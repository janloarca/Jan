import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

async function fetchDividendInfo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=3y&events=div`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return { hasDividend: false, symbol }

    const data = await res.json()
    const result = data.chart?.result?.[0]
    const events = result?.events?.dividends
    if (!events || Object.keys(events).length === 0) return { hasDividend: false, symbol }

    const divList = Object.values(events)
      .map((d) => ({ date: new Date(d.date * 1000), amount: d.amount }))
      .sort((a, b) => a.date - b.date)
    if (divList.length === 0) return { hasDividend: false, symbol }

    const lastDiv = divList[divList.length - 1]
    const lastAmount = lastDiv.amount

    let frequency = 'quarterly'
    if (divList.length >= 2) {
      const gaps = []
      for (let i = 1; i < divList.length; i++) {
        gaps.push((divList[i].date - divList[i - 1].date) / 86400000)
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
      if (avgGap < 45) frequency = 'monthly'
      else if (avgGap < 120) frequency = 'quarterly'
      else if (avgGap < 200) frequency = 'semiannual'
      else frequency = 'annual'
    }

    const freqMonths = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }
    const monthsApart = freqMonths[frequency] || 3
    const nextDate = new Date(lastDiv.date)
    while (nextDate <= new Date()) nextDate.setMonth(nextDate.getMonth() + monthsApart)

    const paymentMonths = []
    const baseMonth = lastDiv.date.getMonth()
    for (let i = 0; i < 12; i += monthsApart) paymentMonths.push((baseMonth + i) % 12)

    const annualDividend = frequency === 'monthly' ? lastAmount * 12
      : frequency === 'quarterly' ? lastAmount * 4
      : frequency === 'semiannual' ? lastAmount * 2 : lastAmount

    const meta = result?.meta
    const currentPrice = meta?.regularMarketPrice || 0
    const dividendYield = currentPrice > 0 ? (annualDividend / currentPrice) * 100 : 0

    return {
      hasDividend: true, symbol, lastAmount,
      annualDividend: Math.round(annualDividend * 100) / 100,
      dividendYield: Math.round(dividendYield * 100) / 100,
      frequency,
      paymentMonths: paymentMonths.sort((a, b) => a - b),
      nextPaymentDate: nextDate.toISOString().split('T')[0],
      lastPaymentDate: lastDiv.date.toISOString().split('T')[0],
      historyCount: divList.length,
    }
  } catch {
    return { hasDividend: false, symbol }
  }
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  }
  const info = await fetchDividendInfo(symbol)
  return NextResponse.json(info)
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  try {
    const { symbols } = await request.json()
    if (!symbols || !Array.isArray(symbols) || symbols.length > 50) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    for (const s of symbols) {
      const sym = typeof s === 'string' ? s : s?.symbol || ''
      if (sym && !SYMBOL_RE.test(sym)) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
      }
    }

    const dividends = {}
    const batches = []
    for (let i = 0; i < symbols.length; i += 5) batches.push(symbols.slice(i, i + 5))

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map((s) => fetchDividendInfo(typeof s === 'string' ? s : s.symbol))
      )
      results.forEach((info) => {
        if (info.symbol) dividends[info.symbol.toUpperCase()] = info
      })
    }

    return NextResponse.json({ dividends })
  } catch (err) {
    console.error('dividends error:', err)
    return NextResponse.json({ error: 'Internal server error', dividends: {} }, { status: 500 })
  }
}
