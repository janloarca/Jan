'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { formatCurrency, getItemValue, getTypeCategory, TYPE_COLORS } from './utils'

const CATEGORY_ORDER = ['banks', 'funds', 'stocks', 'crypto', 'alternatives', 'bonds', 'other', 'debts']
const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos Liquidos', en: 'Liquid Funds' },
  stocks: { es: 'Bolsa de Valores', en: 'Stock Market' },
  crypto: { es: 'Criptoactivos', en: 'Crypto Assets' },
  alternatives: { es: 'Deuda Privada & Alt.', en: 'Private Debt & Alt.' },
  bonds: { es: 'Bonos Corporativo', en: 'Corporate Bonds' },
  realestate: { es: 'Bienes Raices', en: 'Real Estate' },
  debts: { es: 'Pasivos', en: 'Liabilities' },
  other: { es: 'Otros', en: 'Other' },
}

const CATEGORY_ACCENT = {
  banks: '#94a3b8',
  funds: '#818cf8',
  stocks: '#3b82f6',
  crypto: '#f97316',
  alternatives: '#a78bfa',
  bonds: '#f59e0b',
  realestate: '#10b981',
  debts: '#ef4444',
  other: '#64748b',
}

function getMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getMonthLabel(key, lang) {
  const [y, m] = key.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  const label = d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  return label.charAt(0).toUpperCase() + label.slice(1) + ' ' + y.slice(2)
}

function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  const commit = () => {
    const num = parseFloat(draft.replace(/[^0-9.\-]/g, ''))
    if (!isNaN(num) && num >= 0) onSave(num)
    setEditing(false)
  }

  if (editing) {
    return (
      <input ref={ref} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-full bg-white border-2 border-blue-400 rounded px-3 py-1.5 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
    )
  }

  const fmt = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="cursor-pointer rounded px-3 py-1.5 -mx-1 transition-all hover:bg-blue-100 hover:ring-1 hover:ring-blue-300 text-right"
      onClick={() => { setDraft(Math.abs(value).toFixed(2)); setEditing(true) }}>
      <span className={`font-mono tabular-nums text-sm ${value < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt}</span>
    </div>
  )
}

export default function PortfolioSpreadsheet({ items, snapshots, lang, onUpdateItem, onEditItem, returnYTD, netWorth }) {
  const t = (es, en) => lang === 'es' ? es : en

  const now = new Date()
  const currentMonthKey = getMonthKey(now)

  const months = useMemo(() => {
    const result = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      result.push(getMonthKey(d))
    }
    return result
  }, [])

  const monthlyTotals = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return {}
    const byMonth = {}
    snapshots.forEach(s => {
      if (!s.date) return
      const key = getMonthKey(new Date(s.date))
      const val = s.netWorthUSD ?? s.totalActivosUSD ?? 0
      if (val <= 0) return
      const existing = byMonth[key]
      if (!existing || new Date(s.date) > new Date(existing.date)) {
        byMonth[key] = val
      }
    })
    return byMonth
  }, [snapshots])

  const { categories, totalAssets, totalDebt, currencyBreakdown } = useMemo(() => {
    const catMap = {}
    let totalA = 0
    let totalD = 0
    const curBreak = {}

    items.forEach(it => {
      const cat = getTypeCategory(it.type)
      if (!catMap[cat]) catMap[cat] = { institutions: {}, total: 0 }
      const inst = it.institution || t('Sin institucion', 'No institution')
      if (!catMap[cat].institutions[inst]) catMap[cat].institutions[inst] = []
      catMap[cat].institutions[inst].push(it)

      const val = getItemValue(it)
      catMap[cat].total += val
      if (val < 0) totalD += Math.abs(val)
      else totalA += val

      const cur = it.currency || 'USD'
      const isUSD = cur === 'USD' || cur === '$'
      const bucket = isUSD ? 'USD' : cur
      curBreak[bucket] = (curBreak[bucket] || 0) + Math.abs(val)
    })

    const ordered = CATEGORY_ORDER
      .filter(cat => catMap[cat])
      .map(cat => ({
        key: cat,
        label: CATEGORY_LABELS[cat]?.[lang] || cat,
        total: catMap[cat].total,
        institutions: Object.entries(catMap[cat].institutions)
          .map(([name, items]) => ({
            name,
            items: items.sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))),
            total: items.reduce((s, it) => s + getItemValue(it), 0),
          }))
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
      }))

    return { categories: ordered, totalAssets: totalA, totalDebt: totalD, currencyBreakdown: curBreak }
  }, [items, lang])

  const grandTotal = totalAssets - totalDebt
  const [collapsed, setCollapsed] = useState({})
  const [collapsedInst, setCollapsedInst] = useState({})

  const toggleCat = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }))
  const toggleInst = (key) => setCollapsedInst(p => ({ ...p, [key]: !p[key] }))

  const handleValueUpdate = useCallback((item, newVal) => {
    if (!onUpdateItem || !item.id) return
    const qty = item.quantity || 1
    onUpdateItem(item.id, { currentPrice: newVal / qty })
  }, [onUpdateItem])

  const prevMonthKey = months.length >= 2 ? months[months.length - 2] : null
  const prevTotal = prevMonthKey ? monthlyTotals[prevMonthKey] : null
  const monthlyReturn = prevTotal && grandTotal > 0 ? ((grandTotal - prevTotal) / prevTotal) * 100 : null

  const janKey = `${now.getFullYear()}-01`
  const janTotal = monthlyTotals[janKey]

  return (
    <div className="bg-[#f8fafc] border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-bold text-slate-900">{t('Portfolio Spreadsheet', 'Portfolio Spreadsheet')}</h2>
        <span className="text-xs text-slate-400">{t('Click para editar mes actual', 'Click to edit current month')}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="text-left py-2.5 pl-4 pr-2 text-slate-500 font-semibold text-xs uppercase tracking-wide sticky left-0 bg-slate-50 z-20 min-w-[200px]" />
              <th className="text-right py-2.5 px-2 text-slate-400 font-semibold text-xs w-10">%</th>
              <th className="text-center py-2.5 px-1 text-slate-400 font-semibold text-xs w-10">{t('Mon', 'Cur')}</th>
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                return (
                  <th key={mk} className={`text-right py-2.5 px-3 font-semibold text-xs w-28 ${isCurrent ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}>
                    {getMonthLabel(mk, lang)}
                    {isCurrent && <div className="text-[10px] font-normal text-blue-400">{t('actual', 'current')}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>

          {categories.map(cat => {
            const pct = grandTotal !== 0 ? (cat.total / grandTotal) * 100 : 0
            const isCollapsed = collapsed[cat.key]
            const accent = CATEGORY_ACCENT[cat.key] || '#64748b'

            return (
              <tbody key={cat.key}>
                <tr className="cursor-pointer hover:bg-slate-100 transition-colors border-t border-slate-200 bg-white"
                  onClick={() => toggleCat(cat.key)}>
                  <td className="py-3 pl-4 pr-2 sticky left-0 bg-white z-10" style={{ borderLeft: `3px solid ${accent}` }}>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-[10px] w-3">{isCollapsed ? '>' : 'v'}</span>
                      <span className="text-slate-900 font-bold text-sm">{cat.label}</span>
                      <span className="text-slate-400 text-xs">({cat.institutions.reduce((s, i) => s + i.items.length, 0)})</span>
                    </div>
                  </td>
                  <td className="text-right py-3 px-2 text-slate-500 font-semibold text-sm">{Math.abs(pct).toFixed(0)}%</td>
                  <td className="text-center py-3 px-1 text-slate-400 text-xs">$</td>
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    return (
                      <td key={mk} className={`text-right py-3 px-3 font-bold tabular-nums font-mono text-sm ${isCurrent ? 'bg-blue-50 text-slate-900' : 'text-slate-300'}`}>
                        {isCurrent ? formatCurrency(cat.total) : ''}
                      </td>
                    )
                  })}
                </tr>

                {!isCollapsed && cat.institutions.map(inst => {
                  const instKey = `${cat.key}:${inst.name}`
                  const isInstCollapsed = collapsedInst[instKey]
                  const showInst = inst.items.length > 1

                  return (
                    <Fragment key={instKey}>
                      {showInst && (
                        <tr className="cursor-pointer hover:bg-slate-50 transition-colors bg-white border-t border-slate-100"
                          onClick={() => toggleInst(instKey)}>
                          <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10">
                            <span className="text-slate-700 font-semibold text-sm">{inst.name}</span>
                            <span className="text-slate-400 text-xs ml-1.5">{isInstCollapsed ? '>' : 'v'}</span>
                          </td>
                          <td />
                          <td className="text-center py-2 px-1 text-slate-400 text-xs">{inst.items[0]?.currency || ''}</td>
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            return (
                              <td key={mk} className={`text-right py-2 px-3 font-medium tabular-nums font-mono text-sm ${isCurrent ? 'bg-blue-50 text-slate-700' : 'text-slate-300'}`}>
                                {isCurrent ? formatCurrency(inst.total) : ''}
                              </td>
                            )
                          })}
                        </tr>
                      )}

                      {(!showInst || !isInstCollapsed) && inst.items.map((item, idx) => {
                        const val = getItemValue(item)
                        return (
                          <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors bg-white border-t border-slate-100/60">
                            <td className={`py-2.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 bg-white z-10`}>
                              <div className="flex items-center gap-2 min-w-0">
                                {onEditItem ? (
                                  <button className="text-slate-800 text-sm truncate text-left hover:text-blue-600 hover:underline transition-colors" onClick={(e) => { e.stopPropagation(); onEditItem(item) }}>
                                    {item.name || item.symbol}
                                  </button>
                                ) : (
                                  <span className="text-slate-800 text-sm truncate">{item.name || item.symbol}</span>
                                )}
                                {item.quantity && item.quantity !== 1 && (
                                  <span className="text-slate-400 text-xs shrink-0">{item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                )}
                              </div>
                            </td>
                            <td />
                            <td className="text-center py-2.5 px-1 text-slate-400 text-xs">{item.currency || ''}</td>
                            {months.map(mk => {
                              const isCurrent = mk === currentMonthKey
                              if (!isCurrent) {
                                return <td key={mk} className="text-right py-2.5 px-3 text-slate-300 tabular-nums font-mono text-sm">-</td>
                              }
                              return (
                                <td key={mk} className="text-right py-1 px-1 bg-blue-50">
                                  {onUpdateItem ? (
                                    <EditableCell value={val} onSave={(v) => handleValueUpdate(item, v)} />
                                  ) : (
                                    <span className={`font-mono tabular-nums text-sm font-medium ${val < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                      {Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            )
          })}

          <tfoot>
            {Object.entries(currencyBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([cur, val]) => {
                const pct = grandTotal > 0 ? (val / grandTotal) * 100 : 0
                return (
                  <tr key={cur} className="text-slate-400 border-t border-slate-100 bg-white">
                    <td className="py-1.5 pl-8 pr-2 sticky left-0 bg-white z-10 text-xs">{cur}</td>
                    <td className="text-right py-1.5 px-2 text-xs">{pct.toFixed(0)}%</td>
                    <td className="text-center py-1.5 px-1 text-xs">{cur === 'USD' ? '$' : cur}</td>
                    {months.map(mk => {
                      const isCurrent = mk === currentMonthKey
                      return (
                        <td key={mk} className={`text-right py-1.5 px-3 text-xs tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
                          {isCurrent ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            <tr className="border-t-2 border-slate-300 bg-slate-100">
              <td className="py-3.5 pl-4 pr-2 sticky left-0 bg-slate-100 z-10">
                <span className="text-slate-900 font-black text-base">TOTAL</span>
              </td>
              <td className="text-right py-3.5 px-2 text-slate-700 font-bold text-sm">100%</td>
              <td className="text-center py-3.5 px-1 text-slate-500 font-bold text-xs">$</td>
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                return (
                  <td key={mk} className={`text-right py-3.5 px-3 font-black tabular-nums font-mono text-base ${isCurrent ? 'bg-blue-50 text-slate-900' : val ? 'text-slate-600' : 'text-slate-300'}`}>
                    {val ? formatCurrency(val) : '-'}
                  </td>
                )
              })}
            </tr>

            {monthlyReturn != null && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  {t('Retorno Mensual', 'Monthly Return')}
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-2 px-3 text-sm tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
                      {isCurrent ? (
                        <span className={`font-semibold ${monthlyReturn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {monthlyReturn >= 0 ? '+' : ''}{monthlyReturn.toFixed(1)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {returnYTD != null && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  Return YTD
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-2 px-3 text-sm tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
                      {isCurrent ? (
                        <span className={`font-semibold ${returnYTD >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {returnYTD >= 0 ? '+' : ''}{returnYTD.toFixed(2)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {janTotal && grandTotal > 0 && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  {t('Crecimiento Portafolio', 'Portfolio Growth')}
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                  const growth = val && janTotal > 0 ? ((val - janTotal) / janTotal) * 100 : null
                  return (
                    <td key={mk} className={`text-right py-2 px-3 text-sm tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
                      {growth != null ? (
                        <span className={`font-semibold ${growth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {growth >= 0 ? '+' : ''}{growth.toFixed(0)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  )
}
