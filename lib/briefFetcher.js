// FASE HZ2. El fetcher de series para el brief de mercado, compartido por el
// cron dominical y el botón de prueba (antes vivía dentro de la ruta del cron,
// así que la prueba habría usado otra ruta de datos que la corrida real).
//
// Las acciones e índices van a Yahoo, que da serie diaria. CoinGecko no da
// serie en el endpoint barato: para cripto se reconstruye una serie mínima con
// el precio de hoy y el cambio de 7 días. Alcanza para la fila (el % de la
// semana) y es honesta con el resto: no alcanza para "el mayor movimiento en N
// semanas", que por eso solo se afirma del S&P y del VIX.

import { fetchYahooChart, fetchCryptoPrices } from './marketPrices'

export function makeBriefFetcher() {
  let cryptoCache = null
  return async (symbol, kind) => {
    if (kind === 'crypto') {
      if (!cryptoCache) cryptoCache = (await fetchCryptoPrices(['BTC', 'ETH'])).results
      const q = cryptoCache[symbol]
      if (!q || !(q.price > 0)) return null
      const prior = q.change7d != null ? q.price / (1 + q.change7d / 100) : q.price
      return { closes: [prior, prior, prior, prior, prior, q.price] }
    }
    const { data } = await fetchYahooChart(symbol, { range: '6mo', interval: '1d' })
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    return closes ? { closes } : null
  }
}
