import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const IG_BASE_URL = 'https://api.ig.com/gateway/deal'
const FETCH_TIMEOUT_MS = 15000
const BROKER_ID = 'ig'
const BROKER_NAME = 'IG Markets'

function mapInstrumentType(instrumentType) {
  const t = (instrumentType || '').toUpperCase()
  if (t === 'SHARES') return 'Stock'
  if (t === 'CURRENCIES') return 'Forex'
  if (t === 'COMMODITIES') return 'Commodity'
  if (t === 'INDICES') return 'ETF'
  if (t === 'CRYPTOCURRENCIES') return 'Crypto'
  return 'Stock'
}

function validateApiKey(key) {
  if (!key || typeof key !== 'string') return false
  if (key.length < 30 || key.length > 50) return false
  return /^[A-Za-z0-9-]+$/.test(key)
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false
  if (username.length < 3 || username.length > 50) return false
  return true
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false
  if (password.length < 6 || password.length > 128) return false
  return true
}

function classifyError(errMsg) {
  const msg = (errMsg || '').toLowerCase()
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid') || msg.includes('authentication'))
    return { errorCode: 'INVALID_CREDENTIALS', error: 'API key, username, or password is invalid. Check your IG Markets credentials.' }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many'))
    return { errorCode: 'RATE_LIMITED', error: 'IG Markets rate limit reached. Try again in a few minutes.' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'IG Markets did not respond in time. Try again later.' }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed'))
    return { errorCode: 'NETWORK_ERROR', error: 'Could not connect to IG Markets. Check your internet connection.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Unknown IG Markets error.' }
}

async function igCreateSession(apiKey, username, password) {
  const res = await retryRequest(() => fetch(`${IG_BASE_URL}/session`, {
    method: 'POST',
    headers: {
      'X-IG-API-KEY': apiKey,
      'VERSION': '2',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ identifier: username, password }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }))

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('unauthorized')
    }
    if (res.status === 429) {
      throw new Error('rate limit')
    }
    throw new Error(text || `IG API returned ${res.status}`)
  }

  const cst = res.headers.get('CST')
  const securityToken = res.headers.get('X-SECURITY-TOKEN')

  if (!cst || !securityToken) {
    throw new Error('authentication failed: missing session tokens')
  }

  const body = await res.json()
  return { cst, securityToken, accountInfo: body }
}

async function igFetch(endpoint, apiKey, cst, securityToken) {
  const res = await retryRequest(() => fetch(`${IG_BASE_URL}${endpoint}`, {
    headers: {
      'X-IG-API-KEY': apiKey,
      'CST': cst,
      'X-SECURITY-TOKEN': securityToken,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }))

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('unauthorized')
    }
    if (res.status === 429) {
      throw new Error('rate limit')
    }
    throw new Error(text || `IG API returned ${res.status}`)
  }

  return res.json()
}

function parsePositions(data) {
  const positions = data?.positions
  if (!Array.isArray(positions)) return []

  return positions
    .filter((p) => p && p.market && p.position && p.position.size !== 0)
    .map((p) => {
      const { position, market } = p
      const isShort = position.direction === 'SELL'
      const quantity = isShort ? -Math.abs(position.size) : Math.abs(position.size)

      return {
        symbol: market.epic || '',
        name: market.instrumentName || market.epic || '',
        quantity,
        purchasePrice: parseFloat(position.level) || 0,
        currentPrice: parseFloat(market.bid) || 0,
        currency: position.currency || 'USD',
        type: mapInstrumentType(market.instrumentType),
        institution: BROKER_NAME,
        isDebt: isShort,
        _source: BROKER_ID,
      }
    })
}

function getCredentialsPath(uid) {
  return getAdminDb()
    .collection('users')
    .doc(uid)
    .collection('brokerConnections')
    .doc(BROKER_ID)
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 20 })
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
    const { apiKey, username, password } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (apiKey && username && password) {
        if (!validateApiKey(apiKey)) {
          return NextResponse.json({ error: 'Invalid API key format. Must be 30-50 alphanumeric characters or dashes.' }, { status: 400 })
        }
        if (!validateUsername(username)) {
          return NextResponse.json({ error: 'Invalid username format. Must be 3-50 characters.' }, { status: 400 })
        }
        if (!validatePassword(password)) {
          return NextResponse.json({ error: 'Invalid password format. Must be 6-128 characters.' }, { status: 400 })
        }

        // Verify credentials by creating a session
        try {
          await igCreateSession(apiKey, username, password)
        } catch (err) {
          const classified = classifyError(err.message)
          return NextResponse.json({ error: `Credential verification failed: ${classified.error}`, errorCode: classified.errorCode }, { status: 400 })
        }

        const docRef = getCredentialsPath(uid)
        await docRef.set({
          apiKey: await encryptToken(apiKey, uid),
          username: await encryptToken(username, uid),
          password: await encryptToken(password, uid),
          updatedAt: new Date().toISOString(),
        })
      } else {
        // Clear credentials
        const docRef = getCredentialsPath(uid)
        await docRef.delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/ig] save-credentials error:', err.message)
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
        hasUsername: !!data.username,
        hasPassword: !!data.password,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/ig] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  // --- sync ---
  if (action === 'sync') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    let apiKey, username, password

    // Resolve credentials: use provided ones or load from Firestore
    if (body.apiKey && body.username && body.password) {
      apiKey = body.apiKey
      username = body.username
      password = body.password
    } else {
      try {
        const docRef = getCredentialsPath(uid)
        const doc = await docRef.get()
        if (!doc.exists || !doc.data().apiKey || !doc.data().username || !doc.data().password) {
          return NextResponse.json({ error: 'No stored credentials found. Save your IG Markets API key, username, and password first.' }, { status: 400 })
        }
        const data = doc.data()
        apiKey = await decryptToken(data.apiKey, uid)
        username = await decryptToken(data.username, uid)
        password = await decryptToken(data.password, uid)
      } catch (err) {
        console.error('[api/ig] credential-load error:', err.message)
        return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
      }
    }

    if (!validateApiKey(apiKey) || !validateUsername(username) || !validatePassword(password)) {
      return NextResponse.json({ error: 'Invalid credential format' }, { status: 400 })
    }

    try {
      // Create session with IG Markets
      const { cst, securityToken } = await igCreateSession(apiKey, username, password)

      // Fetch positions
      const rawPositions = await igFetch('/positions', apiKey, cst, securityToken)
      const positions = parsePositions(rawPositions)

      if (positions.length === 0) {
        return NextResponse.json({
          errorCode: 'EMPTY_PORTFOLIO',
          error: 'No positions found in your IG Markets account.',
          positions: [],
          count: 0,
        })
      }

      // Update lastSync timestamp on the credentials doc
      try {
        const docRef = getCredentialsPath(uid)
        await docRef.set({ lastSync: new Date().toISOString() }, { merge: true })
      } catch (err) {
        console.error('[api/ig] lastSync update error:', err.message)
        // Non-fatal: still return positions
      }

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const classified = classifyError(err.message)
      console.error('[api/ig] sync error:', err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
