import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { CRYPTO_MAP } from '@/lib/cryptoMap'
import { isMarketPriced } from '@/components/dashboard/utils'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

async function fetchStockPrices(symbols) {
  const results = {}
  const warnings = []
  const batches = []
  for (let i = 0; i < symbols.length; i += 15) {
    batches.push(symbols.slice(i, i + 15))
  }

  for (const batch of batches) {
    await Promise.all(batch.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=7d`
        const res = await fetchWithRetry(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 300 },
        })
        if (!res.ok) {
          warnings.push(`${sym}: Yahoo returned ${res.status}`)
          return
        }
        const data = await res.json()
        const meta = data.chart?.result?.[0]?.meta
        const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close
        if (meta && meta.regularMarketPrice) {
          const price = meta.regularMarketPrice
          const prev7d = closes && closes.length > 1 ? closes.find((c) => c != null) : null
          const change7d = prev7d ? ((price - prev7d) / prev7d) * 100 : null
          // 1-day change: prefer Yahoo's previousClose (yesterday's close),
          // else fall back to the second-to-last daily close in the range.
          const validCloses = (closes || []).filter((c) => c != null)
          const prevDayClose = meta.previousClose ?? (validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null)
          const change1d = prevDayClose ? ((price - prevDayClose) / prevDayClose) * 100 : null
          results[sym] = { price, change7d, change1d, currency: meta.currency || 'USD' }
        }
      } catch (err) {
        console.error(`[api/prices] Failed to fetch ${sym}:`, err.message)
        warnings.push(`${sym}: ${err.message}`)
      }
    }))
  }
  return { results, warnings }
}

async function fetchCryptoPrices(symbols) {
  const results = {}
  const warnings = []
  const ids = symbols
    .map((sym) => CRYPTO_MAP[sym.toUpperCase()])
    .filter(Boolean)

  if (ids.length === 0) return { results, warnings }

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_7d_change=true&include_24hr_change=true`
    const res = await fetchWithRetry(url, { next: { revalidate: 300 } })
    if (!res.ok) {
      warnings.push(`CoinGecko returned ${res.status}`)
      return { results, warnings }
    }
    const data = await res.json()

    symbols.forEach((sym) => {
      const id = CRYPTO_MAP[sym.toUpperCase()]
      if (id && data[id]) {
        results[sym] = {
          price: data[id].usd,
          change7d: data[id].usd_7d_change ?? null,
          change1d: data[id].usd_24h_change ?? null,
          currency: 'USD',
        }
      }
    })
  } catch (err) {
    console.error('[api/prices] CoinGecko failed:', err.message)
    warnings.push(`CoinGecko: ${err.message}`)
  }
  return { results, warnings }
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const { items } = body
    if (!items || !Array.isArray(items) || items.length > 100) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const stockSymbols = []
    const cryptoSymbols = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym || !SYMBOL_RE.test(sym)) return
      // Server-side guard mirroring the client whitelist (isMarketPriced): never
      // quote cash/bond/manual items — a bond coded "TE" or a cash bucket "USD"
      // would otherwise resolve to an unrelated real ticker.
      if (!isMarketPriced(it)) return
      const type = (it.type || '').toLowerCase()
      if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptoSymbols.push(sym)
      } else {
        stockSymbols.push(sym)
      }
    })

    const [stockResult, cryptoResult] = await Promise.all([
      stockSymbols.length > 0 ? fetchStockPrices([...new Set(stockSymbols)]) : { results: {}, warnings: [] },
      cryptoSymbols.length > 0 ? fetchCryptoPrices([...new Set(cryptoSymbols)]) : { results: {}, warnings: [] },
    ])

    const allWarnings = [...stockResult.warnings, ...cryptoResult.warnings]
    const allPrices = { ...stockResult.results, ...cryptoResult.results }
    const requested = stockSymbols.length + cryptoSymbols.length

    if (requested > 0 && Object.keys(allPrices).length === 0) {
      return NextResponse.json({
        error: 'All price sources failed',
        prices: {},
        warnings: allWarnings,
        timestamp: new Date().toISOString(),
      }, { status: 503 })
    }

    return NextResponse.json({
      prices: allPrices,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('prices error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
