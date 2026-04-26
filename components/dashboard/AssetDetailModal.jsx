'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, formatDate, getItemPrice } from './utils'

export default function AssetDetailModal({ item, onClose, lang = 'es' }) {
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('1M')
  const [hoverIdx, setHoverIdx] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en
  const ranges = ['1W', '1M', '3M', '6M', '1Y', 'ALL']

  const rangeMap = { '1W': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', 'ALL': '5y' }

  useEffect(() => {
    let cancelled = false
    async function fetchChart() {
      setLoading(true)
      try {
        const sym = encodeURIComponent(item.symbol)
        const interval = range === '1W' ? '15m' : range === '1M' ? '1d' : '1wk'
        const r = rangeMap[range]
        const res = await fetch(`/api/prices/chart?symbol=${sym}&range=${r}&interval=${interval}`)
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        if (!cancelled) setChartData(data)
      } catch {
        if (!cancelled) setChartData(null)
      }
      if (!cancelled) setLoading(false)
    }
    if (item.symbol) fetchChart()
    return () => { cancelled = true }
  }, [item.symbol, range])

  const currentPrice = getItemPrice(item)
  const totalValue = (item.quantity || 0) * currentPrice
  const cost = (item.quantity || 0) * (item._originalPurchasePrice || item.purchasePrice || 0)
  const pnl = totalValue - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0

  const points = useMemo(() => {
    if (!chartData?.prices || chartData.prices.length < 2) return null
    const prices = chartData.prices
    const min = Math.min(...prices.map((p) => p.close)) * 0.98
    const max = Math.max(...prices.map((p) => p.close)) * 1.02
    const rng = max - min || 1
    const w = 600, h = 200
    const pad = { top: 16, right: 12, bottom: 24, left: 0 }
    const cw = w - pad.left - pad.right
    const ch = h - pad.top - pad.bottom

    return prices.map((p, i) => ({
      x: pad.left + (i / Math.max(prices.length - 1, 1)) * cw,
      y: pad.top + ch - ((p.close - min) / rng) * ch,
      close: p.close,
      date: p.date,
    }))
  }, [chartData])

  const isPositive = points ? points[points.length - 1].close >= points[0].close : pnl >= 0
  const lineColor = isPositive ? '#10b981' : '#ef4444'

  function smoothPath(pts) {
    if (!pts || pts.length < 2) return ''
    if (pts.length < 3) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
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

  const hp = hoverIdx != null && points ? points[hoverIdx] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <div>
            <h2 className="text-lg font-bold text-white">{item.name || item.symbol}</h2>
            <span className="text-xs text-slate-500">{item.symbol} · {item.type} {item.institution ? `· ${item.institution}` : ''}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
              <span className="text-[10px] text-slate-500 block">{t('Precio actual', 'Current price')}</span>
              <span className="text-lg font-bold text-white">{formatCurrency(currentPrice)}</span>
            </div>
            <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
              <span className="text-[10px] text-slate-500 block">{t('Valor total', 'Total value')}</span>
              <span className="text-lg font-bold text-white">{formatCurrency(totalValue)}</span>
            </div>
            <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
              <span className="text-[10px] text-slate-500 block">P&L</span>
              <span className={`text-lg font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
              </span>
              <span className={`text-[10px] block ${pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Position details */}
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>{t('Cantidad', 'Qty')}: <span className="text-white font-medium">{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
            <span>{t('Costo', 'Cost')}: <span className="text-white font-medium">{formatCurrency(item.purchasePrice)}</span></span>
            {item.change7d != null && (
              <span className={item.change7d >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                7d: {item.change7d >= 0 ? '+' : ''}{item.change7d.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Chart */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">{t('Historico de precio', 'Price history')}</span>
              <div className="flex gap-0.5 bg-[#0b1120] rounded-lg p-0.5">
                {ranges.map((r) => (
                  <button key={r} onClick={() => setRange(r)}
                    className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                      range === r ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="h-[200px] bg-[#0b1120] rounded-lg animate-pulse flex items-center justify-center">
                <span className="text-slate-600 text-sm">{t('Cargando...', 'Loading...')}</span>
              </div>
            ) : points ? (
              <div className="relative">
                <svg viewBox="0 0 600 200" className="w-full" preserveAspectRatio="xMidYMid meet"
                  onMouseLeave={() => setHoverIdx(null)}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const mx = ((e.clientX - rect.left) / rect.width) * 600
                    let closest = 0, minD = Infinity
                    points.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < minD) { minD = d; closest = i } })
                    setHoverIdx(closest)
                  }}>
                  <defs>
                    <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
                      <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={`${smoothPath(points)} L ${points[points.length-1].x} 192 L ${points[0].x} 192 Z`}
                    fill="url(#assetGrad)" />
                  <path d={smoothPath(points)} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" />
                  {hp && (
                    <g>
                      <line x1={hp.x} y1={16} x2={hp.x} y2={192} stroke="#334155" strokeDasharray="4 3" />
                      <circle cx={hp.x} cy={hp.y} r="4" fill={lineColor} stroke="#0b1120" strokeWidth="2" />
                    </g>
                  )}
                </svg>
                {hp && (
                  <div className="absolute pointer-events-none bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 shadow-xl"
                    style={{ left: `${(hp.x / 600) * 100}%`, top: `${(hp.y / 200) * 100 - 15}%`, transform: 'translate(-50%, -100%)' }}>
                    <div className="font-bold">{formatCurrency(hp.close)}</div>
                    <div className="text-slate-400">{formatDate(hp.date)}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[200px] bg-[#0b1120] rounded-lg flex items-center justify-center">
                <span className="text-slate-600 text-sm">{t('Sin datos de precio disponibles', 'No price data available')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
