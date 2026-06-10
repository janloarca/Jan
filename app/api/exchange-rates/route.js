import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

export const revalidate = 600

let cachedRates = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000

async function fetchRates() {
  const now = Date.now()
  if (cachedRates && now - cacheTime < CACHE_TTL) return { rates: cachedRates, stale: false }

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
        return { rates, stale: false }
      }
    } catch (err) {
      console.error('[api/exchange-rates] Source failed:', err.message)
    }
  }

  // A stale cache is still real market data — better than nothing
  if (cachedRates) {
    return { rates: cachedRates, stale: true }
  }

  // No data at all: signal failure instead of pretending 1:1 rates exist
  return null
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const result = await fetchRates()
    if (!result) {
      return NextResponse.json({ error: 'Exchange rates unavailable' }, { status: 503 })
    }
    const { rates, stale } = result
    const headers = stale ? { 'X-Cache-Stale': 'true' } : {}
    return NextResponse.json({ rates, timestamp: new Date().toISOString(), stale }, { headers })
  } catch (err) {
    console.error('[api/exchange-rates] error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
