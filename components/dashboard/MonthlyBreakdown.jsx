'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { formatCurrency, getItemValue, getTypeCategory } from './utils'

const LIQUIDITY_ORDER = { banks: 0, bonds: 1, funds: 2, stocks: 3, crypto: 4, realestate: 5, alternatives: 6, other: 7, debts: 8 }

function getLiquidityScore(item) {
  return LIQUIDITY_ORDER[getTypeCategory(item.type)] ?? 7
}

function getMonthKey(dateStr) {
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(key, lang) {
  const [y, m] = key.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  return d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' })
}

function EditableCell({ value, onSave, className }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    const num = parseFloat(draft.replace(/[^0-9.\-]/g, ''))
    if (!isNaN(num) && num >= 0) onSave(num)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-full bg-[#0f172a] border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-white text-right font-medium tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500/30"
      />
    )
  }

  return (
    <span
      className={`cursor-pointer hover:bg-blue-500/10 rounded px-1 py-0.5 -mx-1 transition-colors ${className}`}
      onClick={() => { setDraft(Math.abs(value).toFixed(2)); setEditing(true) }}
      title="Click to edit"
    >
      {formatCurrency(Math.abs(value))}
    </span>
  )
}

export default function MonthlyBreakdown({ items, snapshots, lang, onUpdateItem }) {
  const [collapsed, setCollapsed] = useState({})
  const t = (es, en) => lang === 'es' ? es : en

  const { groups, totalValue, totalDebt } = useMemo(() => {
    const byInst = {}
    let totalVal = 0
    let totalDbt = 0

    items.forEach(it => {
      const val = getItemValue(it)
      const inst = it.institution || t('Sin institución', 'No institution')
      if (!byInst[inst]) byInst[inst] = { items: [], total: 0, debt: 0 }
      byInst[inst].items.push(it)
      if (val < 0) byInst[inst].debt += val
      else byInst[inst].total += val
      if (val < 0) totalDbt += val
      else totalVal += val
    })

    const sorted = Object.entries(byInst)
      .map(([name, data]) => {
        const sortedItems = [...data.items].sort((a, b) => {
          const la = getLiquidityScore(a)
          const lb = getLiquidityScore(b)
          if (la !== lb) return la - lb
          return Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))
        })
        return {
          name,
          items: sortedItems,
          total: data.total + data.debt,
          pct: (totalVal + totalDbt) !== 0 ? ((data.total + data.debt) / (totalVal + totalDbt)) * 100 : 0,
        }
      })
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

    return { groups: sorted, totalValue: totalVal, totalDebt: totalDbt }
  }, [items, lang])

  const monthlyTotals = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return []
    const byMonth = {}
    snapshots.forEach(s => {
      if (!s.date) return
      const key = getMonthKey(s.date)
      if (!key) return
      const val = s.netWorthUSD ?? s.totalActivosUSD ?? 0
      if (val <= 0) return
      const existing = byMonth[key]
      if (!existing || new Date(s.date) > new Date(existing.date)) {
        byMonth[key] = { date: s.date, value: val, key }
      }
    })
    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return Object.values(byMonth)
      .filter(m => m.key !== currentKey)
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, 5)
  }, [snapshots])

  if (items.length === 0) return null

  const netWorth = totalValue + totalDebt
  const currentMonthLabel = new Date().toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' })
  const toggleGroup = (name) => setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))

  const handleValueUpdate = (item, newTotalValue) => {
    if (!onUpdateItem || !item.id) return
    const qty = item.quantity || 1
    const newPrice = newTotalValue / qty
    onUpdateItem(item.id, { currentPrice: newPrice })
  }

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {t('ESTADO DE CUENTA', 'ACCOUNT STATEMENT')}
        </h3>
        <span className="text-xs text-slate-500">{t('Ordenado por liquidez', 'By liquidity')}</span>
      </div>

      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full text-xs border-collapse min-w-[480px]">
          <thead>
            <tr className="border-b-2 border-[#475569]">
              <th className="text-left py-2 pr-2 text-slate-500 font-semibold sticky left-0 bg-[#1e293b] z-10 min-w-[180px]">
                {t('Cuenta / Activo', 'Account / Asset')}
              </th>
              <th className="text-right py-2 px-2 text-slate-400 font-semibold w-24">{currentMonthLabel.toUpperCase()}</th>
              <th className="text-right py-2 px-2 text-slate-500 font-semibold w-12">%</th>
              <th className="text-right py-2 px-2 text-slate-500 font-semibold w-16">P&L</th>
              {monthlyTotals.map(m => (
                <th key={m.key} className="text-right py-2 px-2 text-slate-600 font-medium w-20">
                  {formatMonthLabel(m.key, lang).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => {
            const isCollapsed = collapsed[group.name]
            return (
              <tbody key={group.name}>
                <tr className="bg-[#0f172a]/60 cursor-pointer hover:bg-[#0f172a]/80 transition-colors"
                  onClick={() => toggleGroup(group.name)}>
                  <td className="py-2 pr-2 sticky left-0 bg-[#0f172a]/60 z-10">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-[10px] w-3">{isCollapsed ? '▸' : '▾'}</span>
                      <span className="text-white font-semibold text-xs">{group.name}</span>
                      <span className="text-slate-600 text-[10px]">{group.items.length}</span>
                    </div>
                  </td>
                  <td className={`text-right py-2 px-2 font-bold ${group.total < 0 ? 'text-red-400' : 'text-white'}`}>
                    {formatCurrency(group.total)}
                  </td>
                  <td className="text-right py-2 px-2 text-slate-400 font-medium">{group.pct.toFixed(1)}%</td>
                  <td className="text-right py-2 px-2" />
                  {monthlyTotals.map(m => (
                    <td key={m.key} className="text-right py-2 px-2 text-slate-700">—</td>
                  ))}
                </tr>

                {!isCollapsed && group.items.map((item, i) => {
                  const val = getItemValue(item)
                  const pct = netWorth !== 0 ? (val / netWorth) * 100 : 0
                  const hasRet = item.currentPrice != null && item.purchasePrice > 0
                  const retPct = hasRet ? ((item.currentPrice - item.purchasePrice) / item.purchasePrice) * 100 : null
                  const cat = getTypeCategory(item.type)
                  const isDebt = val < 0

                  return (
                    <tr key={item.id || i} className="border-b border-[#1e293b] hover:bg-[#283548]/30 transition-colors">
                      <td className="py-1.5 pr-2 pl-7 sticky left-0 bg-[#1e293b] z-10">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1 h-5 rounded-full shrink-0 ${
                            cat === 'banks' ? 'bg-cyan-500' :
                            cat === 'bonds' ? 'bg-amber-500' :
                            cat === 'stocks' ? 'bg-blue-500' :
                            cat === 'funds' ? 'bg-indigo-500' :
                            cat === 'crypto' ? 'bg-orange-500' :
                            cat === 'realestate' ? 'bg-emerald-500' :
                            cat === 'debts' ? 'bg-red-500' :
                            'bg-slate-500'
                          }`} />
                          <div className="min-w-0">
                            <span className="text-slate-200 truncate block text-xs">{item.name || item.symbol}</span>
                            <span className="text-[10px] text-slate-600 block">
                              {item.symbol && item.name ? item.symbol : ''}
                              {item.quantity ? ` · ${item.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="text-right py-1.5 px-2">
                        {onUpdateItem ? (
                          <EditableCell
                            value={val}
                            onSave={(newVal) => handleValueUpdate(item, newVal)}
                            className={`font-medium tabular-nums ${isDebt ? 'text-red-400' : 'text-slate-200'}`}
                          />
                        ) : (
                          <span className={`font-medium tabular-nums ${isDebt ? 'text-red-400' : 'text-slate-200'}`}>
                            {isDebt ? '-' : ''}{formatCurrency(Math.abs(val))}
                          </span>
                        )}
                      </td>
                      <td className="text-right py-1.5 px-2 text-slate-600 tabular-nums">{Math.abs(pct).toFixed(1)}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">
                        {retPct != null ? (
                          <span className={retPct >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}>
                            {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-800">—</span>
                        )}
                      </td>
                      {monthlyTotals.map(m => (
                        <td key={m.key} className="text-right py-1.5 px-2 text-slate-800">—</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
          <tfoot>
            <tr className="border-t-2 border-[#475569]">
              <td className="py-2.5 pr-2 sticky left-0 bg-[#1e293b] z-10">
                <span className="text-white font-bold text-xs">TOTAL</span>
              </td>
              <td className="text-right py-2.5 px-2 text-white font-bold tabular-nums">{formatCurrency(netWorth)}</td>
              <td className="text-right py-2.5 px-2 text-slate-400 font-bold">100%</td>
              <td className="text-right py-2.5 px-2" />
              {monthlyTotals.map(m => {
                const change = netWorth > 0 && m.value > 0 ? ((netWorth - m.value) / m.value) * 100 : null
                return (
                  <td key={m.key} className="text-right py-2.5 px-2">
                    <span className="text-slate-300 font-medium tabular-nums block">{formatCurrency(m.value)}</span>
                    {change != null && (
                      <span className={`text-[10px] ${change >= 0 ? 'text-emerald-500/60' : 'text-red-500/60'}`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
