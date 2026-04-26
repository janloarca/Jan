'use client'

import { useMemo } from 'react'
import { formatCurrency, getItemValue } from './utils'

const CURRENCY_FLAGS = {
  USD: '$', EUR: '€', GBP: '£', MXN: '$', GTQ: 'Q', COP: '$',
  CLP: '$', ARS: '$', BRL: 'R$', PEN: 'S/', CAD: 'C$', CHF: 'Fr',
  JPY: '¥', CNY: '¥',
}

const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ec4899', '#06b6d4', '#ef4444', '#84cc16']

export default function CurrencyImpact({ items, convert, baseCurrency, rates, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const exposure = useMemo(() => {
    if (!items || items.length === 0) return null
    const groups = {}
    let total = 0

    items.forEach((it) => {
      const cur = it._originalCurrency || it.currency || 'USD'
      const val = getItemValue(it)
      if (!groups[cur]) groups[cur] = { currency: cur, value: 0, count: 0, items: [] }
      groups[cur].value += val
      groups[cur].count++
      groups[cur].items.push({ symbol: it.symbol || it.name, value: val })
      total += val
    })

    const sorted = Object.values(groups)
      .map((g) => ({
        ...g,
        pct: total > 0 ? (g.value / total) * 100 : 0,
        items: g.items.sort((a, b) => b.value - a.value).slice(0, 3),
      }))
      .sort((a, b) => b.value - a.value)

    const basePct = sorted.find((g) => g.currency === baseCurrency)?.pct || 0
    const foreignPct = 100 - basePct
    const foreignValue = total * (foreignPct / 100)

    return { groups: sorted, total, foreignPct, foreignValue }
  }, [items, baseCurrency])

  const sensitivity = useMemo(() => {
    if (!exposure || exposure.foreignPct <= 0) return []
    const scenarios = [-10, -5, 5, 10]
    return scenarios.map((pct) => {
      const impact = exposure.foreignValue * (pct / 100)
      const impactPct = exposure.total > 0 ? (impact / exposure.total) * 100 : 0
      return { pct, impact, impactPct }
    })
  }, [exposure])

  const foreignGroups = useMemo(() => {
    if (!exposure) return []
    return exposure.groups.filter((g) => g.currency !== baseCurrency)
  }, [exposure, baseCurrency])

  if (!exposure || exposure.foreignPct <= 0) return null
  if (!rates) return null

  const baseRate = rates[baseCurrency] || 1

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        {t('IMPACTO CAMBIARIO', 'CURRENCY IMPACT')}
      </h3>

      {/* Foreign exposure headline */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400">{t('Exposición extranjera', 'Foreign exposure')}</span>
        <span className="text-sm font-bold text-blue-400">{exposure.foreignPct.toFixed(1)}%</span>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-2">
        {exposure.groups.map((g, i) => (
          <div
            key={g.currency}
            className="h-full first:rounded-l-full last:rounded-r-full transition-all"
            style={{
              width: `${Math.max(g.pct, 1)}%`,
              backgroundColor: g.currency === baseCurrency ? '#334155' : PALETTE[i % PALETTE.length],
            }}
          />
        ))}
      </div>

      {/* Currency legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4">
        {exposure.groups.map((g, i) => (
          <span key={g.currency} className="flex items-center gap-1 text-[10px] text-slate-400">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: g.currency === baseCurrency ? '#334155' : PALETTE[i % PALETTE.length] }}
            />
            {g.currency} {g.pct.toFixed(0)}%
          </span>
        ))}
      </div>

      {/* Sensitivity analysis */}
      <div className="mb-4">
        <span className="text-[10px] text-slate-500 mb-2 block">
          {t('Sensibilidad cambiaria', 'Currency sensitivity')}
        </span>
        <div className="grid grid-cols-2 gap-2">
          {sensitivity.map((s) => {
            const isNeg = s.impact < 0
            return (
              <div key={s.pct} className="bg-[#0b1120] rounded-lg px-3 py-2 border border-[#1e2d45]/50">
                <span className="text-[9px] text-slate-500 block">
                  {s.pct > 0
                    ? t(`${baseCurrency} se debilita ${s.pct}%`, `${baseCurrency} weakens ${s.pct}%`)
                    : t(`${baseCurrency} se fortalece ${Math.abs(s.pct)}%`, `${baseCurrency} strengthens ${Math.abs(s.pct)}%`)}
                </span>
                <span className={`text-sm font-bold ${isNeg ? 'text-red-400' : 'text-emerald-400'}`}>
                  {isNeg ? '' : '+'}{formatCurrency(s.impact)}
                </span>
                <span className={`text-[9px] ml-1 ${isNeg ? 'text-red-500/70' : 'text-emerald-500/70'}`}>
                  ({isNeg ? '' : '+'}{s.impactPct.toFixed(2)}%)
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-currency detail */}
      {foreignGroups.length > 0 && (
        <div>
          <span className="text-[10px] text-slate-500 mb-2 block">
            {t('Detalle por moneda', 'By currency')}
          </span>
          <div className="space-y-2">
            {foreignGroups.map((g, i) => {
              const rate = rates[g.currency] ? (baseRate / rates[g.currency]) : null
              return (
                <div key={g.currency} className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                      />
                      <span className="text-xs font-bold text-white">{g.currency}</span>
                      <span className="text-[9px] text-slate-500">
                        {CURRENCY_FLAGS[g.currency] || ''} {g.count} {t('activo(s)', 'holding(s)')}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium text-slate-300">{formatCurrency(g.value)}</span>
                      <span className="text-[9px] text-slate-500 ml-1">({g.pct.toFixed(1)}%)</span>
                    </div>
                  </div>
                  {rate != null && (
                    <div className="text-[9px] text-slate-500 mb-1.5">
                      1 {g.currency} = {rate.toFixed(4)} {baseCurrency}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((item) => (
                      <span key={item.symbol} className="text-[9px] text-slate-400 bg-[#131c2e] px-1.5 py-0.5 rounded">
                        {item.symbol}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
