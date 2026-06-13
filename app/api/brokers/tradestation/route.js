import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { generateOAuthState, makeStateCookie } from '@/lib/oauthState'

export const dynamic = 'force-dynamic'

const BROKER_ID = 'tradestation'
const BROKER_NAME = 'TradeStation'
const AUTH_URL = 'https://signin.tradestation.com/authorize'
const TOKEN_URL = 'https://signin.tradestation.com/oauth/token'
const API_BASE = 'https://api.tradestation.com/v3'
const FETCH_TIMEOUT_MS = 15000

function getCredentialsPath(uid) {
  return getAdminDb().collection('users').doc(uid).collection('brokerConnections').doc(BROKER_ID)
}

function getAppCredentials() {
  const clientId = process.env.TRADESTATION_CLIENT_ID
  const clientSecret = process.env.TRADESTATION_CLIENT_SECRET
  const redirectUri = process.env.TRADESTATION_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

async function exchangeCodeForTokens(code, app) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
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
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function tsFetch(endpoint, accessToken) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TradeStation API ${res.status}: ${text}`)
  }
  return res.json()
}

function mapAssetType(assetType) {
  const t = (assetType || '').toUpperCase()
  if (t === 'STOCK' || t === 'EQUITY') return 'Stock'
  if (t === 'STOCKOPTION' || t === 'OPTION') return 'Option'
  if (t === 'FUTURE') return 'Futures'
  if (t === 'FOREX' || t === 'FX') return 'Forex'
  if (t === 'CRYPTO' || t === 'CRYPTOCURRENCY') return 'Crypto'
  return 'Stock'
}

function parsePositions(data) {
  const positions = data.Positions || data.positions || []
  return positions
    .filter(p => p.Symbol && parseFloat(p.Quantity) !== 0)
    .map(p => ({
      symbol: (p.Symbol || '').toUpperCase(),
      name: p.Description || p.Symbol || '',
      quantity: Math.abs(parseFloat(p.Quantity) || 0),
      purchasePrice: parseFloat(p.AveragePrice) || 0,
      currentPrice: parseFloat(p.Last) || parseFloat(p.MarketValue) / Math.abs(parseFloat(p.Quantity) || 1) || 0,
      currency: 'USD',
      type: mapAssetType(p.AssetType),
      institution: BROKER_NAME,
      isDebt: parseFloat(p.Quantity) < 0,
      _source: BROKER_ID,
      _unrealizedPL: parseFloat(p.UnrealizedPL) || 0,
    }))
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
    if (!app) return NextResponse.json({ error: 'TradeStation OAuth not configured. Set TRADESTATION_CLIENT_ID, TRADESTATION_CLIENT_SECRET, TRADESTATION_REDIRECT_URI env vars.' }, { status: 503 })
    const { state, nonce } = generateOAuthState(BROKER_ID)
    const scope = 'openid offline_access profile ReadAccount'
    const url = `${AUTH_URL}?response_type=code&client_id=${encodeURIComponent(app.clientId)}&redirect_uri=${encodeURIComponent(app.redirectUri)}&audience=https://api.tradestation.com&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`
    const res = NextResponse.json({ url })
    res.headers.set('Set-Cookie', makeStateCookie(nonce))
    return res
  }

  if (action === 'exchange-code') {
    const app = getAppCredentials()
    if (!app) return NextResponse.json({ error: 'TradeStation OAuth not configured' }, { status: 503 })
    const { code } = body
    if (!code) return NextResponse.json({ error: 'Authorization code required' }, { status: 400 })

    try {
      const tokens = await exchangeCodeForTokens(code, app)
      const docRef = getCredentialsPath(uid)
      await docRef.set({
        accessToken: await encryptToken(tokens.access_token, uid),
        refreshToken: await encryptToken(tokens.refresh_token, uid),
        expiresAt: new Date(Date.now() + (tokens.expires_in || 1200) * 1000).toISOString(),
        tokenType: 'oauth',
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({ saved: true, configured: true })
    } catch (err) {
      console.error('[api/tradestation] exchange-code error:', err.message)
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
  }

  if (action === 'save-credentials') {
    if (!body.accessToken) {
      await getCredentialsPath(uid).delete().catch(() => {})
      return NextResponse.json({ saved: true })
    }
    return NextResponse.json({ error: 'Use OAuth flow to connect TradeStation' }, { status: 400 })
  }

  if (action === 'get-credentials') {
    try {
      const doc = await getCredentialsPath(uid).get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: !!data.accessToken,
        tokenType: 'oauth',
        lastSync: data.lastSync || null,
        expiresAt: data.expiresAt || null,
      })
    } catch (err) {
      console.error('[api/tradestation] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  if (action === 'sync') {
    try {
      const doc = await getCredentialsPath(uid).get()
      if (!doc.exists || !doc.data().accessToken) {
        return NextResponse.json({ error: 'Not connected. Use OAuth to link TradeStation first.' }, { status: 400 })
      }
      let { accessToken: encAccess, refreshToken: encRefresh, expiresAt } = doc.data()
      let accessToken = await decryptToken(encAccess, uid)
      let refreshToken = await decryptToken(encRefresh, uid)
      const app = getAppCredentials()

      if (expiresAt && new Date(expiresAt) < new Date() && refreshToken && app) {
        try {
          const tokens = await refreshAccessToken(refreshToken, app)
          accessToken = tokens.access_token
          if (tokens.refresh_token) refreshToken = tokens.refresh_token
          await getCredentialsPath(uid).set({
            accessToken: await encryptToken(accessToken, uid),
            refreshToken: await encryptToken(refreshToken, uid),
            expiresAt: new Date(Date.now() + (tokens.expires_in || 1200) * 1000).toISOString(),
            tokenType: 'oauth', updatedAt: new Date().toISOString(),
          }, { merge: true })
        } catch (err) {
          console.error('[api/tradestation] token refresh failed:', err.message)
          return NextResponse.json({ error: 'Token expired. Please re-link TradeStation.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
        }
      }

      const accountsData = await tsFetch('/brokerage/accounts', accessToken)
      const accounts = accountsData.Accounts || accountsData.accounts || []
      const allPositions = []

      for (const acct of accounts) {
        const accountId = acct.AccountID || acct.accountId
        if (!accountId) continue
        try {
          const data = await tsFetch(`/brokerage/accounts/${accountId}/positions`, accessToken)
          allPositions.push(...parsePositions(data))
        } catch (err) {
          console.error(`[api/tradestation] account ${accountId} error:`, err.message)
        }
      }

      await getCredentialsPath(uid).set({ lastSync: new Date().toISOString() }, { merge: true })

      return NextResponse.json({
        positions: allPositions,
        count: allPositions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[api/tradestation] sync error:', err.message)
      if (err.message.includes('401') || err.message.includes('403')) {
        return NextResponse.json({ error: 'Token expired. Please re-link TradeStation.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
      }
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
