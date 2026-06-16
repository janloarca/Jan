import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const TASTYTRADE_BASE_URL = 'https://api.tastyworks.com'
const FETCH_TIMEOUT_MS = 15000
const BROKER_ID = 'tastytrade'
const BROKER_NAME = 'Tastytrade'

function mapInstrumentType(instrumentType, symbol) {
  const t = (instrumentType || '').toLowerCase()
  if (t === 'cryptocurrency') return 'Crypto'
  if (t === 'equity option' || t === 'option') return 'Option'
  // ETF detection heuristic
  const etfPattern = /^(SPY|QQQ|IVV|VOO|VTI|VEA|VWO|BND|AGG|GLD|SLV|IWM|EFA|EEM|TLT|XLF|XLK|XLE|XLV|ARKK|VNQ|SCHD|VIG|IEMG|IJR|IWF|IWD|VGT|VUG|VTV)\b/i
  if (etfPattern.test(symbol)) return 'ETF'
  if (t === 'equity' || t === 'stock') return 'Stock'
  return 'Stock'
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false
  if (username.length < 3 || username.length > 50) return false
  return /^[A-Za-z0-9._@+-]+$/.test(username)
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false
  if (password.length < 6 || password.length > 128) return false
  return true
}

function classifyError(errMsg) {
  const msg = (errMsg || '').toLowerCase()
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid credentials') || msg.includes('invalid login'))
    return { errorCode: 'INVALID_CREDENTIALS', error: 'Username or password is invalid. Check your Tastytrade credentials.' }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many'))
    return { errorCode: 'RATE_LIMITED', error: 'Tastytrade rate limit reached. Try again in a few minutes.' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'Tastytrade did not respond in time. Try again later.' }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed'))
    return { errorCode: 'NETWORK_ERROR', error: 'Could not connect to Tastytrade. Check your internet connection.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Unknown Tastytrade error.' }
}

async function createSession(username, password) {
  const res = await fetch(`${TASTYTRADE_BASE_URL}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ login: username, password }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('unauthorized')
    }
    if (res.status === 429) {
      throw new Error('rate limit')
    }
    const text = await res.text().catch(() => '')
    throw new Error(text || `Tastytrade API returned ${res.status}`)
  }

  const json = await res.json()
  const sessionToken = json?.data?.['session-token']
  if (!sessionToken) {
    throw new Error('No session token in response')
  }
  return sessionToken
}

async function tastytradeFetch(endpoint, sessionToken) {
  const res = await fetch(`${TASTYTRADE_BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': sessionToken,
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
    throw new Error(text || `Tastytrade API returned ${res.status}`)
  }

  return res.json()
}

function parsePositions(positions) {
  if (!Array.isArray(positions)) return []

  return positions
    .filter((p) => p && (p['underlying-symbol'] || p.symbol) && parseFloat(p.quantity) !== 0)
    .map((p) => {
      const qty = parseFloat(p.quantity) || 0
      const symbol = (p['underlying-symbol'] || p.symbol || '').toUpperCase()
      return {
        symbol,
        name: symbol,
        quantity: Math.abs(qty),
        purchasePrice: parseFloat(p['average-open-price']) || 0,
        currentPrice: parseFloat(p['close-price']) || parseFloat(p.mark) || 0,
        currency: 'USD',
        type: mapInstrumentType(p['instrument-type'], symbol),
        institution: BROKER_NAME,
        isDebt: qty < 0,
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
    const { username, password } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (username && password) {
        if (!validateUsername(username)) {
          return NextResponse.json({ error: 'Invalid username format. Must be 3-50 characters (alphanumeric, ., _, @, +, -).' }, { status: 400 })
        }
        if (!validatePassword(password)) {
          return NextResponse.json({ error: 'Invalid password format. Must be 6-128 characters.' }, { status: 400 })
        }

        // Verify credentials by creating a session
        try {
          await createSession(username, password)
        } catch (err) {
          const classified = classifyError(err.message)
          return NextResponse.json({ error: `Credential verification failed: ${classified.error}`, errorCode: classified.errorCode }, { status: 400 })
        }

        const docRef = getCredentialsPath(uid)
        await docRef.set({
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
      console.error('[api/tastytrade] save-credentials error:', err.message)
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
        hasUsername: !!data.username,
        hasPassword: !!data.password,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/tastytrade] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  // --- sync ---
  if (action === 'sync') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    let username, password

    // Resolve credentials: use provided ones or load from Firestore
    if (body.username && body.password) {
      username = body.username
      password = body.password
    } else {
      try {
        const docRef = getCredentialsPath(uid)
        const doc = await docRef.get()
        if (!doc.exists || !doc.data().username || !doc.data().password) {
          return NextResponse.json({ error: 'No stored credentials found. Save your Tastytrade username and password first.' }, { status: 400 })
        }
        const data = doc.data()
        username = await decryptToken(data.username, uid)
        password = await decryptToken(data.password, uid)
      } catch (err) {
        console.error('[api/tastytrade] credential-load error:', err.message)
        return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
      }
    }

    if (!validateUsername(username) || !validatePassword(password)) {
      return NextResponse.json({ error: 'Invalid credential format' }, { status: 400 })
    }

    try {
      // Create a session
      const sessionToken = await createSession(username, password)

      // Fetch accounts
      const accountsResponse = await tastytradeFetch('/customers/me/accounts', sessionToken)
      const accounts = accountsResponse?.data?.items || accountsResponse?.data || []

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return NextResponse.json({
          errorCode: 'EMPTY_PORTFOLIO',
          error: 'No accounts found in your Tastytrade account.',
          positions: [],
          count: 0,
        })
      }

      // Fetch positions for all accounts
      let allPositions = []
      for (const account of accounts) {
        const accountNumber = account['account-number'] || account.accountNumber || account.account?.['account-number']
        if (!accountNumber) continue

        try {
          const positionsResponse = await tastytradeFetch(`/accounts/${accountNumber}/positions`, sessionToken)
          const rawPositions = positionsResponse?.data?.items || positionsResponse?.data || []
          const parsed = parsePositions(rawPositions)
          allPositions = allPositions.concat(parsed)
        } catch (err) {
          console.error(`[api/tastytrade] positions error for account ${accountNumber}:`, err.message)
          // Continue with other accounts
        }
      }

      if (allPositions.length === 0) {
        return NextResponse.json({
          errorCode: 'EMPTY_PORTFOLIO',
          error: 'No positions found in your Tastytrade account.',
          positions: [],
          count: 0,
        })
      }

      // Update lastSync timestamp on the credentials doc
      try {
        const docRef = getCredentialsPath(uid)
        await docRef.set({ lastSync: new Date().toISOString() }, { merge: true })
      } catch (err) {
        console.error('[api/tastytrade] lastSync update error:', err.message)
        // Non-fatal: still return positions
      }

      return NextResponse.json({
        positions: allPositions,
        count: allPositions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      const classified = classifyError(err.message)
      console.error('[api/tastytrade] sync error:', err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
