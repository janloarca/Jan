'use client'

import { useMemo } from 'react'
import { formatCurrency, formatCompact, getItemValue } from './utils'

// Institution comparison card.
// The portfolio NAV over time already lives in PortfolioGrowthChart (top of the
// dashboard, with its own institution pills). This card answers the question that
// chart does NOT show at a glance: how each institution compares right now —
// value, share of the portfolio, and gain/loss. No duplicate NAV chart, no fetch.
export default function InstitutionPerformance({ items, lang, baseCurrency }) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const institutions = useMemo(() => {
    if (!items || items.length === 0) return []
    const map = {}
    items.forEach((it) => {
      const rawName = it.institution || t('Sin institución', 'No institution')
      // Normalized key: "IDC VALORES" and "IDC Valores" are one custodian, not two rows.
      const key = rawName.trim().replace(/\s+/g, ' ').toLowerCase()
      if (!map[key]) map[key] = { name: rawName.trim(), count: 0, value: 0, cost: 0 }
      map[key].count += 1
      map[key].value += getItemValue(it)
      const qty = Number(it.quantity) || 0
      map[key].cost += qty * (it.purchasePrice || 0)
    })
    return Object.values(map)
      .map((inst) => {
        const gainLoss = inst.value - inst.cost
        const gainPct = inst.cost > 0 ? (gainLoss / inst.cost) * 100 : 0
        return { ...inst, gainLoss, gainPct }
      })
      .sort((a, b) => b.value - a.value)
  }, [items, lang])

  const allTotal = useMemo(
    () => institutions.reduce((s, inst) => s + inst.value, 0),
    [institutions]
  )


  return (
    <div className="bg-theme-surface rounded-2xl border border-glass-border p-4 card-primary">
      {/* Header */}
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue)' }} />
        {t('RENDIMIENTO POR INSTITUCIÓN', 'INSTITUTION PERFORMANCE')}
      </h3>

      {institutions.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-slate-500 text-sm">
          {t('Sin instituciones para comparar.', 'No institutions to compare.')}
        </div>
      ) : (
        <div className="space-y-3">
          {institutions.map((inst) => {
            const pctOfTotal = allTotal > 0 ? (inst.value / allTotal) * 100 : 0
            const isGain = inst.gainLoss >= 0
            const gainColor = isGain ? 'var(--accent-green)' : 'var(--text-negative)'
            return (
              <div key={inst.name}>
                {/* Top row: name + count · value */}
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{inst.name}</span>
                    <span className="text-xs text-slate-500 shrink-0">
                      {inst.count} {t('pos.', 'pos.')}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-white font-mono tabular-nums shrink-0">
                    {formatCurrency(inst.value, baseCurrency)}
                  </span>
                </div>

                {/* Bar = share of the portfolio total, matching the "% del total" label below */}
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-input)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pctOfTotal, 2)}%`,
                      backgroundColor: 'var(--accent-blue)',
                    }}
                  />
                </div>

                {/* Bottom row: % of total + gain% */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {pctOfTotal.toFixed(1)}% {t('del total', 'of total')}
                  </span>
                  <span className="text-xs font-medium font-mono tabular-nums" style={{ color: gainColor }}>
                    {isGain ? '+' : ''}
                    {inst.gainPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            )
          })}

          {/* Total footer */}
          <div
            className="flex items-baseline justify-between pt-3 mt-1 border-t"
            style={{ borderColor: 'var(--card-border)' }}
          >
            <span className="text-xs uppercase tracking-wider text-slate-500">
              {t('Total', 'Total')} · {institutions.length} {t('inst.', 'inst.')}
            </span>
            <span className="text-sm font-bold text-white font-mono tabular-nums">
              {formatCurrency(allTotal, baseCurrency)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
