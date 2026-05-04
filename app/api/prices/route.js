import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', AVAX: 'avalanche-2', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave', XRP: 'ripple',
  DOGE: 'dogecoin', SHIB: 'shiba-inu', BNB: 'binancecoin',
  ATOM: 'cosmos', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand',
  XLM: 'stellar', LTC: 'litecoin', BCH: 'bitcoin-cash',
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
  MANA: 'decentraland', SAND: 'the-sandbox', APE: 'apecoin',
  CRO: 'crypto-com-chain', VET: 'vechain', HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer', FIL: 'filecoin', EOS: 'eos',
  XTZ: 'tezos', THETA: 'theta-token', EGLD: 'elrond-erd-2',
  CELR: 'celer-network', CELO: 'celo',
}

async function fetchStockPrices(symbols) {
  const results = {}
  const batches = []
  for (let i = 0; i < symbols.length; i += 5) {
    batches.push(symbols.slice(i, i + 5))
  }

  for (const batch of batches) {
    await Promise.all(batch.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=7d`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 300 },
        })
        if (!res.ok) return
        const data = await res.json()
        const meta = data.chart?.result?.[0]?.meta
        const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close
        if (meta && meta.regularMarketPrice) {
          const price = meta.regularMarketPrice
          const prev7d = closes && closes.length > 1 ? closes.find((c) => c != null) : null
          const change7d = prev7d ? ((price - prev7d) / prev7d) * 100 : null
          results[sym] = { price, change7d, currency: meta.currency || 'USD' }
        }
      } catch {}
    }))
  }
  return results
}

async function fetchCryptoPrices(symbols) {
  const results = {}
  const ids = symbols
    .map((sym) => CRYPTO_MAP[sym.toUpperCase()])
    .filter(Boolean)

  if (ids.length === 0) return results

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_7d_change=true`
    const res = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) return results
    const data = await res.json()

    symbols.forEach((sym) => {
      const id = CRYPTO_MAP[sym.toUpperCase()]
      if (id && data[id]) {
        results[sym] = {
          price: data[id].usd,
          change7d: data[id].usd_7d_change ?? null,
          currency: 'USD',
        }
      }
    })
  } catch {}
  return results
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const { items } = await request.json()
    if (!items || !Array.isArray(items) || items.length > 100) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const stockSymbols = []
    const cryptoSymbols = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym || !SYMBOL_RE.test(sym)) return
      const type = (it.type || '').toLowerCase()
      if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptoSymbols.push(sym)
      } else {
        stockSymbols.push(sym)
      }
    })

    const [stockPrices, cryptoPrices] = await Promise.all([
      stockSymbols.length > 0 ? fetchStockPrices([...new Set(stockSymbols)]) : {},
      cryptoSymbols.length > 0 ? fetchCryptoPrices([...new Set(cryptoSymbols)]) : {},
    ])

    return NextResponse.json({
      prices: { ...stockPrices, ...cryptoPrices },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('prices error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
