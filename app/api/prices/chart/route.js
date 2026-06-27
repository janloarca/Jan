import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { CRYPTO_MAP } from '@/lib/cryptoMap'

export const dynamic = 'force-dynamic'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', 'ytd', 'max']
const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']

// Map a Yahoo-style range to a CoinGecko market_chart `days` window.
function rangeToDays(range) {
  switch (range) {
    case '1d': return 1
    case '5d': return 5
    case '1mo': return 31
    case '3mo': return 90
    case '6mo': return 180
    case 'ytd': return Math.max(1, Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 86400000))
    case '1y': return 365
    case 'max': return 'max'
    default: return 365
  }
}

// Historical crypto prices from CoinGecko, returned in the same shape as the
// Yahoo path so callers (historicalValues.js) need no special handling.
async function fetchCryptoChart(symbol, range) {
  const id = CRYPTO_MAP[symbol.toUpperCase()]
  if (!id) return NextResponse.json({ symbol, currency: 'USD', prices: [] })
  const days = rangeToDays(range)
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
  const res = await fetchWithRetry(url, { next: { revalidate: 600 } })
  if (!res.ok) {
    console.error(`[api/chart] CoinGecko returned ${res.status} for ${symbol} (${id})`)
    return NextResponse.json({ symbol, currency: 'USD', prices: [], error: 'Data unavailable' }, { status: 503 })
  }
  const data = await res.json()
  const prices = (data.prices || [])
    .filter((p) => Array.isArray(p) && p[1] != null)
    .map((p) => ({ date: new Date(p[0]).toISOString().split('T')[0], close: p[1] }))
  return NextResponse.json({ symbol, currency: 'USD', prices }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' },
  })
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  const range = searchParams.get('range') || '1mo'
  const interval = searchParams.get('interval') || '1d'
  const type = (searchParams.get('type') || '').toLowerCase()

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  }
  if (!VALID_RANGES.includes(range)) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  }

  // Crypto symbols collide with unrelated equity tickers on Yahoo (e.g. ETH =
  // Ethan Allen). Route them to CoinGecko historical prices instead.
  if (type === 'crypto') {
    try {
      return await fetchCryptoChart(symbol, range)
    } catch (err) {
      console.error('chart crypto error:', err)
      return NextResponse.json({ error: 'Internal server error', prices: [] }, { status: 500 })
    }
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) {
      console.error(`[api/chart] Yahoo returned ${res.status} for ${symbol}`)
      return NextResponse.json({ error: 'Data unavailable', prices: [] }, { status: 503 })
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
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' },
    })
  } catch (err) {
    console.error('chart error:', err)
    return NextResponse.json({ error: 'Internal server error', prices: [] }, { status: 500 })
  }
}
