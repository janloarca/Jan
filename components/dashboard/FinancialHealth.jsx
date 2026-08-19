'use client'

import { useMemo } from 'react'
import { getTypeCategory, getItemValue } from './utils'
import { HEALTH } from '@/lib/colors'

export default function FinancialHealth({ items, netWorth, totalAssets, snapshots, lang }) {
  const scores = useMemo(() => {
    const debtItems = items.filter((it) => it.isDebt || getTypeCategory(it) === 'debts')
    const totalDebt = debtItems.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0
    const debtScore = debtRatio === 0 ? 25 : debtRatio < 10 ? 22 : debtRatio < 30 ? 18 : debtRatio < 50 ? 12 : 5

    const liquidItems = items.filter((it) => {
      const cat = getTypeCategory(it)
      return cat === 'banks' || cat === 'funds' || /cash|saving|liquid|money.?market|efectivo|checking/i.test(it.type || '')
    })
    const liquidValue = liquidItems.reduce((s, it) => s + getItemValue(it), 0)
    const liquidPct = totalAssets > 0 ? (liquidValue / totalAssets) * 100 : 0
    const liquidScore = liquidPct > 20 ? 25 : liquidPct > 10 ? 20 : liquidPct > 5 ? 15 : liquidPct > 0 ? 10 : 5

    const typeCounts = {}
    items.forEach((it) => {
      const cat = getTypeCategory(it)
      typeCounts[cat] = (typeCounts[cat] || 0) + 1
    })
    const numTypes = Object.keys(typeCounts).length
    const diversePct = Math.min(100, (numTypes / 5) * 100)
    const diverseScore = numTypes >= 5 ? 25 : numTypes >= 4 ? 22 : numTypes >= 3 ? 18 : numTypes >= 2 ? 14 : 8

    let growthPct = 0
    const snaps = snapshots || []
    if (snaps.length >= 2) {
      const first = snaps[0].netWorthUSD ?? snaps[0].totalActivosUSD ?? 0
      const last = snaps[snaps.length - 1].netWorthUSD ?? snaps[snaps.length - 1].totalActivosUSD ?? 0
      if (first > 0) growthPct = ((last - first) / first) * 100
    }
    const growthScore = growthPct > 50 ? 25 : growthPct > 20 ? 22 : growthPct > 10 ? 18 : growthPct > 0 ? 14 : growthPct === 0 ? 10 : 5

    const total = debtScore + liquidScore + diverseScore + growthScore

    return {
      debtScore, debtRatio, totalDebt,
      liquidScore, liquidPct,
      diverseScore, diversePct, numTypes,
      growthScore, growthPct,
      total,
    }
  }, [items, totalAssets, snapshots])

  const grade = scores.total >= 90 ? 'A+' : scores.total >= 80 ? 'A' : scores.total >= 70 ? 'B+' : scores.total >= 60 ? 'B' : scores.total >= 50 ? 'C' : scores.total >= 40 ? 'D' : 'F'
  const gradeColor = scores.total >= 70 ? 'var(--accent-green)' : scores.total >= 50 ? 'var(--accent-orange)' : 'var(--text-negative)'

  // Bar fill color reflects the score, not the metric: strong = green,
  // mid = amber, weak = red (spec: 20–25 green, 10–19 amber, 0–9 red).
  const barColor = (score, max) => {
    const r = max ? score / max : 0
    return r >= 0.8 ? 'var(--accent-green)' : r >= 0.4 ? 'var(--accent-orange)' : 'var(--text-negative)'
  }

  const bars = [
    { label: lang === 'es' ? 'Deuda' : 'Debt', score: scores.debtScore, max: 25 },
    { label: lang === 'es' ? 'Liquidez' : 'Liquidity', score: scores.liquidScore, max: 25 },
    { label: lang === 'es' ? 'Diversificación' : 'Diversification', score: scores.diverseScore, max: 25 },
    { label: lang === 'es' ? 'Crecimiento' : 'Growth', score: scores.growthScore, max: 25 },
  ]

  const t = (es, en) => lang === 'es' ? es : en

  const suggestions = useMemo(() => {
    const tips = []
    if (scores.numTypes < 5) {
      const needed = 5 - scores.numTypes
      const currentScore = scores.diverseScore
      const targetScore = scores.numTypes + needed >= 5 ? 25 : scores.numTypes + needed >= 4 ? 22 : 18
      const delta = targetScore - currentScore
      if (delta > 0) {
        tips.push({
          textEs: `Agrega ${needed} tipo(s) de activo más`,
          textEn: `Add ${needed} more asset type(s)`,
          points: delta,
        })
      }
    }
    if (scores.liquidPct < 10) {
      const targetScore = scores.liquidPct >= 5 ? 20 : 15
      const delta = targetScore - scores.liquidScore
      if (delta > 0) {
        tips.push({
          textEs: 'Aumenta reservas líquidas al 10%',
          textEn: 'Increase liquid reserves to 10%',
          points: delta,
        })
      }
    }
    if (scores.debtRatio > 30) {
      const targetScore = scores.debtRatio > 50 ? 12 : 18
      const delta = targetScore - scores.debtScore
      if (delta > 0) {
        tips.push({
          textEs: 'Reduce deuda por debajo del 30%',
          textEn: 'Reduce debt below 30%',
          points: delta,
        })
      }
    }
    if (scores.growthPct < 10 && scores.growthPct >= 0) {
      const delta = 18 - scores.growthScore
      if (delta > 0) {
        tips.push({
          textEs: 'Crece tu portafolio +10% para más puntos',
          textEn: 'Grow portfolio 10%+ for more points',
          points: delta,
        })
      }
    }
    return tips.sort((a, b) => b.points - a.points).slice(0, 3)
  }, [scores])

  // No card chrome of its own: this renders inside the Analysis card (see
  // AnalysisTabs in app/dashboard/page.jsx), and a card within a card would
  // double the border and the padding.
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {lang === 'es' ? 'SALUD FINANCIERA' : 'FINANCIAL HEALTH'}
        </h3>
        <div className="flex items-center gap-2.5">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-full h-full">
              <circle cx="18" cy="18" r="16" fill="none" stroke="var(--bg-tertiary)" strokeWidth="3" />
              <circle cx="18" cy="18" r="16" fill="none" stroke={gradeColor} strokeWidth="3"
                strokeDasharray={`${(Math.max(0, Math.min(100, scores.total)) / 100) * 100.5} 100.5`}
                strokeLinecap="round" transform="rotate(-90 18 18)" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-h1" style={{ color: gradeColor }}>{grade}</span>
            </div>
          </div>
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>{scores.total}/100</span>
        </div>
      </div>
      <div className="space-y-3">
        {bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-28 shrink-0">{bar.label}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(bar.score / bar.max) * 100}%`, backgroundColor: barColor(bar.score, bar.max) }} />
            </div>
            <span className="text-xs w-10 text-right font-medium tabular-nums" style={{ color: barColor(bar.score, bar.max) }}>{bar.score}/{bar.max}</span>
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 mb-2 block">{t('Cómo mejorar', 'How to improve')}</span>
          <div className="space-y-1.5">
            {suggestions.map((tip, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-slate-300">{lang === 'es' ? tip.textEs : tip.textEn}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: 'var(--alert-success-icon)', backgroundColor: 'var(--alert-success-bg)' }}>
                  +{tip.points} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
