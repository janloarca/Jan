'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { formatCurrency, formatCompact, getItemValue, getItemPrice, getTypeCategory, buildIncomeEvents } from './utils'
import { authFetch, safeJson } from '@/lib/authFetch'

const PERIODS = ['DAY', '1W', 'MTD', '1M', '3M', 'YTD', '1Y', 'ALL']

const NON_CHARTABLE = new Set(['realestate', 'alternatives', 'banks'])

function polyline(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export default function InstitutionPerformance({ items, lots, transactions, lang, convert, baseCurrency }) {
  const [selected, setSelected] = useState('ALL')
  const [period, setPeriod] = useState('YTD')
  const [dataPoints, setDataPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(null)
  const containerRef = useRef(null)
  const mountedRef = useRef(true)
  const [chartWidth, setChartWidth] = useState(600)

  const t = (es, en) => (lang === 'es' ? es : en)

  // ---------- responsive width ----------
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 100) setChartWidth(Math.round(w))
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // ---------- institutions ----------
  const institutions = useMemo(() => {
    if (!items || items.length === 0) return []
    const map = {}
    items.forEach((it) => {
      const inst = it.institution || t('Sin institución', 'No institution')
      if (!map[inst]) map[inst] = { name: inst, count: 0, value: 0, items: [] }
      map[inst].count += 1
      map[inst].value += getItemValue(it)
      map[inst].items.push(it)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [items, lang])

  const allTotal = useMemo(() => {
    return institutions.reduce((s, inst) => s + inst.value, 0)
  }, [institutions])

  // ---------- filtered items ----------
  const filteredItems = useMemo(() => {
    if (selected === 'ALL') return items || []
    const inst = institutions.find((i) => i.name === selected)
    return inst ? inst.items : []
  }, [selected, items, institutions])

  // ---------- summary ----------
  const summary = useMemo(() => {
    const totalValue = filteredItems.reduce((s, it) => s + getItemValue(it), 0)
    const totalCost = filteredItems.reduce((s, it) => {
      const qty = Number(it.quantity) || 0
      const pp = it.purchasePrice || 0
      return s + qty * pp
    }, 0)
    const gainLoss = totalValue - totalCost
    const gainPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0
    return { totalValue, totalCost, gainLoss, gainPct, positions: filteredItems.length }
  }, [filteredItems])

  // ---------- chartable? ----------
  const hasChartableItems = useMemo(() => {
    return filteredItems.some((it) => !NON_CHARTABLE.has(getTypeCategory(it)))
  }, [filteredItems])

  // ---------- fetch chart data ----------
  const fetchHistory = useCallback(async () => {
    if (!filteredItems || filteredItems.length === 0) return
    if (!hasChartableItems) return

    const chartableItems = filteredItems.filter(
      (it) => !NON_CHARTABLE.has(getTypeCategory(it))
    )
    if (chartableItems.length === 0) return

    setLoading(true)
    try {
      const apiPeriod = period === 'MTD' ? '1M' : period
      const chartableSymbols = new Set(chartableItems.map(it => (it.symbol || '').toUpperCase()).filter(Boolean))
      const selectedInst = selected === 'ALL' ? null : selected
      const relevantLots = (lots || [])
        .filter(l => l.quantity > 0
          && chartableSymbols.has((l.symbol || '').toUpperCase())
          && (!selectedInst || l.institution === selectedInst)
        )
      const data = await authFetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chartableItems.map((it) => {
            const cur = it._originalCurrency || it.currency || 'USD'
            const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
            return {
              id: it.id,
              symbol: it.symbol, type: it.type, quantity: it.quantity,
              currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
              purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
              currency: 'USD',
              acquisitionDate: it.acquisitionDate,
            }
          }),
          lots: relevantLots.length > 0 ? relevantLots.map(l => ({
            symbol: l.symbol, quantity: l.quantity,
            acquisitionDate: l.acquisitionDate,
            closedDate: l.closedDate || null,
            costBasis: l.costBasis,
          })) : undefined,
          income: buildIncomeEvents(transactions, chartableItems, convert, 'USD'),
          period: apiPeriod,
        }),
      })

      if (data && data.ok) {
        const json = await safeJson(data)
        if (!mountedRef.current) return
        let pts = json.dataPoints || []

        if (baseCurrency !== 'USD' && convert) {
          pts = pts.map(dp => ({ ...dp, total: convert(dp.total, 'USD', baseCurrency) }))
        }

        if (period === 'YTD') {
          const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1)
          pts = pts.filter((dp) => dp.ts >= yearStart)
        }
        if (period === 'MTD') {
          const now = new Date()
          const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
          pts = pts.filter((dp) => dp.ts >= monthStart)
        }

        setDataPoints(pts)
      } else {
        setDataPoints([])
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.error('InstitutionPerformance fetch error:', err)
      setDataPoints([])
    }
    if (mountedRef.current) setLoading(false)
  }, [filteredItems, transactions, period, baseCurrency, hasChartableItems])

  useEffect(() => {
    mountedRef.current = true
    setDataPoints([])
    setHoverIdx(null)
    fetchHistory()
    return () => { mountedRef.current = false }
  }, [fetchHistory])

  // ---------- chart geometry ----------
  const chartHeight = 220
  const pad = { top: 14, right: 12, bottom: 28, left: 48 }

  const chartData = useMemo(() => {
    if (dataPoints.length < 2) return []
    return dataPoints.map((dp) => ({
      ts: dp.ts,
      date: new Date(dp.ts),
      value: dp.total,
    }))
  }, [dataPoints])

  const geo = useMemo(() => {
    if (chartData.length < 2) return null
    const values = chartData.map((d) => d.value).filter(v => isFinite(v))
    if (values.length < 2) return null
    const ch = chartHeight - pad.top - pad.bottom
    const cw = chartWidth - pad.left - pad.right

    const min = Math.min(...values)
    const max = Math.max(...values)
    const paddingVal = (max - min) * 0.05 || 1
    const adjustedMin = min - paddingVal
    const adjustedMax = max + paddingVal
    const range = adjustedMax - adjustedMin || 1

    const points = values.map((v, i) => ({
      x: pad.left + (i / Math.max(values.length - 1, 1)) * cw,
      y: pad.top + ch - ((v - adjustedMin) / range) * ch,
      v,
    }))

    const baselineY = pad.top + ch

    const tickCount = 4
    const yTicks = Array.from({ length: tickCount }, (_, i) => ({
      val: adjustedMin + (range * i) / (tickCount - 1),
      y: pad.top + ch - (i / (tickCount - 1)) * ch,
    }))

    return { points, baselineY, yTicks, cw, ch }
  }, [chartData, chartWidth])

  const xLabels = useMemo(() => {
    if (chartData.length === 0) return []
    const step = Math.max(1, Math.floor(chartData.length / 5))
    const spanDays =
      (chartData[chartData.length - 1].ts - chartData[0].ts) / 86400000
    const useDay = spanDays < 120 || ['1W', 'MTD', '1M', '3M'].includes(period)
    return chartData
      .map((d, i) => ({
        label:
          period === 'DAY'
            ? `${d.date.getHours().toString().padStart(2, '0')}:${d.date
                .getMinutes()
                .toString()
                .padStart(2, '0')}`
            : useDay
              ? d.date.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : d.date.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', {
                  month: 'short',
                  year: '2-digit',
                }),
        idx: i,
      }))
      .filter((_, i) => i % step === 0 || i === chartData.length - 1)
      .filter((xl, i, arr) => i === 0 || xl.label !== arr[i - 1].label)
  }, [chartData, period, lang])

  // ---------- growth stats ----------
  const firstVal = chartData.length > 0 ? chartData[0].value : 0
  const lastVal = chartData.length > 0 ? chartData[chartData.length - 1].value : 0
  const growthAbs = lastVal - firstVal
  const growthPct = firstVal > 0 ? (growthAbs / firstVal) * 100 : 0

  const hp = hoverIdx != null && geo ? geo.points[hoverIdx] : null
  const hd = hoverIdx != null ? chartData[hoverIdx] : null

  // ---------- color from gain ----------
  const isGain = summary.gainLoss >= 0

  return (
    <div
      ref={containerRef}
      className="bg-theme-surface rounded-2xl border border-glass-border p-5 card-primary"
    >
      {/* Header */}
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-[#0A84FF]" />
        {t('RENDIMIENTO POR INSTITUCIÓN', 'INSTITUTION PERFORMANCE')}
      </h3>

      {/* Institution pills - horizontal scroll */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide -mx-1 px-1">
        {/* All pill */}
        <button
          onClick={() => setSelected('ALL')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
            selected === 'ALL'
              ? 'bg-[#0A84FF] text-white border-[#0A84FF]'
              : 'bg-theme-elevated text-slate-400 border-glass-border hover:text-white hover:border-slate-500'
          }`}
        >
          {t('Todas', 'All')}
          <span className="ml-1.5 opacity-70">
            {items?.length || 0} &middot; {formatCompact(allTotal, baseCurrency)}
          </span>
        </button>

        {institutions.map((inst) => (
          <button
            key={inst.name}
            onClick={() => setSelected(inst.name)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              selected === inst.name
                ? 'bg-[#0A84FF] text-white border-[#0A84FF]'
                : 'bg-theme-elevated text-slate-400 border-glass-border hover:text-white hover:border-slate-500'
            }`}
          >
            {inst.name}
            <span className="ml-1.5 opacity-70">
              {inst.count} &middot; {formatCompact(inst.value, baseCurrency)}
            </span>
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-theme-base rounded-xl p-3">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {t('Valor total', 'Total value')}
          </p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">
            {formatCurrency(summary.totalValue, baseCurrency)}
          </p>
        </div>
        <div className="bg-theme-base rounded-xl p-3">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {t('Posiciones', 'Positions')}
          </p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">
            {summary.positions}
          </p>
        </div>
        <div className="bg-theme-base rounded-xl p-3">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {t('Ganancia', 'Gain/Loss')}
          </p>
          <p
            className="text-lg font-bold font-mono tabular-nums"
            style={{ color: isGain ? '#34d399' : '#FF453A' }}
          >
            {isGain ? '+' : ''}
            {summary.gainPct.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Chart or fallback */}
      {!hasChartableItems ? (
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          {t(
            'Los activos de esta institución no tienen datos de mercado para graficar.',
            'Assets in this institution do not have market data for charting.'
          )}
        </div>
      ) : loading && chartData.length < 2 ? (
        <div className="flex items-center justify-center h-[220px]">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            {t('Cargando...', 'Loading...')}
          </div>
        </div>
      ) : chartData.length < 2 ? (
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          {t(
            'Sin datos suficientes para este periodo.',
            'Not enough data for this period.'
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Chart header stats */}
          <div className="mb-2">
            <p className="text-2xl font-bold text-white font-mono tabular-nums">
              {formatCurrency(hd ? hd.value : lastVal, baseCurrency)}
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: growthAbs >= 0 ? '#34d399' : '#FF453A' }}
            >
              <span className="font-mono tabular-nums">
                {growthAbs >= 0 ? '+' : ''}
                {formatCurrency(growthAbs, baseCurrency)} (
                {growthAbs >= 0 ? '+' : ''}
                {growthPct.toFixed(2)}%)
              </span>
              <span className="text-slate-500 ml-1">{period}</span>
            </p>
          </div>

          {/* SVG Chart */}
          {geo && (
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full"
              preserveAspectRatio="xMidYMid meet"
              onMouseLeave={() => setHoverIdx(null)}
              onTouchEnd={() => setHoverIdx(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const mx =
                  ((e.clientX - rect.left) / rect.width) * chartWidth
                if (geo.points.length === 0) return
                let lo = 0,
                  hi = geo.points.length - 1
                while (lo < hi - 1) {
                  const mid = (lo + hi) >> 1
                  if (geo.points[mid].x < mx) lo = mid
                  else hi = mid
                }
                setHoverIdx(
                  Math.abs(geo.points[lo].x - mx) <=
                    Math.abs(geo.points[hi].x - mx)
                    ? lo
                    : hi
                )
              }}
              onTouchMove={(e) => {
                const touch = e.touches[0]
                if (!touch) return
                const rect = e.currentTarget.getBoundingClientRect()
                const mx =
                  ((touch.clientX - rect.left) / rect.width) * chartWidth
                if (geo.points.length === 0) return
                let lo = 0,
                  hi = geo.points.length - 1
                while (lo < hi - 1) {
                  const mid = (lo + hi) >> 1
                  if (geo.points[mid].x < mx) lo = mid
                  else hi = mid
                }
                setHoverIdx(
                  Math.abs(geo.points[lo].x - mx) <=
                    Math.abs(geo.points[hi].x - mx)
                    ? lo
                    : hi
                )
              }}
            >
              <defs>
                <linearGradient id="inst-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Y-axis labels only - no grid lines */}
              {geo.yTicks.map((tk, i) => (
                <text
                  key={i}
                  x={pad.left - 6}
                  y={tk.y + 4}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="system-ui"
                >
                  {formatCompact(tk.val, baseCurrency)}
                </text>
              ))}

              {/* Area fill */}
              <path
                d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                fill="url(#inst-grad)"
              />

              {/* Line */}
              <path
                d={polyline(geo.points)}
                fill="none"
                stroke="var(--accent-blue)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* X-axis labels */}
              {xLabels.map((xl, i) => {
                const pt = geo.points[xl.idx]
                if (!pt) return null
                return (
                  <text
                    key={i}
                    x={pt.x}
                    y={chartHeight - 6}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="10"
                    fontFamily="system-ui"
                  >
                    {xl.label}
                  </text>
                )
              })}

              {/* Hover crosshair */}
              {hp && (
                <g>
                  <line
                    x1={hp.x}
                    y1={pad.top}
                    x2={hp.x}
                    y2={chartHeight - pad.bottom}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <circle
                    cx={hp.x}
                    cy={hp.y}
                    r="4.5"
                    fill="var(--accent-blue)"
                    stroke="#000000"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>
          )}

          {/* Hover tooltip */}
          {hd && hp && (
            <div
              className="absolute pointer-events-none bg-theme-base border border-glass-border text-white text-xs rounded-lg px-3 py-2 shadow-xl z-10"
              style={{
                left: `${Math.min(
                  85,
                  Math.max(15, (hp.x / chartWidth) * 100)
                )}%`,
                top: `${(hp.y / chartHeight) * 100 - 14}%`,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="font-bold font-mono tabular-nums">
                {formatCurrency(hd.value, baseCurrency)}
              </div>
              <div className="text-slate-400">
                {period === 'DAY'
                  ? hd.date.toLocaleTimeString(
                      lang === 'es' ? 'es' : 'en-US',
                      { hour: '2-digit', minute: '2-digit' }
                    )
                  : hd.date.toLocaleDateString(
                      lang === 'es' ? 'es' : 'en-US',
                      { year: 'numeric', month: 'short', day: 'numeric' }
                    )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Period selector */}
      <div className="flex justify-center mt-3">
        <div className="flex flex-wrap gap-0.5 bg-theme-base rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p)
                setHoverIdx(null)
              }}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                period === p
                  ? 'bg-[#0A84FF] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
