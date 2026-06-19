'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, CHART_PALETTE, getItemValue, getSectorFromItem, getGeographyFromItem, getInvestmentClass, INVESTMENT_CLASS_META } from './utils'

export default function AssetAllocation({ items, lang }) {
  const [view, setView] = useState('type')

  const allocation = useMemo(() => {
    const groupFns = {
      type: (it) => getTypeCategory(it),
      returnType: (it) => getInvestmentClass(it),
      sector: (it) => getSectorFromItem(it),
      geography: (it) => getGeographyFromItem(it),
      currency: (it) => it._originalCurrency || it.currency || 'USD',
      institution: (it) => it.institution || (lang === 'es' ? 'Sin institución' : 'No institution'),
    }

    const fn = groupFns[view] || groupFns.type
    const byGroup = {}
    const gainByGroup = {}
    let total = 0
    items.forEach((it) => {
      if (it.isDebt) return
      const val = getItemValue(it)
      if (val <= 0) return
      const key = fn(it)
      const qty = it.quantity || 0
      const cost = qty * (it.purchasePrice || 0)
      byGroup[key] = (byGroup[key] || 0) + val
      gainByGroup[key] = (gainByGroup[key] || 0) + (val - cost)
      total += val
    })
    return Object.entries(byGroup)
      .filter(([, value]) => Math.abs(value) > 0.01)
      .map(([name, value], i) => ({
        name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        contribution: total > 0 ? ((gainByGroup[name] || 0) / total) * 100 : 0,
        color: view === 'type' ? (TYPE_COLORS[name]?.bg || CHART_PALETTE[i % CHART_PALETTE.length])
             : view === 'returnType' ? (INVESTMENT_CLASS_META[name]?.color || CHART_PALETTE[i % CHART_PALETTE.length])
             : CHART_PALETTE[i % CHART_PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [items, view, lang])

  const totalValue = useMemo(() => items.reduce((s, it) => s + getItemValue(it), 0), [items])

  if (items.length === 0) return null

  const t = (es, en) => lang === 'es' ? es : en

  const views = [
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'returnType', label: t('Retorno', 'Return') },
    { key: 'sector', label: t('Sector', 'Sector') },
    { key: 'geography', label: t('Geo', 'Geo') },
    { key: 'currency', label: t('Moneda', 'Currency') },
    { key: 'institution', label: t('Inst.', 'Inst.') },
  ]

  return (
    <div className="bg-theme-surface rounded-2xl border border-glass-border p-5 card-primary">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
          {t('ASIGNACIÓN DE ACTIVOS', 'ASSET ALLOCATION')}
        </h3>
        <span className="text-sm font-bold text-white font-mono tabular-nums">
          {formatCurrency(totalValue)}
        </span>
      </div>

      {/* View toggle tabs */}
      <div className="flex items-center gap-1.5 mb-5">
        {views.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              view !== v.key ? 'border border-slate-600/50 hover:bg-theme-elevated' : ''
            }`}
            style={view === v.key
              ? { backgroundColor: 'var(--accent-blue-strong)', color: '#ffffff' }
              : { color: 'var(--text-secondary)' }
            }>
            {v.label}
          </button>
        ))}
      </div>

      {/* Horizontal bar breakdown */}
      <div className="space-y-0">
        {allocation.map((seg) => {
          const displayName = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].label[lang] || seg.name
            : seg.name
          const returnTypeDesc = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].returnType[lang]
            : null

          return (
            <div key={seg.name} style={{ paddingTop: 6, paddingBottom: 6 }}>
              {/* Top row: label left, contribution + value + pct right */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-slate-300 capitalize truncate">
                      {displayName}
                    </span>
                    {returnTypeDesc && (
                      <span className="text-[10px] text-slate-500 leading-tight">
                        {returnTypeDesc}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-xs w-14 text-right"
                    style={{ color: seg.contribution >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(239,68,68,0.7)' }}
                  >
                    {seg.contribution >= 0 ? '+' : ''}{seg.contribution.toFixed(1)}%
                  </span>
                  <span className="text-sm text-white font-mono tabular-nums text-right min-w-[80px]">
                    {formatCurrency(seg.value)}
                  </span>
                  <span className="text-xs text-slate-500 w-12 text-right">
                    {seg.pct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Bar track + fill */}
              <div
                className="rounded-full overflow-hidden"
                style={{ height: 8, backgroundColor: 'var(--bg-input)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.max(seg.pct, 0.5)}%`,
                    backgroundColor: seg.color,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
