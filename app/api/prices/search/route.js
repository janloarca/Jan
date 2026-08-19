import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { CRYPTO_MAP } from '@/lib/cryptoMap'

// FASE JU. Este archivo traía su PROPIA lista de 19 monedas mientras el resto
// de la app (precios actuales e historial) usa lib/cryptoMap.js, que tiene 60+.
// O sea el buscador no podía encontrar OSMO, TON, SUI, TRX, ARB, OP, TIA ni
// ninguna de las otras 40, aunque la app sí supiera cotizarlas: había que
// teclear el símbolo a mano. Ahora se deriva de la lista compartida, así que
// agregar una moneda ahí la vuelve buscable sin tocar nada acá.
//
// El nombre para mostrar sale del id de CoinGecko salvo donde ese id no es el
// nombre de la moneda ('havven' es SNX, 'the-open-network' es Toncoin).
const CRYPTO_NAMES = {
  BTC: 'Bitcoin', XRP: 'XRP', BNB: 'BNB', MATIC: 'Polygon', NEAR: 'NEAR Protocol',
  USDC: 'USD Coin', AVAX: 'Avalanche', EGLD: 'MultiversX', SNX: 'Synthetix',
  TON: 'Toncoin', OSMO: 'Osmosis', ARB: 'Arbitrum', OP: 'Optimism',
  TIA: 'Celestia', SUI: 'Sui', TRX: 'TRON', INJ: 'Injective', GRT: 'The Graph',
  LDO: 'Lido DAO', MKR: 'Maker', RNDR: 'Render', IMX: 'Immutable X',
  DYDX: 'dYdX', SCRT: 'Secret', AKT: 'Akash Network', SEI: 'Sei',
}
const titleCase = (id) => String(id).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const cryptoName = (sym, coinId) => CRYPTO_NAMES[sym] || titleCase(coinId)

async function searchYahoo(query) {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0&listsCount=0`
    const res = await fetchWithRetry(url, {
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
  } catch (err) {
    console.error('[api/search] Yahoo search failed:', err.message)
    return []
  }
}

function searchCrypto(query) {
  const q = query.toUpperCase()
  return Object.entries(CRYPTO_MAP)
    .map(([sym, coinId]) => ({ sym, name: cryptoName(sym, coinId) }))
    .filter(({ sym, name }) => sym.includes(q) || name.toUpperCase().includes(q))
    .map(({ sym, name }) => ({
      symbol: sym,
      name,
      type: 'Crypto',
      exchange: 'Crypto',
    }))
}

async function fetchAssetProfile(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const profile = data.quoteSummary?.result?.[0]?.assetProfile
    if (profile) return { sector: profile.sector || '', industry: profile.industry || '', country: profile.country || '' }
  } catch (err) {
    console.error(`[api/search] Profile fetch failed for ${symbol}:`, err.message)
  }
  return null
}

async function fetchQuote(symbol, type) {
  if (type === 'Crypto') {
    const info = CRYPTO_MAP[symbol.toUpperCase()]
    if (!info) return null
    try {
      const res = await fetchWithRetry(`https://api.coingecko.com/api/v3/simple/price?ids=${info.id}&vs_currencies=usd`)
      if (!res.ok) return null
      const data = await res.json()
      if (data[info.id]) return { price: data[info.id].usd, currency: 'USD', sector: 'Crypto', industry: 'Cryptocurrency' }
    } catch (err) {
      console.error(`[api/search] CoinGecko quote failed for ${symbol}:`, err.message)
    }
    return null
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const meta = data.chart?.result?.[0]?.meta
    if (meta?.regularMarketPrice) {
      const quote = { price: meta.regularMarketPrice, currency: meta.currency || 'USD' }
      const profile = await fetchAssetProfile(symbol)
      if (profile) { quote.sector = profile.sector; quote.industry = profile.industry; quote.country = profile.country }
      return quote
    }
  } catch (err) {
    console.error(`[api/search] Yahoo quote failed for ${symbol}:`, err.message)
  }
  return null
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().slice(0, 50)
  const withQuote = searchParams.get('quote') === '1'
  const quoteSymbol = (searchParams.get('symbol') || '').trim().slice(0, 20)
  const quoteType = searchParams.get('type') || 'Stock'

  if (quoteSymbol) {
    if (!/^[A-Z0-9._\-^=]{1,20}$/i.test(quoteSymbol)) {
      return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST' }, { status: 400 })
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
