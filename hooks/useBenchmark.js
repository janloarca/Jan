'use client'

import { useState, useEffect, useCallback } from 'react'

export function useBenchmark(period = 'YTD') {
  const [benchmarkData, setBenchmarkData] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchBenchmark = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/prices/benchmark?period=${encodeURIComponent(period)}`)
      if (res.ok) {
        const data = await res.json()
        setBenchmarkData(data)
      }
    } catch {}
    setLoading(false)
  }, [period])

  useEffect(() => {
    fetchBenchmark()
  }, [fetchBenchmark])

  const benchmarkReturn = benchmarkData?.periodReturn ?? benchmarkData?.ytdReturn ?? null

  return { benchmarkData, benchmarkReturn, loading }
}
