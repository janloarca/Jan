import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const range = searchParams.get('range') || '1mo'
  const interval = searchParams.get('interval') || '1d'

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Yahoo Finance error', prices: [] }, { status: 200 })
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
    return NextResponse.json({ error: err.message, prices: [] }, { status: 200 })
  }
}
