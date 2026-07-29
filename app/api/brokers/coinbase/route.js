import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.coinbase.com'
const API_VERSION = '2023-01-01'

// Crypto name mapping for common assets
const CRYPTO_NAMES = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
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
  DAI: 'Dai',
}

function getCryptoName(symbol) {
  return CRYPTO_NAMES[symbol] || symbol
}

// Coinbase's legacy v2 API (the CB-ACCESS-KEY / CB-VERSION headers below) signs with
// the secret as a PLAIN UTF-8 string and a hex digest. Base64-decoding the secret is
// the Coinbase Pro/Exchange convention, and that one wants a base64 digest — this
// function used to mix the two, so it matched NEITHER. Buffer.from(x,'base64') never
// throws on non-base64 input, it just yields garbage bytes, so every request 401'd and
// the UI told the user their brand-new, correct key was "invalid".
function signRequest(timestamp, method, requestPath, body, secretKey) {
  const message = timestamp + method.toUpperCase() + requestPath + (body || '')
  return createHmac('sha256', secretKey).update(message).digest('hex')
}

async function coinbaseFetch(path, apiKey, apiSecret) {
  const url = `${BASE_URL}${path}`
  // Timestamp and signature are built INSIDE the attempt factory: Coinbase rejects
  // stale timestamps, so a retry must re-sign rather than replay the first stamp.
  const res = await retryRequest(() => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signRequest(timestamp, 'GET', path, '', apiSecret)
    return fetch(url, {
      headers: {
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-VERSION': API_VERSION,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key or insufficient permissions')
    }
    throw new Error(`Coinbase API error ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json()
}

async function fetchAllAccounts(apiKey, apiSecret) {
  const allAccounts = []
  let path = '/v2/accounts?limit=100'

  for (let page = 0; page < 20; page++) {
    const response = await coinbaseFetch(path, apiKey, apiSecret)
    const accounts = response.data || []
    allAccounts.push(...accounts)

    // Check for pagination
    if (response.pagination && response.pagination.next_uri) {
      path = response.pagination.next_uri
    } else {
      break
    }
  }

  return allAccounts
}

function mapPositions(accounts) {
  const positions = []

  for (const account of accounts) {
    const balance = parseFloat(account.balance?.amount) || 0
    if (balance <= 0) continue

    const symbol = account.balance?.currency || account.currency?.code || ''
    if (!symbol) continue

    const nativeAmount = parseFloat(account.native_balance?.amount) || 0
    const currentPrice = balance > 0 ? nativeAmount / balance : 0

    positions.push({
      symbol,
      name: account.currency?.name || getCryptoName(symbol),
      quantity: balance,
      purchasePrice: 0,
      currentPrice,
      currency: account.native_balance?.currency || 'USD',
      type: 'Crypto',
      institution: 'Coinbase',
      isDebt: false,
      _source: 'coinbase',
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
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('coinbase').get()
      if (!doc.exists || !doc.data().apiKey || !doc.data().apiSecret) {
        return NextResponse.json({ error: 'No stored credentials. Enter your Coinbase API key and secret.' }, { status: 400 })
      }
      const data = doc.data()
      // An undecryptable vault credential must read as a friendly re-save prompt,
      // not an unhandled 500 (which Next renders as HTML that the client's
      // safeJson then chokes on).
      try {
        apiKey = await decryptToken(data.apiKey, uid)
        apiSecret = await decryptToken(data.apiSecret, uid)
      } catch {
        return NextResponse.json({ error: 'No pudimos leer tus credenciales guardadas. Vuelve a ingresarlas.', errorCode: 'CREDENTIALS_UNREADABLE' }, { status: 400 })
      }
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API key and secret are required' }, { status: 400 })
    }

    try {
      const accounts = await fetchAllAccounts(apiKey, apiSecret)
      const positions = mapPositions(accounts)

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const status = err.message.includes('Invalid API key') ? 401 : 502
      return NextResponse.json({
        error: err.message,
        detail: 'Verify your Coinbase API key is valid and has the required permissions.',
      }, { status })
    }
  }

  if (action === 'save-credentials') {
    const { apiKey, apiSecret } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (apiKey && apiSecret) {
        if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 256) {
          return NextResponse.json({ error: 'Invalid API key format.' }, { status: 400 })
        }
        if (typeof apiSecret !== 'string' || apiSecret.length < 10 || apiSecret.length > 256) {
          return NextResponse.json({ error: 'Invalid API secret format.' }, { status: 400 })
        }

        await db.collection('users').doc(uid).collection('brokerConnections').doc('coinbase').set({
          apiKey: await encryptToken(apiKey, uid),
          apiSecret: await encryptToken(apiSecret, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('brokerConnections').doc('coinbase').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/coinbase] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('brokerConnections').doc('coinbase').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        hasKey: !!data.apiKey,
        hasSecret: !!data.apiSecret,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/coinbase] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
