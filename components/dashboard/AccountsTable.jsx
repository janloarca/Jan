'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS } from './utils'

export default function AccountsTable({ items, lang }) {
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('value')

  const counts = useMemo(() => {
    const c = { all: items.length, stocks: 0, crypto: 0, bonds: 0, funds: 0 }
    items.forEach((it) => {
      const cat = getTypeCategory(it.type)
      if (c[cat] !== undefined) c[cat]++
    })
    return c
  }, [items])

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter((it) => getTypeCategory(it.type) === filter)
    return [...list].sort((a, b) => {
      const va = (a.quantity || 0) * (a.purchasePrice || 0)
      const vb = (b.quantity || 0) * (b.purchasePrice || 0)
      return sortBy === 'value' ? vb - va : va - vb
    })
  }, [items, filter, sortBy])

  const totalValue = useMemo(() => items.reduce((s, it) => s + (it.quantity || 0) * (it.purchasePrice || 0), 0), [items])

  const tabs = [
    { key: 'all', label: `All (${counts.all})`, icon: '🔵' },
    { key: 'stocks', label: `Stocks (${counts.stocks})`, icon: '📈' },
    { key: 'crypto', label: `Crypto (${counts.crypto})`, icon: '₿' },
    { key: 'bonds', label: `Instruments (${counts.bonds})`, icon: '🏛' },
    { key: 'funds', label: `Funds (${counts.funds})`, icon: '💼' },
  ]

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">Accounts & Instruments</h3>
        <button className="text-xs text-slate-400 border border-slate-600 px-3 py-1 rounded-lg hover:bg-slate-700 transition-colors">
          View all
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
              filter === tab.key
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 border border-slate-600 hover:bg-slate-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-8 text-sm">
          {lang === 'es' ? 'Sin posiciones en esta categoría.' : 'No holdings in this category.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-[#1e2d45]">
                <th className="text-left py-2 font-medium">Instrument</th>
                <th className="text-center py-2 font-medium">% Port.</th>
                <th className="text-center py-2 font-medium">Ret %</th>
                <th className="text-right py-2 font-medium cursor-pointer hover:text-slate-300"
                  onClick={() => setSortBy(sortBy === 'value' ? 'value-asc' : 'value')}>
                  Value $ {sortBy === 'value' ? '▼' : '▲'}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const cat = getTypeCategory(item.type)
                const colors = TYPE_COLORS[cat]
                const value = (item.quantity || 0) * (item.purchasePrice || 0)
                const pctPort = totalValue > 0 ? (value / totalValue) * 100 : 0
                const abbr = (item.symbol || '??').slice(0, 4).toUpperCase()

                return (
                  <tr key={item.id || item.symbol} className="border-b border-[#1e2d45]/50 hover:bg-[#1a2540] transition-colors">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        {/* Icon */}
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: colors.bg + '33', color: colors.bg }}>
                          {abbr}
                        </div>
                        <div>
                          <div className="text-white font-medium text-sm flex items-center gap-2">
                            {item.name || item.symbol}
                          </div>
                          <div className="text-slate-500 text-[10px]">
                            {item.institution || ''} · {item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ {formatCurrency(item.purchasePrice)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pctPort, 100)}%`, backgroundColor: colors.bg }} />
                        </div>
                        <span className="text-slate-400 text-[10px]">{pctPort.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <span className="text-slate-600">—</span>
                    </td>
                    <td className="text-right py-3">
                      <span className="text-emerald-400 font-medium">{formatCurrency(value)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
