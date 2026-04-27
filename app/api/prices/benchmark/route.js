import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RANGE_MAP = {
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  YTD: { range: 'ytd', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
  '3Y': { range: '3y', interval: '1mo' },
  ALL: { range: 'max', interval: '1mo' },
}

let cache = { data: null, ts: 0, period: null }
const CACHE_TTL = 5 * 60 * 1000

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'YTD'
    const { range, interval } = RANGE_MAP[period] || RANGE_MAP.YTD

    if (cache.data && cache.period === period && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const symbol = '%5EGSPC'
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },
    })

    if (!res.ok) {
      return NextResponse.json({ dataPoints: [], ytdReturn: null, oneYearReturn: null })
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
    }

    cache = { data: responseData, ts: Date.now(), period }
    return NextResponse.json(responseData)
  } catch (err) {
    return NextResponse.json({ dataPoints: [], ytdReturn: null, oneYearReturn: null }, { status: 500 })
  }
}
