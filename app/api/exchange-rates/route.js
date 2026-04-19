import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
    } catch {}
  }

  return cachedRates || { USD: 1 }
}

export async function GET() {
  try {
    const rates = await fetchRates()
    return NextResponse.json({ rates, timestamp: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json({ error: err.message, rates: { USD: 1 } }, { status: 500 })
  }
}
