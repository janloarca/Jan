import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

export const revalidate = 600

let cachedRates = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000

async function fetchRates() {
  const now = Date.now()
  if (cachedRates && now - cacheTime < CACHE_TTL) return cachedRates

  const sources = [
    async () => {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 600 } })
      if (!res.ok) throw new Error('er-api failed')
      const data = await res.json()
      return data.rates
    },
    async () => {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { next: { revalidate: 600 } })
      if (!res.ok) throw new Error('exchangerate-api failed')
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
        return rates
      }
    } catch (err) {
      console.error('Exchange rate source failed:', err.message)
    }
  }

  return cachedRates || { USD: 1 }
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const rates = await fetchRates()
    return NextResponse.json({ rates, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('exchange-rates error:', err)
    return NextResponse.json({ error: 'Internal server error', rates: { USD: 1 } }, { status: 500 })
  }
}
