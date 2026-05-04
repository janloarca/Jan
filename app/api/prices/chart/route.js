import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', 'ytd', 'max']
const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  const range = searchParams.get('range') || '1mo'
  const interval = searchParams.get('interval') || '1d'

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  }
  if (!VALID_RANGES.includes(range)) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Data unavailable', prices: [] }, { status: 200 })
    }

    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) {
      return NextResponse.json({ prices: [] })
    }

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    const meta = result.meta || {}

    const prices = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        close: closes[i],
      }))
      .filter((p) => p.close != null)

    return NextResponse.json({
      symbol: meta.symbol || symbol,
      currency: meta.currency || 'USD',
      prices,
    })
  } catch (err) {
    console.error('chart error:', err)
    return NextResponse.json({ error: 'Internal server error', prices: [] }, { status: 500 })
  }
}
