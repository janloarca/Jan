import { useState, useEffect, useCallback, useRef } from 'react'

export function useExchangeRates(baseCurrency) {
  const [rates, setRates] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const ratesRef = useRef(null)
  const baseRef = useRef(baseCurrency)
  const mountedRef = useRef(true)
  ratesRef.current = rates
  baseRef.current = baseCurrency

  const fetchRates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exchange-rates')
      if (!mountedRef.current) return
      if (res.ok) {
        const data = await res.json()
        if (!mountedRef.current) return
        const raw = data.rates || {}
        const valid = Object.fromEntries(
          Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > 0 && isFinite(v))
        )
        if (Object.keys(valid).length > 0) {
          setRates(valid)
          setLastUpdate(data.timestamp)
          setStale(!!data.stale)
          if (data.stale) setError('rates-stale')
          else setError(null)
        } else {
          setError('Invalid rate data')
        }
      } else if (res.status === 503) {
        setError('Exchange rates temporarily unavailable')
      } else {
        setError('Failed to fetch rates')
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.error('Failed to fetch exchange rates:', err)
      setError(err.message)
    }
    if (mountedRef.current) setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchRates()
    const interval = setInterval(fetchRates, 15 * 60 * 1000)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [baseCurrency])

  const convert = useCallback((amount, fromCurrency, toCurrency) => {
    if (!amount || !ratesRef.current) return amount || 0
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseRef.current || 'USD').toUpperCase()
    if (from === to) return amount
    const fromRate = ratesRef.current[from]
    const toRate = ratesRef.current[to]
    if (!fromRate || !toRate) {
      console.warn(`[exchange] Missing rate for ${!fromRate ? from : to}`)
      return amount
    }
    const result = (amount / fromRate) * toRate
    return isFinite(result) ? result : amount
  }, [])

  const getRate = useCallback((fromCurrency, toCurrency) => {
    if (!ratesRef.current) return 1
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseRef.current || 'USD').toUpperCase()
    if (from === to) return 1
    const fromRate = ratesRef.current[from]
    const toRate = ratesRef.current[to]
    if (!fromRate || !toRate) {
      console.warn(`[exchange] Missing rate for ${!fromRate ? from : to}`)
      return 1
    }
    return toRate / fromRate
  }, [])

  const convertItemValue = useCallback((item) => {
    const qty = item.quantity || 0
    const price = item.currentPrice || item.purchasePrice || item.price || item.cost || 0
    const itemCurrency = item.marketCurrency || item.currency || 'USD'
    const rawValue = qty * price
    if (!isFinite(rawValue)) return 0
    return convert(rawValue, itemCurrency, baseRef.current)
  }, [convert])

  const ready = !!rates

  return { rates, loading, error, stale, lastUpdate, convert, getRate, convertItemValue, ready, refresh: fetchRates }
}
