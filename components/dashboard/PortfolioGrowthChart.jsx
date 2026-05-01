'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { formatCurrency, formatCompact, formatShortDate, formatDate, computeModifiedDietz } from './utils'
import { computeTWRSeries } from './analytics'

function smooth(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const tension = 0.3
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += ` C ${p1.x + (p2.x - p0.x) * tension / 3} ${p1.y + (p2.y - p0.y) * tension / 3}, ${p2.x - (p3.x - p1.x) * tension / 3} ${p2.y - (p3.y - p1.y) * tension / 3}, ${p2.x} ${p2.y}`
  }
  return d
}

function buildGeometry(values, mode, height, width, pad, extraSeries) {
  const ch = height - pad.top - pad.bottom
  const cw = width - pad.left - pad.right

  let allVals = values
  if (mode === 'performance' && extraSeries && extraSeries.length > 0) {
    allVals = [...values, ...extraSeries]
  }
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

  return { points, baselineY, yTicks, cw, ch }
}

export default function PortfolioGrowthChart({ items, transactions, lang, convert, baseCurrency }) {
  const [period, setPeriod] = useState('YTD')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [dataPoints, setDataPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [staticTotal, setStaticTotal] = useState(0)
  const [viewMode, setViewMode] = useState('value')
  const [returnMode, setReturnMode] = useState('twr')
  const [benchmarkPts, setBenchmarkPts] = useState(null)

  const periods = ['1W', 'MTD', '1M', '3M', 'YTD', '1Y', 'ALL']
  const t = (es, en) => lang === 'es' ? es : en
  const benchmarkPeriodMap = { '1W': '1M', MTD: '1M', '1M': '1M', '3M': '3M', '6M': '6M', YTD: 'YTD', '1Y': '1Y', ALL: 'ALL' }

  const fetchHistory = useCallback(async () => {
    if (!items || items.length === 0) return
    setLoading(true)
    try {
      const apiPeriod = period === 'MTD' ? '1M' : period
      const res = await fetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({
            symbol: it.symbol, type: it.type, quantity: it.quantity,
            currentPrice: it.currentPrice, purchasePrice: it.purchasePrice,
            acquisitionDate: it.acquisitionDate,
          })),
          period: apiPeriod,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        let pts = data.dataPoints || []
        if (period === 'MTD') {
          const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
          pts = pts.filter((dp) => dp.ts >= monthStart)
        }
        setDataPoints(pts)
        setStaticTotal(data.staticTotal || 0)
      }
    } catch (err) {
      console.error('Failed to fetch portfolio history:', err)
    }
    setLoading(false)
  }, [items, period])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  useEffect(() => {
    const bp = benchmarkPeriodMap[period] || 'YTD'
    let cancelled = false
    fetch(`/api/prices/benchmark?period=${encodeURIComponent(bp)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled && data) setBenchmarkPts(data.dataPoints || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [period])

  const currentTotal = useMemo(() => {
    if (!items) return 0
    return items.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0)
  }, [items])

  const chartData = useMemo(() => {
    if (dataPoints.length === 0) return []
    const pts = dataPoints.map((dp) => ({
      ts: dp.ts,
      date: new Date(dp.ts),
      value: dp.total,
    }))
    const last = pts[pts.length - 1]
    if (last && currentTotal > 0 && Math.abs(last.value - currentTotal) > 1) {
      pts.push({ ts: Date.now(), date: new Date(), value: currentTotal })
    }
    return pts
  }, [dataPoints, currentTotal])

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

  const benchmarkReturn = useMemo(() => {
    if (!benchmarkPts || benchmarkPts.length < 2 || chartData.length < 2) return null
    const startTs = chartData[0].ts
    let bStart = null, bEnd = null
    let minStartDiff = Infinity, minEndDiff = Infinity
    for (const bp of benchmarkPts) {
      const dS = Math.abs(bp.ts - startTs)
      if (dS < minStartDiff) { minStartDiff = dS; bStart = bp.close }
      const dE = Math.abs(bp.ts - chartData[chartData.length - 1].ts)
      if (dE < minEndDiff) { minEndDiff = dE; bEnd = bp.close }
    }
    return bStart > 0 ? ((bEnd - bStart) / bStart) * 100 : null
  }, [benchmarkPts, chartData])

  const benchmarkReturnSeries = useMemo(() => {
    if (!benchmarkPts || benchmarkPts.length < 2 || chartData.length < 2) return null
    const sorted = [...benchmarkPts].sort((a, b) => a.ts - b.ts)
    const baseClose = sorted[0].close
    if (baseClose <= 0) return null
    const series = chartData.map((dp) => {
      let closest = sorted[0]
      let minDiff = Infinity
      for (const bp of sorted) {
        const diff = Math.abs(bp.ts - dp.ts)
        if (diff < minDiff) { minDiff = diff; closest = bp }
      }
      return ((closest.close - baseClose) / baseClose) * 100
    })
    return series
  }, [benchmarkPts, chartData])

  const width = 650
  const chartHeight = 260
  const pad = { top: 16, right: 16, bottom: 32, left: 52 }

  const step = Math.max(1, Math.floor(chartData.length / 6))
  const xLabels = useMemo(() => {
    return chartData
      .map((d, i) => ({
        label: period === 'DAY'
          ? `${d.date.getHours().toString().padStart(2, '0')}:${d.date.getMinutes().toString().padStart(2, '0')}`
          : formatShortDate(d.date.toISOString()),
        idx: i,
      }))
      .filter((_, i) => i % step === 0 || i === chartData.length - 1)
  }, [chartData, step, period])

  const growthValues = useMemo(() => chartData.map((d) => d.value), [chartData])

  const geo = useMemo(() => {
    const vals = viewMode === 'value' ? growthValues : returnData
    if (vals.length < 2) return null
    const extra = (viewMode === 'performance' && benchmarkReturnSeries) ? benchmarkReturnSeries : null
    return buildGeometry(vals, viewMode === 'value' ? 'value' : 'performance', chartHeight, width, pad, extra)
  }, [viewMode, growthValues, returnData, benchmarkReturnSeries])

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

  const periodSelector = (
    <div className="flex gap-0.5 bg-[#0f172a] rounded-lg p-0.5">
      {periods.map((p) => (
        <button key={p} onClick={() => setPeriod(p)}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
            period === p ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}>{p}</button>
      ))}
    </div>
  )

  if (loading) {
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

  if (chartData.length < 2) {
    return (
      <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
        <div className="flex items-center justify-center min-h-[200px] text-slate-500 text-sm">
          {t('Agrega activos para ver la gráfica.', 'Add assets to see the chart.')}
        </div>
      </div>
    )
  }

  const hp = hoverIdx != null && geo ? geo.points[hoverIdx] : null
  const hd = hoverIdx != null ? chartData[hoverIdx] : null

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
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
            <span className="text-slate-500 ml-1">{period === 'YTD' ? t('este año', 'this year') : period}</span>
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className={`text-3xl font-bold ${lastReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {lastReturn >= 0 ? '+' : ''}{(hoverIdx != null && returnData[hoverIdx] != null ? returnData[hoverIdx] : lastReturn).toFixed(2)}%
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-sm text-slate-400">
              {period === 'YTD' ? t('Retorno total del año', 'Total return this year') : `${t('Retorno', 'Return')} ${period}`}
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
            {' vs S&P 500 '}{microInsight.benchmarkRet >= 0 ? '+' : ''}{microInsight.benchmarkRet.toFixed(2)}%
            {' · '}{microInsight.isOut
              ? t(`Superas por ${Math.abs(microInsight.delta).toFixed(2)}%`, `Outperforming by ${Math.abs(microInsight.delta).toFixed(2)}%`)
              : t(`Debajo por ${Math.abs(microInsight.delta).toFixed(2)}%`, `Underperforming by ${Math.abs(microInsight.delta).toFixed(2)}%`)}
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
                {/* VALUE MODE: Blue line + blue gradient fill */}
                <defs>
                  <linearGradient id="grad-value" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path
                  d={`${smooth(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-value)" />
                <path d={smooth(geo.points)} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
              </>
            ) : (
              <>
                {/* PERFORMANCE MODE: Green above 0%, Red below 0% */}
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

                {/* 0% baseline */}
                <line x1={pad.left} y1={geo.baselineY} x2={width - pad.right} y2={geo.baselineY}
                  stroke="#64748b" strokeWidth="1" strokeDasharray="6 4" />
                <text x={pad.left - 8} y={geo.baselineY + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="system-ui" fontWeight="600">0%</text>

                {/* Green area (above baseline) */}
                <path
                  d={`${smooth(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-green)" clipPath="url(#clip-above-baseline)" />

                {/* Red area (below baseline) */}
                <path
                  d={`${smooth(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-red)" clipPath="url(#clip-below-baseline)" />

                {/* Green line (above baseline) */}
                <path d={smooth(geo.points)} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"
                  clipPath="url(#clip-above-baseline)" />

                {/* Red line (below baseline) */}
                <path d={smooth(geo.points)} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"
                  clipPath="url(#clip-below-baseline)" />

                {/* S&P 500 benchmark overlay */}
                {benchmarkGeoPoints && benchmarkGeoPoints.length >= 2 && (
                  <>
                    <path d={smooth(benchmarkGeoPoints)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 3" strokeOpacity="0.7" />
                    <text x={benchmarkGeoPoints[benchmarkGeoPoints.length - 1].x + 4} y={benchmarkGeoPoints[benchmarkGeoPoints.length - 1].y + 3}
                      fill="#f59e0b" fontSize="9" fontFamily="system-ui" fontWeight="600" opacity="0.8">S&P</text>
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
                  <div className="text-slate-400">{formatDate(hd.date.toISOString())}</div>
                </>
              ) : (
                <>
                  <div className={`font-bold ${(returnData[hoverIdx] ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t('Portafolio', 'Portfolio')}: {(returnData[hoverIdx] ?? 0) >= 0 ? '+' : ''}{(returnData[hoverIdx] ?? 0).toFixed(2)}%
                  </div>
                  {benchmarkReturnSeries && benchmarkReturnSeries[hoverIdx] != null && (
                    <div className="text-amber-400">
                      S&P 500: {benchmarkReturnSeries[hoverIdx] >= 0 ? '+' : ''}{benchmarkReturnSeries[hoverIdx].toFixed(2)}%
                    </div>
                  )}
                  <div className="text-slate-300">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-500">{formatDate(hd.date.toISOString())}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend + Period selector */}
      {viewMode === 'performance' && (
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" />
            {t('Tu portafolio', 'Your portfolio')} ({returnMode.toUpperCase()})
          </span>
          {benchmarkReturnSeries && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-amber-500 rounded-full inline-block opacity-70" style={{ borderBottom: '1px dashed' }} />
              S&P 500
            </span>
          )}
        </div>
      )}
      <div className="flex justify-center mt-2">
        {periodSelector}
      </div>
    </div>
  )
}
