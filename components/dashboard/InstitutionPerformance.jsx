'use client'

import { useMemo } from 'react'
import { formatCurrency, formatCompact, getItemValue, getDividendIncomeByItem, getItemCostBasis, getItemPrincipalCost } from './utils'
import { InfoTip } from '../ui/Tooltip'

// Institution comparison card.
// The portfolio NAV over time already lives in PortfolioGrowthChart (top of the
// dashboard, with its own institution pills). This card answers the question that
// chart does NOT show at a glance: how each institution compares right now —
// value, share of the portfolio, and gain/loss. No duplicate NAV chart, no fetch.
export default function InstitutionPerformance({ items, lang, baseCurrency, transactions, convert, ibkrDataComplete }) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const institutions = useMemo(() => {
    if (!items || items.length === 0) return []
    // A bond/bank account that pays cash to a different account (rather than
    // reinvesting) never moves its own currentPrice — without this, it always
    // shows a flat 0% gain regardless of how much it actually paid out.
    const dividendIncome = getDividendIncomeByItem(transactions, items, convert, baseCurrency)
    const map = {}
    items.forEach((it) => {
      const rawName = it.institution || t('Sin institución', 'No institution')
      // Normalized key: "IDC VALORES" and "IDC Valores" are one custodian, not two rows.
      const key = rawName.trim().replace(/\s+/g, ' ').toLowerCase()
      if (!map[key]) map[key] = { name: rawName.trim(), count: 0, value: 0, cost: 0, principal: 0, income: 0, hasIbkr: false }
      map[key].count += 1
      map[key].value += getItemValue(it)
      if (it._source === 'ibkr') map[key].hasIbkr = true
      // Gain measures against principal; the % divides by all-in cost (with
      // fees) — see getItemPrincipalCost for why the two differ.
      map[key].principal += getItemPrincipalCost(it)
      map[key].cost += getItemCostBasis(it)
      map[key].income += dividendIncome.get(it.id) || 0
    })
    return Object.values(map)
      .map((inst) => {
        const gainLoss = inst.value - inst.principal + inst.income
        const gainPct = inst.cost > 0 ? (gainLoss / inst.cost) * 100 : null
        return { ...inst, gainLoss, gainPct }
      })
      .sort((a, b) => b.value - a.value)
  }, [items, lang, transactions, convert, baseCurrency])

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
        <InfoTip text={t(
          'El % es el retorno de ESA institución: ganancia ÷ lo que invertiste ahí (incluye costos de entrada). Misma fórmula que "Asignación de Activos", pero agrupada por institución: si una institución tiene activos de varios tipos, sus % no tienen por qué ser idénticos.',
          'The % is that institution\'s own return: gain ÷ what you invested there (includes entry costs). Same formula as "Asset Allocation", just grouped by institution: if one institution holds several asset types, the two % need not be identical.'
        )} />
      </h3>

      {institutions.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-slate-500 text-sm">
          {t('Sin instituciones para comparar.', 'No institutions to compare.')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Compact 2-line rows: 7 institutions in 3-line rows made this card far
              taller than its grid sibling and left a large blank column. */}
          {institutions.map((inst) => {
            const pctOfTotal = allTotal > 0 ? (inst.value / allTotal) * 100 : 0
            const isGain = inst.gainLoss >= 0
            const gainColor = inst.gainPct == null ? 'var(--text-muted)' : (isGain ? 'var(--accent-green)' : 'var(--text-negative)')
            return (
              <div key={inst.name}>
                {/* Line 1: name · count — % of total · value */}
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{inst.name}</span>
                    <span className="text-xs text-slate-500 shrink-0">{inst.count} {t('pos.', 'pos.')}</span>
                    {/* Same gate as the checklist and the inferred-flows
                        feature (hasCompleteBrokerData) — one signal, shown
                        wherever the user is looking at this institution's
                        numbers, dashboard or spreadsheet alike. */}
                    {inst.hasIbkr && ibkrDataComplete != null && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={ibkrDataComplete
                          ? { color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)' }
                          : { color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)' }}
                        title={ibkrDataComplete
                          ? t('Historial y retornos completos: los 4 pasos de conexión están hechos.', 'History and returns complete: all 4 connection steps are done.')
                          : t('Historial incompleto: faltan pasos en "Nuevo → Completar información".', 'History incomplete: steps missing in "New → Complete your data".')}>
                        {ibkrDataComplete ? t('100% historial', '100% history') : t('historial parcial', 'partial history')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2.5 shrink-0">
                    <span className="text-xs text-slate-500 font-mono tabular-nums">{pctOfTotal.toFixed(1)}%</span>
                    <span className="text-sm font-bold text-white font-mono tabular-nums">
                      {formatCurrency(inst.value, baseCurrency)}
                    </span>
                  </div>
                </div>

                {/* Line 2: bar (% of total) + gain% at the right */}
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-input)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(pctOfTotal, 2)}%`, backgroundColor: 'var(--accent-blue)' }}
                    />
                  </div>
                  <span className="text-xs font-medium font-mono tabular-nums w-16 text-right" style={{ color: gainColor }}>
                    {inst.gainPct == null ? '-' : `${isGain ? '+' : ''}${inst.gainPct.toFixed(2)}%`}
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
