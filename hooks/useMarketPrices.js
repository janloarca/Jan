import { authFetch } from '@/lib/authFetch'
import { isMarketPriced } from '@/components/dashboard/utils'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

// Caché en memoria a nivel de módulo: al cambiar de sección el hook arranca con
// los últimos precios/dividendos conocidos en vez de una pantalla en blanco. El
// fetch corre SIEMPRE al montar y cada 5 min, exactamente igual que antes.
let _cachedPrices = {}
let _cachedDividends = {}
let _cachedLastUpdate = null

export function useMarketPrices(items) {
  const [prices, setPrices] = useState(_cachedPrices)
  const [dividends, setDividends] = useState(_cachedDividends)
  const [loading, setLoading] = useState(false)
  // `loading` only ever arms on the very FIRST fetch of the session (see the
  // gate below) — on purpose, so a background poll never flashes a big
  // loading UI every 5 minutes. But that also means `loading` is USELESS as
  // a "don't trust these prices yet" signal for anything past the first
  // load: a caller gating a write on `!loading` (useDashboardData's daily
  // snapshot, backfill, and dividend-processing effects) had NO protection
  // during a background refetch, so a transient bad price mid-poll could get
  // written straight into a permanent snapshot before the retry corrected
  // it — the "gráfica con bumps" the user reported. `isFetching` is the
  // separate, always-armed signal for that: true for every fetch, visible to
  // NOTHING UI-facing, so it can't reintroduce the flicker `loading`
  // deliberately avoids.
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(_cachedLastUpdate)
  const abortRef = useRef(null)
  // A single failed poll is usually Yahoo hiccupping for a few seconds, not a
  // real outage — the server already retries per-request (fetchWithRetry +
  // query2 fallback) and falls back to a last-good cache. Only surface the
  // "no se pudo conectar" banner once a poll fails twice IN A ROW: one blip
  // shouldn't alarm the user with an error they can't do anything about.
  const consecutiveFailuresRef = useRef(0)

  const fetchPrices = useCallback(async () => {
    if (!items || items.length === 0) return
    // Whitelist, not blacklist — see isMarketPriced. A cash bucket named "USD"
    // must never be quoted as the "USD" ETF.
    const symbols = items
      .filter((it) => isMarketPriced(it))
      .map((it) => ({ symbol: it.symbol, type: it.type }))
    if (symbols.length === 0) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    if (Object.keys(_cachedPrices).length === 0) setLoading(true)
    setIsFetching(true)
    setError(null)
    try {
      const stockSyms = symbols.filter((s) => !/crypto|cripto|blockchain/i.test(s.type || ''))

      const [priceRes, divRes] = await Promise.all([
        authFetch('/api/prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: symbols }),
          signal,
        }),
        stockSyms.length > 0
          ? authFetch('/api/prices/dividends', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbols: stockSyms }),
              signal,
            })
          : null,
      ])

      if (priceRes.ok) {
        const data = await priceRes.json()
        _cachedPrices = data.prices || {}
        _cachedLastUpdate = data.timestamp
        setPrices(_cachedPrices)
        setLastUpdate(_cachedLastUpdate)
        consecutiveFailuresRef.current = 0
      } else {
        consecutiveFailuresRef.current += 1
        if (consecutiveFailuresRef.current >= 2) setError('Failed to fetch prices')
      }

      if (divRes?.ok) {
        const divData = await divRes.json()
        _cachedDividends = divData.dividends || {}
        setDividends(_cachedDividends)
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Failed to fetch market prices:', err)
      consecutiveFailuresRef.current += 1
      if (consecutiveFailuresRef.current >= 2) setError(err.message)
    }
    setLoading(false)
    setIsFetching(false)
  }, [items])

  useEffect(() => {
    if (items && items.length > 0) {
      fetchPrices()
      // 5 min, not 1 — the dashboard shows daily change, not a trading terminal;
      // 60s polling multiplied Yahoo/CoinGecko quota use 5× for no visible gain
      // and churned every downstream memo (enrichedItems identity) each tick.
      const interval = setInterval(fetchPrices, 300000)
      return () => { clearInterval(interval); abortRef.current?.abort() }
    }
    return () => abortRef.current?.abort()
  }, [fetchPrices])

  const enrichedItems = useMemo(() => {
    return items.map((it) => {
      const sym = (it.symbol || '').toUpperCase()
      const priceData = prices[sym] || prices[it.symbol]
      const divData = dividends[sym]
      const enriched = { ...it }

      // Defense in depth: even if a quote sneaks into the map (stale cache, a
      // symbol shared with a market item), never overwrite a non-market item's
      // stored balance/price with it.
      if (priceData && isMarketPriced(it)) {
        enriched.currentPrice = priceData.price
        enriched.change7d = priceData.change7d
        enriched.change1d = priceData.change1d
        // FASE KN: qué VENTANA mide ese change1d y de cuándo es. Para una acción
        // es la última sesión regular COMPLETADA, así que un fin de semana (o un
        // martes antes de la apertura) sigue siendo la sesión anterior; para
        // cripto es una ventana rodante de 24h, siempre fresca. Sin esto la
        // tarjeta de movimientos titulaba "hoy" un dato del viernes.
        enriched._change1dWindow = priceData.change1dWindow || null
        enriched._change1dAsOf = priceData.change1dAsOf || null
        // ⛔ FASE KN. `priceItems` cae a un respaldo last-known-good POR SÍMBOLO
        // con expiración de SIETE DÍAS (lib/priceCache.js) y lo devuelve marcado
        // `stale: true` + `asOf`. Esos dos campos existían, viajaban dentro de
        // `prices[sym]`... y este enriquecimiento los tiraba: una cotización de
        // la semana pasada se dibujaba en "movimientos de HOY" idéntica a una
        // viva, sin ninguna marca. Es la degradación muda que el invariante 5
        // prohíbe, en una superficie que no lo tenía cubierto.
        enriched._priceStale = priceData.stale === true
        enriched._priceAsOf = priceData.asOf || null
        enriched.marketCurrency = priceData.currency
      }

      if (divData?.hasDividend && !it.incomeAmount && !it.incomeRate) {
        enriched.dividendYield = divData.dividendYield
        enriched.annualDividend = divData.annualDividend
        if (!it.incomeMonths || it.incomeMonths.length === 0) {
          enriched.incomeMonths = divData.paymentMonths
        }
        if (!it.incomeFrequency) {
          enriched.incomeFrequency = divData.frequency
        }
        if (!it.incomeAmount) {
          enriched.incomeAmount = divData.lastAmount || 0
        }
      }

      return enriched
    })
  }, [items, prices, dividends])

  return { enrichedItems, prices, loading, isFetching, error, lastUpdate, refresh: fetchPrices }
}
