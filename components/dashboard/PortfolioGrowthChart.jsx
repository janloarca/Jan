'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { formatCurrency, formatCompact, formatShortDate, formatDate, computeModifiedDietz } from './utils'

function MiniChart({ points, height, width, pad, lineColor, baselineY, mode, yTicks, xLabels, chartData, hoverIdx, setHoverIdx, returnData, period, lang, showXLabels = true }) {
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

  const gradId = `grad-${mode}`
  const line = smooth(points)
  const area = `${line} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`
  const hp = hoverIdx != null ? points[hoverIdx] : null
  const hd = hoverIdx != null ? chartData[hoverIdx] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const mx = ((e.clientX - rect.left) / rect.width) * width
          if (points.length === 0) return
          let lo = 0, hi = points.length - 1
          while (lo < hi - 1) {
            const mid = (lo + hi) >> 1
            if (points[mid].x < mx) lo = mid; else hi = mid
          }
          const closest = Math.abs(points[lo].x - mx) <= Math.abs(points[hi].x - mx) ? lo : hi
          setHoverIdx(closest)
        }}>
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line x1={pad.left} y1={tk.y} x2={width - pad.right} y2={tk.y} stroke="#1e2d45" strokeDasharray="4 4" />
            <text x={pad.left - 8} y={tk.y + 4} textAnchor="end" fill="#475569" fontSize="9" fontFamily="system-ui">
              {mode === 'return' ? `${tk.val.toFixed(1)}%` : formatCompact(tk.val)}
            </text>
          </g>
        ))}
        {mode === 'return' && (
          <line x1={pad.left} y1={baselineY} x2={width - pad.right} y2={baselineY}
            stroke="#475569" strokeWidth="1" strokeDasharray="6 3" />
        )}
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" />
        {hp && (
          <g>
            <line x1={hp.x} y1={pad.top} x2={hp.x} y2={height - pad.bottom} stroke="#334155" strokeDasharray="4 3" />
            <circle cx={hp.x} cy={hp.y} r="4" fill={lineColor} stroke="#0b1120" strokeWidth="2" />
          </g>
        )}
        {showXLabels && xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 6} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="system-ui">{xl.label}</text>
        ))}
      </svg>
      {hd && hp && (
        <div className="absolute pointer-events-none bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 shadow-xl z-10"
          style={{ left: `${(hp.x / width) * 100}%`, top: `${(hp.y / height) * 100 - 12}%`, transform: 'translate(-50%, -100%)' }}>
          {mode === 'growth' ? (
            <>
              <div className="font-bold">{formatCurrency(hd.value)}</div>
              <div className="text-slate-400">
                {period === 'DAY'
                  ? `${hd.date.getHours().toString().padStart(2, '0')}:${hd.date.getMinutes().toString().padStart(2, '0')}`
                  : formatDate(hd.date.toISOString())}
              </div>
            </>
          ) : (
            <>
              <div className="font-bold">{(returnData[hoverIdx] ?? 0) >= 0 ? '+' : ''}{(returnData[hoverIdx] ?? 0).toFixed(2)}%</div>
              <div className="text-slate-400">{formatCurrency(hd.value)}</div>
              <div className="text-slate-500">
                {period === 'DAY'
                  ? `${hd.date.getHours().toString().padStart(2, '0')}:${hd.date.getMinutes().toString().padStart(2, '0')}`
                  : formatDate(hd.date.toISOString())}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function buildChartGeometry(values, mode, height, width, pad) {
  const ch = height - pad.top - pad.bottom
  const cw = width - pad.left - pad.right

  const min = Math.min(...values)
  const max = Math.max(...values)
  const paddingVal = mode === 'return' ? 0 : (max - min) * 0.05
  const adjustedMin = mode === 'return' ? Math.min(min, 0) - Math.abs(min) * 0.1 : min - paddingVal
  const adjustedMax = mode === 'return' ? Math.max(max, 0) + Math.abs(max) * 0.1 : max + paddingVal
  const range = adjustedMax - adjustedMin || 1

  const points = values.map((v, i) => ({
    x: pad.left + (i / Math.max(values.length - 1, 1)) * cw,
    y: pad.top + ch - ((v - adjustedMin) / range) * ch,
    v,
  }))

  const baselineY = mode === 'return'
    ? pad.top + ch - ((0 - adjustedMin) / range) * ch
    : pad.top + ch

  const yTicks = Array.from({ length: 4 }, (_, i) => ({
    val: adjustedMin + (range * i) / 3,
    y: pad.top + ch - (i / 3) * ch,
  }))

  return { points, baselineY, yTicks }
}

export default function PortfolioGrowthChart({ items, transactions, lang, convert, baseCurrency }) {
  const [period, setPeriod] = useState('YTD')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [dataPoints, setDataPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [staticTotal, setStaticTotal] = useState(0)

  const periods = ['1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL']
  const t = (es, en) => lang === 'es' ? es : en

  const fetchHistory = useCallback(async () => {
    if (!items || items.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({
            symbol: it.symbol, type: it.type, quantity: it.quantity,
            currentPrice: it.currentPrice, purchasePrice: it.purchasePrice,
            acquisitionDate: it.acquisitionDate,
          })),
          period,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setDataPoints(data.dataPoints || [])
        setStaticTotal(data.staticTotal || 0)
      }
    } catch (err) {
      console.error('Failed to fetch portfolio history:', err)
    }
    setLoading(false)
  }, [items, period])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

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

  const returnData = useMemo(() => {
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

  const width = 650
  const growthHeight = 140
  const returnHeight = 140
  const growthPad = { top: 12, right: 16, bottom: 10, left: 50 }
  const returnPad = { top: 12, right: 16, bottom: 28, left: 50 }

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
  const growthGeo = useMemo(() => {
    if (growthValues.length < 2) return null
    return buildChartGeometry(growthValues, 'growth', growthHeight, width, growthPad)
  }, [growthValues])

  const returnGeo = useMemo(() => {
    if (returnData.length < 2) return null
    return buildChartGeometry(returnData, 'return', returnHeight, width, returnPad)
  }, [returnData])

  const returnXLabels = useMemo(() => {
    if (!returnGeo) return []
    return xLabels.map((xl) => ({ ...xl, x: returnGeo.points[xl.idx]?.x }))
  }, [xLabels, returnGeo])

  const dateRange = chartData.length >= 2
    ? `${formatShortDate(chartData[0].date.toISOString())} → ${formatShortDate(chartData[chartData.length - 1].date.toISOString())}`
    : ''

  const firstVal = chartData.length > 0 ? chartData[0].value : 0
  const lastVal = chartData.length > 0 ? chartData[chartData.length - 1].value : 0
  const growthAbs = lastVal - firstVal
  const growthPct = firstVal > 0 ? (growthAbs / firstVal) * 100 : 0
  const lastReturn = returnData.length > 0 ? returnData[returnData.length - 1] : 0

  const growthPositive = growthPct >= 0
  const returnPositive = lastReturn >= 0
  const growthColor = growthPositive ? '#10b981' : '#ef4444'
  const returnColor = returnPositive ? '#3b82f6' : '#ef4444'

  const periodSelector = (
    <div className="flex gap-0.5 bg-[#0b1120] rounded-lg p-0.5">
      {periods.map((p) => (
        <button key={p} onClick={() => setPeriod(p)}
          className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all ${
            period === p ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}>{p}</button>
      ))}
    </div>
  )

  if (loading) {
    return (
      <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 pulse-dot" />
            Portfolio
          </h3>
          {periodSelector}
        </div>
        <div className="flex items-center justify-center min-h-[160px]">
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
      <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 pulse-dot" />
            Portfolio
          </h3>
          {periodSelector}
        </div>
        <div className="flex items-center justify-center min-h-[160px] text-slate-500 text-sm">
          {t('Agrega activos para ver la gráfica.', 'Add assets to see the chart.')}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-4">
      {/* Shared header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 pulse-dot" />
          Portfolio
          <span className="text-slate-600 text-[10px]">{dateRange}</span>
        </h3>
        {periodSelector}
      </div>

      {/* Growth section */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Growth</span>
        <span className={`text-sm font-bold ${growthPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {growthPositive ? '+' : ''}{formatCompact(growthAbs)}
        </span>
        <span className={`text-[11px] ${growthPositive ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
          {growthPositive ? '+' : ''}{growthPct.toFixed(2)}%
        </span>
        <span className="text-[10px] text-slate-600">{period}</span>
      </div>
      {growthGeo && (
        <MiniChart
          points={growthGeo.points} height={growthHeight} width={width} pad={growthPad}
          lineColor={growthColor} baselineY={growthGeo.baselineY} mode="growth"
          yTicks={growthGeo.yTicks} xLabels={[]} chartData={chartData}
          hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} returnData={returnData}
          period={period} lang={lang} showXLabels={false}
        />
      )}

      {/* Divider */}
      <div className="border-t border-dashed border-[#1e2d45] my-2" />

      {/* Return section */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Return</span>
        <span className={`text-sm font-bold ${returnPositive ? 'text-blue-400' : 'text-red-400'}`}>
          {returnPositive ? '+' : ''}{lastReturn.toFixed(2)}%
        </span>
        <span className="text-[10px] text-slate-600">{period} · Modified Dietz</span>
      </div>
      {returnGeo && (
        <MiniChart
          points={returnGeo.points} height={returnHeight} width={width} pad={returnPad}
          lineColor={returnColor} baselineY={returnGeo.baselineY} mode="return"
          yTicks={returnGeo.yTicks} xLabels={returnXLabels} chartData={chartData}
          hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} returnData={returnData}
          period={period} lang={lang} showXLabels={true}
        />
      )}
    </div>
  )
}
