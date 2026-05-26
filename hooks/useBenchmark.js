'use client'

import { useState, useEffect, useCallback } from 'react'

export const BENCHMARKS = {
  '%5EGSPC': { name: 'S&P 500', short: 'SPX' },
  '%5EIXIC': { name: 'NASDAQ Composite', short: 'NDX' },
  '%5EDJI': { name: 'Dow Jones', short: 'DJI' },
  '%5EGSPTSE': { name: 'S&P/TSX (Canada)', short: 'TSX' },
  'EWZ': { name: 'iShares MSCI Brazil', short: 'EWZ' },
  'EWW': { name: 'iShares MSCI Mexico', short: 'EWW' },
  'VT': { name: 'Vanguard Total World', short: 'VT' },
  'QQQ': { name: 'Invesco QQQ (Nasdaq-100)', short: 'QQQ' },
}

export function useBenchmark(period = 'YTD', symbol = '%5EGSPC') {
  const [benchmarkData, setBenchmarkData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchBenchmark = useCallback(async () => {
    const cacheKey = `chispudo-benchmark-${symbol}-${period}`
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const { data, ts } = JSON.parse(cached)
        if (Date.now() - ts < 5 * 60 * 1000) {
          setBenchmarkData(data)
          setLoading(false)
          return
        }
      }
    } catch {}

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/prices/benchmark?period=${encodeURIComponent(period)}&symbol=${encodeURIComponent(symbol)}`)
      if (res.ok) {
        const data = await res.json()
        setBenchmarkData(data)
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })) } catch {}
      } else {
        setError('Failed to fetch benchmark data')
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Network error')
      }
    }
    setLoading(false)
  }, [period, symbol])

  useEffect(() => {
    fetchBenchmark()
  }, [fetchBenchmark])

  const benchmarkReturn = benchmarkData?.periodReturn ?? benchmarkData?.ytdReturn ?? null
  const benchmarkName = BENCHMARKS[symbol]?.short || 'SPX'

  return { benchmarkData, benchmarkReturn, benchmarkName, loading, error, refetch: fetchBenchmark }
}
