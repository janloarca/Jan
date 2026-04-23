import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', AVAX: 'avalanche-2', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave', XRP: 'ripple',
  DOGE: 'dogecoin', SHIB: 'shiba-inu', BNB: 'binancecoin',
  ATOM: 'cosmos', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand',
  XLM: 'stellar', LTC: 'litecoin', USDT: 'tether', USDC: 'usd-coin',
}

const RANGE_MAP = {
  DAY: { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
  YTD: { range: 'ytd', interval: '1d' },
  ALL: { range: 'max', interval: '1mo' },
}

async function fetchYahooHistory(symbol, range, interval) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return []
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return []
    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    return timestamps
      .map((ts, i) => ({ ts: ts * 1000, close: closes[i] }))
      .filter((p) => p.close != null)
  } catch {
    return []
  }
}

async function fetchCryptoHistory(id, days) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.prices || []).map(([ts, price]) => ({ ts, close: price }))
  } catch {
    return []
  }
}

const CRYPTO_DAYS = {
  DAY: 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, YTD: 365, ALL: 'max',
}

export async function POST(request) {
  try {
    const { items, period } = await request.json()
    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'items required' }, { status: 400 })
    }

    const per = period || 'YTD'
    const { range, interval } = RANGE_MAP[per] || RANGE_MAP.YTD

    const skipTypes = /inmueble|bank|banco|real.?estate|property|inversion|inversión|bono|bond|deposito|certificado/i
    const marketItems = []
    const cryptoItems = []
    const staticItems = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym) return
      const type = (it.type || '').toLowerCase()
      if (skipTypes.test(type)) {
        staticItems.push(it)
      } else if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptoItems.push(it)
      } else {
        marketItems.push(it)
      }
    })

    const allTimeSeries = {}

    const stockBatches = []
    for (let i = 0; i < marketItems.length; i += 5) stockBatches.push(marketItems.slice(i, i + 5))
    for (const batch of stockBatches) {
      await Promise.all(batch.map(async (it) => {
        const sym = it.symbol.toUpperCase()
        const history = await fetchYahooHistory(sym, range, interval)
        if (history.length > 0) {
          allTimeSeries[sym] = {
            history,
            qty: it.quantity || 0,
            acquiredTs: it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0,
            costBasis: (it.quantity || 0) * (it.purchasePrice || 0),
          }
        }
      }))
    }

    await Promise.all(cryptoItems.map(async (it) => {
      const sym = it.symbol.toUpperCase()
      const id = CRYPTO_MAP[sym]
      if (!id) return
      const days = CRYPTO_DAYS[per] || 365
      const history = await fetchCryptoHistory(id, days)
      if (history.length > 0) {
        allTimeSeries[sym] = {
          history,
          qty: it.quantity || 0,
          acquiredTs: it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0,
          costBasis: (it.quantity || 0) * (it.purchasePrice || 0),
        }
      }
    }))

    marketItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        staticItems.push(it)
      }
    })
    cryptoItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        staticItems.push(it)
      }
    })

    if (Object.keys(allTimeSeries).length === 0 && staticItems.length === 0) {
      return NextResponse.json({ dataPoints: [], staticTotal: 0 })
    }

    const allTs = new Set()
    Object.values(allTimeSeries).forEach(({ history }) => {
      history.forEach((p) => allTs.add(p.ts))
    })

    if (per === 'ALL') {
      const allDates = items
        .map((it) => it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0)
        .filter((d) => d > 0)
      if (allDates.length > 0) {
        const earliest = Math.min(...allDates)
        const dayBefore = earliest - 86400000
        allTs.add(dayBefore)
      }
    }

    const sortedTs = [...allTs].sort((a, b) => a - b)

    const dataPoints = sortedTs.map((ts) => {
      let total = 0

      staticItems.forEach((it) => {
        const acqTs = it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0
        if (ts >= acqTs) {
          total += (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
        }
      })

      Object.entries(allTimeSeries).forEach(([, data]) => {
        if (ts < data.acquiredTs) return

        let price = null
        for (let i = data.history.length - 1; i >= 0; i--) {
          if (data.history[i].ts <= ts) { price = data.history[i].close; break }
        }
        if (price == null && data.history.length > 0) price = data.history[0].close
        total += (data.qty || 0) * (price || 0)
      })

      return { ts, total: Math.round(total * 100) / 100 }
    })

    const staticTotal = staticItems.reduce((s, it) => {
      return s + (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
    }, 0)

    return NextResponse.json({ dataPoints, staticTotal })
  } catch (err) {
    return NextResponse.json({ error: err.message, dataPoints: [] }, { status: 500 })
  }
}
