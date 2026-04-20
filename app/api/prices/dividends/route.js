import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=3y&events=div`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch', hasDividend: false })
    }

    const data = await res.json()
    const result = data.chart?.result?.[0]
    const events = result?.events?.dividends

    if (!events || Object.keys(events).length === 0) {
      return NextResponse.json({ hasDividend: false, symbol })
    }

    const divList = Object.values(events)
      .map((d) => ({ date: new Date(d.date * 1000), amount: d.amount }))
      .sort((a, b) => a.date - b.date)

    if (divList.length === 0) {
      return NextResponse.json({ hasDividend: false, symbol })
    }

    const lastDiv = divList[divList.length - 1]
    const lastAmount = lastDiv.amount

    let frequency = 'quarterly'
    if (divList.length >= 2) {
      const gaps = []
      for (let i = 1; i < divList.length; i++) {
        const diffDays = (divList[i].date - divList[i - 1].date) / 86400000
        gaps.push(diffDays)
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
    while (nextDate <= new Date()) {
      nextDate.setMonth(nextDate.getMonth() + monthsApart)
    }

    const paymentMonths = []
    const baseMonth = divList[divList.length - 1].date.getMonth()
    for (let i = 0; i < 12; i += monthsApart) {
      paymentMonths.push((baseMonth + i) % 12)
    }

    const annualDividend = frequency === 'monthly' ? lastAmount * 12
      : frequency === 'quarterly' ? lastAmount * 4
      : frequency === 'semiannual' ? lastAmount * 2
      : lastAmount

    const meta = result?.meta
    const currentPrice = meta?.regularMarketPrice || 0
    const dividendYield = currentPrice > 0 ? (annualDividend / currentPrice) * 100 : 0

    return NextResponse.json({
      hasDividend: true,
      symbol,
      lastAmount,
      annualDividend: Math.round(annualDividend * 100) / 100,
      dividendYield: Math.round(dividendYield * 100) / 100,
      frequency,
      paymentMonths: paymentMonths.sort((a, b) => a - b),
      nextPaymentDate: nextDate.toISOString().split('T')[0],
      lastPaymentDate: lastDiv.date.toISOString().split('T')[0],
      historyCount: divList.length,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message, hasDividend: false }, { status: 500 })
  }
}
