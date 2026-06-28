import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.blockchain.com/v3/exchange'

async function bcFetch(path, apiKey, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, v)
  })
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Token': apiKey },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('Invalid API key')
    throw new Error(`Blockchain.com API error ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchAllPages(path, apiKey, key = null) {
  const all = []
  let to = null
  for (let page = 0; page < 20; page++) {
    const params = { limit: 100 }
    if (to) params.to = to
    const data = await bcFetch(path, apiKey, params)
    const items = key ? data[key] : (Array.isArray(data) ? data : [])
    if (!items || items.length === 0) break
    all.push(...items)
    if (items.length < 100) break
    const oldest = items.reduce((min, it) => {
      const ts = it.timestamp || 0
      return ts < min ? ts : min
    }, Infinity)
    if (!isFinite(oldest)) break
    to = oldest - 1
  }
  return all
}

function mapBalances(accountsData) {
  const items = []
  const primary = accountsData.primary || accountsData
  const balances = Array.isArray(primary) ? primary : Object.values(primary)

  balances.forEach(b => {
    const currency = b.currency || ''
    const balance = parseFloat(b.balance) || 0
    if (balance <= 0 || !currency) return

    const isStable = /^(USD|EUR|GBP|USDT|USDC|DAI|BUSD)$/i.test(currency)
    items.push({
      symbol: currency.toUpperCase(),
      name: currency.toUpperCase(),
      quantity: balance,
      purchasePrice: parseFloat(b.rate) || 0,
      currentPrice: parseFloat(b.rate) || 0,
      currency: 'USD',
      type: isStable ? 'Bank' : 'Crypto',
      institution: 'Blockchain.com',
      _source: 'blockchain',
    })
  })
  return items
}

function mapTrades(trades) {
  return trades.map(t => {
    const isBuy = (t.side || '').toUpperCase() === 'BUY'
    const symbol = (t.symbol || '').replace('-', '/')
    const qty = parseFloat(t.cumQty || t.lastShares || t.orderQty) || 0
    const price = parseFloat(t.avgPx || t.lastPx || t.price) || 0
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: symbol,
      description: `${symbol} — ${isBuy ? 'Buy' : 'Sell'} ${qty} @ ${price}`,
      date: t.timestamp ? new Date(t.timestamp).toISOString().split('T')[0] : '',
      quantity: Math.abs(qty),
      pricePerUnit: price,
      totalAmount: qty * price,
      currency: 'USD',
      _bcOrdId: t.exOrdId,
      _source: 'blockchain',
    }
  })
}

function mapDeposits(deposits) {
  return deposits
    .filter(d => (d.state || '').toUpperCase() === 'COMPLETED')
    .map(d => ({
      type: 'DEPOSIT',
      symbol: d.currency || '',
      description: `Deposit ${parseFloat(d.amount) || 0} ${d.currency || ''}`,
      date: d.timestamp ? new Date(d.timestamp).toISOString().split('T')[0] : '',
      quantity: parseFloat(d.amount) || 0,
      totalAmount: parseFloat(d.amount) || 0,
      currency: d.currency || 'USD',
      _source: 'blockchain',
    }))
}

function mapWithdrawals(withdrawals) {
  return withdrawals
    .filter(w => (w.state || '').toUpperCase() === 'COMPLETED')
    .map(w => ({
      type: 'WITHDRAWAL',
      symbol: w.currency || '',
      description: `Withdrawal ${parseFloat(w.amount) || 0} ${w.currency || ''} (fee: ${parseFloat(w.fee) || 0})`,
      date: w.timestamp ? new Date(w.timestamp).toISOString().split('T')[0] : '',
      quantity: parseFloat(w.amount) || 0,
      totalAmount: parseFloat(w.amount) || 0,
      fee: parseFloat(w.fee) || 0,
      currency: w.currency || 'USD',
      _source: 'blockchain',
    }))
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body

  if (!action || !['sync', 'save-credentials', 'get-credentials'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (action === 'sync') {
    let { apiKey } = body

    if (!apiKey || apiKey === '__stored__') {
      const db = getAdminDb()
      if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
      const doc = await db.collection('users').doc(uid).collection('settings').doc('blockchain').get()
      if (!doc.exists || !doc.data().apiKey) {
        return NextResponse.json({ error: 'No stored API key. Enter your Blockchain.com API key.' }, { status: 400 })
      }
      apiKey = await decryptToken(doc.data().apiKey, uid)
    }

    try {
      const [accountsData, tradesRaw, depositsRaw, withdrawalsRaw] = await Promise.all([
        bcFetch('/accounts', apiKey),
        fetchAllPages('/trades', apiKey),
        fetchAllPages('/deposits', apiKey),
        fetchAllPages('/withdrawals', apiKey),
      ])

      const positions = mapBalances(accountsData)
      const trades = mapTrades(tradesRaw)
      const deposits = mapDeposits(depositsRaw)
      const withdrawals = mapWithdrawals(withdrawalsRaw)

      return NextResponse.json({
        positions,
        trades,
        deposits,
        withdrawals,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const status = err.message.includes('Invalid API key') ? 401 : 502
      return NextResponse.json({
        error: err.message,
        detail: 'Verifica que tu API key de Blockchain.com sea válida y tenga permisos de lectura.',
      }, { status })
    }
  }

  if (action === 'save-credentials') {
    const { apiKey } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      if (apiKey) {
        await db.collection('users').doc(uid).collection('settings').doc('blockchain').set({
          apiKey: await encryptToken(apiKey, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('settings').doc('blockchain').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/blockchain] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('settings').doc('blockchain').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      return NextResponse.json({
        configured: true,
        hasKey: !!doc.data().apiKey,
        lastSync: doc.data().lastSync || null,
      })
    } catch (err) {
      console.error('[api/blockchain] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
