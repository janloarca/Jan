// FASE HZ3. El fetcher de series para el brief de mercado, compartido por el
// cron y el botón de prueba (antes vivía dentro de la ruta del cron, así que
// la prueba habría usado otra ruta de datos que la corrida real).
//
// Índices y acciones: Yahoo, que da serie diaria completa.
//
// Cripto: el endpoint `simple/price` que usa el resto de la app NO devuelve
// cambio de 7 días (`include_7d_change` no existe ahí; solo hay 24h), así que
// `change7d` volvía null y la primera prueba real imprimió "Bitcoin +0.00%":
// un número inventado que afirmaba que la cripto no se movió en la semana
// cuando en realidad no lo sabíamos. Se usa `coins/markets`, que sí trae
// `price_change_percentage_{7d,30d}_in_currency`, y si ese dato falta se
// devuelve SOLO el precio: la fila sale sin porcentaje en vez de con uno falso.
//
// FASE IE (correo mensual): parametrizado por ventana. `days` decide qué
// campo de CoinGecko se pide (7d para el semanal, 30d para el mensual) y
// `yahooRange` cuánta historia trae Yahoo (el contexto del brief mensual
// necesita ~13 ventanas de 21 días hábiles: 2 años alcanzan de sobra).

import { fetchYahooChart } from './marketPrices'
import { fetchWithRetry } from './fetchWithRetry'
import { CRYPTO_MAP } from './cryptoMap'

export async function fetchCryptoWindow(symbols, { days = 7 } = {}) {
  const field = `price_change_percentage_${days}d_in_currency`
  const ids = symbols.map((s) => CRYPTO_MAP[s.toUpperCase()]).filter(Boolean)
  if (ids.length === 0) return {}
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=${days}d`
    const res = await fetchWithRetry(url, { next: { revalidate: 300 } })
    if (!res.ok) return {}
    const rows = await res.json()
    const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]))
    const out = {}
    for (const sym of symbols) {
      const r = byId.get(CRYPTO_MAP[sym.toUpperCase()])
      if (!r || !(r.current_price > 0)) continue
      const pct = r[field]
      out[sym] = { price: r.current_price, changePct: pct != null && isFinite(pct) ? pct : null }
    }
    return out
  } catch {
    return {}
  }
}

// Compatibilidad con los consumidores del semanal ya escritos.
export async function fetchCryptoWeekly(symbols) {
  const out = await fetchCryptoWindow(symbols, { days: 7 })
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { price: v.price, change7d: v.changePct }]))
}

export function makeBriefFetcher({ days = 7, yahooRange = '6mo' } = {}) {
  let cryptoCache = null
  return async (symbol, kind) => {
    if (kind === 'crypto') {
      if (!cryptoCache) cryptoCache = await fetchCryptoWindow(['BTC', 'ETH'], { days })
      const q = cryptoCache[symbol]
      if (!q || !(q.price > 0)) return null
      // Sin cambio de ventana real, se devuelve un solo cierre: windowChangePct
      // no alcanza a medir y la fila sale con precio y sin porcentaje. Mejor
      // un dato faltante que un cero inventado.
      if (q.changePct == null) return { closes: [q.price] }
      const prior = q.price / (1 + q.changePct / 100)
      // Suficientes cierres para cualquier windowSize hasta 21 (la ventana
      // mensual): windowChangePct solo mira el primero y el último de su
      // ventana, así que rellenar con `prior` reproduce el % exacto.
      return { closes: Array(21).fill(prior).concat([q.price]) }
    }
    const { data } = await fetchYahooChart(symbol, { range: yahooRange, interval: '1d' })
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    return closes ? { closes } : null
  }
}
