import { useState, useEffect, useCallback, useMemo } from 'react'

export function useExchangeRates(baseCurrency) {
  const [rates, setRates] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchRates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/exchange-rates')
      if (res.ok) {
        const data = await res.json()
        setRates(data.rates || null)
        setLastUpdate(data.timestamp)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRates()
  }, [])

  const convert = useCallback((amount, fromCurrency, toCurrency) => {
    if (!amount || !rates) return amount || 0
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseCurrency || 'USD').toUpperCase()
    if (from === to) return amount

    const fromRate = rates[from] || 1
    const toRate = rates[to] || 1
    return (amount / fromRate) * toRate
  }, [rates, baseCurrency])

  const getRate = useCallback((fromCurrency, toCurrency) => {
    if (!rates) return 1
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseCurrency || 'USD').toUpperCase()
    if (from === to) return 1
    const fromRate = rates[from] || 1
    const toRate = rates[to] || 1
    return toRate / fromRate
  }, [rates, baseCurrency])

  const convertItemValue = useCallback((item) => {
    const qty = item.quantity || 0
    const price = item.currentPrice || item.purchasePrice || item.price || item.cost || 0
    const itemCurrency = item.marketCurrency || item.currency || 'USD'
    const rawValue = qty * price
    return convert(rawValue, itemCurrency, baseCurrency)
  }, [convert, baseCurrency])

  const ready = !!rates

  return { rates, loading, lastUpdate, convert, getRate, convertItemValue, ready, refresh: fetchRates }
}
