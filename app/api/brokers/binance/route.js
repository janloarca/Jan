import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.binance.com'

// Crypto name mapping for common assets
const CRYPTO_NAMES = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  BNB: 'BNB',
  SOL: 'Solana',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  MATIC: 'Polygon',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  LTC: 'Litecoin',
  FIL: 'Filecoin',
  NEAR: 'NEAR Protocol',
  APT: 'Aptos',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  SHIB: 'Shiba Inu',
  USDT: 'Tether',
  USDC: 'USD Coin',
  BUSD: 'Binance USD',
  DAI: 'Dai',
}

function getCryptoName(symbol) {
  return CRYPTO_NAMES[symbol] || symbol
}

function signQuery(queryString, secretKey) {
  return createHmac('sha256', secretKey).update(queryString).digest('hex')
}

async function binanceFetch(path, apiKey, apiSecret, params = {}) {
  const timestamp = Date.now()
  const searchParams = new URLSearchParams({ ...params, timestamp: String(timestamp) })
  const queryString = searchParams.toString()
  const signature = signQuery(queryString, apiSecret)
  searchParams.set('signature', signature)

  const url = `${BASE_URL}${path}?${searchParams.toString()}`
  const res = await fetch(url, {
    headers: { 'X-MBX-APIKEY': apiKey },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key or insufficient permissions')
    }
    throw new Error(`Binance API error ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json()
}

async function fetchTickerPrices() {
  const res = await fetch(`${BASE_URL}/api/v3/ticker/price`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch ticker prices: ${res.status}`)
  }
  return res.json()
}

function buildPriceMap(tickers) {
  const map = {}
  for (const t of tickers) {
    map[t.symbol] = parseFloat(t.price) || 0
  }
  return map
}

function getUsdPrice(asset, priceMap) {
  if (asset === 'USDT' || asset === 'USDC' || asset === 'BUSD' || asset === 'USD') return 1
  const usdtPair = `${asset}USDT`
  if (priceMap[usdtPair]) return priceMap[usdtPair]
  const busdPair = `${asset}BUSD`
  if (priceMap[busdPair]) return priceMap[busdPair]
  const usdcPair = `${asset}USDC`
  if (priceMap[usdcPair]) return priceMap[usdcPair]
  return 0
}

function mapPositions(balances, priceMap) {
  const positions = []
  for (const b of balances) {
    const asset = b.asset
    const free = parseFloat(b.free) || 0
    const locked = parseFloat(b.locked) || 0
    const quantity = free + locked
    if (quantity <= 0) continue

    const currentPrice = getUsdPrice(asset, priceMap)

    positions.push({
      symbol: asset,
      name: getCryptoName(asset),
      quantity,
      purchasePrice: 0,
      currentPrice,
      currency: 'USD',
      type: 'Crypto',
      institution: 'Binance',
      isDebt: false,
      _source: 'binance',
    })
  }
  return positions
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 20 })
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
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('binance').get()
      if (!doc.exists || !doc.data().apiKey || !doc.data().apiSecret) {
        return NextResponse.json({ error: 'No stored credentials. Enter your Binance API key and secret.' }, { status: 400 })
      }
      const data = doc.data()
      apiKey = await decryptToken(data.apiKey, uid)
      apiSecret = await decryptToken(data.apiSecret, uid)
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API key and secret are required' }, { status: 400 })
    }

    try {
      const [accountData, tickers] = await Promise.all([
        binanceFetch('/api/v3/account', apiKey, apiSecret),
        fetchTickerPrices(),
      ])

      const priceMap = buildPriceMap(tickers)
      const positions = mapPositions(accountData.balances || [], priceMap)

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const status = err.message.includes('Invalid API key') ? 401 : 502
      return NextResponse.json({
        error: err.message,
        detail: 'Verify your Binance API key is valid and has read permissions enabled.',
      }, { status })
    }
  }

  if (action === 'save-credentials') {
    const { apiKey, apiSecret } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (apiKey && apiSecret) {
        // Validate format: alphanumeric, ~64 chars
        if (!/^[a-zA-Z0-9]{20,128}$/.test(apiKey)) {
          return NextResponse.json({ error: 'Invalid API key format. Expected alphanumeric, ~64 characters.' }, { status: 400 })
        }
        if (!/^[a-zA-Z0-9]{20,128}$/.test(apiSecret)) {
          return NextResponse.json({ error: 'Invalid API secret format.' }, { status: 400 })
        }

        await db.collection('users').doc(uid).collection('brokerConnections').doc('binance').set({
          apiKey: await encryptToken(apiKey, uid),
          apiSecret: await encryptToken(apiSecret, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('binance').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/binance] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('binance').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        hasKey: !!data.apiKey,
        hasSecret: !!data.apiSecret,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/binance] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
