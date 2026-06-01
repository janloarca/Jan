'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { formatCurrency, formatCompact, formatDate, computeModifiedDietz } from './utils'
import { computeTWRSeries } from './analytics'
import { authFetch } from '@/lib/authFetch'

function polyline(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

function buildGeometry(values, mode, height, width, pad, extraSeries) {
  const ch = height - pad.top - pad.bottom
  const cw = width - pad.left - pad.right

  let allVals = values.filter(v => isFinite(v))
  if (mode === 'performance' && extraSeries && extraSeries.length > 0) {
    allVals = [...allVals, ...extraSeries.filter(v => isFinite(v))]
  }
  if (allVals.length === 0) allVals = [0]
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const paddingVal = mode === 'performance' ? 0 : (max - min) * 0.05
  const adjustedMin = mode === 'performance' ? Math.min(min, 0) - Math.abs(min || 1) * 0.1 : min - paddingVal
  const adjustedMax = mode === 'performance' ? Math.max(max, 0) + Math.abs(max || 1) * 0.1 : max + paddingVal
  const range = adjustedMax - adjustedMin || 1

  const points = values.map((v, i) => ({
    x: pad.left + (i / Math.max(values.length - 1, 1)) * cw,
    y: pad.top + ch - ((v - adjustedMin) / range) * ch,
    v,
  }))

  const baselineY = mode === 'performance'
    ? pad.top + ch - ((0 - adjustedMin) / range) * ch
    : pad.top + ch

  const tickCount = 5
  const yTicks = Array.from({ length: tickCount }, (_, i) => ({
    val: adjustedMin + (range * i) / (tickCount - 1),
    y: pad.top + ch - (i / (tickCount - 1)) * ch,
  }))

  return { points, baselineY, yTicks, cw, ch, adjustedMin, range }
}

function findClosestBenchmark(sorted, targetTs) {
  let lo = 0, hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].ts < targetTs) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(sorted[lo - 1].ts - targetTs) < Math.abs(sorted[lo].ts - targetTs)) lo--
  return sorted[lo]
}

export default function PortfolioGrowthChart({ items, snapshots, transactions, lang, convert, baseCurrency, benchmarkSymbol, benchmarkName, onSaveSnapshot }) {
  const [period, setPeriod] = useState('YTD')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [dataPoints, setDataPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [staticTotal, setStaticTotal] = useState(0)
  const [viewMode, setViewMode] = useState('value')
  const [returnMode, setReturnMode] = useState('twr')
  const [benchmarkPts, setBenchmarkPts] = useState(null)
  const [showContributions, setShowContributions] = useState(true)
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [showSnapshotImport, setShowSnapshotImport] = useState(false)
  const [snapshotRows, setSnapshotRows] = useState([{ date: '', value: '' }])
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const containerRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(650)

  const periods = ['DAY', '1W', 'MTD', '1M', '3M', 'YTD', '1Y', 'ALL', 'CUSTOM']
  const t = (es, en) => lang === 'es' ? es : en
  const benchmarkPeriodMap = { DAY: '1M', '1W': '1M', MTD: '1M', '1M': '1M', '3M': '3M', '6M': '6M', YTD: 'YTD', '1Y': '1Y', ALL: 'ALL' }

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 100) setChartWidth(Math.round(w))
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const formatTooltipDate = useCallback((date) => {
    if (period === 'DAY') {
      return date.toLocaleTimeString(lang === 'es' ? 'es' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    }
    return formatDate(date.toISOString())
  }, [period, lang])

  const fetchHistory = useCallback(async () => {
    if (!items || items.length === 0) return
    if (period === 'CUSTOM' && !customRange.from) return
    if (period === 'DAY') { setLoading(false); return }
    setLoading(true)
    setFetchError(null)
    try {
      let apiPeriod = period === 'MTD' ? '1M' : period
      if (period === 'CUSTOM') {
        const fromDate = new Date(customRange.from)
        const toDate = customRange.to ? new Date(customRange.to) : new Date()
        const diffDays = Math.ceil((toDate - fromDate) / 86400000)
        if (diffDays <= 30) apiPeriod = '1M'
        else if (diffDays <= 90) apiPeriod = '3M'
        else if (diffDays <= 180) apiPeriod = '6M'
        else if (diffDays <= 365) apiPeriod = '1Y'
        else apiPeriod = 'ALL'
      }
      const res = await authFetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({
            symbol: it.symbol, type: it.type, quantity: it.quantity,
            currentPrice: it._originalPrice || it.currentPrice,
            purchasePrice: it._originalPurchasePrice || it.purchasePrice,
            currency: it._originalCurrency || 'USD',
            acquisitionDate: it.acquisitionDate,
          })),
          period: apiPeriod,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        let pts = data.dataPoints || []
        if (baseCurrency !== 'USD' && convert) {
          pts = pts.map(dp => ({ ...dp, total: convert(dp.total, 'USD', baseCurrency) }))
        }
        if (period === 'CUSTOM' && customRange.from) {
          const fromTs = new Date(customRange.from).getTime()
          const toTs = customRange.to ? new Date(customRange.to + 'T23:59:59').getTime() : Date.now()
          pts = pts.filter(dp => dp.ts >= fromTs && dp.ts <= toTs)
        }
        if (period === 'YTD') {
          const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
          pts = pts.filter((dp) => dp.ts >= yearStart)
        }
        if (period === 'MTD') {
          const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
          pts = pts.filter((dp) => dp.ts >= monthStart)
        }
        if (period === 'DAY' && pts.length > 0) {
          const latestTs = pts[pts.length - 1].ts
          const latestDate = new Date(latestTs)
          const dayStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate(), 7, 0, 0).getTime()
          pts = pts.filter(dp => dp.ts >= dayStart)
        }
        setDataPoints(pts)
        setStaticTotal(data.staticTotal != null
          ? (baseCurrency !== 'USD' && convert ? convert(data.staticTotal, 'USD', baseCurrency) : data.staticTotal)
          : 0)
      }
    } catch (err) {
      console.error('Failed to fetch portfolio history:', err)
      setFetchError(t('Error cargando historial', 'Failed to load history'))
    }
    setLoading(false)
  }, [items, period, baseCurrency, convert, customRange])

  useEffect(() => {
    fetchHistory()
    const interval = setInterval(fetchHistory, 60000)
    return () => clearInterval(interval)
  }, [fetchHistory])

  useEffect(() => {
    const bp = benchmarkPeriodMap[period] || 'YTD'
    let cancelled = false
    const sym = benchmarkSymbol || '%5EGSPC'
    fetch(`/api/prices/benchmark?period=${encodeURIComponent(bp)}&symbol=${encodeURIComponent(sym)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled && data) setBenchmarkPts(data.dataPoints || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [period, benchmarkSymbol])

  const currentTotal = useMemo(() => {
    if (!items) return 0
    return items.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0)
  }, [items])

  const snapshotData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return []
    const now = Date.now()
    const convertVal = (v) => convert ? convert(v, 'USD', baseCurrency || 'USD') : v

    if (period === 'DAY') {
      const threeDaysAgo = now - 3 * 86400000
      const recentSnaps = [...snapshots]
        .filter(s => s.date && new Date(s.date).getTime() >= threeDaysAgo)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(s => ({ ts: new Date(s.date).getTime(), date: new Date(s.date), value: convertVal(s.netWorthUSD ?? s.totalActivosUSD ?? 0) }))
        .filter(p => p.value > 0)
      if (currentTotal > 0) {
        recentSnaps.push({ ts: Date.now(), date: new Date(), value: currentTotal })
      }
      return recentSnaps
    }

    const periodDays = { '1W': 7, MTD: null, '1M': 30, '3M': 90, '6M': 180, YTD: null, '1Y': 365, ALL: null, CUSTOM: null }
    let cutoff, ceiling

    if (period === 'CUSTOM' && customRange.from) {
      cutoff = new Date(customRange.from).getTime()
      ceiling = customRange.to ? new Date(customRange.to + 'T23:59:59').getTime() : now
    } else if (period === 'YTD') cutoff = new Date(new Date().getFullYear(), 0, 1).getTime()
    else if (period === 'MTD') cutoff = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    else if (period === 'ALL') cutoff = 0
    else cutoff = now - (periodDays[period] || 365) * 86400000

    let pts = [...snapshots]
      .filter((s) => {
        if (!s.date) return false
        const ts = new Date(s.date).getTime()
        if (ts < cutoff) return false
        if (ceiling && ts > ceiling) return false
        return true
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((s) => ({
        ts: new Date(s.date).getTime(),
        date: new Date(s.date),
        value: convertVal(s.netWorthUSD ?? s.totalActivosUSD ?? 0),
      }))
      .filter((p) => p.value > 0)

    if (period === 'MTD' && pts.length < 2) {
      const sorted = [...snapshots]
        .filter(s => s.date && new Date(s.date).getTime() < cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
      if (sorted.length > 0) {
        const prevSnap = sorted[0]
        const val = convertVal(prevSnap.netWorthUSD ?? prevSnap.totalActivosUSD ?? 0)
        if (val > 0) {
          pts.unshift({ ts: cutoff, date: new Date(cutoff), value: val })
        }
      }
    }

    if (currentTotal > 0 && pts.length > 0) {
      const lastTs = pts[pts.length - 1].ts
      if (Date.now() - lastTs > 3600000) {
        pts.push({ ts: Date.now(), date: new Date(), value: currentTotal })
      }
    }

    return pts
  }, [snapshots, period, convert, baseCurrency, customRange, currentTotal])

  const chartData = useMemo(() => {
    const apiPts = dataPoints.length >= 2
      ? dataPoints.map((dp) => ({ ts: dp.ts, date: new Date(dp.ts), value: dp.total }))
      : []
    const snapPts = snapshotData.length >= 2 ? [...snapshotData] : []

    let pts

    if (period === 'DAY' && snapPts.length >= 2) {
      pts = [...snapPts]
      const recentApi = apiPts.filter(p => p.ts > snapPts[0].ts && p.ts < snapPts[snapPts.length - 1].ts)
      if (recentApi.length > 0) {
        pts = [...snapPts.slice(0, -1), ...recentApi, snapPts[snapPts.length - 1]]
          .sort((a, b) => a.ts - b.ts)
      }
    } else if (period === '1W' && apiPts.length >= 2) {
      pts = apiPts
    } else if (snapPts.length >= 2) {
      pts = [...snapPts]
      const firstSnapTs = snapPts[0].ts
      const lastSnapTs = snapPts[snapPts.length - 1].ts
      const olderApi = apiPts.filter(p => p.ts < firstSnapTs - 3600000)
      if (olderApi.length > 0) pts.unshift(...olderApi)
      const recentApi = apiPts.filter(p => p.ts > lastSnapTs + 3600000)
      pts.push(...recentApi)
    } else if (apiPts.length >= 2) {
      pts = apiPts
    } else {
      return []
    }

    const keepLeadingZeros = ['YTD', 'MTD'].includes(period)
    if (!keepLeadingZeros) {
      while (pts.length > 2 && pts[0].value === 0) {
        pts.shift()
      }
    }

    if (period === 'YTD' && pts.length > 0) {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
      if (pts[0].ts > yearStart + 86400000) {
        pts.unshift({ ts: yearStart, date: new Date(yearStart), value: pts[0].value })
      }
    }
    if (period === 'MTD' && pts.length > 0) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
      if (pts[0].ts > monthStart + 86400000) {
        pts.unshift({ ts: monthStart, date: new Date(monthStart), value: pts[0].value })
      }
    }

    if (currentTotal > 0) {
      const now = Date.now()
      const last = pts[pts.length - 1]
      if (last && Math.abs(last.ts - now) > 60000) {
        pts.push({ ts: now, date: new Date(), value: currentTotal })
      } else if (last) {
        pts[pts.length - 1] = { ts: now, date: new Date(), value: currentTotal }
      }
    }
    return pts
  }, [dataPoints, snapshotData, currentTotal, period])

  const mwrData = useMemo(() => {
    if (chartData.length < 2) return []
    const startTs = chartData[0].ts
    const startVal = chartData[0].value
    const result = [0]
    for (let i = 1; i < chartData.length; i++) {
      const { pct } = computeModifiedDietz({
        startValue: startVal,
        endValue: chartData[i].value,
        startTs,
        endTs: chartData[i].ts,
        transactions, convert, baseCurrency,
      })
      result.push(pct)
    }
    return result
  }, [chartData, transactions, convert, baseCurrency])

  const twrData = useMemo(() => {
    if (chartData.length < 2) return []
    return computeTWRSeries(chartData, transactions, convert, baseCurrency)
  }, [chartData, transactions, convert, baseCurrency])

  const returnData = returnMode === 'twr' ? twrData : mwrData

  const sortedBenchmark = useMemo(() => {
    if (!benchmarkPts || benchmarkPts.length < 2) return null
    return [...benchmarkPts].sort((a, b) => a.ts - b.ts)
  }, [benchmarkPts])

  const benchmarkReturn = useMemo(() => {
    if (!sortedBenchmark || chartData.length < 2) return null
    const bStart = findClosestBenchmark(sortedBenchmark, chartData[0].ts)
    const bEnd = findClosestBenchmark(sortedBenchmark, chartData[chartData.length - 1].ts)
    return bStart.close > 0 ? ((bEnd.close - bStart.close) / bStart.close) * 100 : null
  }, [sortedBenchmark, chartData])

  const benchmarkReturnSeries = useMemo(() => {
    if (!sortedBenchmark || chartData.length < 2) return null
    const baseClose = sortedBenchmark[0].close
    if (baseClose <= 0) return null
    return chartData.map((dp) => {
      const closest = findClosestBenchmark(sortedBenchmark, dp.ts)
      return ((closest.close - baseClose) / baseClose) * 100
    })
  }, [sortedBenchmark, chartData])

  const contributionLine = useMemo(() => {
    if (viewMode !== 'value' || !transactions || chartData.length < 2) return null
    const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
    const txs = transactions
      .filter(tx => flowTypes[tx.type] != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    const startVal = chartData[0].value
    return chartData.map(dp => {
      let cum = startVal
      for (const tx of txs) {
        const txTs = new Date(tx.date).getTime()
        if (txTs <= chartData[0].ts) continue
        if (txTs > dp.ts) break
        const amt = tx.totalAmount || tx.amount || 0
        const convertedAmt = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
        cum += (flowTypes[tx.type] || 0) * convertedAmt
      }
      return cum
    })
  }, [chartData, transactions, viewMode, convert, baseCurrency])

  const drawdown = useMemo(() => {
    if (chartData.length < 3) return null
    let peak = chartData[0].value, peakIdx = 0
    let maxDd = 0, ddStart = 0, ddEnd = 0
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i].value > peak) { peak = chartData[i].value; peakIdx = i }
      const dd = peak > 0 ? (peak - chartData[i].value) / peak : 0
      if (dd > maxDd) { maxDd = dd; ddStart = peakIdx; ddEnd = i }
    }
    if (maxDd < 0.01) return null
    return { start: ddStart, end: ddEnd, pct: maxDd * 100 }
  }, [chartData])

  const txMarkers = useMemo(() => {
    if (!transactions || chartData.length < 2) return []
    const actionTypes = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL']
    const startTs = chartData[0].ts
    const endTs = chartData[chartData.length - 1].ts
    return transactions
      .filter(tx => actionTypes.includes(tx.type))
      .filter(tx => {
        const txTs = new Date(tx.date).getTime()
        return txTs >= startTs && txTs <= endTs
      })
      .map(tx => {
        const txTs = new Date(tx.date).getTime()
        let closest = 0
        let minDist = Infinity
        for (let i = 0; i < chartData.length; i++) {
          const dist = Math.abs(chartData[i].ts - txTs)
          if (dist < minDist) { minDist = dist; closest = i }
        }
        return { ...tx, chartIdx: closest }
      })
  }, [transactions, chartData])

  const width = chartWidth
  const chartHeight = 260
  const pad = { top: 16, right: 16, bottom: 32, left: 52 }

  const step = Math.max(1, Math.floor(chartData.length / 6))
  const xLabels = useMemo(() => {
    if (chartData.length === 0) return []
    const spanDays = (chartData[chartData.length - 1].ts - chartData[0].ts) / 86400000
    const useDay = spanDays < 120 || ['1W', 'MTD', '1M', '3M'].includes(period)
    const raw = chartData
      .map((d, i) => ({
        label: period === 'DAY'
          ? `${d.date.getHours().toString().padStart(2, '0')}:${d.date.getMinutes().toString().padStart(2, '0')}`
          : useDay
            ? d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : d.date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        idx: i,
      }))
      .filter((_, i) => i % step === 0 || i === chartData.length - 1)
    return raw.filter((xl, i) => i === 0 || xl.label !== raw[i - 1].label)
  }, [chartData, step, period])

  const growthValues = useMemo(() => chartData.map((d) => d.value), [chartData])

  const geo = useMemo(() => {
    const vals = viewMode === 'value' ? growthValues : returnData
    if (vals.length < 2) return null
    const extra = (viewMode === 'performance' && benchmarkReturnSeries) ? benchmarkReturnSeries : null
    return buildGeometry(vals, viewMode === 'value' ? 'value' : 'performance', chartHeight, width, pad, extra)
  }, [viewMode, growthValues, returnData, benchmarkReturnSeries, width])

  const contributionGeoPoints = useMemo(() => {
    if (!geo || !contributionLine || viewMode !== 'value' || !showContributions) return null
    const ch = chartHeight - pad.top - pad.bottom
    const allVals = [...growthValues, ...contributionLine]
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const paddingVal = (max - min) * 0.05
    const adjustedMin = min - paddingVal
    const adjustedMax = max + paddingVal
    const range = adjustedMax - adjustedMin || 1
    return contributionLine.map((v, i) => ({
      x: pad.left + (i / Math.max(contributionLine.length - 1, 1)) * geo.cw,
      y: pad.top + ch - ((v - adjustedMin) / range) * ch,
      v,
    }))
  }, [geo, contributionLine, viewMode, showContributions, growthValues, chartHeight, pad])

  const resolvedXLabels = useMemo(() => {
    if (!geo) return []
    return xLabels.map((xl) => ({ ...xl, x: geo.points[xl.idx]?.x })).filter((xl) => xl.x != null)
  }, [xLabels, geo])

  const benchmarkGeoPoints = useMemo(() => {
    if (!geo || !benchmarkReturnSeries || viewMode !== 'performance') return null
    const ch = chartHeight - pad.top - pad.bottom
    const allVals = [...returnData, ...benchmarkReturnSeries]
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const adjustedMin = Math.min(min, 0) - Math.abs(min || 1) * 0.1
    const adjustedMax = Math.max(max, 0) + Math.abs(max || 1) * 0.1
    const range = adjustedMax - adjustedMin || 1
    return benchmarkReturnSeries.map((v, i) => ({
      x: pad.left + (i / Math.max(benchmarkReturnSeries.length - 1, 1)) * geo.cw,
      y: pad.top + ch - ((v - adjustedMin) / range) * ch,
      v,
    }))
  }, [geo, benchmarkReturnSeries, viewMode, returnData, chartHeight, pad])

  const firstVal = chartData.length > 0 ? chartData[0].value : 0
  const lastVal = chartData.length > 0 ? chartData[chartData.length - 1].value : 0
  const growthAbs = lastVal - firstVal
  const growthPct = firstVal > 0 ? (growthAbs / firstVal) * 100 : 0
  const lastReturn = returnData.length > 0 ? returnData[returnData.length - 1] : 0

  const microInsight = useMemo(() => {
    if (benchmarkReturn == null || returnData.length < 2) return null
    const delta = lastReturn - benchmarkReturn
    return { portfolioRet: lastReturn, benchmarkRet: benchmarkReturn, delta, isOut: delta >= 0 }
  }, [benchmarkReturn, lastReturn, returnData])

  const handleSaveSnapshots = useCallback(async () => {
    if (!onSaveSnapshot) return
    const valid = snapshotRows.filter(r => r.date && r.value && !isNaN(parseFloat(r.value)))
    if (valid.length === 0) return
    setSnapshotSaving(true)
    for (const row of valid) {
      await onSaveSnapshot({
        date: row.date,
        totalActivosUSD: parseFloat(row.value),
        totalDebtUSD: 0,
        netWorthUSD: parseFloat(row.value),
        baseCurrency: 'USD',
        _source: 'manual',
      })
    }
    setSnapshotSaving(false)
    setShowSnapshotImport(false)
    setSnapshotRows([{ date: '', value: '' }])
  }, [snapshotRows, onSaveSnapshot])

  const periodSelector = (
    <div className="flex flex-wrap gap-0.5 bg-[#0f172a] rounded-lg p-0.5">
      {periods.map((p) => (
        <button key={p} onClick={() => {
          setPeriod(p)
          if (p === 'CUSTOM') setShowCustomRange(true)
          else setShowCustomRange(false)
        }}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
            period === p ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}>{p === 'CUSTOM' ? (lang === 'es' ? 'Rango' : 'Range') : p}</button>
      ))}
    </div>
  )

  if (loading && chartData.length < 2) {
    return (
      <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
        <div className="flex items-center justify-center min-h-[260px]">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            {t('Cargando datos...', 'Loading data...')}
          </div>
        </div>
      </div>
    )
  }

  if (fetchError && chartData.length < 2) {
    return (
      <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-2">
          <p className="text-red-400 text-sm">{fetchError}</p>
          <button onClick={fetchHistory} className="text-xs text-blue-400 hover:text-blue-300">{t('Reintentar', 'Retry')}</button>
        </div>
      </div>
    )
  }

  if (chartData.length < 2) {
    return (
      <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-2 text-slate-500 text-sm">
          {period === 'DAY' ? (
            <>
              <p>{t('Sin datos intradía — el mercado puede estar cerrado.', 'No intraday data — market may be closed.')}</p>
              <button onClick={() => setPeriod('1W')} className="text-xs text-blue-400 hover:text-blue-300">
                {t('Ver última semana', 'View last week')}
              </button>
            </>
          ) : (
            <p>{t('Agrega activos para ver la gráfica.', 'Add assets to see the chart.')}</p>
          )}
        </div>
        <div className="flex justify-center mt-2">{periodSelector}</div>
      </div>
    )
  }

  const hp = hoverIdx != null && geo ? geo.points[hoverIdx] : null
  const hd = hoverIdx != null ? chartData[hoverIdx] : null

  return (
    <div ref={containerRef} className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      {/* Tab bar: Value | Performance */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setViewMode('value')}
          className={`text-sm font-medium pb-1 transition-all border-b-2 ${
            viewMode === 'value'
              ? 'text-white border-white'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          }`}>
          {t('Valor', 'Value')}
        </button>
        <button onClick={() => setViewMode('performance')}
          className={`text-sm font-medium pb-1 transition-all border-b-2 ${
            viewMode === 'performance'
              ? 'text-white border-white'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          }`}>
          {t('Rendimiento', 'Performance')}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {viewMode === 'value' && contributionLine && (
            <button onClick={() => setShowContributions(!showContributions)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${showContributions ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'}`}
              title={t('Mostrar/ocultar capital invertido', 'Show/hide invested capital')}>
              {t('Invertido', 'Invested')}
            </button>
          )}
          {viewMode === 'performance' && (
            <div className="flex gap-0.5 bg-[#0f172a] rounded-lg p-0.5">
              <button onClick={() => setReturnMode('twr')}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${returnMode === 'twr' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'}`}
                title={t('Retorno ponderado por tiempo — mide el rendimiento del portafolio sin importar depósitos/retiros', 'Time-Weighted Return — measures portfolio performance regardless of deposits/withdrawals')}>
                TWR
              </button>
              <button onClick={() => setReturnMode('mwr')}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${returnMode === 'mwr' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'}`}
                title={t('Retorno ponderado por dinero — refleja tu experiencia real como inversionista', 'Money-Weighted Return — reflects your actual experience as an investor')}>
                MWR
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Header stats */}
      {viewMode === 'value' ? (
        <div className="mb-3">
          <p className="text-3xl font-bold text-white">{formatCurrency(hd ? hd.value : currentTotal)}</p>
          <p className={`text-sm mt-0.5 ${growthAbs >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {growthAbs >= 0 ? '+' : ''}{formatCurrency(growthAbs)} ({growthAbs >= 0 ? '+' : ''}{growthPct.toFixed(2)}%)
            <span className="text-slate-500 ml-1">{period === 'YTD' ? t('este año', 'this year') : period === 'DAY' ? t('hoy', 'today') : period === 'CUSTOM' ? t('rango', 'range') : period}</span>
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className={`text-3xl font-bold ${lastReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {lastReturn >= 0 ? '+' : ''}{(hoverIdx != null && returnData[hoverIdx] != null ? returnData[hoverIdx] : lastReturn).toFixed(2)}%
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-sm text-slate-400">
              {period === 'YTD' ? t('Retorno total del año', 'Total return this year') : period === 'DAY' ? t('Retorno hoy', 'Return today') : `${t('Retorno', 'Return')} ${period}`}
            </span>
            <span className="text-xs text-slate-600">
              {returnMode === 'twr'
                ? t('TWR · Sin efecto de depósitos', 'TWR · Excludes cashflow effects')
                : t('MWR · Tu experiencia real', 'MWR · Your actual experience')}
            </span>
          </div>
        </div>
      )}

      {/* Benchmark insight (performance mode only) */}
      {viewMode === 'performance' && microInsight && (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-3 ${
          microInsight.isOut ? 'bg-emerald-500/5 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/5 border border-red-500/20 text-red-400'
        }`}>
          <span>{microInsight.isOut ? '▲' : '▼'}</span>
          <span>
            {t('Portafolio', 'Portfolio')} {microInsight.portfolioRet >= 0 ? '+' : ''}{microInsight.portfolioRet.toFixed(2)}%
            {` vs ${benchmarkName || 'S&P 500'} `}{microInsight.benchmarkRet >= 0 ? '+' : ''}{microInsight.benchmarkRet.toFixed(2)}%
            {' · '}{microInsight.isOut
              ? t(`Superas por ${Math.abs(microInsight.delta).toFixed(2)}%`, `Outperforming by ${Math.abs(microInsight.delta).toFixed(2)}%`)
              : t(`Debajo por ${Math.abs(microInsight.delta).toFixed(2)}%`, `Underperforming by ${Math.abs(microInsight.delta).toFixed(2)}%`)}
          </span>
        </div>
      )}

      {/* Drawdown indicator */}
      {viewMode === 'value' && drawdown && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-3 bg-red-500/5 border border-red-500/20 text-red-400">
          <span>↓</span>
          <span>
            Max drawdown: -{drawdown.pct.toFixed(1)}%
            <span className="text-slate-500 ml-1">
              ({formatDate(chartData[drawdown.start].date.toISOString())} → {formatDate(chartData[drawdown.end].date.toISOString())})
            </span>
          </span>
        </div>
      )}

      {/* Chart */}
      {geo && (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${chartHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet"
            onMouseLeave={() => setHoverIdx(null)}
            onTouchEnd={() => setHoverIdx(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = ((e.clientX - rect.left) / rect.width) * width
              if (geo.points.length === 0) return
              let lo = 0, hi = geo.points.length - 1
              while (lo < hi - 1) {
                const mid = (lo + hi) >> 1
                if (geo.points[mid].x < mx) lo = mid; else hi = mid
              }
              setHoverIdx(Math.abs(geo.points[lo].x - mx) <= Math.abs(geo.points[hi].x - mx) ? lo : hi)
            }}
            onTouchMove={(e) => {
              const touch = e.touches[0]
              if (!touch) return
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = ((touch.clientX - rect.left) / rect.width) * width
              if (geo.points.length === 0) return
              let lo = 0, hi = geo.points.length - 1
              while (lo < hi - 1) {
                const mid = (lo + hi) >> 1
                if (geo.points[mid].x < mx) lo = mid; else hi = mid
              }
              setHoverIdx(Math.abs(geo.points[lo].x - mx) <= Math.abs(geo.points[hi].x - mx) ? lo : hi)
            }}>

            {/* Y-axis grid lines and labels */}
            {geo.yTicks.map((tk, i) => (
              <g key={i}>
                <line x1={pad.left} y1={tk.y} x2={width - pad.right} y2={tk.y} stroke="#334155" strokeDasharray="4 4" strokeOpacity="0.5" />
                <text x={pad.left - 8} y={tk.y + 4} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="system-ui">
                  {viewMode === 'performance' ? `${tk.val >= 0 ? '+' : ''}${tk.val.toFixed(tk.val === 0 ? 0 : 2)}%` : formatCompact(tk.val)}
                </text>
              </g>
            ))}

            {viewMode === 'value' ? (
              <>
                <defs>
                  <linearGradient id="grad-value" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Drawdown shaded zone */}
                {drawdown && geo.points[drawdown.start] && geo.points[drawdown.end] && (
                  <rect
                    x={geo.points[drawdown.start].x}
                    y={pad.top}
                    width={geo.points[drawdown.end].x - geo.points[drawdown.start].x}
                    height={chartHeight - pad.top - pad.bottom}
                    fill="#ef4444" opacity="0.06" rx="2" />
                )}

                {/* Main value area + line */}
                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-value)" />
                <path d={polyline(geo.points)} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Contributions line (invested capital) */}
                {contributionGeoPoints && contributionGeoPoints.length >= 2 && showContributions && (
                  <path d={polyline(contributionGeoPoints)} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 3" opacity="0.5" />
                )}

                {/* Transaction markers */}
                {txMarkers.map((tx, i) => {
                  const pt = geo.points[tx.chartIdx]
                  if (!pt) return null
                  const isBuy = tx.type === 'BUY' || tx.type === 'DEPOSIT'
                  const markerY = chartHeight - pad.bottom
                  return (
                    <polygon key={i}
                      points={isBuy
                        ? `${pt.x},${markerY + 2} ${pt.x - 4},${markerY + 10} ${pt.x + 4},${markerY + 10}`
                        : `${pt.x},${markerY + 10} ${pt.x - 4},${markerY + 2} ${pt.x + 4},${markerY + 2}`}
                      fill={isBuy ? '#10b981' : '#ef4444'} opacity="0.6" />
                  )
                })}
              </>
            ) : (
              <>
                <defs>
                  <linearGradient id="grad-perf-green" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="grad-perf-red" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.02" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
                  </linearGradient>
                  <clipPath id="clip-above-baseline">
                    <rect x={pad.left} y={pad.top} width={geo.cw} height={Math.max(0, geo.baselineY - pad.top)} />
                  </clipPath>
                  <clipPath id="clip-below-baseline">
                    <rect x={pad.left} y={geo.baselineY} width={geo.cw} height={Math.max(0, chartHeight - pad.bottom - geo.baselineY)} />
                  </clipPath>
                </defs>

                <line x1={pad.left} y1={geo.baselineY} x2={width - pad.right} y2={geo.baselineY}
                  stroke="#64748b" strokeWidth="1" strokeDasharray="6 4" />
                <text x={pad.left - 8} y={geo.baselineY + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="system-ui" fontWeight="600">0%</text>

                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-green)" clipPath="url(#clip-above-baseline)" />

                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-red)" clipPath="url(#clip-below-baseline)" />

                <path d={polyline(geo.points)} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  clipPath="url(#clip-above-baseline)" />

                <path d={polyline(geo.points)} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  clipPath="url(#clip-below-baseline)" />

                {benchmarkGeoPoints && benchmarkGeoPoints.length >= 2 && (
                  <>
                    <path d={polyline(benchmarkGeoPoints)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" strokeOpacity="0.7" />
                    <text x={benchmarkGeoPoints[benchmarkGeoPoints.length - 1].x + 4} y={benchmarkGeoPoints[benchmarkGeoPoints.length - 1].y + 3}
                      fill="#f59e0b" fontSize="9" fontFamily="system-ui" fontWeight="600" opacity="0.8">{benchmarkName || 'SPX'}</text>
                  </>
                )}
              </>
            )}

            {/* X-axis labels */}
            {resolvedXLabels.map((xl, i) => (
              <text key={i} x={xl.x} y={chartHeight - 8} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="system-ui">{xl.label}</text>
            ))}

            {/* Hover crosshair */}
            {hp && (
              <g>
                <line x1={hp.x} y1={pad.top} x2={hp.x} y2={chartHeight - pad.bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
                <circle cx={hp.x} cy={hp.y} r="4.5"
                  fill={viewMode === 'value' ? '#3b82f6' : (hp.v >= 0 ? '#10b981' : '#ef4444')}
                  stroke="#0f172a" strokeWidth="2" />
              </g>
            )}
          </svg>

          {/* Hover tooltip */}
          {hd && hp && (
            <div className="absolute pointer-events-none bg-[#0f172a] border border-[#475569] text-white text-xs rounded-lg px-3 py-2 shadow-xl z-10"
              style={{
                left: `${Math.min(85, Math.max(15, (hp.x / width) * 100))}%`,
                top: `${(hp.y / chartHeight) * 100 - 14}%`,
                transform: 'translate(-50%, -100%)',
              }}>
              {viewMode === 'value' ? (
                <>
                  <div className="font-bold">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-400">{formatTooltipDate(hd.date)}</div>
                  {hoverIdx > 0 && (() => {
                    const prev = chartData[hoverIdx - 1]
                    const chg = hd.value - prev.value
                    const chgPct = prev.value > 0 ? (chg / prev.value) * 100 : 0
                    return (
                      <div className={chg >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {chg >= 0 ? '+' : ''}{formatCurrency(chg)} ({chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%)
                      </div>
                    )
                  })()}
                  {(() => {
                    const chgFromStart = hd.value - firstVal
                    const chgPctFromStart = firstVal > 0 ? (chgFromStart / firstVal) * 100 : 0
                    return (
                      <div className="text-slate-500">
                        {chgFromStart >= 0 ? '+' : ''}{formatCurrency(chgFromStart)} ({chgPctFromStart >= 0 ? '+' : ''}{chgPctFromStart.toFixed(2)}%) {t('desde inicio', 'from start')}
                      </div>
                    )
                  })()}
                </>
              ) : (
                <>
                  <div className={`font-bold ${(returnData[hoverIdx] ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t('Portafolio', 'Portfolio')}: {(returnData[hoverIdx] ?? 0) >= 0 ? '+' : ''}{(returnData[hoverIdx] ?? 0).toFixed(2)}%
                  </div>
                  {benchmarkReturnSeries && benchmarkReturnSeries[hoverIdx] != null && (
                    <div className="text-amber-400">
                      {benchmarkName || 'S&P 500'}: {benchmarkReturnSeries[hoverIdx] >= 0 ? '+' : ''}{benchmarkReturnSeries[hoverIdx].toFixed(2)}%
                    </div>
                  )}
                  <div className="text-slate-300">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-500">{formatTooltipDate(hd.date)}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend + Period selector */}
      {viewMode === 'value' && (showContributions && contributionLine) && (
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-500 rounded-full inline-block" />
            {t('Valor actual', 'Current value')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-slate-400 rounded-full inline-block opacity-50" style={{ borderBottom: '1px dashed' }} />
            {t('Capital invertido', 'Invested capital')}
          </span>
        </div>
      )}
      {viewMode === 'performance' && (
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" />
            {t('Tu portafolio', 'Your portfolio')} ({returnMode.toUpperCase()})
          </span>
          {benchmarkReturnSeries && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-amber-500 rounded-full inline-block opacity-70" style={{ borderBottom: '1px dashed' }} />
              {benchmarkName || 'S&P 500'}
            </span>
          )}
        </div>
      )}
      <div className="flex justify-center mt-2">
        {periodSelector}
      </div>

      {/* Custom date range inputs */}
      {showCustomRange && period === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 mt-3 justify-center">
          <label className="text-xs text-slate-400">{t('Desde', 'From')}:</label>
          <input type="date" value={customRange.from}
            onChange={e => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
            className="px-2 py-1 bg-[#0f172a] border border-[#334155] rounded text-xs text-white focus:outline-none focus:border-blue-500" />
          <label className="text-xs text-slate-400">{t('Hasta', 'To')}:</label>
          <input type="date" value={customRange.to}
            onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
            max={new Date().toISOString().split('T')[0]}
            className="px-2 py-1 bg-[#0f172a] border border-[#334155] rounded text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
      )}

      {/* Snapshot import section */}
      <div className="flex justify-center mt-3">
        <button onClick={() => setShowSnapshotImport(!showSnapshotImport)}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          {showSnapshotImport ? '▾' : '▸'} {t('Agregar datos históricos', 'Add historical data')}
        </button>
      </div>

      {showSnapshotImport && (
        <div className="mt-2 p-3 bg-[#0f172a] border border-[#334155] rounded-lg">
          <p className="text-[10px] text-slate-400 mb-2">
            {t('Agrega valores pasados de tu portafolio para completar la gráfica.',
               'Add past portfolio values to complete the chart.')}
          </p>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {snapshotRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input type="date" value={row.date}
                  onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, date: e.target.value } : r))}
                  className="px-2 py-1 bg-[#1e293b] border border-[#334155] rounded text-xs text-white focus:outline-none focus:border-blue-500 w-36" />
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-xs text-slate-500">$</span>
                  <input type="number" value={row.value} placeholder={t('Valor total', 'Total value')}
                    onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                    className="w-full px-2 py-1 bg-[#1e293b] border border-[#334155] rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
                {snapshotRows.length > 1 && (
                  <button onClick={() => setSnapshotRows(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-500 hover:text-red-400 text-sm px-1">×</button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => setSnapshotRows(prev => [...prev, { date: '', value: '' }])}
              className="text-[11px] text-blue-400 hover:text-blue-300">
              + {t('Agregar fila', 'Add row')}
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setShowSnapshotImport(false); setSnapshotRows([{ date: '', value: '' }]) }}
                className="px-3 py-1 text-xs text-slate-400 hover:text-white transition-colors">
                {t('Cancelar', 'Cancel')}
              </button>
              <button onClick={handleSaveSnapshots} disabled={snapshotSaving || !snapshotRows.some(r => r.date && r.value)}
                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 disabled:opacity-40 transition-colors">
                {snapshotSaving ? '...' : t('Guardar', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
