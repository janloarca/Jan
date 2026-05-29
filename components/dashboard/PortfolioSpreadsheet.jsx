'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { formatCurrency, getItemValue, getTypeCategory, TYPE_COLORS } from './utils'

const CATEGORY_ORDER = ['banks', 'funds', 'stocks', 'crypto', 'alternatives', 'bonds', 'other', 'debts']
const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos Líquidos', en: 'Liquid Funds' },
  stocks: { es: 'Bolsa de Valores', en: 'Stock Market' },
  crypto: { es: 'Criptoactivos', en: 'Crypto Assets' },
  alternatives: { es: 'Deuda Privada & Alt.', en: 'Private Debt & Alt.' },
  bonds: { es: 'Bonos Corporativo', en: 'Corporate Bonds' },
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  debts: { es: 'Pasivos', en: 'Liabilities' },
  other: { es: 'Otros', en: 'Other' },
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

function EditableCell({ value, currency, onSave }) {
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
        className="w-full bg-[#0f172a] border border-blue-500/50 rounded px-1 py-0.5 text-[11px] text-white text-right font-mono focus:outline-none" />
    )
  }

  const fmt = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <span className="cursor-pointer hover:bg-blue-500/10 rounded px-1 py-0.5 -mx-1 transition-colors"
      onClick={() => { setDraft(Math.abs(value).toFixed(2)); setEditing(true) }}>
      {fmt}
    </span>
  )
}

export default function PortfolioSpreadsheet({ items, snapshots, lang, onUpdateItem, returnYTD, netWorth }) {
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
      const inst = it.institution || t('Sin institución', 'No institution')
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
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden card-primary">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#334155]">
        <h2 className="text-sm font-bold text-white">{t('Portfolio Spreadsheet', 'Portfolio Spreadsheet')}</h2>
        <span className="text-xs text-slate-500">{t('Click para editar mes actual', 'Click to edit current month')}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-[#475569]">
              <th className="text-left py-2 pl-4 pr-2 text-slate-500 font-semibold sticky left-0 bg-[#1e293b] z-20 min-w-[200px]" />
              <th className="text-right py-2 px-1 text-slate-600 font-medium w-8">%</th>
              <th className="text-center py-2 px-1 text-slate-600 font-medium w-10">{t('Mon', 'Cur')}</th>
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                return (
                  <th key={mk} className={`text-right py-2 px-2 font-semibold w-24 ${isCurrent ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}>
                    {getMonthLabel(mk, lang)}
                    {isCurrent && <div className="text-[9px] font-normal opacity-60">{t('Final', 'Final')}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>

          {categories.map(cat => {
            const pct = grandTotal !== 0 ? (cat.total / grandTotal) * 100 : 0
            const isCollapsed = collapsed[cat.key]
            const color = TYPE_COLORS[cat.key]?.bg || '#64748b'

            return (
              <tbody key={cat.key}>
                <tr className="bg-[#0f172a]/50 cursor-pointer hover:bg-[#0f172a]/70 transition-colors border-t border-[#334155]/50"
                  onClick={() => toggleCat(cat.key)}>
                  <td className="py-2 pl-4 pr-2 sticky left-0 bg-[#0f172a]/50 z-10">
                    <div className="flex items-center gap-2">
                      <span style={{ backgroundColor: color }} className="w-2 h-2 rounded-sm shrink-0" />
                      <span className="text-white font-bold text-xs">{cat.label}</span>
                      <span className="text-slate-600 text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                    </div>
                  </td>
                  <td className="text-right py-2 px-1 text-slate-400 font-bold">{Math.abs(pct).toFixed(0)}%</td>
                  <td className="text-center py-2 px-1 text-slate-600 font-medium">
                    {(cat.total < 0 ? '-' : '') + (Math.abs(cat.total) >= 1000 ? '$' : '')}
                  </td>
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    return (
                      <td key={mk} className={`text-right py-2 px-2 font-bold tabular-nums ${isCurrent ? 'bg-emerald-500/10 text-white' : 'text-slate-400'}`}>
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
                        <tr className="cursor-pointer hover:bg-[#1a2536] transition-colors"
                          onClick={() => toggleInst(instKey)}>
                          <td className="py-1 pl-6 pr-2 sticky left-0 bg-[#1e293b] z-10">
                            <span className="text-slate-300 font-semibold text-[11px]">{inst.name}</span>
                            <span className="text-slate-600 text-[10px] ml-1">{isInstCollapsed ? '▸' : '▾'}</span>
                          </td>
                          <td />
                          <td className="text-center py-1 px-1 text-slate-600 text-[10px]">{inst.items[0]?.currency || ''}</td>
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            return (
                              <td key={mk} className={`text-right py-1 px-2 font-medium tabular-nums ${isCurrent ? 'bg-emerald-500/10 text-slate-300' : 'text-slate-500'}`}>
                                {isCurrent ? formatCurrency(inst.total) : ''}
                              </td>
                            )
                          })}
                        </tr>
                      )}

                      {(!showInst || !isInstCollapsed) && inst.items.map((item, idx) => {
                        const val = getItemValue(item)
                        return (
                          <tr key={item.id || idx} className="hover:bg-[#283548]/30 transition-colors">
                            <td className={`py-1 ${showInst ? 'pl-10' : 'pl-6'} pr-2 sticky left-0 bg-[#1e293b] z-10`}>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-slate-300 text-[11px] truncate">{item.name || item.symbol}</span>
                                {item.quantity && item.quantity !== 1 && (
                                  <span className="text-slate-600 text-[10px] shrink-0">{item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                )}
                              </div>
                            </td>
                            <td />
                            <td className="text-center py-1 px-1 text-slate-600 text-[10px]">{item.currency || ''}</td>
                            {months.map(mk => {
                              const isCurrent = mk === currentMonthKey
                              if (!isCurrent) {
                                return <td key={mk} className="text-right py-1 px-2 text-slate-700 tabular-nums">-</td>
                              }
                              return (
                                <td key={mk} className="text-right py-1 px-2 bg-emerald-500/10 tabular-nums">
                                  {onUpdateItem ? (
                                    <EditableCell value={val} currency={item.currency} onSave={(v) => handleValueUpdate(item, v)} />
                                  ) : (
                                    <span className={`font-medium ${val < 0 ? 'text-red-400' : 'text-slate-200'}`}>
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
            {/* Currency breakdown */}
            <tr className="border-t border-[#475569]/50">
              <td colSpan={3} />
              {months.map(mk => <td key={mk} />)}
            </tr>
            {Object.entries(currencyBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([cur, val]) => {
                const pct = grandTotal > 0 ? (val / grandTotal) * 100 : 0
                return (
                  <tr key={cur} className="text-slate-500">
                    <td className="py-0.5 pl-6 pr-2 sticky left-0 bg-[#1e293b] z-10 italic text-[10px]">{cur}</td>
                    <td className="text-right py-0.5 px-1 text-[10px]">{pct.toFixed(0)}%</td>
                    <td className="text-center py-0.5 px-1 text-[10px]">{cur === 'USD' ? '$' : cur}</td>
                    {months.map(mk => {
                      const isCurrent = mk === currentMonthKey
                      return (
                        <td key={mk} className={`text-right py-0.5 px-2 text-[10px] tabular-nums ${isCurrent ? 'bg-emerald-500/10' : ''}`}>
                          {isCurrent ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            {/* Grand total */}
            <tr className="border-t-2 border-[#475569] bg-[#0f172a]/40">
              <td className="py-3 pl-4 pr-2 sticky left-0 bg-[#0f172a]/40 z-10">
                <span className="text-white font-black text-sm">TOTAL</span>
              </td>
              <td className="text-right py-3 px-1 text-white font-bold">100%</td>
              <td className="text-center py-3 px-1 text-slate-400 font-bold">$</td>
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                return (
                  <td key={mk} className={`text-right py-3 px-2 font-black tabular-nums text-sm ${isCurrent ? 'bg-emerald-500/15 text-emerald-400' : val ? 'text-slate-300' : 'text-slate-700'}`}>
                    {val ? formatCurrency(val) : '-'}
                  </td>
                )
              })}
            </tr>

            {/* Metrics */}
            {monthlyReturn != null && (
              <tr>
                <td className="py-1 pl-6 pr-2 sticky left-0 bg-[#1e293b] z-10 text-slate-500 text-[10px]">
                  {t('Retorno Mensual', 'Monthly Return')}
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-1 px-2 text-[10px] tabular-nums ${isCurrent ? 'bg-emerald-500/10' : ''}`}>
                      {isCurrent ? (
                        <span className={monthlyReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {monthlyReturn >= 0 ? '+' : ''}{monthlyReturn.toFixed(1)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {returnYTD != null && (
              <tr>
                <td className="py-1 pl-6 pr-2 sticky left-0 bg-[#1e293b] z-10 text-slate-500 text-[10px]">
                  Return YTD
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-1 px-2 text-[10px] tabular-nums ${isCurrent ? 'bg-emerald-500/10' : ''}`}>
                      {isCurrent ? (
                        <span className={returnYTD >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {returnYTD >= 0 ? '+' : ''}{returnYTD.toFixed(2)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {janTotal && grandTotal > 0 && (
              <tr>
                <td className="py-1 pl-6 pr-2 sticky left-0 bg-[#1e293b] z-10 text-slate-500 text-[10px]">
                  {t('Crecimiento Portafolio', 'Portfolio Growth')}
                </td>
                <td />
                <td />
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                  const growth = val && janTotal > 0 ? ((val - janTotal) / janTotal) * 100 : null
                  return (
                    <td key={mk} className={`text-right py-1 px-2 text-[10px] tabular-nums ${isCurrent ? 'bg-emerald-500/10' : ''}`}>
                      {growth != null ? (
                        <span className={growth >= 0 ? 'text-emerald-400' : 'text-red-400'}>
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
