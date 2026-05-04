import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

const CRYPTO_MAP = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  SOL: { id: 'solana', name: 'Solana' },
  ADA: { id: 'cardano', name: 'Cardano' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  MATIC: { id: 'matic-network', name: 'Polygon' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  UNI: { id: 'uniswap', name: 'Uniswap' },
  XRP: { id: 'ripple', name: 'XRP' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  BNB: { id: 'binancecoin', name: 'BNB' },
  ATOM: { id: 'cosmos', name: 'Cosmos' },
  NEAR: { id: 'near', name: 'NEAR Protocol' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  USDT: { id: 'tether', name: 'Tether' },
  USDC: { id: 'usd-coin', name: 'USD Coin' },
  SHIB: { id: 'shiba-inu', name: 'Shiba Inu' },
  AAVE: { id: 'aave', name: 'Aave' },
}

async function searchYahoo(query) {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0&listsCount=0`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.quotes || [])
      .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND'))
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND' ? 'Fund' : 'Stock',
        exchange: q.exchDisp || q.exchange || '',
      }))
  } catch {
    return []
  }
}

function searchCrypto(query) {
  const q = query.toUpperCase()
  return Object.entries(CRYPTO_MAP)
    .filter(([sym, info]) => sym.includes(q) || info.name.toUpperCase().includes(q))
    .map(([sym, info]) => ({
      symbol: sym,
      name: info.name,
      type: 'Crypto',
      exchange: 'Crypto',
    }))
}

async function fetchQuote(symbol, type) {
  if (type === 'Crypto') {
    const info = CRYPTO_MAP[symbol.toUpperCase()]
    if (!info) return null
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${info.id}&vs_currencies=usd`)
      if (!res.ok) return null
      const data = await res.json()
      if (data[info.id]) return { price: data[info.id].usd, currency: 'USD' }
    } catch {}
    return null
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const meta = data.chart?.result?.[0]?.meta
    if (meta?.regularMarketPrice) {
      return { price: meta.regularMarketPrice, currency: meta.currency || 'USD' }
    }
  } catch {}
  return null
}

export async function GET(request) {
  const { limited } = rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().slice(0, 50)
  const withQuote = searchParams.get('quote') === '1'
  const quoteSymbol = (searchParams.get('symbol') || '').trim().slice(0, 20)
  const quoteType = searchParams.get('type') || 'Stock'

  if (quoteSymbol) {
    if (!/^[A-Z0-9._\-^=]{1,20}$/i.test(quoteSymbol)) {
      return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
    }
    const quote = await fetchQuote(quoteSymbol, quoteType)
    return NextResponse.json({ quote })
  }

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const [yahooResults, cryptoResults] = await Promise.all([
    searchYahoo(q),
    Promise.resolve(searchCrypto(q)),
  ])

  let results = [...cryptoResults, ...yahooResults].slice(0, 8)

  if (withQuote && results.length > 0) {
    const top = results[0]
    const quote = await fetchQuote(top.symbol, top.type)
    if (quote) {
      results[0] = { ...top, ...quote }
    }
  }

  return NextResponse.json({ results })
}
