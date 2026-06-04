import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

const ALPACA_BASE_URL = 'https://api.alpaca.markets'
const FETCH_TIMEOUT_MS = 15000
const BROKER_ID = 'alpaca'
const BROKER_NAME = 'Alpaca'

function mapAssetClass(assetClass, symbol) {
  const cls = (assetClass || '').toLowerCase()
  if (cls === 'us_equity' || cls === 'equity') return 'Stock'
  if (cls === 'crypto') return 'Crypto'
  if (cls === 'options' || cls === 'option') return 'Option'
  if (cls === 'fixed_income' || cls === 'bond') return 'Bond'
  // ETF detection heuristic: common ETF symbols
  if (cls === 'us_equity') {
    const etfPattern = /^(SPY|QQQ|IVV|VOO|VTI|VEA|VWO|BND|AGG|GLD|SLV|IWM|EFA|EEM|TLT|XLF|XLK|XLE|XLV|ARKK|VNQ|SCHD|VIG|IEMG|IJR|IWF|IWD|VGT|VUG|VTV)\b/i
    if (etfPattern.test(symbol)) return 'ETF'
  }
  return 'Stock'
}

function validateApiKey(key) {
  if (!key || typeof key !== 'string') return false
  if (key.length < 10 || key.length > 100) return false
  return /^[A-Za-z0-9]+$/.test(key)
}

function validateApiSecret(secret) {
  if (!secret || typeof secret !== 'string') return false
  if (secret.length < 10 || secret.length > 200) return false
  return /^[A-Za-z0-9/+=]+$/.test(secret)
}

function classifyError(errMsg) {
  const msg = (errMsg || '').toLowerCase()
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid key'))
    return { errorCode: 'INVALID_CREDENTIALS', error: 'API key or secret is invalid. Check your Alpaca credentials.' }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many'))
    return { errorCode: 'RATE_LIMITED', error: 'Alpaca rate limit reached. Try again in a few minutes.' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'Alpaca did not respond in time. Try again later.' }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed'))
    return { errorCode: 'NETWORK_ERROR', error: 'Could not connect to Alpaca. Check your internet connection.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Unknown Alpaca error.' }
}

async function alpacaFetch(endpoint, apiKey, apiSecret) {
  const res = await fetch(`${ALPACA_BASE_URL}${endpoint}`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('unauthorized')
    }
    if (res.status === 429) {
      throw new Error('rate limit')
    }
    throw new Error(text || `Alpaca API returned ${res.status}`)
  }

  return res.json()
}

function parsePositions(positions) {
  if (!Array.isArray(positions)) return []

  return positions
    .filter((p) => p && p.symbol && parseFloat(p.qty) !== 0)
    .map((p) => ({
      symbol: p.symbol.toUpperCase(),
      name: p.symbol.toUpperCase(),
      quantity: Math.abs(parseFloat(p.qty) || 0),
      purchasePrice: parseFloat(p.avg_entry_price) || 0,
      currentPrice: parseFloat(p.current_price) || 0,
      currency: 'USD',
      type: mapAssetClass(p.asset_class, p.symbol),
      institution: BROKER_NAME,
      isDebt: parseFloat(p.qty) < 0,
      _source: BROKER_ID,
    }))
}

function getCredentialsPath(uid) {
  return getAdminDb()
    .collection('users')
    .doc(uid)
    .collection('brokerConnections')
    .doc(BROKER_ID)
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 20 })
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
  const validActions = ['save-credentials', 'get-credentials', 'sync']
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // --- save-credentials ---
  if (action === 'save-credentials') {
    const { apiKey, apiSecret } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (apiKey && apiSecret) {
        if (!validateApiKey(apiKey)) {
          return NextResponse.json({ error: 'Invalid API key format. Must be 10-100 alphanumeric characters.' }, { status: 400 })
        }
        if (!validateApiSecret(apiSecret)) {
          return NextResponse.json({ error: 'Invalid API secret format. Must be 10-200 characters.' }, { status: 400 })
        }

        // Verify credentials by calling the account endpoint
        try {
          await alpacaFetch('/v2/account', apiKey, apiSecret)
        } catch (err) {
          const classified = classifyError(err.message)
          return NextResponse.json({ error: `Credential verification failed: ${classified.error}`, errorCode: classified.errorCode }, { status: 400 })
        }

        const docRef = getCredentialsPath(uid)
        await docRef.set({
          apiKey,
          apiSecret,
          updatedAt: new Date().toISOString(),
        })
      } else {
        // Clear credentials
        const docRef = getCredentialsPath(uid)
        await docRef.delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/alpaca] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  // --- get-credentials ---
  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      const docRef = getCredentialsPath(uid)
      const doc = await docRef.get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        hasApiKey: !!data.apiKey,
        hasApiSecret: !!data.apiSecret,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/alpaca] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  // --- sync ---
  if (action === 'sync') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    let apiKey, apiSecret

    // Resolve credentials: use provided ones or load from Firestore
    if (body.apiKey && body.apiSecret) {
      apiKey = body.apiKey
      apiSecret = body.apiSecret
    } else {
      try {
        const docRef = getCredentialsPath(uid)
        const doc = await docRef.get()
        if (!doc.exists || !doc.data().apiKey || !doc.data().apiSecret) {
          return NextResponse.json({ error: 'No stored credentials found. Save your Alpaca API key and secret first.' }, { status: 400 })
        }
        const data = doc.data()
        apiKey = data.apiKey
        apiSecret = data.apiSecret
      } catch (err) {
        console.error('[api/alpaca] credential-load error:', err.message)
        return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
      }
    }

    if (!validateApiKey(apiKey) || !validateApiSecret(apiSecret)) {
      return NextResponse.json({ error: 'Invalid credential format' }, { status: 400 })
    }

    try {
      // Fetch positions from Alpaca
      const rawPositions = await alpacaFetch('/v2/positions', apiKey, apiSecret)
      const positions = parsePositions(rawPositions)

      if (positions.length === 0) {
        return NextResponse.json({
          errorCode: 'EMPTY_PORTFOLIO',
          error: 'No positions found in your Alpaca account.',
          positions: [],
          count: 0,
        })
      }

      // Update lastSync timestamp on the credentials doc
      try {
        const docRef = getCredentialsPath(uid)
        await docRef.set({ lastSync: new Date().toISOString() }, { merge: true })
      } catch (err) {
        console.error('[api/alpaca] lastSync update error:', err.message)
        // Non-fatal: still return positions
      }

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const classified = classifyError(err.message)
      console.error('[api/alpaca] sync error:', err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
