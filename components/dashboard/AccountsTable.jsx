'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue, getItemPrice, getBaseCurrency, formatHoldingPeriod } from './utils'

export default function AccountsTable({ items, lang, onDeleteItem, onEditItem, onViewItem }) {
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('value')
  const [showAll, setShowAll] = useState(false)
  const [breakdown, setBreakdown] = useState(null)
  const [dismissWarning, setDismissWarning] = useState(false)

  const counts = useMemo(() => {
    const c = { all: items.length, stocks: 0, crypto: 0, bonds: 0, funds: 0 }
    items.forEach((it) => {
      const cat = getTypeCategory(it.type)
      if (c[cat] !== undefined) c[cat]++
    })
    return c
  }, [items])

  const missingDate = useMemo(() => items.filter((it) => !it.acquisitionDate && !it.createdAt).length, [items])

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter((it) => getTypeCategory(it.type) === filter)
    return [...list].sort((a, b) => {
      const va = getItemValue(a)
      const vb = getItemValue(b)
      if (sortBy === 'name') return (a.name || a.symbol || '').localeCompare(b.name || b.symbol || '')
      return sortBy === 'value' ? vb - va : va - vb
    })
  }, [items, filter, sortBy])

  const totalValue = useMemo(() => items.reduce((s, it) => s + getItemValue(it), 0), [items])
  const displayItems = showAll ? filtered : filtered.slice(0, 10)

  const breakdownData = useMemo(() => {
    if (!breakdown) return null
    const groups = {}
    let total = 0
    items.forEach((it) => {
      const key = breakdown === 'type' ? (it.type || 'Other') : (it.institution || (lang === 'es' ? 'Sin institución' : 'No institution'))
      const val = getItemValue(it)
      if (!groups[key]) groups[key] = { count: 0, value: 0 }
      groups[key].count++
      groups[key].value += val
      total += val
    })
    return Object.entries(groups)
      .map(([name, d]) => ({ name, ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
  }, [items, breakdown, lang])

  const tabs = [
    { key: 'all', icon: '🔵', label: lang === 'es' ? `Todos (${counts.all})` : `All (${counts.all})` },
    { key: 'stocks', icon: '📈', label: `Stocks (${counts.stocks})` },
    { key: 'crypto', icon: '₿', label: `Crypto (${counts.crypto})` },
    { key: 'bonds', icon: '🏛', label: lang === 'es' ? `Instrumentos (${counts.bonds})` : `Instruments (${counts.bonds})` },
    { key: 'funds', icon: '💼', label: `Funds (${counts.funds})` },
  ]

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">
          {t('Cuentas e Instrumentos', 'Accounts & Instruments')}
        </h3>
        <span className="text-xs text-slate-500">Total: {formatCurrency(totalValue)}</span>
      </div>

      {/* Warning banner */}
      {missingDate > 0 && !dismissWarning && (
        <div className="flex items-center justify-between mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <span className="text-xs text-amber-400">
            ⚠ {missingDate} {t('activo(s) sin fecha de adquisición', 'asset(s) missing acquisition date')}
          </span>
          <button onClick={() => setDismissWarning(true)} className="text-amber-500/60 hover:text-amber-400 text-sm ml-2">×</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-full transition-colors ${
              filter === tab.key
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 border border-slate-600/50 hover:bg-[#1a2540]'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Breakdown toggles */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-slate-500">{t('Desglose:', 'Breakdown:')}</span>
        {[
          { key: 'type', label: t('Por tipo', 'By type') },
          { key: 'institution', label: t('Por institución', 'By institution') },
        ].map((opt) => (
          <button key={opt.key} onClick={() => setBreakdown(breakdown === opt.key ? null : opt.key)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
              breakdown === opt.key
                ? 'bg-slate-600 text-white'
                : 'text-slate-400 border border-slate-600/50 hover:bg-[#1a2540]'
            }`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Breakdown summary */}
      {breakdownData && (
        <div className="mb-4 p-3 bg-[#0b1120] rounded-lg border border-[#1e2d45]/50">
          <div className="space-y-1.5">
            {breakdownData.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span className="text-xs text-white font-medium w-32 truncate">{row.name}</span>
                <div className="flex-1 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${row.pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 w-8">{row.pct.toFixed(0)}%</span>
                <span className="text-[10px] text-slate-300 w-14 text-right">{formatCurrency(row.value)}</span>
                <span className="text-[10px] text-slate-500 w-4 text-right">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-8 text-sm">
          {t('Sin posiciones en esta categoría.', 'No holdings in this category.')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-[#1e2d45]">
                <th className="text-left py-2 font-medium cursor-pointer hover:text-slate-300" onClick={() => setSortBy('name')}>
                  {t('Instrumento', 'Instrument')} {sortBy === 'name' ? '↕' : ''}
                </th>
                <th className="text-center py-2 font-medium">% Port.</th>
                <th className="text-right py-2 font-medium">{t('Costo', 'Avg Cost')}</th>
                <th className="text-center py-2 font-medium">P&L</th>
                <th className="text-center py-2 font-medium">Yield</th>
                <th className="text-center py-2 font-medium">{t('Periodo', 'Holding')}</th>
                <th className="text-right py-2 font-medium cursor-pointer hover:text-slate-300"
                  onClick={() => setSortBy(sortBy === 'value' ? 'value-asc' : 'value')}>
                  {t('Valor $', 'Value $')} {sortBy === 'value' ? '▼' : sortBy === 'value-asc' ? '▲' : ''}
                </th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item) => {
                const cat = getTypeCategory(item.type)
                const colors = TYPE_COLORS[cat] || TYPE_COLORS.other
                const value = getItemValue(item)
                const pctPort = totalValue > 0 ? (value / totalValue) * 100 : 0
                const abbr = (item.symbol || '??').slice(0, 4).toUpperCase()

                const hasReturn = item.currentPrice != null && item.purchasePrice > 0
                const retPct = hasReturn ? ((item.currentPrice - item.purchasePrice) / item.purchasePrice) * 100 : null
                const retAbs = hasReturn ? (item.currentPrice - item.purchasePrice) * (item.quantity || 0) : null

                return (
                  <tr key={item.id || item.symbol} className="border-b border-[#1e2d45]/30 hover:bg-[#1a2540]/50 transition-colors group">
                    <td className="py-3">
                      <div className="flex items-center gap-0">
                        {/* Left color bar */}
                        <div className="w-1 h-12 rounded-full mr-3 shrink-0" style={{ backgroundColor: colors.bg }} />
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: colors.bg + '22', color: colors.bg }}>
                          {abbr}
                        </div>
                        <div className="min-w-0 ml-3">
                          <div className="text-white font-medium text-sm truncate flex items-center gap-2">
                            {item.name || item.symbol}
                            {item.change7d != null && (
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                                item.change7d >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {item.change7d >= 0 ? '▲' : '▼'}{Math.abs(item.change7d).toFixed(1)}% 7d
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 text-[10px]">
                            {item.institution ? `${item.institution} · ` : ''}{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ {formatCurrency(getItemPrice(item), item.currency)}
                            {item.currency && item.currency !== getBaseCurrency() && (
                              <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-slate-700 text-slate-400">{item.currency}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-14 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pctPort, 100)}%`, backgroundColor: colors.bg }} />
                        </div>
                        <span className="text-slate-400 text-[10px] w-8">{pctPort.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="text-right py-3">
                      {item.purchasePrice > 0 ? (
                        <span className="text-slate-400 text-[11px]">{formatCurrency(item.purchasePrice)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="text-center py-3">
                      {retPct != null ? (
                        <div>
                          <span className={`text-xs font-medium ${retPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {retPct >= 0 ? '+' : ''}{formatCurrency(retAbs)}
                          </span>
                          <div className={`text-[9px] ${retPct >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                            {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="text-center py-3">
                      <span className="text-[11px] text-slate-400">
                        {item.dividendYield ? `${item.dividendYield.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td className="text-center py-3">
                      <span className="text-[11px] text-slate-400">
                        {formatHoldingPeriod(item.acquisitionDate, lang)}
                      </span>
                    </td>
                    <td className="text-right py-3">
                      <span className="text-emerald-400 font-medium cursor-pointer hover:underline"
                        onClick={() => onViewItem && onViewItem(item)}>
                        {formatCurrency(value)}
                      </span>
                    </td>
                    <td className="text-right py-3 w-16">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        {onViewItem && (
                          <button onClick={() => onViewItem(item)}
                            className="text-slate-600 hover:text-cyan-400 text-xs" title={lang === 'es' ? 'Ver detalle' : 'View detail'}>
                            📊
                          </button>
                        )}
                        {onEditItem && (
                          <button onClick={() => onEditItem(item)}
                            className="text-slate-600 hover:text-emerald-400 text-xs" title={lang === 'es' ? 'Editar' : 'Edit'}>
                            ✏️
                          </button>
                        )}
                        {onDeleteItem && (
                          <button onClick={() => onDeleteItem(item.id)}
                            className="text-slate-600 hover:text-red-400 text-sm">
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length > 10 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-[#1e2d45]/50 rounded-lg hover:bg-[#1a2540] transition-colors">
              {showAll
                ? t('Mostrar menos', 'Show less')
                : t(`Ver todos (${filtered.length})`, `View all (${filtered.length})`)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
