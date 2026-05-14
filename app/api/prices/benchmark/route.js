import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

const VALID_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'ALL']

const RANGE_MAP = {
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  YTD: { range: 'ytd', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
  '3Y': { range: '3y', interval: '1mo' },
  ALL: { range: 'max', interval: '1mo' },
}

const ALLOWED_SYMBOLS = {
  '%5EGSPC': 'S&P 500',
  '%5EIXIC': 'NASDAQ Composite',
  '%5EDJI': 'Dow Jones',
  '%5EGSPTSE': 'S&P/TSX (Canada)',
  'EWZ': 'iShares MSCI Brazil',
  'EWW': 'iShares MSCI Mexico',
  'VT': 'Vanguard Total World',
  'QQQ': 'Invesco QQQ (Nasdaq-100)',
}

const cache = {}
const CACHE_TTL = 5 * 60 * 1000

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'YTD'
    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const { range, interval } = RANGE_MAP[period] || RANGE_MAP.YTD
    const symbol = searchParams.get('symbol') || '%5EGSPC'
    if (!ALLOWED_SYMBOLS[symbol]) {
      return NextResponse.json({ error: 'Invalid benchmark symbol' }, { status: 400 })
    }
    const benchmarkName = ALLOWED_SYMBOLS[symbol]

    const cacheKey = `${symbol}:${period}`
    const cached = cache[cacheKey]
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data)
    }
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },
    })

    if (!res.ok) {
      console.error(`[api/benchmark] Yahoo returned ${res.status}`)
      return NextResponse.json({ error: 'Benchmark data unavailable', dataPoints: [], ytdReturn: null, oneYearReturn: null }, { status: 503 })
    }

    const raw = await res.json()
    const result = raw.chart?.result?.[0]
    if (!result) {
      return NextResponse.json({ dataPoints: [], ytdReturn: null, oneYearReturn: null })
    }

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []

    const dataPoints = timestamps
      .map((ts, i) => ({ ts: ts * 1000, close: closes[i] }))
      .filter((p) => p.close != null && !isNaN(p.close))

    if (dataPoints.length === 0) {
      return NextResponse.json({ dataPoints: [], ytdReturn: null, oneYearReturn: null })
    }

    const first = dataPoints[0].close
    const last = dataPoints[dataPoints.length - 1].close
    const periodReturn = first > 0 ? ((last - first) / first) * 100 : null

    const now = Date.now()
    const oneYearAgo = now - 365 * 86400000
    const yearAgoPoint = dataPoints.find((p) => p.ts >= oneYearAgo)
    const oneYearReturn = yearAgoPoint && yearAgoPoint.close > 0
      ? ((last - yearAgoPoint.close) / yearAgoPoint.close) * 100
      : null

    const responseData = {
      dataPoints,
      currentPrice: last,
      ytdReturn: period === 'YTD' ? periodReturn : null,
      oneYearReturn,
      periodReturn,
      symbol,
      benchmarkName,
    }

    cache[cacheKey] = { data: responseData, ts: Date.now() }
    return NextResponse.json(responseData)
  } catch (err) {
    console.error('[api/benchmark] error:', err.message)
    return NextResponse.json({ error: 'Internal server error', dataPoints: [], ytdReturn: null, oneYearReturn: null }, { status: 500 })
  }
}
