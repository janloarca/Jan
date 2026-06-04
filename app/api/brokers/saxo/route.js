import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

const BROKER_ID = 'saxo'
const BROKER_NAME = 'Saxo Bank'
const FETCH_TIMEOUT_MS = 15000

function getEnv() {
  const useSim = process.env.SAXO_USE_SIM === 'true'
  return {
    authUrl: useSim ? 'https://sim.logonvalidation.net/authorize' : 'https://live.logonvalidation.net/authorize',
    tokenUrl: useSim ? 'https://sim.logonvalidation.net/token' : 'https://live.logonvalidation.net/token',
    apiBase: useSim ? 'https://gateway.saxobank.com/sim/openapi' : 'https://gateway.saxobank.com/openapi',
    clientId: process.env.SAXO_CLIENT_ID,
    clientSecret: process.env.SAXO_CLIENT_SECRET,
    redirectUri: process.env.SAXO_REDIRECT_URI,
  }
}

function getCredentialsPath(uid) {
  return getAdminDb().collection('users').doc(uid).collection('brokerConnections').doc(BROKER_ID)
}

function getAppCredentials() {
  const env = getEnv()
  if (!env.clientId || !env.clientSecret || !env.redirectUri) return null
  return env
}

async function exchangeCodeForTokens(code, app) {
  const res = await fetch(app.tokenUrl, {
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
  const res = await fetch(app.tokenUrl, {
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

async function saxoFetch(endpoint, accessToken, apiBase) {
  const res = await fetch(`${apiBase}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Saxo API ${res.status}: ${text}`)
  }
  return res.json()
}

function mapAssetType(assetType) {
  const t = (assetType || '').toLowerCase()
  if (t === 'stock') return 'Stock'
  if (t === 'etf' || t === 'etfs') return 'Fund'
  if (t === 'etn' || t === 'fund' || t === 'mutualfund') return 'Fund'
  if (t === 'bond') return 'Bond'
  if (t === 'cfdonstock' || t === 'cfdonindex' || t === 'cfd') return 'Stock'
  if (t === 'fxspot' || t === 'fxforward') return 'Forex'
  if (t === 'futuresoption' || t === 'stockoption') return 'Option'
  if (t === 'futures' || t === 'futurescontract') return 'Futures'
  return 'Stock'
}

function parsePositions(data) {
  const positions = data.Data || []
  return positions
    .filter(p => {
      const amt = p.PositionBase?.Amount || 0
      return amt !== 0
    })
    .map(p => {
      const base = p.PositionBase || {}
      const view = p.PositionView || {}
      const qty = Math.abs(base.Amount || 0)
      const currentPrice = view.CurrentPrice || view.MarketValue && qty > 0 ? (view.MarketValue || view.Exposure || 0) / qty : 0
      return {
        symbol: (base.SourceOrderId || p.NetPositionId || `SAXO-${base.Uic}`).toUpperCase(),
        name: p.DisplayAndFormat?.Description || base.AssetType || '',
        quantity: qty,
        purchasePrice: view.AverageOpenPrice || view.ConversionRateOpen || 0,
        currentPrice: view.CurrentPrice || currentPrice || 0,
        currency: p.DisplayAndFormat?.Currency || base.Currency || 'USD',
        type: mapAssetType(base.AssetType),
        institution: BROKER_NAME,
        isDebt: (base.Amount || 0) < 0,
        _source: BROKER_ID,
        _unrealizedPL: view.ProfitLossOnTrade || 0,
      }
    })
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
    if (!app) return NextResponse.json({ error: 'Saxo OAuth not configured. Set SAXO_CLIENT_ID, SAXO_CLIENT_SECRET, SAXO_REDIRECT_URI env vars.' }, { status: 503 })
    const url = `${app.authUrl}?response_type=code&client_id=${encodeURIComponent(app.clientId)}&redirect_uri=${encodeURIComponent(app.redirectUri)}&state=saxo`
    return NextResponse.json({ url })
  }

  if (action === 'exchange-code') {
    const app = getAppCredentials()
    if (!app) return NextResponse.json({ error: 'Saxo OAuth not configured' }, { status: 503 })
    const { code } = body
    if (!code) return NextResponse.json({ error: 'Authorization code required' }, { status: 400 })

    try {
      const tokens = await exchangeCodeForTokens(code, app)
      const docRef = getCredentialsPath(uid)
      await docRef.set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + (tokens.expires_in || 1200) * 1000).toISOString(),
        tokenType: 'oauth',
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({ saved: true, configured: true })
    } catch (err) {
      console.error('[api/saxo] exchange-code error:', err.message)
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
  }

  if (action === 'save-credentials') {
    if (!body.accessToken) {
      await getCredentialsPath(uid).delete().catch(() => {})
      return NextResponse.json({ saved: true })
    }
    return NextResponse.json({ error: 'Use OAuth flow to connect Saxo Bank' }, { status: 400 })
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
      console.error('[api/saxo] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  if (action === 'sync') {
    const env = getEnv()
    try {
      const doc = await getCredentialsPath(uid).get()
      if (!doc.exists || !doc.data().accessToken) {
        return NextResponse.json({ error: 'Not connected. Use OAuth to link Saxo Bank first.' }, { status: 400 })
      }
      let { accessToken, refreshToken, expiresAt } = doc.data()
      const app = getAppCredentials()

      if (expiresAt && new Date(expiresAt) < new Date() && refreshToken && app) {
        try {
          const tokens = await refreshAccessToken(refreshToken, app)
          accessToken = tokens.access_token
          if (tokens.refresh_token) refreshToken = tokens.refresh_token
          await getCredentialsPath(uid).set({
            accessToken, refreshToken,
            expiresAt: new Date(Date.now() + (tokens.expires_in || 1200) * 1000).toISOString(),
            tokenType: 'oauth', updatedAt: new Date().toISOString(),
          }, { merge: true })
        } catch (err) {
          console.error('[api/saxo] token refresh failed:', err.message)
          return NextResponse.json({ error: 'Token expired. Please re-link Saxo Bank.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
        }
      }

      const data = await saxoFetch('/port/v1/positions/me', accessToken, env.apiBase)
      const positions = parsePositions(data)

      await getCredentialsPath(uid).set({ lastSync: new Date().toISOString() }, { merge: true })

      return NextResponse.json({
        positions,
        count: positions.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[api/saxo] sync error:', err.message)
      if (err.message.includes('401') || err.message.includes('403')) {
        return NextResponse.json({ error: 'Token expired. Please re-link Saxo Bank.', errorCode: 'TOKEN_EXPIRED' }, { status: 401 })
      }
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
