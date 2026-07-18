import { authFetch } from '@/lib/authFetch'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 30
const REQUEST_RETRIES = 2

async function requestWithRetry(token, queryId, signal, onStatus) {
  for (let attempt = 0; attempt < REQUEST_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Sync cancelado.', 'AbortError')

    if (attempt > 0) {
      if (onStatus) onStatus('requesting-retry', attempt)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 15000)
        if (signal) {
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Sync cancelado.', 'AbortError')) }, { once: true })
        }
      })
    }

    const reqRes = await authFetch('/api/brokers/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request-sync', token, queryId }),
      signal,
    })

    const reqData = await reqRes.json().catch(() => ({}))

    if (reqData.referenceCode) return reqData.referenceCode

    if (reqData.errorCode === 'RATE_LIMITED' && attempt < REQUEST_RETRIES - 1) continue

    const msg = reqData.error || `IBKR sync failed (${reqRes.status})`
    const err = new Error(msg)
    err.errorCode = reqData.errorCode || 'UNKNOWN'
    throw err
  }
}

export async function syncIBKR(token, queryId, { signal, onStatus } = {}) {
  if (onStatus) onStatus('requesting')

  const referenceCode = await requestWithRetry(token, queryId, signal, onStatus)

  if (onStatus) onStatus('polling')

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (signal?.aborted) {
      const err = new Error('Sync cancelado.')
      err.errorCode = 'CANCELLED'
      throw err
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Sync cancelado.', 'AbortError'))
        }, { once: true })
      }
    })

    if (onStatus) onStatus('polling', i + 1, MAX_POLL_ATTEMPTS)

    const pollRes = await authFetch('/api/brokers/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll-sync', referenceCode, token, queryId }),
      signal,
    })

    const pollData = await pollRes.json().catch(() => ({}))

    if (pollData.status === 'ready') {
      if (onStatus) onStatus('processing')
      return formatResult(pollData)
    }

    if (pollData.status === 'error') {
      const msg = pollData.error || `IBKR poll failed (${pollRes.status})`
      const err = new Error(msg)
      err.errorCode = pollData.errorCode || 'UNKNOWN'
      throw err
    }

    // status === 'pending' → continue polling
  }

  const err = new Error('IBKR no respondió después de varios intentos. Intenta de nuevo en unos minutos.')
  err.errorCode = 'TIMEOUT'
  throw err
}

// Map an IBKR cash transaction (deposit/withdrawal) to the canonical flow shape
// Modified Dietz consumes. Mirrors the file-import parser (ibkrFileParser) but
// keeps the real currency and carries transactionID for collision-safe dedup.
export function cashTxToTransaction(ct) {
  const amount = Math.abs(ct.amount || 0)
  const type = (ct.amount || 0) >= 0 ? 'DEPOSIT' : 'WITHDRAWAL'
  return {
    type,
    symbol: 'CASH',
    description: ct.description || (type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'),
    date: ct.date || new Date().toISOString().split('T')[0],
    quantity: 1,
    pricePerUnit: amount,
    totalAmount: amount,
    commission: 0,
    currency: ct.currency || 'USD',
    _ibkrAccountId: ct.accountId || '',
    _ibkrTxnId: ct.txnId || '',
    _source: 'ibkr',
  }
}

function formatResult(data) {
  const accountIds = new Set()

  const items = (data.positions || [])
    .filter(p => p.quantity !== 0)
    .map(p => {
      if (p._ibkrAccountId) accountIds.add(p._ibkrAccountId)
      return {
        symbol: (p.symbol || '').toUpperCase(),
        name: p.name || p.symbol,
        type: p.type || 'Stock',
        quantity: Math.abs(p.quantity || 0),
        purchasePrice: p.purchasePrice || 0,
        currentPrice: p.currentPrice || 0,
        institution: p.institution || 'Interactive Brokers',
        currency: p.currency || 'USD',
        acquisitionDate: p.acquisitionDate,
        conid: p._ibkrConId || '',
        _ibkrAccountId: p._ibkrAccountId || '',
        _isShort: p.isDebt || false,
        _source: 'ibkr',
      }
    })

  const transactions = (data.trades || []).map(t => {
    const isBuy = (t.buySell || '').toUpperCase() === 'BUY'
    if (t.accountId) accountIds.add(t.accountId)
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: (t.symbol || '').toUpperCase(),
      description: `${t.description || t.symbol}: ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(t.quantity)} @ ${t.tradePrice}`,
      date: t.tradeDate || new Date().toISOString().split('T')[0],
      quantity: Math.abs(t.quantity || 0),
      pricePerUnit: t.tradePrice || 0,
      totalAmount: Math.abs(t.proceeds || 0),
      commission: Math.abs(t.commission || 0),
      currency: t.currency || 'USD',
      _ibkrAccountId: t.accountId || '',
      _ibkrCostBasis: t.costBasis,
      _ibkrRealizedPL: t.realizedPL,
      _source: 'ibkr',
    }
  })

  // External deposits/withdrawals — needed so Modified Dietz strips contributions.
  // Dividend rows (kind:'dividend') become DIVIDEND transactions instead: they are
  // income, not external flows, and feed the cash-rewind line + the income module.
  for (const ct of (data.cashTransactions || [])) {
    if (ct.accountId) accountIds.add(ct.accountId)
    if (ct.kind === 'dividend') {
      transactions.push({
        type: 'DIVIDEND',
        symbol: ct.symbol || 'CASH',
        description: ct.description || 'Dividend',
        date: ct.date || new Date().toISOString().split('T')[0],
        quantity: 1,
        pricePerUnit: Math.abs(ct.amount || 0),
        totalAmount: Math.abs(ct.amount || 0),
        commission: 0,
        currency: ct.currency || 'USD',
        _ibkrAccountId: ct.accountId || '',
        _ibkrTxnId: ct.txnId || '',
        _source: 'ibkr',
      })
    } else {
      transactions.push(cashTxToTransaction(ct))
    }
  }

  return {
    items,
    transactions,
    equityHistory: data.equityHistory || [],
    accounts: [...accountIds],
    syncedAt: data.syncedAt,
  }
}
