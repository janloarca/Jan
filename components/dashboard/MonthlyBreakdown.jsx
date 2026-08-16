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

function EditableCell({ value, onSave, className, style }) {
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
        className="w-full bg-theme-base rounded px-1.5 py-0.5 text-xs text-white text-right font-medium tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        style={{ borderColor: 'var(--accent-blue)' }}
      />
    )
  }

  return (
    <span
      className={`cursor-pointer rounded px-1 py-0.5 -mx-1 transition-colors ${className}`}
      style={style}
      onClick={() => { setDraft(Math.abs(value).toFixed(2)); setEditing(true) }}
      title="Click to edit"
    >
      {formatCurrency(Math.abs(value))}
    </span>
  )
}

export default function MonthlyBreakdown({ items, snapshots, lang, onUpdateItem, onEditItem }) {
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
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {t('ESTADO DE CUENTA', 'ACCOUNT STATEMENT')}
        </h3>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Ordenado por liquidez', 'By liquidity')}</span>
      </div>

      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full text-xs border-collapse min-w-[480px]">
          <caption className="sr-only">{t('Estado de cuenta por institución y activo', 'Account statement by institution and asset')}</caption>
          <thead>
            <tr className="border-b-2" style={{ borderColor: 'var(--card-border)' }}>
              <th scope="col" className="text-left py-2 pr-2 font-semibold sticky left-0 bg-theme-card z-10 min-w-[180px]" style={{ color: 'var(--text-muted)' }}>
                {t('Cuenta / Activo', 'Account / Asset')}
              </th>
              <th scope="col" className="text-right py-2 px-2 font-semibold w-24" style={{ color: 'var(--text-secondary)' }}>{currentMonthLabel.toUpperCase()}</th>
              <th scope="col" className="text-right py-2 px-2 font-semibold w-12" style={{ color: 'var(--text-muted)' }}>%</th>
              <th scope="col" className="text-right py-2 px-2 font-semibold w-16" style={{ color: 'var(--text-muted)' }}>P&L</th>
              {monthlyTotals.map(m => (
                <th scope="col" key={m.key} className="text-right py-2 px-2 font-medium w-20" style={{ color: 'var(--text-muted)' }}>
                  {formatMonthLabel(m.key, lang).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => {
            const isCollapsed = collapsed[group.name]
            return (
              <tbody key={group.name}>
                <tr className="bg-theme-base/60 cursor-pointer hover:bg-theme-base/80 transition-colors"
                  onClick={() => toggleGroup(group.name)}>
                  <td className="py-2 pr-2 sticky left-0 bg-theme-base/60 z-10">
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-3" style={{ color: 'var(--text-muted)' }}>{isCollapsed ? '▸' : '▾'}</span>
                      <span className="text-white font-semibold text-xs">{group.name}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{group.items.length}</span>
                    </div>
                  </td>
                  <td className="text-right py-2 px-2 font-bold" style={{ color: group.total < 0 ? 'var(--text-negative)' : '#ffffff' }}>
                    {formatCurrency(group.total)}
                  </td>
                  <td className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{group.pct.toFixed(1)}%</td>
                  <td className="text-right py-2 px-2" />
                  {monthlyTotals.map(m => (
                    <td key={m.key} className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>-</td>
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
                    <tr key={item.id || i} className="border-b hover:bg-theme-elevated/30 transition-colors" style={{ borderColor: 'var(--card-border)' }}>
                      <td className="py-1.5 pr-2 pl-7 sticky left-0 bg-theme-card z-10">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor:
                            cat === 'banks' ? 'var(--accent-cyan)' :
                            cat === 'bonds' ? 'var(--accent-orange)' :
                            cat === 'stocks' ? 'var(--accent-blue)' :
                            cat === 'funds' ? 'var(--accent-purple)' :
                            cat === 'crypto' ? 'var(--accent-orange)' :
                            cat === 'realestate' ? 'var(--accent-green)' :
                            cat === 'debts' ? 'var(--text-negative)' :
                            'var(--text-muted)'
                          }} />
                          <div className="min-w-0">
                            {onEditItem ? (
                              <button className="truncate block text-xs text-left hover:underline transition-colors" style={{ color: 'var(--text-secondary)' }} onClick={(e) => { e.stopPropagation(); onEditItem(item) }}>
                                {item.name || item.symbol}
                              </button>
                            ) : (
                              <span className="truncate block text-xs" style={{ color: 'var(--text-secondary)' }}>{item.name || item.symbol}</span>
                            )}
                            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>
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
                            className="font-medium tabular-nums"
                            style={{ color: isDebt ? 'var(--text-negative)' : 'var(--text-secondary)' }}
                          />
                        ) : (
                          <span className="font-medium font-mono tabular-nums" style={{ color: isDebt ? 'var(--text-negative)' : 'var(--text-secondary)' }}>
                            {isDebt ? '-' : ''}{formatCurrency(Math.abs(val))}
                          </span>
                        )}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{Math.abs(pct).toFixed(1)}</td>
                      <td className="text-right py-1.5 px-2 font-mono tabular-nums">
                        {retPct != null ? (
                          <span style={{ color: retPct >= 0 ? 'color-mix(in srgb, var(--accent-green) 80%, transparent)' : 'color-mix(in srgb, var(--text-negative) 80%, transparent)' }}>
                            {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--bg-card)' }}>-</span>
                        )}
                      </td>
                      {monthlyTotals.map(m => (
                        <td key={m.key} className="text-right py-1.5 px-2" style={{ color: 'var(--text-muted)' }}>-</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: 'var(--card-border)' }}>
              <td className="py-2.5 pr-2 sticky left-0 bg-theme-card z-10">
                <span className="text-white font-bold text-xs">TOTAL</span>
              </td>
              <td className="text-right py-2.5 px-2 text-white font-bold tabular-nums">{formatCurrency(netWorth)}</td>
              <td className="text-right py-2.5 px-2 font-bold" style={{ color: 'var(--text-secondary)' }}>100%</td>
              <td className="text-right py-2.5 px-2" />
              {monthlyTotals.map(m => {
                const change = netWorth > 0 && m.value > 0 ? ((netWorth - m.value) / m.value) * 100 : null
                return (
                  <td key={m.key} className="text-right py-2.5 px-2">
                    <span className="font-medium tabular-nums block" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(m.value)}</span>
                    {change != null && (
                      <span className="text-xs" style={{ color: change >= 0 ? 'color-mix(in srgb, var(--accent-green) 60%, transparent)' : 'color-mix(in srgb, var(--text-negative) 60%, transparent)' }}>
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
