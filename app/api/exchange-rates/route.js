import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { kvConfigured, kvGetJSON, kvSetJSON } from '@/lib/kvClient'

export const revalidate = 600

let cachedRates = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000

// Last-known-good persisted in KV so a cold serverless instance can still serve
// real (if stale) rates when both upstream providers are down. Best-effort: when
// KV isn't configured we fall back to the in-memory cache alone.
// FASE HS: ver lib/kvClient.js (dos juegos de nombres, sin SDK deprecado).
const KV_KEY = 'fx:last-good'

async function kvReadLastGood() {
  if (!kvConfigured()) return null
  return await kvGetJSON(KV_KEY)
}

async function kvWriteLastGood(rates) {
  if (!kvConfigured()) return
  // 7-day expiry: week-old FX beats a broken dashboard, older than that is noise.
  await kvSetJSON(KV_KEY, { rates, asOf: new Date().toISOString() }, 7 * 86400)
}

async function fetchRates() {
  const now = Date.now()
  if (cachedRates && now - cacheTime < CACHE_TTL) return { rates: cachedRates, stale: false, asOf: new Date(cacheTime).toISOString() }

  const sources = [
    async () => {
      const res = await fetchWithRetry('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 600 } })
      if (!res.ok) throw new Error(`er-api returned ${res.status}`)
      const data = await res.json()
      return data.rates
    },
    async () => {
      const res = await fetchWithRetry('https://api.exchangerate-api.com/v4/latest/USD', { next: { revalidate: 600 } })
      if (!res.ok) throw new Error(`exchangerate-api returned ${res.status}`)
      const data = await res.json()
      return data.rates
    },
  ]

  for (const source of sources) {
    try {
      const rates = await source()
      if (rates && rates.EUR) {
        cachedRates = rates
        cacheTime = now
        kvWriteLastGood(rates) // fire-and-forget
        return { rates, stale: false, asOf: new Date(now).toISOString() }
      }
    } catch (err) {
      console.error('[api/exchange-rates] Source failed:', err.message)
    }
  }

  // A stale cache is still real market data — better than nothing
  if (cachedRates) {
    return { rates: cachedRates, stale: true, asOf: new Date(cacheTime).toISOString() }
  }

  // Cold instance + both providers down: last-known-good from KV.
  const persisted = await kvReadLastGood()
  if (persisted?.rates?.EUR) {
    return { rates: persisted.rates, stale: true, asOf: persisted.asOf }
  }

  // No data at all: signal failure instead of pretending 1:1 rates exist
  return null
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  try {
    const result = await fetchRates()
    if (!result) {
      return NextResponse.json({ error: 'Exchange rates unavailable', errorCode: 'UPSTREAM_DOWN' }, { status: 503 })
    }
    const { rates, stale, asOf } = result
    const headers = stale ? { 'X-Cache-Stale': 'true' } : {}
    // asOf tells the client how old the data actually is (stale:true alone didn't)
    return NextResponse.json({ rates, timestamp: new Date().toISOString(), asOf, stale }, { headers })
  } catch (err) {
    console.error('[api/exchange-rates] error:', err.message)
    return NextResponse.json({ error: 'Internal server error', errorCode: 'INTERNAL' }, { status: 500 })
  }
}
