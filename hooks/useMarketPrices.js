import { authFetch } from '@/lib/authFetch'
import { isMarketPriced } from '@/components/dashboard/utils'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

export function useMarketPrices(items) {
  const [prices, setPrices] = useState({})
  const [dividends, setDividends] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const abortRef = useRef(null)

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

    setLoading(true)
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
        setPrices(data.prices || {})
        setLastUpdate(data.timestamp)
      } else {
        setError('Failed to fetch prices')
      }

      if (divRes?.ok) {
        const divData = await divRes.json()
        setDividends(divData.dividends || {})
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Failed to fetch market prices:', err)
      setError(err.message)
    }
    setLoading(false)
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

  return { enrichedItems, prices, loading, error, lastUpdate, refresh: fetchPrices }
}
