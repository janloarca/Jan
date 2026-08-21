// FASE HZ. El motor de cotizaciones, extraído de app/api/prices/route.js para
// que el CRON pueda valorar el portafolio de un usuario sin navegador.
//
// Por qué extraerlo en vez de que el cron llame a la ruta: la ruta exige un
// usuario firmado (verifyAuth) y el cron no tiene sesión, así que llamarla
// desde el servidor obligaría a inventar un bypass de auth. Y copiar la lógica
// sería la enfermedad que este repo ya documenta: dos copias, una se queda
// atrás. La ruta queda como una cáscara delgada sobre este módulo.
//
// Todo lo de aquí corre SOLO en el servidor (habla directo con Yahoo y
// CoinGecko con nuestra IP de salida).

import { fetchWithRetry } from './fetchWithRetry'
import { CRYPTO_MAP } from './cryptoMap'
import { isMarketPriced } from '../components/dashboard/utils'
import { saveLastGood, getLastGood } from './priceCache'

export const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

// Yahoo's unofficial chart API blocks/rate-limits by source IP rather than by
// API key. Since this fetch runs server-side, every user shares OUR Vercel
// function's outbound IP — a block against query1 takes down prices for
// EVERYONE at once, for as long as Yahoo keeps it up (can be an hour+).
// query2 is Yahoo's other production edge for the same endpoint (same JSON
// shape, no extra parsing needed) and empirically is not always blocked at
// the same time as query1, so it is tried as a same-request fallback before
// giving up on a symbol.
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']

export async function fetchYahooChart(sym, { range = '7d', interval = '1d' } = {}) {
  let lastError = 'unknown error'
  for (const host of YAHOO_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`
      const res = await fetchWithRetry(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 300 },
      })
      if (!res.ok) {
        lastError = `Yahoo (${host}) returned ${res.status}`
        continue
      }
      return { data: await res.json() }
    } catch (err) {
      lastError = err.message
    }
  }
  return { error: lastError }
}

// La fecha CALENDARIO de la última sesión, en la zona horaria del EXCHANGE.
//
// La zona importa y no es un detalle: Tokio cierra ~2am hora de Guatemala, así
// que "hoy" no es el mismo día para todas las bolsas. Yahoo trae el offset en
// `meta.gmtoffset` (segundos) junto al timestamp en UTC; sumarlos y leer la
// fecha en UTC da el día tal como lo vivió esa bolsa. Sin offset se cae a UTC,
// que es la aproximación conservadora de siempre.
//
// Devuelve 'YYYY-MM-DD' o null. Nunca lanza: una fecha ilegible tiene que dejar
// el precio pasar igual (perder la cotización por no poder fecharla sería peor
// que no saber la fecha).
export function sessionDateOf(stamps, meta) {
  try {
    const list = Array.isArray(stamps) ? stamps.filter((s) => Number.isFinite(Number(s))) : []
    const lastSec = list.length > 0 ? Number(list[list.length - 1]) : Number(meta?.regularMarketTime)
    if (!Number.isFinite(lastSec) || lastSec <= 0) return null
    const offsetSec = Number.isFinite(Number(meta?.gmtoffset)) ? Number(meta.gmtoffset) : 0
    return new Date((lastSec + offsetSec) * 1000).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

export async function fetchStockPrices(symbols) {
  const results = {}
  const warnings = []
  const batches = []
  for (let i = 0; i < symbols.length; i += 15) {
    batches.push(symbols.slice(i, i + 15))
  }

  for (const batch of batches) {
    await Promise.all(batch.map(async (sym) => {
      const { data, error } = await fetchYahooChart(sym)
      if (!data) {
        console.error(`[marketPrices] Failed to fetch ${sym}:`, error)
        warnings.push(`${sym}: ${error}`)
        return
      }
      const meta = data.chart?.result?.[0]?.meta
      const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close
      const stamps = data.chart?.result?.[0]?.timestamp
      if (meta && meta.regularMarketPrice) {
        const price = meta.regularMarketPrice
        const prev7d = closes && closes.length > 1 ? closes.find((c) => c != null) : null
        const change7d = prev7d ? ((price - prev7d) / prev7d) * 100 : null
        // 1-day change: prefer Yahoo's previousClose (yesterday's close),
        // else fall back to the second-to-last daily close in the range.
        const validCloses = (closes || []).filter((c) => c != null)
        const prevDayClose = meta.previousClose ?? (validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null)
        const change1d = prevDayClose ? ((price - prevDayClose) / prevDayClose) * 100 : null
        results[sym] = {
          price, change7d, change1d,
          currency: meta.currency || 'USD',
          // ⛔ FASE JX. QUÉ VENTANA mide `change1d`, y DE CUÁNDO es.
          //
          // Para una acción NUNCA es "lo que se movió hoy": es la última sesión
          // REGULAR completada. Un sábado, `regularMarketPrice` es el cierre del
          // viernes y `previousClose` el del jueves, así que este número es el
          // movimiento del VIERNES, idéntico todo el fin de semana. Lo mismo un
          // feriado, y lo mismo un martes ANTES de la apertura (ahí muestra el
          // lunes). Sin esta señal la tarjeta lo titulaba "hoy" y el usuario veía
          // "biggest winners" en días sin mercado.
          //
          // Se deriva de `result.timestamp`, no de campos que no puedo verificar
          // desde acá: ese arreglo está PROBADO presente en este mismo endpoint
          // (app/api/prices/chart/route.js lo usa para fechar cada cierre) y con
          // `interval=1d` su última entrada es la sesión más reciente.
          change1dWindow: 'session',
          change1dAsOf: sessionDateOf(stamps, meta),
        }
      }
    }))
  }
  return { results, warnings }
}

export async function fetchCryptoPrices(symbols) {
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
          // FASE JX. La cripto NO mide un día calendario: `usd_24h_change` es
          // una ventana RODANTE de 24 horas. O sea la misma lista mezclaba dos
          // definiciones de "hoy" (sesión bursátil vs 24h rodantes) sin decirlo.
          // Siempre está fresca, así que no lleva fecha de sesión.
          change1dWindow: 'rolling24h',
          change1dAsOf: null,
        }
      }
    })
  } catch (err) {
    console.error('[marketPrices] CoinGecko failed:', err.message)
    warnings.push(`CoinGecko: ${err.message}`)
  }
  return { results, warnings }
}

// Clasifica los símbolos de una lista de items entre acciones y cripto,
// aplicando el MISMO whitelist que el cliente (isMarketPriced): nunca se
// cotiza un bono, un saldo bancario ni un símbolo sintético, porque un bono
// codificado "TE" o una cuenta "USD" resolverían a un ticker real ajeno.
export function classifySymbols(items) {
  const stockSymbols = []
  const cryptoSymbols = []
  for (const it of items || []) {
    const sym = (it.symbol || '').toUpperCase().trim()
    if (!sym || !SYMBOL_RE.test(sym)) continue
    if (!isMarketPriced(it)) continue
    const type = (it.type || '').toLowerCase()
    if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) cryptoSymbols.push(sym)
    else stockSymbols.push(sym)
  }
  return { stockSymbols: [...new Set(stockSymbols)], cryptoSymbols: [...new Set(cryptoSymbols)] }
}

// Precios de todos los items cotizables, con el respaldo last-known-good:
// una caída del proveedor degrada a precios viejos marcados `stale`, nunca a
// una respuesta vacía que el consumidor lea como "vale cero".
export async function priceItems(items) {
  const { stockSymbols, cryptoSymbols } = classifySymbols(items)
  const [stockResult, cryptoResult] = await Promise.all([
    stockSymbols.length > 0 ? fetchStockPrices(stockSymbols) : { results: {}, warnings: [] },
    cryptoSymbols.length > 0 ? fetchCryptoPrices(cryptoSymbols) : { results: {}, warnings: [] },
  ])

  const warnings = [...stockResult.warnings, ...cryptoResult.warnings]
  const prices = { ...stockResult.results, ...cryptoResult.results }
  const requestedSyms = [...new Set([...stockSymbols, ...cryptoSymbols])]

  let usedStale = false
  for (const sym of requestedSyms) {
    if (prices[sym]) {
      saveLastGood(`px:${sym}`, prices[sym]).catch(() => {})
    } else {
      const cached = await getLastGood(`px:${sym}`)
      if (cached?.data) {
        prices[sym] = { ...cached.data, stale: true, asOf: cached.asOf }
        usedStale = true
      }
    }
  }

  return { prices, warnings, usedStale, requested: requestedSyms }
}
