'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatCompact, formatShortDate, formatDate } from './utils'

export default function PortfolioGrowthChart({ snapshots, lang }) {
  const [period, setPeriod] = useState('ALL')
  const [hoverIdx, setHoverIdx] = useState(null)

  const periods = ['MTD', '3M', 'YTD', '1Y', 'ALL']

  const filtered = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return []
    const valid = snapshots.filter((s) => s.date && (s.netWorthUSD ?? s.totalActivosUSD) != null)
    if (valid.length === 0) return []
    if (period === 'ALL') return valid
    if (period === 'YTD') {
      const year = new Date().getFullYear()
      const ytd = valid.filter((s) => new Date(s.date).getFullYear() >= year)
      return ytd.length >= 2 ? ytd : valid
    }
    const monthsMap = { 'MTD': 1, '3M': 3, '1Y': 12 }
    const months = monthsMap[period] || 12
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    const result = valid.filter((s) => new Date(s.date) >= cutoff)
    return result.length >= 2 ? result : valid
  }, [snapshots, period])

  if (!filtered || filtered.length < 2) {
    return (
      <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5 h-full flex flex-col">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          Portfolio Growth
        </h3>
        <div className="flex-1 flex items-center justify-center min-h-[200px] text-slate-500 text-sm">
          {lang === 'es' ? 'Necesitas al menos 2 snapshots para ver la gráfica.' : 'Need at least 2 snapshots to show chart.'}
        </div>
      </div>
    )
  }

  const values = filtered.map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0)
  const firstVal = values[0]
  const lastVal = values[values.length - 1]
  const growthPct = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0
  const growthAbs = lastVal - firstVal
  const isPositive = growthPct >= 0
  const lineColor = isPositive ? '#10b981' : '#ef4444'

  const min = Math.min(...values) * 0.95
  const max = Math.max(...values) * 1.02
  const range = max - min || 1

  const height = 240
  const padding = { top: 20, right: 16, bottom: 36, left: 50 }
  const width = 650
  const cw = width - padding.left - padding.right
  const ch = height - padding.top - padding.bottom

  const points = values.map((v, i) => ({
    x: padding.left + (i / Math.max(values.length - 1, 1)) * cw,
    y: padding.top + ch - ((v - min) / range) * ch,
    v,
  }))

  function smooth(pts) {
    if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const t = 0.3
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      d += ` C ${p1.x + (p2.x - p0.x) * t / 3} ${p1.y + (p2.y - p0.y) * t / 3}, ${p2.x - (p3.x - p1.x) * t / 3} ${p2.y - (p3.y - p1.y) * t / 3}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const line = smooth(points)
  const area = `${line} L ${points[points.length - 1].x} ${padding.top + ch} L ${points[0].x} ${padding.top + ch} Z`

  const yTicks = Array.from({ length: 5 }, (_, i) => ({
    val: min + (range * i) / 4,
    y: padding.top + ch - (i / 4) * ch,
  }))

  const step = Math.max(1, Math.floor(filtered.length / 6))
  const xLabels = filtered
    .map((s, i) => ({ label: formatShortDate(s.date), x: points[i]?.x }))
    .filter((_, i) => i % step === 0 || i === filtered.length - 1)

  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const athIdx = values.indexOf(maxVal)
  const mddIdx = values.indexOf(minVal)

  const hp = hoverIdx != null ? points[hoverIdx] : null
  const hs = hoverIdx != null ? filtered[hoverIdx] : null

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
            Portfolio Growth
            <span className="text-slate-600 text-xs">
              {formatShortDate(filtered[0]?.date)} → {formatShortDate(filtered[filtered.length - 1]?.date)}
            </span>
          </h3>
          <div className="flex items-center gap-2 sm:gap-3 mt-2">
            <span className={`text-2xl font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{growthPct.toFixed(2)}%
            </span>
            <span className={`text-sm ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
              {isPositive ? '+' : ''}{formatCurrency(growthAbs)}
            </span>
            <span className="text-xs text-slate-500">{period}</span>
          </div>
        </div>
        <div className="flex gap-0.5 bg-[#0b1120] rounded-lg p-0.5">
          {periods.map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                period === p ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = ((e.clientX - rect.left) / rect.width) * width
            let closest = 0, minD = Infinity
            points.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < minD) { minD = d; closest = i } })
            setHoverIdx(closest)
          }}>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padding.left} y1={t.y} x2={width - padding.right} y2={t.y} stroke="#1e2d45" strokeDasharray="4 4" />
              <text x={padding.left - 8} y={t.y + 4} textAnchor="end" fill="#475569" fontSize="9" fontFamily="system-ui">
                {formatCompact(t.val)}
              </text>
            </g>
          ))}
          <defs>
            <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#growthGrad)" />
          <path d={line} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" />
          {athIdx > 0 && athIdx < values.length - 1 && (
            <text x={points[athIdx].x} y={points[athIdx].y - 10} textAnchor="middle" fill="#10b981" fontSize="9" fontWeight="bold">ATH</text>
          )}
          {mddIdx > 0 && mddIdx < values.length - 1 && (
            <text x={points[mddIdx].x} y={points[mddIdx].y + 16} textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="bold">MDD</text>
          )}
          {hp && (
            <g>
              <line x1={hp.x} y1={padding.top} x2={hp.x} y2={padding.top + ch} stroke="#334155" strokeDasharray="4 3" />
              <circle cx={hp.x} cy={hp.y} r="4" fill={lineColor} stroke="#0b1120" strokeWidth="2" />
            </g>
          )}
          {xLabels.map((xl, i) => (
            <text key={i} x={xl.x} y={height - 8} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="system-ui">{xl.label}</text>
          ))}
        </svg>
        {hs && hp && (
          <div className="absolute pointer-events-none bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 shadow-xl"
            style={{ left: `${(hp.x / width) * 100}%`, top: `${(hp.y / height) * 100 - 12}%`, transform: 'translate(-50%, -100%)' }}>
            <div className="font-bold">{formatCurrency(hs.netWorthUSD ?? hs.totalActivosUSD)}</div>
            <div className="text-slate-400">{formatDate(hs.date)}</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: lineColor }} /> Portfolio</span>
        <span>Max {formatCompact(maxVal)}</span>
        <span>Min {formatCompact(minVal)}</span>
        <span>{filtered.length} {lang === 'es' ? 'puntos' : 'points'}</span>
      </div>
    </div>
  )
}
