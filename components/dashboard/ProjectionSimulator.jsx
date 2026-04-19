'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatCompact } from './utils'

export default function ProjectionSimulator({ netWorth, lang }) {
  const [monthly, setMonthly] = useState(500)
  const [years, setYears] = useState(10)
  const [rate, setRate] = useState(8)
  const [expanded, setExpanded] = useState(false)

  const t = (es, en) => lang === 'es' ? es : en

  const projection = useMemo(() => {
    const r = rate / 100 / 12
    const n = years * 12
    const start = netWorth || 0

    const points = []
    let balance = start
    let totalContributed = start

    for (let m = 0; m <= n; m++) {
      if (m > 0) {
        balance = balance * (1 + r) + monthly
        totalContributed += monthly
      }
      if (m % 12 === 0 || m === n) {
        points.push({
          year: m / 12,
          balance,
          contributed: totalContributed,
          gains: balance - totalContributed,
        })
      }
    }

    const finalBalance = points[points.length - 1].balance
    const totalInvested = start + monthly * n
    const totalGains = finalBalance - totalInvested

    return { points, finalBalance, totalInvested, totalGains }
  }, [netWorth, monthly, years, rate])

  const { points, finalBalance, totalInvested, totalGains } = projection

  const maxVal = Math.max(...points.map((p) => p.balance))
  const height = 180
  const width = 560
  const pad = { top: 16, right: 12, bottom: 28, left: 0 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  const balancePts = points.map((p, i) => ({
    x: pad.left + (i / Math.max(points.length - 1, 1)) * cw,
    y: pad.top + ch - (p.balance / maxVal) * ch,
  }))
  const contribPts = points.map((p, i) => ({
    x: pad.left + (i / Math.max(points.length - 1, 1)) * cw,
    y: pad.top + ch - (p.contributed / maxVal) * ch,
  }))

  function linePath(pts) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  }

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          {t('SIMULADOR DE PROYECCION', 'PROJECTION SIMULATOR')}
        </h3>
        <button onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors">
          {expanded ? t('Cerrar', 'Close') : t('Ajustar', 'Adjust')}
        </button>
      </div>

      {expanded && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">{t('Inversion mensual', 'Monthly investment')}</label>
            <input value={monthly} onChange={(e) => setMonthly(parseFloat(e.target.value) || 0)}
              type="number" step="100"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">{t('Anos', 'Years')}</label>
            <input value={years} onChange={(e) => setYears(parseInt(e.target.value) || 1)}
              type="number" min="1" max="50"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">{t('Retorno anual %', 'Annual return %')}</label>
            <input value={rate} onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
              type="number" step="0.5" min="0" max="30"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
        </div>
      )}

      {/* Result cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50 text-center">
          <span className="text-[9px] text-slate-500 block">{t('Valor futuro', 'Future value')}</span>
          <span className="text-base font-bold text-emerald-400">{formatCompact(finalBalance)}</span>
        </div>
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50 text-center">
          <span className="text-[9px] text-slate-500 block">{t('Invertido', 'Invested')}</span>
          <span className="text-base font-bold text-white">{formatCompact(totalInvested)}</span>
        </div>
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50 text-center">
          <span className="text-[9px] text-slate-500 block">{t('Ganancias', 'Gains')}</span>
          <span className="text-base font-bold text-cyan-400">{formatCompact(totalGains)}</span>
        </div>
      </div>

      {/* Chart */}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="contribGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Area fills */}
        <path d={`${linePath(balancePts)} L ${balancePts[balancePts.length-1].x} ${pad.top + ch} L ${balancePts[0].x} ${pad.top + ch} Z`}
          fill="url(#projGrad)" />
        <path d={`${linePath(contribPts)} L ${contribPts[contribPts.length-1].x} ${pad.top + ch} L ${contribPts[0].x} ${pad.top + ch} Z`}
          fill="url(#contribGrad)" />
        {/* Lines */}
        <path d={linePath(balancePts)} fill="none" stroke="#10b981" strokeWidth="2" />
        <path d={linePath(contribPts)} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3" />
        {/* X labels */}
        {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map((p, i) => {
          const idx = points.indexOf(p)
          return (
            <text key={i} x={balancePts[idx].x} y={height - 6} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="system-ui">
              {t(`Año ${p.year}`, `Yr ${p.year}`)}
            </text>
          )
        })}
        {/* End label */}
        <text x={balancePts[balancePts.length-1].x - 4} y={balancePts[balancePts.length-1].y - 8}
          textAnchor="end" fill="#10b981" fontSize="10" fontWeight="bold">
          {formatCompact(finalBalance)}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {t('Valor proyectado', 'Projected value')}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> {t('Capital invertido', 'Invested capital')}</span>
        <span>{formatCurrency(monthly)}/{t('mes', 'mo')} · {rate}% · {years}{t(' años', 'y')}</span>
      </div>
    </div>
  )
}
