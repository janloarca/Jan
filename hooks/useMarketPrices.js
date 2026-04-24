import { useState, useEffect, useCallback } from 'react'

export function useMarketPrices(items) {
  const [prices, setPrices] = useState({})
  const [dividends, setDividends] = useState({})
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

      const stockSyms = symbols.filter((s) => !/crypto|cripto|blockchain/i.test(s.type || ''))
      if (stockSyms.length > 0) {
        try {
          const divRes = await fetch('/api/prices/dividends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: stockSyms }),
          })
          if (divRes.ok) {
            const divData = await divRes.json()
            setDividends(divData.dividends || {})
          }
        } catch {}
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
    const divData = dividends[sym]
    const enriched = { ...it }

    if (priceData) {
      enriched.currentPrice = priceData.price
      enriched.change7d = priceData.change7d
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

  return { enrichedItems, prices, loading, lastUpdate, refresh: fetchPrices }
}
