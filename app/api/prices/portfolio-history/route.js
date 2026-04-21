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

    const skipTypes = /inmueble|bank|banco|real.?estate|property/i
    const stocks = []
    const cryptos = []
    const staticAssets = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym) return
      const type = (it.type || '').toLowerCase()
      if (skipTypes.test(type)) {
        staticAssets.push(it)
      } else if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptos.push(it)
      } else {
        stocks.push(it)
      }
    })

    const allTimeSeries = {}

    const stockBatches = []
    for (let i = 0; i < stocks.length; i += 5) stockBatches.push(stocks.slice(i, i + 5))
    for (const batch of stockBatches) {
      await Promise.all(batch.map(async (it) => {
        const sym = it.symbol.toUpperCase()
        const history = await fetchYahooHistory(sym, range, interval)
        if (history.length > 0) {
          allTimeSeries[sym] = { history, qty: it.quantity || 0 }
        }
      }))
    }

    await Promise.all(cryptos.map(async (it) => {
      const sym = it.symbol.toUpperCase()
      const id = CRYPTO_MAP[sym]
      if (!id) return
      const days = CRYPTO_DAYS[per] || 365
      const history = await fetchCryptoHistory(id, days)
      if (history.length > 0) {
        allTimeSeries[sym] = { history, qty: it.quantity || 0 }
      }
    }))

    const staticTotal = staticAssets.reduce((s, it) => {
      return s + (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
    }, 0)

    if (Object.keys(allTimeSeries).length === 0) {
      return NextResponse.json({ dataPoints: [], staticTotal })
    }

    const allTs = new Set()
    Object.values(allTimeSeries).forEach(({ history }) => {
      history.forEach((p) => allTs.add(p.ts))
    })
    const sortedTs = [...allTs].sort((a, b) => a - b)

    const dataPoints = sortedTs.map((ts) => {
      let total = staticTotal
      Object.entries(allTimeSeries).forEach(([, { history, qty }]) => {
        let price = null
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].ts <= ts) { price = history[i].close; break }
        }
        if (price == null && history.length > 0) price = history[0].close
        total += (qty || 0) * (price || 0)
      })
      return { ts, total: Math.round(total * 100) / 100 }
    })

    return NextResponse.json({ dataPoints, staticTotal })
  } catch (err) {
    return NextResponse.json({ error: err.message, dataPoints: [] }, { status: 500 })
  }
}
