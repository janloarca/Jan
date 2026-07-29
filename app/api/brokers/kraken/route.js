import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { createHmac, createHash } from 'crypto'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.kraken.com'

// Kraken uses non-standard asset codes
const ASSET_MAP = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XLTC: 'LTC',
  XXRP: 'XRP',
  XXLM: 'XLM',
  XDAO: 'DAO',
  XETC: 'ETC',
  XREP: 'REP',
  XXMR: 'XMR',
  XZEC: 'ZEC',
  XMLN: 'MLN',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZGBP: 'GBP',
  ZJPY: 'JPY',
  ZCAD: 'CAD',
  ZAUD: 'AUD',
}

const FIAT_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'ZUSD', 'ZEUR', 'ZGBP', 'ZJPY', 'ZCAD', 'ZAUD'])

// Map Kraken's ticker pair names to standard pairs
const PAIR_MAP = {
  XXBTZUSD: 'BTC/USD',
  XETHZUSD: 'ETH/USD',
  XXBTZEUR: 'BTC/EUR',
  XETHZEUR: 'ETH/EUR',
  XLTCZUSD: 'LTC/USD',
  XXRPZUSD: 'XRP/USD',
  XXLMZUSD: 'XLM/USD',
  XETCZUSD: 'ETC/USD',
  XXMRZUSD: 'XMR/USD',
  XZECZUSD: 'ZEC/USD',
}

function normalizeAsset(code) {
  if (ASSET_MAP[code]) return ASSET_MAP[code]
  // Strip leading X or Z for 4-char codes (Kraken convention)
  if (code.length === 4 && (code.startsWith('X') || code.startsWith('Z'))) {
    return code.slice(1)
  }
  return code
}

function isFiat(code) {
  return FIAT_CODES.has(code) || FIAT_CODES.has(normalizeAsset(code))
}

function krakenSign(path, nonce, postData, apiSecret) {
  const message = nonce + postData
  const hash = createHash('sha256').update(message).digest()
  const secret = Buffer.from(apiSecret, 'base64')
  const hmac = createHmac('sha512', secret)
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64')
  return hmac
}

async function krakenPrivate(path, apiKey, apiSecret) {
  // Nonce + signature are regenerated INSIDE the attempt factory: a retried
  // request must not reuse a nonce Kraken already consumed.
  const res = await retryRequest(() => {
    const nonce = Date.now().toString()
    const postData = `nonce=${nonce}`
    const signature = krakenSign(path, nonce, postData, apiSecret)
    return fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postData,
      signal: AbortSignal.timeout(15000),
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 403 || res.status === 401) throw new Error('Invalid API credentials')
    throw new Error(`Kraken API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  if (data.error && data.error.length > 0) {
    const errMsg = data.error.join(', ')
    if (errMsg.includes('Invalid key') || errMsg.includes('Permission denied')) {
      throw new Error('Invalid API credentials')
    }
    throw new Error(`Kraken error: ${errMsg}`)
  }

  return data.result
}

async function krakenPublic(path) {
  const res = await retryRequest(() => fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(15000) }))
  if (!res.ok) {
    throw new Error(`Kraken public API error ${res.status}`)
  }
  const data = await res.json()
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken error: ${data.error.join(', ')}`)
  }
  return data.result
}

function buildTickerPairs(balances) {
  const pairs = []
  for (const code of Object.keys(balances)) {
    const symbol = normalizeAsset(code)
    if (isFiat(code)) continue
    const bal = parseFloat(balances[code]) || 0
    if (bal <= 0) continue
    // Try common pair formats
    pairs.push(`${symbol}USD`)
  }
  return [...new Set(pairs)]
}

function extractPrice(tickerResult, symbol) {
  // tickerResult keys use Kraken's pair format, e.g., XXBTZUSD, XETHZUSD, or BTCUSD
  for (const [pairKey, data] of Object.entries(tickerResult)) {
    const normalizedPair = PAIR_MAP[pairKey] || pairKey
    // Check if this pair corresponds to symbol/USD
    if (
      normalizedPair === `${symbol}/USD` ||
      normalizedPair === `${symbol}USD` ||
      pairKey === `${symbol}USD` ||
      pairKey === `X${symbol}ZUSD` ||
      pairKey === `XX${symbol.toLowerCase()}ZUSD`
    ) {
      // c[0] is the last trade closed price
      if (data.c && data.c[0]) return parseFloat(data.c[0])
    }
  }
  return 0
}

async function syncPositions(apiKey, apiSecret) {
  // Fetch balances
  const balances = await krakenPrivate('/0/private/Balance', apiKey, apiSecret)

  // Determine which pairs to fetch prices for
  const cryptoSymbols = []
  for (const [code, amount] of Object.entries(balances)) {
    const bal = parseFloat(amount) || 0
    if (bal <= 0) continue
    if (!isFiat(code)) {
      cryptoSymbols.push({ code, symbol: normalizeAsset(code), balance: bal })
    }
  }

  // Fetch ticker prices for all crypto assets.
  // Kraken fails the WHOLE batched Ticker request with EQuery:Unknown asset pair if a
  // single pair is unknown — and staked assets (ETH2.S, DOT.S, ADA.S) have no USD book,
  // so one staked coin used to zero the price of EVERY position while the sync still
  // reported success. Fall back to pricing pair-by-pair so one bad pair costs only
  // itself, and report which ones we could not price.
  let tickerResult = {}
  const unpriced = []
  if (cryptoSymbols.length > 0) {
    const pairs = buildTickerPairs(balances)
    if (pairs.length > 0) {
      try {
        tickerResult = await krakenPublic(`/0/public/Ticker?pair=${pairs.join(',')}`)
      } catch {
        for (const p of pairs) {
          try {
            const one = await krakenPublic(`/0/public/Ticker?pair=${p}`)
            Object.assign(tickerResult, one || {})
          } catch { unpriced.push(p) }
        }
      }
    }
  }

  const positions = []

  // Process crypto balances
  for (const { code, symbol, balance } of cryptoSymbols) {
    const price = extractPrice(tickerResult, symbol)
    positions.push({
      symbol,
      name: symbol,
      quantity: balance,
      purchasePrice: 0,
      currentPrice: price,
      currency: 'USD',
      type: 'Crypto',
      institution: 'Kraken',
      isDebt: false,
      _source: 'kraken',
    })
  }

  // Process fiat balances
  for (const [code, amount] of Object.entries(balances)) {
    const bal = parseFloat(amount) || 0
    if (bal <= 0 || !isFiat(code)) continue
    const symbol = normalizeAsset(code)
    positions.push({
      symbol: `CASH-${symbol}`,
      name: `Cash (${symbol})`,
      quantity: 1,
      purchasePrice: Math.abs(bal),
      currentPrice: Math.abs(bal),
      currency: symbol,
      type: 'Bank',
      institution: 'Kraken',
      isDebt: bal < 0,
      _source: 'kraken',
    })
  }

  return positions
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 20 })
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
    let { apiKey, apiSecret } = body

    if (!apiKey || apiKey === '__stored__') {
      const db = getAdminDb()
      if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('kraken').get()
      if (!doc.exists || !doc.data().apiKey || !doc.data().apiSecret) {
        return NextResponse.json({ error: 'No stored API credentials. Enter your Kraken API key and secret.' }, { status: 400 })
      }
      // An undecryptable vault credential must read as a friendly re-save prompt,
      // not an unhandled 500 (which Next renders as HTML that the client's
      // safeJson then chokes on).
      try {
        apiKey = await decryptToken(doc.data().apiKey, uid)
        apiSecret = await decryptToken(doc.data().apiSecret, uid)
      } catch {
        return NextResponse.json({ error: 'No pudimos leer tus credenciales guardadas. Vuelve a ingresarlas.', errorCode: 'CREDENTIALS_UNREADABLE' }, { status: 400 })
      }
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API key and secret are required' }, { status: 400 })
    }

    try {
      const positions = await syncPositions(apiKey, apiSecret)
      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const status = err.message.includes('Invalid API credentials') ? 401 : 502
      return NextResponse.json({
        error: err.message,
        detail: 'Verifica que tu API key de Kraken sea valida y tenga permisos de lectura.',
      }, { status })
    }
  }

  if (action === 'save-credentials') {
    const { apiKey, apiSecret } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      if (apiKey && apiSecret) {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('kraken').set({
          apiKey: await encryptToken(apiKey, uid),
          apiSecret: await encryptToken(apiSecret, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('kraken').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/kraken] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('kraken').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      return NextResponse.json({
        configured: true,
        hasKey: !!doc.data().apiKey,
        hasSecret: !!doc.data().apiSecret,
        lastSync: doc.data().lastSync || null,
      })
    } catch (err) {
      console.error('[api/kraken] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
