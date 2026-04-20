import { useState, useEffect, useCallback } from 'react'

export function useMarketPrices(items) {
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchPrices = useCallback(async () => {
    if (!items || items.length === 0) return
    const skipTypes = /inmueble|bank|banco|inversion|real.?estate|property/i
    const symbols = items
      .filter((it) => it.symbol && !skipTypes.test(it.type || ''))
      .map((it) => ({ symbol: it.symbol, type: it.type }))
    if (symbols.length === 0) return

    setLoading(true)
    try {
      const res = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: symbols }),
      })
      if (res.ok) {
        const data = await res.json()
        setPrices(data.prices || {})
        setLastUpdate(data.timestamp)
      }
    } catch {}
    setLoading(false)
  }, [items])

  useEffect(() => {
    if (items && items.length > 0) {
      fetchPrices()
    }
  }, [items.length])

  const enrichedItems = items.map((it) => {
    const sym = (it.symbol || '').toUpperCase()
    const priceData = prices[sym] || prices[it.symbol]
    if (!priceData) return it
    return {
      ...it,
      currentPrice: priceData.price,
      change7d: priceData.change7d,
      marketCurrency: priceData.currency,
    }
  })

  return { enrichedItems, prices, loading, lastUpdate, refresh: fetchPrices }
}
