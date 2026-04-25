'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory } from './utils'

export default function DividendIncome({ transactions, items, convert, baseCurrency, lang, netWorth }) {
  const projected = useMemo(() => {
    if (!items || items.length === 0) return { annualTotal: 0, sources: [], upcoming: [] }

    const now = new Date()
    const currentMonth = now.getMonth()
    const sources = []

    items.forEach((it) => {
      const sym = it.symbol || it.name || ''
      const cur = it.currency || it._originalCurrency || 'USD'
      const qty = it.quantity || 1
      const price = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      let annual = 0

      if (it.incomeAmount > 0 && it.incomeMonths) {
        const payCount = Array.isArray(it.incomeMonths) ? it.incomeMonths.length : 12
        annual = it.incomeAmount * payCount
      } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
        annual = balance * (it.incomeRate / 100)
      } else if (it.dividendYield > 0) {
        annual = balance * (it.dividendYield / 100)
      } else {
        return
      }

      if (annual <= 0) return

      const converted = convert ? convert(annual, cur, baseCurrency || 'USD') : annual
      const months = Array.isArray(it.incomeMonths) ? it.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
      const payDay = it.incomePayDay || 1

      const cat = getTypeCategory(it.type)
      const incomeType = cat === 'bonds' ? 'coupon' : cat === 'banks' ? 'interest' : 'dividend'
      sources.push({ symbol: sym, annual: converted, months, payDay, currency: cur, incomeType })
    })

    const upcoming = []
    sources.forEach((s) => {
      const perPayment = s.annual / (s.months.length || 12)
      for (let offset = 0; offset < 3; offset++) {
        const m = (currentMonth + offset) % 12
        if (s.months.includes(m)) {
          const y = now.getFullYear() + (currentMonth + offset >= 12 ? 1 : 0)
          upcoming.push({ symbol: s.symbol, amount: perPayment, month: m, year: y, day: s.payDay })
        }
      }
    })
    upcoming.sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month) || a.day - b.day)

    const annualTotal = sources.reduce((s, x) => s + x.annual, 0)
    return { annualTotal, sources: sources.sort((a, b) => b.annual - a.annual), upcoming: upcoming.slice(0, 6) }
  }, [items, convert, baseCurrency])

  const stats = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')

    const now = new Date()
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth()

    let totalAll = 0
    let totalYTD = 0
    let totalThisMonth = 0
    const byMonth = {}
    const bySymbol = {}

    divs.forEach((tx) => {
      const rawAmt = tx.totalAmount ?? 0
      const amt = convert ? convert(rawAmt, tx.currency || 'USD', baseCurrency || 'USD') : rawAmt
      totalAll += amt
      const sym = tx.symbol || tx.description || 'Other'
      bySymbol[sym] = (bySymbol[sym] || 0) + amt
      const d = tx.date ? new Date(tx.date) : null
      if (d) {
        const y = d.getFullYear()
        const m = d.getMonth()
        const key = `${y}-${String(m).padStart(2, '0')}`
        byMonth[key] = (byMonth[key] || 0) + amt
        if (y === thisYear) totalYTD += amt
        if (y === thisYear && m === thisMonth) totalThisMonth += amt
      }
    })

    const monthKeys = Object.keys(byMonth).sort()
    const avgMonthly = monthKeys.length > 0 ? totalAll / monthKeys.length : 0
    let daySpan = 30
    if (divs.length > 1) {
      const first = new Date(divs[0].date).getTime()
      const last = new Date(divs[divs.length - 1].date).getTime()
      if (!isNaN(first) && !isNaN(last) && last > first) daySpan = Math.ceil((last - first) / 86400000)
    }
    const dailyAvg = totalAll / Math.max(1, daySpan)

    const last6 = monthKeys.slice(-6)
    const maxBar = Math.max(...last6.map((k) => byMonth[k]), 1)

    const topPayers = Object.entries(bySymbol)
      .map(([symbol, total]) => ({ symbol, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    return {
      totalAll, totalYTD, totalThisMonth, avgMonthly, dailyAvg,
      divCount: divs.length, byMonth, last6, maxBar, topPayers,
    }
  }, [transactions, convert, baseCurrency])

  const estAnnual = projected.annualTotal > 0 ? projected.annualTotal : (stats.avgMonthly * 12)
  const portfolioYield = netWorth > 0 && estAnnual > 0 ? (estAnnual / netWorth) * 100 : 0

  const incomeByType = useMemo(() => {
    const types = { dividend: 0, coupon: 0, interest: 0 }
    projected.sources.forEach((s) => {
      types[s.incomeType || 'dividend'] = (types[s.incomeType || 'dividend'] || 0) + s.annual
    })
    return Object.entries(types).filter(([, v]) => v > 0).map(([type, annual]) => ({
      type,
      annual,
      label: type === 'dividend' ? 'Dividendos' : type === 'coupon' ? 'Cupones' : 'Intereses',
      labelEn: type === 'dividend' ? 'Dividends' : type === 'coupon' ? 'Coupons' : 'Interest',
    }))
  }, [projected.sources])

  const incomeCalendar = useMemo(() => {
    const monthTotals = Array(12).fill(0)
    projected.sources.forEach((s) => {
      const perPayment = s.annual / (s.months.length || 12)
      s.months.forEach((m) => { monthTotals[m] += perPayment })
    })
    return monthTotals
  }, [projected.sources])

  const hasData = stats.divCount > 0 || projected.annualTotal > 0
  if (!hasData) return null

  const t = (es, en) => lang === 'es' ? es : en
  const monthName = (m) => new Date(2024, m).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  const calendarMax = Math.max(...incomeCalendar, 1)

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        {t('INGRESOS PASIVOS', 'PASSIVE INCOME')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <span className="text-[10px] text-slate-500 block">{t('Ingreso anual est.', 'Est. Annual Income')}</span>
          <span className="text-lg font-bold text-emerald-400">{formatCurrency(estAnnual)}</span>
        </div>
        <div className="text-center">
          <span className="text-[10px] text-slate-500 block">Yield</span>
          <span className="text-lg font-bold text-cyan-400">{portfolioYield.toFixed(2)}%</span>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-500 block">YTD {t('recibido', 'received')}</span>
          <span className="text-lg font-bold text-white">{formatCurrency(stats.totalYTD)}</span>
        </div>
      </div>

      {incomeByType.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          {incomeByType.map((bt) => (
            <div key={bt.type} className="flex-1 bg-[#0b1120] rounded-lg p-2 border border-[#1e2d45]/50 text-center">
              <span className="text-[9px] text-slate-500 block">{lang === 'es' ? bt.label : bt.labelEn}</span>
              <span className="text-[11px] font-semibold text-white">{formatCurrency(bt.annual)}/yr</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
          <span className="text-[10px] text-slate-500">{t('Mensual est.', 'Monthly est.')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(estAnnual / 12)}</span>
        </div>
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
          <span className="text-[10px] text-slate-500">{t('Este mes', 'This month')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(stats.totalThisMonth)}</span>
        </div>
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
          <span className="text-[10px] text-slate-500">{t('Pagos', 'Payments')}</span>
          <span className="text-sm font-semibold text-white block">{stats.divCount}</span>
        </div>
      </div>

      {/* Upcoming payments */}
      {projected.upcoming.length > 0 && (
        <div className="mb-4">
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Próximos pagos esperados', 'Upcoming expected payments')}</span>
          <div className="space-y-1">
            {projected.upcoming.map((u, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-[#0b1120]/60">
                <span className="text-slate-400 font-medium w-16 truncate">{u.symbol}</span>
                <span className="text-slate-500">{monthName(u.month)} {u.day}</span>
                <span className="text-emerald-400 font-medium">{formatCurrency(u.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mini bar chart - last 6 months */}
      {stats.last6.length > 0 && (
        <div className="mb-4">
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Historial reciente', 'Recent history')}</span>
          <div className="flex items-end gap-1.5 h-16">
            {stats.last6.map((key) => {
              const val = stats.byMonth[key]
              const h = (val / stats.maxBar) * 100
              const [y, m] = key.split('-')
              const monthLabel = new Date(parseInt(y), parseInt(m)).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
              return (
                <div key={key} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[8px] text-emerald-400">{formatCurrency(val)}</span>
                  <div className="w-full bg-emerald-500/30 rounded-t" style={{ height: `${Math.max(h, 8)}%` }}>
                    <div className="w-full h-full bg-emerald-500/60 rounded-t" />
                  </div>
                  <span className="text-[8px] text-slate-500">{monthLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top income sources - from items data + transaction history */}
      {projected.sources.length > 0 && (
        <div>
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Fuentes de ingreso', 'Income sources')}</span>
          <div className="space-y-1.5">
            {projected.sources.slice(0, 5).map((s) => {
              const pct = estAnnual > 0 ? (s.annual / estAnnual) * 100 : 0
              return (
                <div key={s.symbol} className="flex items-center gap-2">
                  <span className="text-[11px] text-white font-medium w-16 truncate">{s.symbol}</span>
                  <div className="flex-1 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-400 w-20 text-right">{formatCurrency(s.annual)}/yr</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 12-month income calendar */}
      {projected.sources.length > 0 && (
        <div className="mb-4">
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Calendario de ingresos', 'Income calendar')}</span>
          <div className="grid grid-cols-6 gap-1">
            {incomeCalendar.map((amt, m) => {
              const intensity = calendarMax > 0 ? amt / calendarMax : 0
              return (
                <div key={m} className="text-center p-1.5 rounded" style={{
                  backgroundColor: amt > 0 ? `rgba(16, 185, 129, ${0.1 + intensity * 0.3})` : 'rgba(30, 45, 69, 0.3)',
                }}>
                  <span className="text-[8px] text-slate-500 block">{monthName(m)}</span>
                  <span className={`text-[9px] font-medium ${amt > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {amt > 0 ? formatCurrency(amt) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Fallback: top payers from transactions if no projected sources */}
      {projected.sources.length === 0 && stats.topPayers && stats.topPayers.length > 0 && (
        <div>
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Mayores pagadores', 'Top payers')}</span>
          <div className="space-y-1.5">
            {stats.topPayers.map((p) => {
              const pct = stats.totalAll > 0 ? (p.total / stats.totalAll) * 100 : 0
              return (
                <div key={p.symbol} className="flex items-center gap-2">
                  <span className="text-[11px] text-white font-medium w-16 truncate">{p.symbol}</span>
                  <div className="flex-1 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-400 w-16 text-right">{formatCurrency(p.total)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
