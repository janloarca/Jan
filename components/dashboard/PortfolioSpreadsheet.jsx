'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { formatCurrency, getItemValue, getTypeCategory, isExcludedFromNetWorth, TYPE_COLORS } from './utils'

const CATEGORY_ORDER = ['banks', 'funds', 'stocks', 'crypto', 'alternatives', 'bonds', 'realestate', 'other', 'receivables', 'debts']
const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos Liquidos', en: 'Liquid Funds' },
  stocks: { es: 'Bolsa de Valores', en: 'Stock Market' },
  crypto: { es: 'Criptoactivos', en: 'Crypto Assets' },
  alternatives: { es: 'Deuda Privada & Alt.', en: 'Private Debt & Alt.' },
  bonds: { es: 'Bonos Corporativo', en: 'Corporate Bonds' },
  realestate: { es: 'Bienes Raices', en: 'Real Estate' },
  receivables: { es: 'Cuentas por Cobrar', en: 'Receivables' },
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
  receivables: '#06b6d4',
  debts: '#ef4444',
  other: '#64748b',
}

const DEBT_TERM_LABELS = {
  '3m': '3 meses',
  '6m': '6 meses',
  '12m': '12 meses',
  '24m': '24 meses',
  '36m': '36 meses',
  payday: 'Día de pago',
  revolving: 'Revolving',
  custom: 'Custom',
}

const REWARD_ICONS = {
  miles: '✈',
  cashback: '$',
  points: '★',
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

function getOriginalValue(item) {
  if (item._originalPrice == null) return getItemValue(item)
  const qty = Number(item.quantity) || 0
  const val = qty * item._originalPrice
  if (!isFinite(val)) return 0
  return item.isDebt ? -Math.abs(val) : val
}

function formatNum(val) {
  return Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isMarketAsset(type) {
  return /stock|crypto|fund|etf/i.test(type) && !/realestate|inmueble/i.test(type)
}

function EditableCell({ displayValue, editValue, onSave, hint, isNegative }) {
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
      <div>
        <input ref={ref} type="text" value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-full bg-white border-2 border-blue-400 rounded px-3 py-1.5 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
        {hint && <p className="text-[10px] text-blue-400 text-right mt-0.5 pr-1">{hint}</p>}
      </div>
    )
  }

  return (
    <div className="cursor-pointer rounded px-3 py-1.5 -mx-1 transition-all hover:bg-blue-100 hover:ring-1 hover:ring-blue-300 text-right"
      onClick={() => { setDraft(editValue); setEditing(true) }}>
      <span className={`font-mono tabular-nums text-sm ${isNegative ? 'text-red-600' : 'text-slate-800'}`}>{formatNum(displayValue)}</span>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

export default function PortfolioSpreadsheet({ items, snapshots, lang, onUpdateItem, onEditItem, returnYTD, netWorth, convert }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [showOriginal, setShowOriginal] = useState(false)

  const ZOOM_LEVELS = [0.75, 0.875, 1, 1.125, 1.25]
  const [zoom, setZoom] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = parseFloat(localStorage.getItem('chispudo-spreadsheet-zoom'))
      if (ZOOM_LEVELS.includes(saved)) return saved
    }
    return 1
  })
  const zoomIn = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx < ZOOM_LEVELS.length - 1) {
      const next = ZOOM_LEVELS[idx + 1]
      setZoom(next)
      localStorage.setItem('chispudo-spreadsheet-zoom', next)
    }
  }
  const zoomOut = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx > 0) {
      const next = ZOOM_LEVELS[idx - 1]
      setZoom(next)
      localStorage.setItem('chispudo-spreadsheet-zoom', next)
    }
  }

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

  const itemValue = useCallback((item) => {
    return showOriginal ? getOriginalValue(item) : getItemValue(item)
  }, [showOriginal])

  const itemCurrency = useCallback((item) => {
    if (showOriginal) return item._originalCurrency || item.currency || 'USD'
    return 'USD'
  }, [showOriginal])

  const { categories, totalAssets, totalDebt, currencyBreakdown } = useMemo(() => {
    const catMap = {}
    let totalA = 0
    let totalD = 0
    const curBreak = {}

    items.forEach(it => {
      const cat = getTypeCategory(it)
      if (!catMap[cat]) catMap[cat] = { institutions: {}, total: 0 }
      const inst = it.institution || t('Sin institucion', 'No institution')
      if (!catMap[cat].institutions[inst]) catMap[cat].institutions[inst] = []
      catMap[cat].institutions[inst].push(it)

      const val = getItemValue(it)
      catMap[cat].total += val

      if (!isExcludedFromNetWorth(it)) {
        if (val < 0) totalD += Math.abs(val)
        else totalA += val
      }

      const cur = it._originalCurrency || it.currency || 'USD'
      const isUSD = cur === 'USD' || cur === '$'
      const bucket = isUSD ? 'USD' : cur
      const origVal = getOriginalValue(it)
      curBreak[bucket] = curBreak[bucket] || { usd: 0, original: 0 }
      curBreak[bucket].usd += Math.abs(val)
      curBreak[bucket].original += Math.abs(origVal)
    })

    const ordered = CATEGORY_ORDER
      .filter(cat => catMap[cat])
      .map(cat => ({
        key: cat,
        label: CATEGORY_LABELS[cat]?.[lang] || cat,
        total: catMap[cat].total,
        excludedFromTotal: cat === 'receivables' && catMap[cat] ?
          Object.values(catMap[cat].institutions).flat().some(it => isExcludedFromNetWorth(it)) : false,
        institutions: Object.entries(catMap[cat].institutions)
          .map(([name, its]) => ({
            name,
            items: its.sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))),
            total: its.reduce((s, it) => s + getItemValue(it), 0),
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
    if (isMarketAsset(item.type)) {
      onUpdateItem(item.id, { quantity: newVal })
    } else {
      const qty = item.quantity || 1
      if (showOriginal) {
        onUpdateItem(item.id, { currentPrice: newVal / qty })
      } else {
        const cur = item._originalCurrency || item.currency || 'USD'
        const originalVal = convert ? convert(newVal, 'USD', cur) : newVal
        onUpdateItem(item.id, { currentPrice: originalVal / qty })
      }
    }
  }, [onUpdateItem, showOriginal, convert])

  const prevMonthKey = months.length >= 2 ? months[months.length - 2] : null
  const prevTotal = prevMonthKey ? monthlyTotals[prevMonthKey] : null
  const monthlyReturn = prevTotal && grandTotal > 0 ? ((grandTotal - prevTotal) / prevTotal) * 100 : null

  const janKey = `${now.getFullYear()}-01`
  const janTotal = monthlyTotals[janKey]

  return (
    <div className="bg-[#f8fafc] border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-bold text-slate-900">{t('Portfolio Spreadsheet', 'Portfolio Spreadsheet')}</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 rounded-md border border-slate-200 p-0.5">
            <button onClick={() => setShowOriginal(false)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${!showOriginal ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              USD
            </button>
            <button onClick={() => setShowOriginal(true)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${showOriginal ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {t('Original', 'Original')}
            </button>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-md border border-slate-200 p-0.5">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_LEVELS[0]}
              className="w-6 h-6 flex items-center justify-center text-xs rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              −
            </button>
            <span className="text-[10px] text-slate-400 w-8 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              className="w-6 h-6 flex items-center justify-center text-xs rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              +
            </button>
          </div>
          <span className="text-xs text-slate-400 hidden sm:inline">{t('Click para editar', 'Click to edit')}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%` }}>
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="text-left py-2.5 pl-4 pr-2 text-slate-500 font-semibold text-xs uppercase tracking-wide sticky left-0 bg-slate-50 z-20 min-w-[140px] max-w-[200px]" />
              <th className="text-right py-2.5 px-1 text-slate-400 font-semibold text-xs w-8">%</th>
              {showOriginal && <th className="text-center py-2.5 px-1 text-slate-400 font-semibold text-xs w-10">{t('Mon', 'Cur')}</th>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                return (
                  <th key={mk} className={`text-right py-2.5 px-2 font-semibold text-xs w-32 ${isCurrent ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}>
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
                      {cat.excludedFromTotal && <span className="text-[10px] text-cyan-500 ml-1">{t('(no incluido en total)', '(not in total)')}</span>}
                    </div>
                  </td>
                  <td className="text-right py-3 px-1 text-slate-500 font-semibold text-sm">{Math.abs(pct).toFixed(0)}%</td>
                  {showOriginal && <td className="text-center py-3 px-1 text-slate-400 text-xs">USD</td>}
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    if (isCurrent) {
                      return <td key={mk} className="text-right py-3 px-2 font-bold tabular-nums font-mono text-sm bg-blue-50 text-slate-900">{formatCurrency(cat.total)}</td>
                    }
                    const monthTotal = monthlyTotals[mk]
                    const catEstimate = monthTotal && grandTotal > 0 ? monthTotal * (cat.total / grandTotal) : null
                    return (
                      <td key={mk} className="text-right py-3 px-2 tabular-nums font-mono text-sm text-slate-400">
                        {catEstimate ? formatNum(catEstimate) : ''}
                      </td>
                    )
                  })}
                </tr>

                {!isCollapsed && cat.institutions.map(inst => {
                  const instKey = `${cat.key}:${inst.name}`
                  const isInstCollapsed = collapsedInst[instKey]
                  const showInst = inst.items.length > 1

                  const instCurrencies = [...new Set(inst.items.map(it => it._originalCurrency || it.currency || 'USD'))]
                  const singleCurrency = instCurrencies.length === 1 ? instCurrencies[0] : null
                  const instOrigTotal = showOriginal && singleCurrency
                    ? inst.items.reduce((s, it) => s + getOriginalValue(it), 0)
                    : null

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
                          {showOriginal && <td className="text-center py-2 px-1 text-slate-400 text-xs">
                            {singleCurrency || 'USD'}
                          </td>}
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            const displayVal = showOriginal && instOrigTotal != null ? instOrigTotal : inst.total
                            return (
                              <td key={mk} className={`text-right py-2 px-2 font-medium tabular-nums font-mono text-sm ${isCurrent ? 'bg-blue-50 text-slate-700' : 'text-slate-300'}`}>
                                {isCurrent ? formatNum(displayVal) : ''}
                              </td>
                            )
                          })}
                        </tr>
                      )}

                      {(!showInst || !isInstCollapsed) && inst.items.map((item, idx) => {
                        const val = itemValue(item)
                        const cur = itemCurrency(item)
                        const market = isMarketAsset(item.type)
                        const qty = item.quantity || 0
                        const qtyLabel = market && qty ? qty.toLocaleString(undefined, { maximumFractionDigits: 4 }) : null
                        const editVal = market ? qty.toFixed(4).replace(/\.?0+$/, '') : Math.abs(val).toFixed(2)
                        const editHint = market
                          ? (item.symbol || item.name || '')
                          : null
                        return (
                          <Fragment key={item.id || idx}>
                          <tr className="hover:bg-slate-50 transition-colors bg-white border-t border-slate-100/60">
                            <td className={`py-2.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 bg-white z-10`}>
                              <div className="flex items-center gap-2 min-w-0">
                                {onEditItem ? (
                                  <button className="text-slate-800 text-sm truncate text-left hover:text-blue-600 hover:underline transition-colors" onClick={(e) => { e.stopPropagation(); onEditItem(item) }}>
                                    {item.name || item.symbol}
                                  </button>
                                ) : (
                                  <span className="text-slate-800 text-sm truncate">{item.name || item.symbol}</span>
                                )}
                                {qtyLabel && (
                                  <span className="text-slate-400 text-xs shrink-0">{qtyLabel}</span>
                                )}
                                {item.rewardType && REWARD_ICONS[item.rewardType] && (
                                  <span className="text-[10px] bg-cyan-50 text-cyan-600 px-1 rounded shrink-0" title={item.rewardType}>
                                    {REWARD_ICONS[item.rewardType]}
                                  </span>
                                )}
                                {item.isReceivable && !item.countInNetWorth && (
                                  <span className="text-[9px] text-cyan-400 shrink-0">*</span>
                                )}
                              </div>
                            </td>
                            <td />
                            {showOriginal && <td className="text-center py-2.5 px-1 text-slate-400 text-xs">{cur}</td>}
                            {months.map(mk => {
                              const isCurrent = mk === currentMonthKey
                              if (!isCurrent) {
                                return <td key={mk} className="text-right py-2.5 px-2 text-slate-300 tabular-nums font-mono text-sm">—</td>
                              }
                              return (
                                <td key={mk} className="text-right py-1 px-1 bg-blue-50">
                                  {onUpdateItem ? (
                                    <EditableCell
                                      displayValue={val}
                                      editValue={editVal}
                                      onSave={(v) => handleValueUpdate(item, v)}
                                      hint={editHint}
                                      isNegative={val < 0}
                                    />
                                  ) : (
                                    <span className={`font-mono tabular-nums text-sm font-medium ${val < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                      {formatNum(val)}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                          {(item.isDebt || item.isReceivable) && (item.debtTerm || item.interestRate || item.monthlyPayment || item.installmentsRemaining) && (
                            <tr className="bg-slate-50/50 border-t-0">
                              <td className={`py-0.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 bg-slate-50/50 z-10`} colSpan={2 + (showOriginal ? 1 : 0) + months.length}>
                                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                  {item.debtTerm && <span>{DEBT_TERM_LABELS[item.debtTerm] || item.debtTerm}</span>}
                                  {item.interestRate > 0 && <span>{item.interestRate}% {t('int.', 'int.')}</span>}
                                  {item.monthlyPayment > 0 && <span>${item.monthlyPayment.toLocaleString()}/{t('mes', 'mo')}</span>}
                                  {item.installmentsRemaining > 0 && (
                                    <span>{item.installmentsRemaining} {t('cuotas rest.', 'pmts left')}</span>
                                  )}
                                  {item.maturityDate && <span>{t('Vence', 'Due')}: {item.maturityDate}</span>}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
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
              .sort((a, b) => b[1].usd - a[1].usd)
              .map(([cur, data]) => {
                const pct = grandTotal > 0 ? (data.usd / grandTotal) * 100 : 0
                const displayVal = showOriginal ? data.original : data.usd
                const rate = data.original > 0 && cur !== 'USD' ? (data.usd / data.original) : null
                return (
                  <tr key={cur} className="text-slate-400 border-t border-slate-100 bg-white">
                    <td className="py-1.5 pl-8 pr-2 sticky left-0 bg-white z-10 text-xs">
                      {cur}
                      {showOriginal && rate != null && (
                        <span className="text-slate-300 ml-1.5">1 {cur} = {rate.toFixed(4)} USD</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 text-xs">{pct.toFixed(0)}%</td>
                    {showOriginal && <td className="text-center py-1.5 px-1 text-xs">{cur}</td>}
                    {months.map(mk => {
                      const isCurrent = mk === currentMonthKey
                      return (
                        <td key={mk} className={`text-right py-1.5 px-2 text-xs tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
                          {isCurrent ? formatNum(displayVal) : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            <tr className="border-t-2 border-slate-300 bg-slate-100">
              <td className="py-3.5 pl-4 pr-2 sticky left-0 bg-slate-100 z-10">
                <span className="text-slate-900 font-black text-base">TOTAL</span>
                {showOriginal && (
                  <span className="text-slate-400 text-xs ml-2 font-normal">(USD)</span>
                )}
              </td>
              <td className="text-right py-3.5 px-1 text-slate-700 font-bold text-sm">100%</td>
              {showOriginal && <td className="text-center py-3.5 px-1 text-slate-500 font-bold text-xs">USD</td>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                return (
                  <td key={mk} className={`text-right py-3.5 px-2 font-black tabular-nums font-mono text-base ${isCurrent ? 'bg-blue-50 text-slate-900' : val ? 'text-slate-600' : 'text-slate-300'}`}>
                    {val ? formatCurrency(val) : '—'}
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
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-2 px-2 text-sm tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
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
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className={`text-right py-2 px-2 text-sm tabular-nums font-mono ${isCurrent ? 'bg-blue-50' : ''}`}>
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
    </div>
  )
}
