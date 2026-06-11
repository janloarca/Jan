import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const ETORO_BASE_URL = 'https://api.etoro.com'
const FETCH_TIMEOUT_MS = 15000
const BROKER_ID = 'etoro'
const BROKER_NAME = 'eToro'

function mapAssetType(assetType) {
  const t = (assetType || '').toLowerCase()
  if (t === 'stock' || t === 'stocks' || t === 'equity') return 'Stock'
  if (t === 'etf' || t === 'etfs') return 'ETF'
  if (t === 'crypto' || t === 'cryptocurrency' || t === 'cryptoasset') return 'Crypto'
  if (t === 'commodity' || t === 'commodities') return 'Commodity'
  if (t === 'currency' || t === 'currencies' || t === 'forex') return 'Forex'
  if (t === 'index' || t === 'indices') return 'Index'
  if (t === 'bond' || t === 'bonds') return 'Bond'
  if (t === 'option' || t === 'options') return 'Option'
  return 'Stock'
}

function validateApiKey(key) {
  if (!key || typeof key !== 'string') return false
  if (key.length < 8 || key.length > 200) return false
  return /^[A-Za-z0-9._\-]+$/.test(key)
}

function validateUserKey(key) {
  if (!key || typeof key !== 'string') return false
  if (key.length < 8 || key.length > 200) return false
  return /^[A-Za-z0-9._\-]+$/.test(key)
}

function classifyError(errMsg) {
  const msg = (errMsg || '').toLowerCase()
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid'))
    return { errorCode: 'INVALID_CREDENTIALS', error: 'API key or user key is invalid. Check your eToro credentials.' }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many'))
    return { errorCode: 'RATE_LIMITED', error: 'eToro rate limit reached. Try again in a few minutes.' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'eToro did not respond in time. Try again later.' }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed'))
    return { errorCode: 'NETWORK_ERROR', error: 'Could not connect to eToro. Check your internet connection.' }
  if (msg.includes('not found') || msg.includes('404'))
    return { errorCode: 'NOT_FOUND', error: 'eToro API endpoint not found. The API may have changed.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Unknown eToro error.' }
}

async function etoroFetch(endpoint, apiKey, userKey) {
  const res = await fetch(`${ETORO_BASE_URL}${endpoint}`, {
    headers: {
      'x-api-key': apiKey,
      'x-user-key': userKey,
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
    if (res.status === 404) {
      throw new Error('not found')
    }
    throw new Error(text || `eToro API returned ${res.status}`)
  }

  return res.json()
}

async function fetchPortfolio(apiKey, userKey) {
  // Try primary endpoint first
  try {
    const data = await etoroFetch('/api/v1/portfolio', apiKey, userKey)
    if (data && (Array.isArray(data) || Array.isArray(data.positions) || Array.isArray(data.Positions))) {
      return data
    }
  } catch (err) {
    // If it's an auth error, throw immediately rather than trying the fallback
    if (err.message.includes('unauthorized')) throw err
    if (err.message.includes('rate limit')) throw err
    // Otherwise try fallback endpoint
  }

  // Try fallback endpoint
  const data = await etoroFetch('/api/v1/portfolio/positions', apiKey, userKey)
  return data
}

function extractPositions(data) {
  // Handle various response shapes from eToro
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.positions)) return data.positions
  if (data && Array.isArray(data.Positions)) return data.Positions
  if (data && Array.isArray(data.data)) return data.data
  return []
}

function parsePositions(rawPositions) {
  if (!Array.isArray(rawPositions)) return []

  return rawPositions
    .filter((p) => p && (p.InstrumentId || p.instrumentId || p.symbol))
    .map((p) => {
      const isBuy = p.IsBuy !== undefined ? p.IsBuy : (p.isBuy !== undefined ? p.isBuy : true)
      const quantity = Math.abs(
        parseFloat(p.Amount || p.amount || p.Units || p.units || p.quantity || p.Quantity || 0)
      )
      const openRate = parseFloat(p.OpenRate || p.openRate || p.avgOpenPrice || 0)
      const currentRate = parseFloat(p.CurrentRate || p.currentRate || p.currentPrice || 0)
      const assetType = p.AssetType || p.assetType || p.InstrumentType || p.instrumentType || ''
      const symbol = (p.symbol || p.Symbol || p.TickerSymbol || p.tickerSymbol || p.InstrumentDisplayName || p.instrumentDisplayName || `ETORO-${p.InstrumentId || p.instrumentId}`)
      const name = p.InstrumentDisplayName || p.instrumentDisplayName || p.name || p.Name || symbol

      return {
        symbol: symbol.toUpperCase(),
        name,
        quantity,
        purchasePrice: openRate,
        currentPrice: currentRate,
        currency: (p.currency || p.Currency || 'USD').toUpperCase(),
        type: mapAssetType(assetType),
        institution: BROKER_NAME,
        isDebt: !isBuy,
        _source: BROKER_ID,
        _etoroInstrumentId: p.InstrumentId || p.instrumentId || undefined,
      }
    })
    .filter((p) => p.quantity > 0)
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
    const { apiKey, userKey } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (apiKey && userKey) {
        if (!validateApiKey(apiKey)) {
          return NextResponse.json({ error: 'Invalid API key format. Must be 8-200 characters (alphanumeric, dots, hyphens, underscores).' }, { status: 400 })
        }
        if (!validateUserKey(userKey)) {
          return NextResponse.json({ error: 'Invalid user key format. Must be 8-200 characters (alphanumeric, dots, hyphens, underscores).' }, { status: 400 })
        }

        // Verify credentials by trying to fetch portfolio
        try {
          await fetchPortfolio(apiKey, userKey)
        } catch (err) {
          const classified = classifyError(err.message)
          return NextResponse.json({ error: `Credential verification failed: ${classified.error}`, errorCode: classified.errorCode }, { status: 400 })
        }

        const docRef = getCredentialsPath(uid)
        await docRef.set({
          apiKey: await encryptToken(apiKey, uid),
          userKey: await encryptToken(userKey, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        // Clear credentials
        const docRef = getCredentialsPath(uid)
        await docRef.delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/etoro] save-credentials error:', err.message)
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
        hasUserKey: !!data.userKey,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/etoro] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  // --- sync ---
  if (action === 'sync') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    let apiKey, userKey

    // Resolve credentials: use provided ones or load from Firestore
    if (body.apiKey && body.userKey) {
      apiKey = body.apiKey
      userKey = body.userKey
    } else {
      try {
        const docRef = getCredentialsPath(uid)
        const doc = await docRef.get()
        if (!doc.exists || !doc.data().apiKey || !doc.data().userKey) {
          return NextResponse.json({ error: 'No stored credentials found. Save your eToro API key and user key first.' }, { status: 400 })
        }
        const data = doc.data()
        apiKey = await decryptToken(data.apiKey, uid)
        userKey = await decryptToken(data.userKey, uid)
      } catch (err) {
        console.error('[api/etoro] credential-load error:', err.message)
        return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
      }
    }

    if (!validateApiKey(apiKey) || !validateUserKey(userKey)) {
      return NextResponse.json({ error: 'Invalid credential format' }, { status: 400 })
    }

    try {
      // Fetch portfolio from eToro
      const rawData = await fetchPortfolio(apiKey, userKey)
      const rawPositions = extractPositions(rawData)
      const positions = parsePositions(rawPositions)

      if (positions.length === 0) {
        return NextResponse.json({
          errorCode: 'EMPTY_PORTFOLIO',
          error: 'No positions found in your eToro account.',
          positions: [],
          count: 0,
        })
      }

      // Update lastSync timestamp on the credentials doc
      try {
        const docRef = getCredentialsPath(uid)
        await docRef.set({ lastSync: new Date().toISOString() }, { merge: true })
      } catch (err) {
        console.error('[api/etoro] lastSync update error:', err.message)
        // Non-fatal: still return positions
      }

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const classified = classifyError(err.message)
      console.error('[api/etoro] sync error:', err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
