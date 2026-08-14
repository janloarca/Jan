import { authFetch } from '@/lib/authFetch'
import { useState, useEffect, useCallback, useRef } from 'react'

// Caché en memoria a nivel de módulo: al volver a una sección el hook arranca
// con las últimas tasas conocidas y revalida en background con la misma
// frecuencia de siempre (fetch al montar + cada 15 min). Si ya hay datos en
// pantalla no se muestra estado de carga.
let _cachedRates = null
let _cachedLastUpdate = null
let _cachedStale = false

// FASE FS. Persistencia entre sesiones: sin tasas, convert() devuelve el monto
// 1:1 (no hay número correcto que inventar), así que durante la carga fría un
// portafolio con cuentas en GTQ mostraba los quetzales COMO dólares: el
// patrimonio destellaba en ~$60K/$52K hasta que el fetch de tasas aterrizaba
// en el total real. Una tasa de ayer guardada en localStorage es muchísimo
// mejor que 1:1 (el FX se mueve lento), y el fetch de siempre la revalida en
// segundos. Solo elimina el destello de la carga fría: la PRIMera visita de
// la vida (sin nada guardado) sigue igual que antes.
const FX_STORAGE_KEY = 'chispudo-fx-rates-v1'

function seedFromStorage() {
  if (_cachedRates || typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.rates !== 'object') return
    const valid = Object.fromEntries(
      Object.entries(parsed.rates).filter(([, v]) => typeof v === 'number' && v > 0 && isFinite(v))
    )
    if (Object.keys(valid).length === 0) return
    _cachedRates = valid
    _cachedLastUpdate = parsed.timestamp || null
    _cachedStale = true // hasta que el fetch de este mount la refresque
  } catch { /* localStorage bloqueado o corrupto: mismo comportamiento de antes */ }
}

export function useExchangeRates(baseCurrency) {
  const [rates, setRates] = useState(() => { seedFromStorage(); return _cachedRates })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(_cachedStale)
  const [lastUpdate, setLastUpdate] = useState(_cachedLastUpdate)

  const ratesRef = useRef(null)
  const baseRef = useRef(baseCurrency)
  const mountedRef = useRef(true)
  ratesRef.current = rates
  baseRef.current = baseCurrency
  // Same reasoning as useMarketPrices: one failed poll (every 15 min here) is
  // not worth alarming the user over — only surface the error after it fails
  // twice in a row.
  const consecutiveFailuresRef = useRef(0)

  const fetchRates = useCallback(async () => {
    if (!ratesRef.current) setLoading(true)
    try {
      const res = await authFetch('/api/exchange-rates')
      if (!mountedRef.current) return
      if (res.ok) {
        const data = await res.json()
        if (!mountedRef.current) return
        const raw = data.rates || {}
        const valid = Object.fromEntries(
          Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > 0 && isFinite(v))
        )
        if (Object.keys(valid).length > 0) {
          _cachedRates = valid
          _cachedLastUpdate = data.timestamp
          _cachedStale = !!data.stale
          setRates(valid)
          setLastUpdate(data.timestamp)
          setStale(!!data.stale)
          try { localStorage.setItem(FX_STORAGE_KEY, JSON.stringify({ rates: valid, timestamp: data.timestamp })) } catch { /* sin persistencia, sin drama */ }
          // A stale rate is still a SUCCESSFUL response (the API degraded to its
          // own cache on purpose) — it must not feed `error`, which drives the
          // "no se pudo conectar" banner. That banner is for when we have
          // NOTHING to show, not for "this number is a few minutes old."
          consecutiveFailuresRef.current = 0
          setError(null)
        } else {
          consecutiveFailuresRef.current += 1
          if (consecutiveFailuresRef.current >= 2) setError('Invalid rate data')
        }
      } else if (res.status === 503) {
        consecutiveFailuresRef.current += 1
        if (consecutiveFailuresRef.current >= 2) setError('Exchange rates temporarily unavailable')
      } else {
        consecutiveFailuresRef.current += 1
        if (consecutiveFailuresRef.current >= 2) setError('Failed to fetch rates')
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.error('Failed to fetch exchange rates:', err)
      consecutiveFailuresRef.current += 1
      if (consecutiveFailuresRef.current >= 2) setError(err.message)
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
