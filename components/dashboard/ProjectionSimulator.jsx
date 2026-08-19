'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatCompact } from './utils'
import { runMonteCarloSimulation } from './analytics'

export default function ProjectionSimulator({ netWorth, lang, volatility, goalValue }) {
  const [monthly, setMonthly] = useState(500)
  const [years, setYears] = useState(10)
  const [rate, setRate] = useState(8)
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState('deterministic')

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

  const mcResult = useMemo(() => {
    if (mode !== 'montecarlo') return null
    const vol = volatility ? volatility / 100 : 0.15
    return runMonteCarloSimulation({
      startValue: netWorth || 0,
      monthlyContribution: monthly,
      years,
      expectedReturn: rate / 100,
      volatility: vol,
      numSimulations: 1000,
      goalValue: goalValue || 0,
    })
  }, [mode, netWorth, monthly, years, rate, volatility, goalValue])

  const { points, finalBalance, totalInvested, totalGains } = projection

  const height = 200
  const width = 560
  const pad = { top: 16, right: 12, bottom: 28, left: 0 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  const mcPoints = useMemo(() => {
    if (!mcResult) return null
    const yearlyIndices = []
    const totalMonths = years * 12
    for (let m = 0; m <= totalMonths; m++) {
      if (m % 12 === 0 || m === totalMonths) yearlyIndices.push(m)
    }

    const maxVal = Math.max(
      ...yearlyIndices.map((m) => mcResult.percentiles.p90[m] || 0),
      ...points.map((p) => p.balance),
      1
    )

    function toXY(arr) {
      return yearlyIndices.map((m, i) => ({
        x: pad.left + (i / Math.max(yearlyIndices.length - 1, 1)) * cw,
        y: pad.top + ch - ((arr[m] || 0) / maxVal) * ch,
      }))
    }

    return {
      p10: toXY(mcResult.percentiles.p10),
      p25: toXY(mcResult.percentiles.p25),
      p50: toXY(mcResult.percentiles.p50),
      p75: toXY(mcResult.percentiles.p75),
      p90: toXY(mcResult.percentiles.p90),
      maxVal,
      yearlyIndices,
    }
  }, [mcResult, years, points, cw, ch])

  const maxVal = mode === 'montecarlo' && mcPoints ? mcPoints.maxVal : Math.max(...points.map((p) => p.balance), 1)

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

  function bandPath(upper, lower) {
    const fwd = upper.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const bwd = [...lower].reverse().map((p, i) => `${i === 0 ? 'L' : 'L'} ${p.x} ${p.y}`).join(' ')
    return `${fwd} ${bwd} Z`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)' }} />
          {t('SIMULADOR DE PROYECCIÓN', 'PROJECTION SIMULATOR')}
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-theme-base rounded-lg border border-glass-border/50 overflow-hidden">
            <button onClick={() => setMode('deterministic')}
              className="px-2 py-1 text-xs font-medium transition-colors"
              style={mode === 'deterministic' ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', color: 'var(--accent-blue)' } : { color: 'var(--text-muted)' }}>
              {t('Lineal', 'Linear')}
            </button>
            <button onClick={() => setMode('montecarlo')}
              className="px-2 py-1 text-xs font-medium transition-colors"
              style={mode === 'montecarlo' ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', color: 'var(--accent-blue)' } : { color: 'var(--text-muted)' }}>
              Monte Carlo
            </button>
          </div>
          <button onClick={() => setExpanded(!expanded)}
            className="text-xs transition-colors" style={{ color: 'var(--accent-green)' }}>
            {expanded ? t('Cerrar', 'Close') : t('Ajustar', 'Adjust')}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('Inversión mensual', 'Monthly investment')}</label>
            <input value={monthly} onChange={(e) => setMonthly(parseFloat(e.target.value) || 0)}
              type="number" step="100"
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('Años', 'Years')}</label>
            <input value={years} onChange={(e) => setYears(parseInt(e.target.value) || 1)}
              type="number" min="1" max="50"
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('Retorno anual %', 'Annual return %')}</label>
            <input value={rate} onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
              type="number" step="0.5" min="0" max="30"
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
        </div>
      )}

      {/* Result cards */}
      {mode === 'montecarlo' && mcResult ? (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Mediana (p50)', 'Median (p50)')}</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent-green)' }}>{formatCompact(mcResult.medianFinal)}</span>
          </div>
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('90% prob ≥', '90% prob ≥')}</span>
            <span className="text-base font-bold text-amber-400">{formatCompact(mcResult.p10Final)}</span>
          </div>
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('10% prob ≥', '10% prob ≥')}</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent-cyan)' }}>{formatCompact(mcResult.p90Final)}</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Valor futuro', 'Future value')}</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent-green)' }}>{formatCompact(finalBalance)}</span>
          </div>
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Invertido', 'Invested')}</span>
            <span className="text-base font-bold text-white">{formatCompact(totalInvested)}</span>
          </div>
          <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Ganancias', 'Gains')}</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent-cyan)' }}>{formatCompact(totalGains)}</span>
          </div>
        </div>
      )}

      {/* Chart */}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-green)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--accent-green)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="contribGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Monte Carlo bands */}
        {mode === 'montecarlo' && mcPoints && (
          <>
            <path d={bandPath(mcPoints.p90, mcPoints.p10)} fill="color-mix(in srgb, var(--accent-purple) 6%, transparent)" />
            <path d={bandPath(mcPoints.p75, mcPoints.p25)} fill="color-mix(in srgb, var(--accent-purple) 10%, transparent)" />
            <path d={linePath(mcPoints.p50)} fill="none" stroke="var(--accent-purple)" strokeWidth="2" />
            <path d={linePath(mcPoints.p90)} fill="none" stroke="var(--accent-purple)" strokeWidth="0.5" strokeOpacity="0.4" />
            <path d={linePath(mcPoints.p10)} fill="none" stroke="var(--accent-purple)" strokeWidth="0.5" strokeOpacity="0.4" />
          </>
        )}

        {/* Deterministic lines */}
        {mode === 'deterministic' && (
          <>
            <path d={`${linePath(balancePts)} L ${balancePts[balancePts.length-1].x} ${pad.top + ch} L ${balancePts[0].x} ${pad.top + ch} Z`}
              fill="url(#projGrad)" />
            <path d={`${linePath(contribPts)} L ${contribPts[contribPts.length-1].x} ${pad.top + ch} L ${contribPts[0].x} ${pad.top + ch} Z`}
              fill="url(#contribGrad)" />
            <path d={linePath(balancePts)} fill="none" stroke="var(--accent-green)" strokeWidth="2" />
          </>
        )}

        {/* Invested capital line (both modes) */}
        <path d={linePath(contribPts)} fill="none" stroke="var(--accent-blue)" strokeWidth="1.5" strokeDasharray="4 3" />

        {/* Deterministic dashed line in MC mode for reference */}
        {mode === 'montecarlo' && (
          <path d={linePath(balancePts)} fill="none" stroke="var(--accent-green)" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />
        )}

        {/* X labels */}
        {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map((p, i) => {
          const idx = points.indexOf(p)
          return (
            <text key={i} x={balancePts[idx].x} y={height - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="system-ui">
              {t(`Año ${p.year}`, `Yr ${p.year}`)}
            </text>
          )
        })}

        {/* End label */}
        {mode === 'montecarlo' && mcPoints ? (
          <text x={mcPoints.p50[mcPoints.p50.length-1].x - 4} y={mcPoints.p50[mcPoints.p50.length-1].y - 8}
            textAnchor="end" fill="var(--accent-purple)" fontSize="10" fontWeight="bold">
            {formatCompact(mcResult?.medianFinal || 0)}
          </text>
        ) : (
          <text x={balancePts[balancePts.length-1].x - 4} y={balancePts[balancePts.length-1].y - 8}
            textAnchor="end" fill="var(--accent-green)" fontSize="10" fontWeight="bold">
            {formatCompact(finalBalance)}
          </text>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
        {mode === 'montecarlo' ? (
          <>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-purple)' }} /> p50 ({t('mediana', 'median')})</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-purple) 20%, transparent)' }} /> p10-p90</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 50%, transparent)' }} /> {t('Determinista', 'Deterministic')}</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-green)' }} /> {t('Valor proyectado', 'Projected value')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue)' }} /> {t('Capital invertido', 'Invested capital')}</span>
          </>
        )}
        <span>{formatCurrency(monthly)}/{t('mes', 'mo')} · {rate}% · {years}{t(' años', 'y')}</span>
      </div>

      {/* Goal probability in MC mode */}
      {mode === 'montecarlo' && mcResult?.goalProbability != null && goalValue > 0 && (
        <div className="mt-3 px-3 py-2 bg-theme-base rounded-lg border border-glass-border/50 flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: mcResult.goalProbability >= 70 ? 'var(--accent-green)' : mcResult.goalProbability >= 40 ? 'var(--accent-orange)' : 'var(--text-negative)' }}>
            {mcResult.goalProbability}%
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t(`probabilidad de alcanzar ${formatCompact(goalValue)}`, `probability of reaching ${formatCompact(goalValue)}`)}
          </span>
        </div>
      )}
    </div>
  )
}
