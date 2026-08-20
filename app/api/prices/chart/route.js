import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { CRYPTO_MAP } from '@/lib/cryptoMap'
import { saveLastGood, getLastGood } from '@/lib/priceCache'

export const dynamic = 'force-dynamic'

// On upstream failure, serve the last-known-good series instead of an empty
// chart — a Yahoo/CoinGecko outage degrades to stale data, not a collapse.
async function staleOr(key, failBody, failStatus) {
  const cached = await getLastGood(key)
  if (cached?.data) {
    return NextResponse.json({ ...cached.data, stale: true, asOf: cached.asOf })
  }
  return NextResponse.json(failBody, { status: failStatus })
}

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', 'ytd', 'max']
const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']

// ⛔ FASE IX4. La API PÚBLICA de CoinGecko (sin llave) solo sirve historial de
// los últimos 365 días: `days=max` (y cualquier ventana mayor) la RECHAZA, así
// que la respuesta vuelve vacía y el caller cae a mantener la posición plana en
// su valor de HOY. Eso es justo lo que hacía el Spreadsheet con TODA la cripto:
// `rangeForMonths` (lib/historicalValues.js) pide 'max' en cuanto la tabla
// abarca más de un año, o sea siempre en un portafolio con historia, y las
// columnas de cripto quedaban en "~ valor estimado" plano hacia atrás. En el
// caso real: LEGDER dibujaba ~$1,008 en oct/nov/dic 2025 (su valor de hoy)
// cuando la gráfica de esa misma cuenta muestra ~$2,000 en esas fechas. Dos
// pantallas contándose historias distintas sobre el mismo activo.
//
// Mismo defecto y mismo arreglo que FASE IV en portfolio-history/route.js: se
// pide la ventana más larga que la API de verdad sirve. Más allá de esos ~364
// días no hay dato disponible y el hold-flat se queda, que es honesto; lo que
// no se vale es perder el año que SÍ se puede traer.
const CRYPTO_MAX_DAYS = 364

function rangeToDays(range) {
  const cap = (d) => Math.min(CRYPTO_MAX_DAYS, d)
  switch (range) {
    case '1d': return 1
    case '5d': return 5
    case '1mo': return 31
    case '3mo': return 90
    case '6mo': return 180
    case 'ytd': return cap(Math.max(1, Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 86400000)))
    case '1y': return CRYPTO_MAX_DAYS
    case 'max': return CRYPTO_MAX_DAYS
    default: return CRYPTO_MAX_DAYS
  }
}

// Historical crypto prices from CoinGecko, returned in the same shape as the
// Yahoo path so callers (historicalValues.js) need no special handling.
async function fetchCryptoChart(symbol, range) {
  const id = CRYPTO_MAP[symbol.toUpperCase()]
  if (!id) return NextResponse.json({ symbol, currency: 'USD', prices: [] })
  const days = rangeToDays(range)
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
  const res = await fetchWithRetry(url, { next: { revalidate: 600 } })
  if (!res.ok) {
    console.error(`[api/chart] CoinGecko returned ${res.status} for ${symbol} (${id})`)
    return staleOr(`chart:${symbol}:${range}:crypto`,
      { error: 'Data unavailable', errorCode: 'UPSTREAM_DOWN', prices: [] }, 503)
  }
  const data = await res.json()
  const prices = (data.prices || [])
    .filter((p) => Array.isArray(p) && p[1] != null)
    .map((p) => ({ date: new Date(p[0]).toISOString().split('T')[0], close: p[1] }))
  if (prices.length > 0) saveLastGood(`chart:${symbol}:${range}:crypto`, { symbol, currency: 'USD', prices }).catch(() => {})
  return NextResponse.json({ symbol, currency: 'USD', prices }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' },
  })
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  const range = searchParams.get('range') || '1mo'
  const interval = searchParams.get('interval') || '1d'
  const type = (searchParams.get('type') || '').toLowerCase()

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST', prices: [] }, { status: 400 })
  }
  if (!VALID_RANGES.includes(range)) {
    return NextResponse.json({ error: 'Invalid range', errorCode: 'BAD_REQUEST', prices: [] }, { status: 400 })
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: 'Invalid interval', errorCode: 'BAD_REQUEST', prices: [] }, { status: 400 })
  }

  // Crypto symbols collide with unrelated equity tickers on Yahoo (e.g. ETH =
  // Ethan Allen). Route them to CoinGecko historical prices instead.
  if (type === 'crypto') {
    try {
      return await fetchCryptoChart(symbol, range)
    } catch (err) {
      console.error('chart crypto error:', err)
      return staleOr(`chart:${symbol}:${range}:crypto`,
        { error: 'Internal server error', errorCode: 'INTERNAL', prices: [] }, 500)
    }
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) {
      console.error(`[api/chart] Yahoo returned ${res.status} for ${symbol}`)
      return staleOr(`chart:${symbol}:${range}:${interval}`,
        { error: 'Data unavailable', errorCode: 'UPSTREAM_DOWN', prices: [] }, 503)
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

    const payload = { symbol: meta.symbol || symbol, currency: meta.currency || 'USD', prices }
    if (prices.length > 0) saveLastGood(`chart:${symbol}:${range}:${interval}`, payload).catch(() => {})
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' },
    })
  } catch (err) {
    console.error('chart error:', err)
    return staleOr(`chart:${symbol}:${range}:${interval}`,
      { error: 'Internal server error', errorCode: 'INTERNAL', prices: [] }, 500)
  }
}
