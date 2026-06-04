import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

const BROKER_ID = 'schwab'
const BROKER_NAME = 'Charles Schwab'
const AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'
const API_BASE = 'https://api.schwabapi.com/trader/v1'
const FETCH_TIMEOUT_MS = 15000

function getCredentialsPath(uid) {
  return getAdminDb().collection('users').doc(uid).collection('brokerConnections').doc(BROKER_ID)
}

function getAppCredentials() {
  const clientId = process.env.SCHWAB_CLIENT_ID
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET
  const redirectUri = process.env.SCHWAB_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

async function exchangeCodeForTokens(code, app) {
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: app.redirectUri,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function refreshAccessToken(refreshToken, app) {
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function schwabFetch(endpoint, accessToken) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Schwab API ${res.status}: ${text}`)
  }
  return res.json()
}

function parsePositions(accounts) {
  const positions = []
  for (const account of accounts) {
    const acct = account.securitiesAccount || account
    const acctPositions = acct.positions || []
    for (const p of acctPositions) {
      const inst = p.instrument || {}
      const qty = p.longQuantity || p.shortQuantity || 0
      if (qty === 0) continue
      positions.push({
        symbol: (inst.symbol || '').toUpperCase(),
        name: inst.description || inst.symbol || '',
        quantity: Math.abs(qty),
        purchasePrice: p.averagePrice || 0,
        currentPrice: p.marketValue ? p.marketValue / Math.abs(qty) : p.averagePrice || 0,
        currency: 'USD',
        type: mapAssetType(inst.assetType),
        institution: BROKER_NAME,
        isDebt: (p.shortQuantity || 0) > 0,
        _source: BROKER_ID,
      })
    }
  }
  return positions
}

function mapAssetType(assetType) {
  const t = (assetType || '').toUpperCase()
  if (t === 'EQUITY') return 'Stock'
  if (t === 'MUTUAL_FUND' || t === 'ETF') return 'Fund'
  if (t === 'FIXED_INCOME' || t === 'BOND') return 'Bond'
  if (t === 'OPTION') return 'Option'
  if (t === 'CASH_EQUIVALENT') return 'Bank'
  return 'Stock'
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 20 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  if (action === 'get-auth-url') {
    const app = getAppCredentials()
    if (!app) return NextResponse.json({ error: 'Schwab OAuth not configured. Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, SCHWAB_REDIRECT_URI env vars.' }, { status: 503 })
    const url = `${AUTH_URL}?client_id=${encodeURIComponent(app.clientId)}&redirect_uri=${encodeURIComponent(app.redirectUri)}&response_type=code`
    return NextResponse.json({ url })
  }

  if (action === 'exchange-code') {
    const app = getAppCredentials()
    if (!app) return NextResponse.json({ error: 'Schwab OAuth not configured' }, { status: 503 })
    const { code } = body
    if (!code) return NextResponse.json({ error: 'Authorization code required' }, { status: 400 })

    try {
      const tokens = await exchangeCodeForTokens(code, app)
      const docRef = getCredentialsPath(uid)
      await docRef.set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString(),
        tokenType: 'oauth',
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({ saved: true, configured: true })
    } catch (err) {
      console.error('[api/schwab] exchange-code error:', err.message)
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
  }

  if (action === 'save-credentials') {
    if (!body.accessToken) {
      const docRef = getCredentialsPath(uid)
      await docRef.delete().catch(() => {})
      return NextResponse.json({ saved: true })
    }
    return NextResponse.json({ error: 'Use OAuth flow (get-auth-url → exchange-code) to connect Schwab' }, { status: 400 })
  }

  if (action === 'get-credentials') {
    try {
      const docRef = getCredentialsPath(uid)
      const doc = await docRef.get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: !!data.accessToken,
        tokenType: data.tokenType || 'oauth',
        lastSync: data.lastSync || null,
        expiresAt: data.expiresAt || null,
      })
    } catch (err) {
      console.error('[api/schwab] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  if (action === 'sync') {
    try {
      const docRef = getCredentialsPath(uid)
      const doc = await docRef.get()
      if (!doc.exists || !doc.data().accessToken) {
        return NextResponse.json({ error: 'Not connected. Use OAuth to link Schwab first.' }, { status: 400 })
      }
      let { accessToken, refreshToken, expiresAt } = doc.data()
      const app = getAppCredentials()

      if (expiresAt && new Date(expiresAt) < new Date() && refreshToken && app) {
        try {
          const tokens = await refreshAccessToken(refreshToken, app)
          accessToken = tokens.access_token
          if (tokens.refresh_token) refreshToken = tokens.refresh_token
          await docRef.set({
            accessToken,
            refreshToken,
            expiresAt: new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString(),
            tokenType: 'oauth',
            updatedAt: new Date().toISOString(),
          }, { merge: true })
        } catch (err) {
          console.error('[api/schwab] token refresh failed:', err.message)
          return NextResponse.json({ error: 'Token expired. Please re-link your Schwab account.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
        }
      }

      const accountNumbers = await schwabFetch('/accounts/accountNumbers', accessToken)
      const allPositions = []

      for (const acct of accountNumbers) {
        const hash = acct.hashValue
        if (!hash) continue
        try {
          const data = await schwabFetch(`/accounts/${hash}?fields=positions`, accessToken)
          const parsed = parsePositions([data])
          allPositions.push(...parsed)
        } catch (err) {
          console.error(`[api/schwab] account ${acct.accountNumber} error:`, err.message)
        }
      }

      await docRef.set({ lastSync: new Date().toISOString() }, { merge: true })

      return NextResponse.json({
        positions: allPositions,
        count: allPositions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[api/schwab] sync error:', err.message)
      if (err.message.includes('401') || err.message.includes('403')) {
        return NextResponse.json({ error: 'Token expired. Please re-link your Schwab account.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
      }
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
