// FASE HZ3. El fetcher de series para el brief de mercado, compartido por el
// cron dominical y el botón de prueba (antes vivía dentro de la ruta del cron,
// así que la prueba habría usado otra ruta de datos que la corrida real).
//
// Índices y acciones: Yahoo, que da serie diaria completa.
//
// Cripto: el endpoint `simple/price` que usa el resto de la app NO devuelve
// cambio de 7 días (`include_7d_change` no existe ahí; solo hay 24h), así que
// `change7d` volvía null y la primera prueba real imprimió "Bitcoin +0.00%":
// un número inventado que afirmaba que la cripto no se movió en la semana
// cuando en realidad no lo sabíamos. Se usa `coins/markets`, que sí trae
// `price_change_percentage_7d_in_currency`, y si ese dato falta se devuelve
// SOLO el precio: la fila sale sin porcentaje en vez de con uno falso.

import { fetchYahooChart } from './marketPrices'
import { fetchWithRetry } from './fetchWithRetry'
import { CRYPTO_MAP } from './cryptoMap'

export async function fetchCryptoWeekly(symbols) {
  const ids = symbols.map((s) => CRYPTO_MAP[s.toUpperCase()]).filter(Boolean)
  if (ids.length === 0) return {}
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=7d`
    const res = await fetchWithRetry(url, { next: { revalidate: 300 } })
    if (!res.ok) return {}
    const rows = await res.json()
    const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]))
    const out = {}
    for (const sym of symbols) {
      const r = byId.get(CRYPTO_MAP[sym.toUpperCase()])
      if (!r || !(r.current_price > 0)) continue
      const pct = r.price_change_percentage_7d_in_currency
      out[sym] = { price: r.current_price, change7d: pct != null && isFinite(pct) ? pct : null }
    }
    return out
  } catch {
    return {}
  }
}

export function makeBriefFetcher() {
  let cryptoCache = null
  return async (symbol, kind) => {
    if (kind === 'crypto') {
      if (!cryptoCache) cryptoCache = await fetchCryptoWeekly(['BTC', 'ETH'])
      const q = cryptoCache[symbol]
      if (!q || !(q.price > 0)) return null
      // Sin cambio semanal real, se devuelve un solo cierre: windowChangePct
      // no alcanza a medir y la fila sale con precio y sin porcentaje. Mejor
      // un dato faltante que un cero inventado.
      if (q.change7d == null) return { closes: [q.price] }
      const prior = q.price / (1 + q.change7d / 100)
      return { closes: [prior, prior, prior, prior, prior, q.price] }
    }
    const { data } = await fetchYahooChart(symbol, { range: '6mo', interval: '1d' })
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    return closes ? { closes } : null
  }
}
