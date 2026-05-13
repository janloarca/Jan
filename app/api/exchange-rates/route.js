import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

export const revalidate = 600

let cachedRates = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000
const STALE_TTL = 60 * 60 * 1000

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

  if (cachedRates && now - cacheTime < STALE_TTL) {
    return { rates: cachedRates, stale: true }
  }

  return { rates: cachedRates || { USD: 1 }, stale: !cachedRates }
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const { rates, stale } = await fetchRates()
    const headers = stale ? { 'X-Cache-Stale': 'true' } : {}
    return NextResponse.json({ rates, timestamp: new Date().toISOString(), stale }, { headers })
  } catch (err) {
    console.error('[api/exchange-rates] error:', err.message)
    return NextResponse.json({ error: 'Internal server error', rates: { USD: 1 } }, { status: 500 })
  }
}
