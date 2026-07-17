import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { parseEquitySummary } from '@/lib/parsers/ibkrEquitySummary'
import { parseCashPositions } from '@/lib/parsers/ibkrCashReport'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FLEX_REQUEST_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest'
const FLEX_FETCH_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement'

const REQUEST_ATTEMPTS = 5
const REQUEST_DELAYS = [0, 5000, 15000, 25000, 40000]
const FETCH_TIMEOUT_MS = 15000
const POLL_TIMEOUT_MS = 10000

// Legacy sync constants (kept for backward compat)
const LEGACY_POLL_ATTEMPTS = 8
const LEGACY_POLL_DELAY_MS = 3000

function classifyError(errMsg) {
  const msg = (errMsg || '').toLowerCase()
  // IBKR lockout after repeated failed logins ("Too many failed attempts. Please
  // review your configuration."). MUST be fatal: every retry counts as another
  // failed login and refreshes the lock — the old UNKNOWN classification let the
  // 30-min auto-sync keep the account blocked indefinitely.
  if (msg.includes('too many failed attempts') || msg.includes('review your configuration'))
    return { errorCode: 'LOCKED', error: 'IBKR bloqueó temporalmente el acceso por intentos fallidos. Verifica que tu Flex Token siga vigente (suelen expirar), genera uno nuevo si hace falta, y reintenta en ~1 hora.' }
  if (msg.includes('invalid token') || msg.includes('token is not valid') || msg.includes('not authenticated'))
    return { errorCode: 'TOKEN_EXPIRED', error: 'Tu Flex Token expiró o es inválido. Genera uno nuevo en IBKR.' }
  if (msg.includes('invalid query') || msg.includes('no matching flex') || msg.includes('query id'))
    return { errorCode: 'INVALID_QUERY', error: 'El Query ID no existe o no está activo. Verifica en IBKR → Flex Queries.' }
  if (msg.includes('try again') || msg.includes('could not be generated') || msg.includes('please try'))
    return { errorCode: 'RATE_LIMITED', error: 'IBKR está ocupado generando el reporte. Reintentando...' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'IBKR no respondió a tiempo. Intenta de nuevo en unos minutos.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Error desconocido de IBKR.' }
}

function parseFlexPositions(xml) {
  const positions = []
  const posRegex = /<OpenPosition[^>]*\/>/g
  let match
  while ((match = posRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const symbol = attr('symbol')
    const qty = parseFloat(attr('position')) || 0
    if (!symbol || qty === 0) continue
    positions.push({
      symbol: symbol.toUpperCase(),
      name: attr('description') || symbol,
      quantity: Math.abs(qty),
      purchasePrice: parseFloat(attr('costBasisPrice')) || 0,
      currentPrice: parseFloat(attr('markPrice')) || parseFloat(attr('closePrice')) || 0,
      currency: attr('currency') || 'USD',
      type: mapAssetCategory(attr('assetCategory'), attr('putCall')),
      institution: 'Interactive Brokers',
      acquisitionDate: formatDate(attr('openDateTime')) || undefined,
      isDebt: qty < 0,
      _ibkrAccountId: attr('accountId'),
      _ibkrConId: attr('conid'),
    })
  }
  return positions
}

function parseTrades(xml) {
  const trades = []
  const tradeRegex = /<Trade[^>]*\/>/g
  let match
  while ((match = tradeRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const symbol = attr('symbol')
    if (!symbol) continue
    trades.push({
      symbol: symbol.toUpperCase(),
      description: attr('description') || symbol,
      buySell: attr('buySell'),
      quantity: parseFloat(attr('quantity')) || 0,
      tradePrice: parseFloat(attr('tradePrice')) || 0,
      proceeds: parseFloat(attr('proceeds')) || 0,
      commission: parseFloat(attr('ibCommission') || attr('commission')) || 0,
      currency: attr('currency') || 'USD',
      tradeDate: attr('tradeDate') || attr('dateTime'),
      accountId: attr('accountId'),
      assetCategory: attr('assetCategory'),
      costBasis: parseFloat(attr('cost')) || 0,
      realizedPL: parseFloat(attr('fifoPnlRealized') || attr('realizedPL')) || 0,
    })
  }
  return trades
}

// External cash flows — deposits & withdrawals. These are what Modified Dietz
// needs to strip contributions from performance; without them, an auto-synced
// IBKR portfolio's YTD/MTD return is distorted by unaccounted deposits. IBKR
// tags them type="Deposits/Withdrawals"; the sign of `amount` decides direction.
function parseCashTransactions(xml) {
  const txns = []
  const regex = /<CashTransaction[^>]*\/>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const type = attr('type')
    if (!/deposit|withdrawal/i.test(type)) continue
    const amount = parseFloat(attr('amount')) || 0
    if (amount === 0) continue
    const date = formatDate(attr('dateTime') || attr('reportDate') || attr('settleDate'))
    if (!date) continue
    txns.push({
      amount,
      currency: attr('currency') || 'USD',
      date,
      txnId: attr('transactionID') || '',
      description: attr('description') || '',
      accountId: attr('accountId') || '',
    })
  }
  return txns
}

function mapAssetCategory(cat, putCall) {
  const c = (cat || '').toUpperCase()
  if (c === 'STK' || c === 'STOCK') return 'Stock'
  if (c === 'BOND' || c === 'BILL') return 'Bond'
  if (c === 'FUND' || c === 'ETF') return 'ETF'
  if (c === 'CASH') return 'Bank'
  if (c === 'OPT' || c === 'FOP') return putCall ? `Option (${putCall})` : 'Option'
  if (c === 'FUT') return 'Futures'
  if (c === 'CRYPTO') return 'Crypto'
  if (c === 'WAR') return 'Warrant'
  return c || 'Stock'
}

function formatDate(dt) {
  if (!dt) return undefined
  const clean = dt.replace(/[;,]/g, '').trim()
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return undefined
}

// EquitySummaryByReportDateInBase values are in the account's BASE currency, not
// necessarily USD. Detect that base currency from AccountInformation when present
// so the client can convert; defaults to USD (current behavior) when absent.
function parseBaseCurrency(xml) {
  const m = xml.match(/<AccountInformation\b[^>]*\bcurrency="([^"]+)"/i)
  return (m && m[1] ? m[1].toUpperCase() : 'USD')
}

function parseXmlToData(xml) {
  const positions = parseFlexPositions(xml)
  const cash = parseCashPositions(xml)
  const trades = parseTrades(xml)
  const cashTransactions = parseCashTransactions(xml)
  const baseCurrency = parseBaseCurrency(xml)
  const equityHistory = parseEquitySummary(xml).map((e) => ({ ...e, _equityCurrency: baseCurrency }))
  const all = [...positions, ...cash]

  if (all.length === 0 && trades.length === 0 && cashTransactions.length === 0) {
    return { empty: true }
  }

  return {
    positions: all,
    trades,
    cashTransactions,
    equityHistory,
    count: all.length,
    syncedAt: new Date().toISOString(),
  }
}

async function requestFlexReference(token, queryId) {
  const requestUrl = `${FLEX_REQUEST_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`

  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    if (REQUEST_DELAYS[attempt]) await new Promise((r) => setTimeout(r, REQUEST_DELAYS[attempt]))

    let requestXml
    try {
      const res = await fetch(requestUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      requestXml = await res.text()
    } catch (err) {
      if (attempt === REQUEST_ATTEMPTS - 1) {
        return { error: classifyError(err.name === 'TimeoutError' ? 'timed out' : err.message) }
      }
      continue
    }

    const refMatch = requestXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/)
    if (refMatch) {
      return { referenceCode: refMatch[1] }
    }

    const errMatch = requestXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    const errMsg = errMatch ? errMatch[1] : ''
    const classified = classifyError(errMsg)

    if (classified.errorCode === 'RATE_LIMITED') {
      if (attempt === REQUEST_ATTEMPTS - 1) return { error: classified }
      continue
    }

    return { error: classified }
  }

  return { error: classifyError('timed out') }
}

async function resolveCredentials(body, uid) {
  let { token, queryId } = body
  if (!queryId) {
    return { error: NextResponse.json({ error: 'Query ID is required' }, { status: 400 }) }
  }

  if (!token || token === '__stored__') {
    const db = getAdminDb()
    if (!db) return { error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) }
    const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
    if (!doc.exists || !doc.data().flexToken) {
      return { error: NextResponse.json({ error: 'No stored token found. Enter your Flex Token.' }, { status: 400 }) }
    }
    token = await decryptToken(doc.data().flexToken, uid)
    if (!queryId) queryId = doc.data().flexQueryId
  }

  if (typeof token !== 'string' || typeof queryId !== 'string' || token.length > 200 || queryId.length > 50) {
    return { error: NextResponse.json({ error: 'Invalid credentials format' }, { status: 400 }) }
  }

  if (!/^[a-zA-Z0-9]+$/.test(queryId)) {
    return { error: NextResponse.json({ error: 'Invalid query ID format' }, { status: 400 }) }
  }

  return { token, queryId }
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 40 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action } = body

  const validActions = ['sync', 'request-sync', 'poll-sync', 'save-credentials', 'get-credentials']
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // --- NEW: request-sync (Step 1 — get reference code) ---
  if (action === 'request-sync') {
    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    const result = await requestFlexReference(creds.token, creds.queryId)
    if (result.error) {
      return NextResponse.json(result.error, { status: 502 })
    }

    return NextResponse.json({ referenceCode: result.referenceCode, status: 'pending' })
  }

  // --- NEW: poll-sync (Step 2 — poll for result) ---
  if (action === 'poll-sync') {
    const { referenceCode } = body
    if (!referenceCode || typeof referenceCode !== 'string') {
      return NextResponse.json({ error: 'referenceCode is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    const fetchUrl = `${FLEX_FETCH_URL}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(creds.token)}&v=3`

    let fetchXml
    try {
      // A transient blip here used to fail the whole sync after the statement
      // was already generated — retry the download before giving up.
      const fetchRes = await retryRequest(() => fetch(fetchUrl, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }))
      fetchXml = await fetchRes.text()
    } catch (err) {
      const classified = classifyError(err.name === 'TimeoutError' ? 'timed out' : err.message)
      return NextResponse.json({ ...classified, status: 'error' }, { status: 502 })
    }

    if (fetchXml.includes('<FlexStatement') || fetchXml.includes('<OpenPosition')) {
      const data = parseXmlToData(fetchXml)
      if (data.empty) {
        return NextResponse.json({
          errorCode: 'EMPTY_REPORT',
          error: 'El reporte no tiene posiciones ni trades. Verifica que tu Flex Query incluya Open Positions, Trades, Cash Transactions, Cash Report y Equity Summary.',
          status: 'error',
        }, { status: 200 })
      }
      return NextResponse.json({ ...data, status: 'ready' })
    }

    if (fetchXml.includes('Statement generation in progress') || fetchXml.toLowerCase().includes('try again')) {
      return NextResponse.json({ status: 'pending' })
    }

    const errMatch = fetchXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    if (errMatch) {
      const classified = classifyError(errMatch[1])
      return NextResponse.json({ ...classified, status: 'error' }, { status: 502 })
    }

    return NextResponse.json({ status: 'pending' })
  }

  // --- LEGACY: sync (backward compat, with reduced timeouts) ---
  if (action === 'sync') {
    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    try {
      const refResult = await requestFlexReference(creds.token, creds.queryId)
      if (refResult.error) {
        return NextResponse.json(refResult.error, { status: 502 })
      }

      const { referenceCode } = refResult

      for (let i = 0; i < LEGACY_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, LEGACY_POLL_DELAY_MS))
        const fetchUrl = `${FLEX_FETCH_URL}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(creds.token)}&v=3`

        let fetchXml
        try {
          const fetchRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
          fetchXml = await fetchRes.text()
        } catch {
          if (i === LEGACY_POLL_ATTEMPTS - 1) throw new Error('IBKR no respondió a tiempo.')
          continue
        }

        if (fetchXml.includes('<FlexStatement') || fetchXml.includes('<OpenPosition')) {
          const data = parseXmlToData(fetchXml)
          if (data.empty) {
            return NextResponse.json({ error: 'El reporte no tiene posiciones.', errorCode: 'EMPTY_REPORT' }, { status: 200 })
          }
          return NextResponse.json(data)
        }
        if (fetchXml.includes('Statement generation in progress')) continue
        if (fetchXml.toLowerCase().includes('try again')) continue
        const errMatch = fetchXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
        if (errMatch) throw new Error(errMatch[1])
      }
      throw new Error('Flex statement generation timed out')
    } catch (err) {
      const classified = classifyError(err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  if (action === 'save-credentials') {
    const { token, queryId } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (token && queryId) {
        const encryptedToken = await encryptToken(token, uid)
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').set({
          flexToken: encryptedToken,
          flexQueryId: queryId,
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/ibkr] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        flexQueryId: data.flexQueryId,
        hasToken: !!data.flexToken,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/ibkr] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
