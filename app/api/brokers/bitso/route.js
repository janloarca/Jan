import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { createHmac } from 'crypto'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.bitso.com'

const FIAT_CODES = new Set(['mxn', 'usd', 'ars', 'brl', 'cop'])

// Common crypto name mappings
const CRYPTO_NAMES = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  xrp: 'XRP',
  ltc: 'Litecoin',
  bch: 'Bitcoin Cash',
  tusd: 'TrueUSD',
  mana: 'Decentraland',
  bat: 'Basic Attention Token',
  doge: 'Dogecoin',
  dai: 'Dai',
  uni: 'Uniswap',
  comp: 'Compound',
  link: 'Chainlink',
  aave: 'Aave',
  sol: 'Solana',
  matic: 'Polygon',
  dot: 'Polkadot',
  ada: 'Cardano',
  avax: 'Avalanche',
  atom: 'Cosmos',
  shib: 'Shiba Inu',
  usdt: 'Tether',
  usdc: 'USD Coin',
}

function bitsoSign(nonce, method, requestPath, body, apiSecret) {
  let message = nonce + method + requestPath
  if (body) message += JSON.stringify(body)
  return createHmac('sha256', apiSecret).update(message).digest('hex')
}

async function bitsoFetch(method, path, apiKey, apiSecret, body = null) {
  const nonce = Date.now().toString()
  const requestPath = `/v3${path}`
  const signature = bitsoSign(nonce, method, requestPath, body, apiSecret)

  const headers = {
    Authorization: `Bitso ${apiKey}:${nonce}:${signature}`,
    'Content-Type': 'application/json',
  }

  const url = `${BASE_URL}${requestPath}`
  const options = { method, headers }
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API credentials')
    throw new Error(`Bitso API error ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.success) {
    const errMsg = data.error?.message || 'Unknown Bitso error'
    if (errMsg.includes('Invalid') || errMsg.includes('Unauthorized')) {
      throw new Error('Invalid API credentials')
    }
    throw new Error(`Bitso error: ${errMsg}`)
  }

  return data.payload
}

async function bitsoPublic(path) {
  const res = await fetch(`${BASE_URL}/v3${path}`)
  if (!res.ok) {
    throw new Error(`Bitso public API error ${res.status}`)
  }
  const data = await res.json()
  if (!data.success) {
    throw new Error(`Bitso error: ${data.error?.message || 'Unknown error'}`)
  }
  return data.payload
}

async function getAvailableBooks() {
  try {
    const books = await bitsoPublic('/available_books')
    return books.map(b => b.book)
  } catch {
    return []
  }
}

async function getPrice(currency, availableBooks) {
  const lower = currency.toLowerCase()

  // Try USD pair first
  const usdBook = `${lower}_usd`
  if (availableBooks.includes(usdBook)) {
    try {
      const ticker = await bitsoPublic(`/ticker?book=${usdBook}`)
      return { price: parseFloat(ticker.last) || 0, currency: 'USD' }
    } catch {
      // Fall through to MXN
    }
  }

  // Try MXN pair
  const mxnBook = `${lower}_mxn`
  if (availableBooks.includes(mxnBook)) {
    try {
      const ticker = await bitsoPublic(`/ticker?book=${mxnBook}`)
      return { price: parseFloat(ticker.last) || 0, currency: 'MXN' }
    } catch {
      // No price available
    }
  }

  return { price: 0, currency: 'USD' }
}

async function syncPositions(apiKey, apiSecret) {
  // Fetch balances and available books in parallel
  const [balances, availableBooks] = await Promise.all([
    bitsoFetch('GET', '/balance', apiKey, apiSecret),
    getAvailableBooks(),
  ])

  const balanceList = balances.balances || []
  const nonZero = balanceList.filter(b => parseFloat(b.total) > 0)

  // Fetch prices for crypto assets
  const cryptoBalances = nonZero.filter(b => !FIAT_CODES.has(b.currency.toLowerCase()))
  const priceMap = {}

  // Fetch prices sequentially to avoid rate limiting
  for (const b of cryptoBalances) {
    priceMap[b.currency] = await getPrice(b.currency, availableBooks)
  }

  const positions = []

  for (const b of nonZero) {
    const currencyCode = b.currency.toLowerCase()
    const symbol = b.currency.toUpperCase()
    const total = parseFloat(b.total) || 0

    if (FIAT_CODES.has(currencyCode)) {
      // Fiat balance
      positions.push({
        symbol: `CASH-${symbol}`,
        name: `Cash (${symbol})`,
        quantity: 1,
        purchasePrice: total,
        currentPrice: total,
        currency: symbol,
        type: 'Bank',
        institution: 'Bitso',
        isDebt: false,
        _source: 'bitso',
      })
    } else {
      // Crypto balance
      const priceInfo = priceMap[b.currency] || { price: 0, currency: 'USD' }
      positions.push({
        symbol,
        name: CRYPTO_NAMES[currencyCode] || symbol,
        quantity: total,
        purchasePrice: 0,
        currentPrice: priceInfo.price,
        currency: priceInfo.currency,
        type: 'Crypto',
        institution: 'Bitso',
        isDebt: false,
        _source: 'bitso',
      })
    }
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
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('bitso').get()
      if (!doc.exists || !doc.data().apiKey || !doc.data().apiSecret) {
        return NextResponse.json({ error: 'No stored API credentials. Enter your Bitso API key and secret.' }, { status: 400 })
      }
      apiKey = await decryptToken(doc.data().apiKey, uid)
      apiSecret = await decryptToken(doc.data().apiSecret, uid)
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
        detail: 'Verifica que tu API key de Bitso sea valida y tenga permisos de lectura.',
      }, { status })
    }
  }

  if (action === 'save-credentials') {
    const { apiKey, apiSecret } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      if (apiKey && apiSecret) {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('bitso').set({
          apiKey: await encryptToken(apiKey, uid),
          apiSecret: await encryptToken(apiSecret, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('bitso').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/bitso] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('bitso').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      return NextResponse.json({
        configured: true,
        hasKey: !!doc.data().apiKey,
        hasSecret: !!doc.data().apiSecret,
        lastSync: doc.data().lastSync || null,
      })
    } catch (err) {
      console.error('[api/bitso] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
