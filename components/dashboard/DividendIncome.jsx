'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory, projectItemAnnualIncome } from './utils'

export default function DividendIncome({ transactions, items, convert, baseCurrency, lang, totalAssets }) {
  const t = (es, en) => lang === 'es' ? es : en

  const projected = useMemo(() => {
    if (!items || items.length === 0) return { annualTotal: 0, sources: [], upcoming: [] }

    const now = new Date()
    const currentMonth = now.getMonth()
    const sources = []

    items.forEach((it) => {
      const sym = it.symbol || it.name || ''
      const cur = it._originalCurrency || it.currency || 'USD'
      const qty = it.quantity || 1
      const price = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      const annual = projectItemAnnualIncome(it, balance)
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
    // Exclude reinvested dividends — same filter as the dashboard's annualDividends,
    // so "YTD recibido" here matches the headline figure.
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND' && !tx._reinvested)

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
    // Average over elapsed calendar months since the first payment, not over the
    // count of months that happened to have a payment — otherwise one dividend in
    // one month projects a full year of income (avgMonthly × 12).
    let avgMonthly = 0
    if (monthKeys.length > 0) {
      const [fy, fm] = monthKeys[0].split('-').map(Number)
      const elapsedMonths = (thisYear - fy) * 12 + (thisMonth - fm) + 1
      avgMonthly = totalAll / Math.max(elapsedMonths, monthKeys.length)
    }
    let daySpan = 30
    if (divs.length > 1) {
      const first = new Date(divs[0].date).getTime()
      const last = new Date(divs[divs.length - 1].date).getTime()
      if (!isNaN(first) && !isNaN(last) && last > first) daySpan = Math.ceil((last - first) / 86400000)
    }
    const dailyAvg = totalAll / Math.max(1, daySpan)

    const last6 = monthKeys.slice(-6)
    const maxBar = Math.max(...last6.map((k) => byMonth[k]), 1)

    // Trailing 12 months (oldest → newest) for the history bar chart. Months
    // with no payment stay at 0 so they render as a flat gray bar.
    const monthly12 = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      monthly12.push({ key, month: d.getMonth(), value: byMonth[key] || 0 })
    }
    const maxBar12 = Math.max(...monthly12.map((b) => b.value), 1)

    const topPayers = Object.entries(bySymbol)
      .map(([symbol, total]) => ({ symbol, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    return {
      totalAll, totalYTD, totalThisMonth, avgMonthly, dailyAvg,
      divCount: divs.length, byMonth, last6, maxBar, topPayers, monthly12, maxBar12,
    }
  }, [transactions, convert, baseCurrency])

  const estAnnual = projected.annualTotal > 0 ? projected.annualTotal : (stats.avgMonthly * 12)
  // Yield over total assets — dividing by net worth (assets − debt) would inflate
  // the yield for anyone with debt.
  const portfolioYield = totalAssets > 0 && estAnnual > 0 ? (estAnnual / totalAssets) * 100 : 0

  const yoyComparison = useMemo(() => {
    if (!transactions || transactions.length === 0) return null
    const divs = transactions.filter(tx => (tx.type || '').toUpperCase() === 'DIVIDEND' && !tx._reinvested)
    if (divs.length === 0) return null
    const now = new Date()
    const thisYear = now.getFullYear()
    const lastYear = thisYear - 1
    let thisYearTotal = 0, lastYearTotal = 0
    divs.forEach(tx => {
      const d = tx.date ? new Date(tx.date) : null
      if (!d) return
      const amt = convert ? convert(tx.totalAmount ?? 0, tx.currency || 'USD', baseCurrency || 'USD') : (tx.totalAmount ?? 0)
      if (d.getFullYear() === thisYear) thisYearTotal += amt
      if (d.getFullYear() === lastYear) lastYearTotal += amt
    })
    if (lastYearTotal === 0 && thisYearTotal === 0) return null
    const growth = lastYearTotal > 0 ? ((thisYearTotal - lastYearTotal) / lastYearTotal) * 100 : null
    return { thisYear: thisYearTotal, lastYear: lastYearTotal, growth }
  }, [transactions, convert, baseCurrency])

  const incomeByType = useMemo(() => {
    const types = { dividend: 0, coupon: 0, interest: 0 }
    projected.sources.forEach((s) => {
      types[s.incomeType || 'dividend'] = (types[s.incomeType || 'dividend'] || 0) + s.annual
    })
    return Object.entries(types).filter(([, v]) => v > 0).map(([type, annual]) => ({
      type,
      annual,
      label: type === 'dividend' ? t('Dividendos', 'Dividends') : type === 'coupon' ? t('Cupones', 'Coupons') : t('Intereses', 'Interest'),
    }))
  }, [projected.sources, lang])

  const incomeByCurrency = useMemo(() => {
    const byCur = {}
    projected.sources.forEach((s) => {
      const cur = s.currency || 'USD'
      if (!byCur[cur]) byCur[cur] = { original: 0, converted: 0 }
      const originalAnnual = s.annual
      const ratio = convert ? convert(1, baseCurrency || 'USD', cur) : 1
      byCur[cur].original += ratio > 0 ? originalAnnual * ratio : originalAnnual
      byCur[cur].converted += originalAnnual
    })
    return Object.entries(byCur)
      .map(([currency, data]) => ({ currency, ...data }))
      .filter(c => c.converted > 0)
      .sort((a, b) => b.converted - a.converted)
  }, [projected.sources, convert, baseCurrency])

  const incomeCalendar = useMemo(() => {
    const monthTotals = Array(12).fill(0)
    projected.sources.forEach((s) => {
      const perPayment = s.annual / (s.months.length || 12)
      s.months.forEach((m) => { monthTotals[m] += perPayment })
    })
    return monthTotals
  }, [projected.sources])

  const hasData = stats.divCount > 0 || projected.annualTotal > 0
  // This card lives inside the collapsible "Ingresos" section — returning null
  // left an expandable header that opened to nothing. Show guidance instead.
  if (!hasData) {
    return (
      <div className="bg-theme-surface/80 rounded-xl border border-glass-border/50 p-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('INGRESOS PASIVOS', 'PASSIVE INCOME')}
        </h3>
        <p className="text-sm text-slate-500">
          {t('Aún no hay ingresos que mostrar. Configura la tasa o el monto de ingreso de un activo (bono, cuenta, acción con dividendos) al editarlo, o registra un dividendo recibido — aquí verás la proyección anual, el calendario y el historial.',
             'No income to show yet. Set an income rate or amount on an asset (bond, account, dividend stock) when editing it, or record a received dividend — you\'ll see the annual projection, calendar and history here.')}
        </p>
      </div>
    )
  }

  const monthName = (m) => new Date(2024, m).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  const calendarMax = Math.max(...incomeCalendar, 1)

  return (
    <div className="bg-theme-surface/80 rounded-xl border border-glass-border/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('INGRESOS PASIVOS', 'PASSIVE INCOME')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <span className="text-xs text-slate-500 block">{t('Ingreso anual est.', 'Est. Annual Income')}</span>
          <span className="text-lg font-bold font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>{formatCurrency(estAnnual)}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 block">{t('Rendimiento', 'Yield')}</span>
          <span className="text-lg font-bold font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{portfolioYield.toFixed(2)}%</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">YTD {t('recibido', 'received')}</span>
          <span className="text-lg font-bold text-white font-mono tabular-nums">{formatCurrency(stats.totalYTD)}</span>
        </div>
      </div>

      {yoyComparison && yoyComparison.lastYear > 0 && (() => {
        const ly = yoyComparison.lastYear
        const ty = yoyComparison.thisYear
        const total = ly + ty
        const leftPct = total > 0 ? (ly / total) * 100 : 50
        const rightPct = total > 0 ? (ty / total) * 100 : 50
        const up = (yoyComparison.growth ?? 0) >= 0
        return (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-500">{new Date().getFullYear() - 1}</span>
              <span className="text-xs text-slate-500">{new Date().getFullYear()} YTD</span>
            </div>
            <div className="relative flex items-center w-full rounded-full overflow-hidden" style={{ height: '24px' }}>
              <div className="h-full flex items-center px-2.5" style={{ width: `${leftPct}%`, backgroundColor: 'var(--bg-tertiary)' }}>
                <span className="text-xs font-medium font-mono tabular-nums truncate" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(ly)}</span>
              </div>
              <div className="h-full flex items-center justify-end px-2.5" style={{ width: `${rightPct}%`, backgroundColor: 'var(--accent-green)' }}>
                <span className="text-xs font-semibold font-mono tabular-nums truncate text-white">{formatCurrency(ty)}</span>
              </div>
              {yoyComparison.growth != null && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ color: up ? 'var(--alert-success-icon)' : 'var(--alert-error-icon)', backgroundColor: up ? 'var(--alert-success-bg)' : 'var(--alert-error-bg)', border: '1px solid var(--card-border)' }}>
                  {up ? '▲' : '▼'} {up ? '+' : ''}{yoyComparison.growth.toFixed(0)}% YoY
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {incomeByType.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          {incomeByType.map((bt) => (
            <div key={bt.type} className="flex-1 bg-theme-base rounded-lg p-2 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">{bt.label}</span>
              <span className="text-xs font-semibold text-white">{formatCurrency(bt.annual)}/yr</span>
            </div>
          ))}
        </div>
      )}

      {incomeByCurrency.length > 1 && (
        <div className="mb-3 p-2.5 bg-theme-base rounded-lg border border-glass-border/50">
          <span className="text-xs text-slate-500 mb-1.5 block">{t('Ingreso por moneda', 'Income by currency')}</span>
          <div className="space-y-1">
            {incomeByCurrency.map((c) => (
              <div key={c.currency} className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">{c.currency}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{formatCurrency(c.original, c.currency)}/yr</span>
                  {c.currency !== (baseCurrency || 'USD') && (
                    <span className="text-xs text-slate-500">= {formatCurrency(c.converted)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Mensual est.', 'Monthly est.')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(estAnnual / 12)}</span>
        </div>
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Este mes', 'This month')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(stats.totalThisMonth)}</span>
        </div>
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Pagos', 'Payments')}</span>
          <span className="text-sm font-semibold text-white block">{stats.divCount}</span>
        </div>
      </div>

      {/* Upcoming payments */}
      {projected.upcoming.length > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Próximos pagos esperados', 'Upcoming expected payments')}</span>
          <div className="space-y-1">
            {projected.upcoming.map((u, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-theme-base/60">
                <span className="text-slate-400 font-medium w-16 truncate">{u.symbol}</span>
                <span className="text-slate-500">{monthName(u.month)} {u.day}</span>
                <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{formatCurrency(u.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mini bar chart - trailing 12 months */}
      {stats.divCount > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Historial (12 meses)', 'History (12 months)')}</span>
          <div className="flex items-end gap-1 h-16">
            {stats.monthly12.map((b) => {
              const paid = b.value > 0
              const h = paid ? (b.value / stats.maxBar12) * 100 : 0
              return (
                <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  {paid && (
                    <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 px-2 py-1 rounded text-xs font-mono tabular-nums whitespace-nowrap"
                      style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
                      {formatCurrency(b.value)}
                    </div>
                  )}
                  <div className="w-full rounded-t" style={{ height: paid ? `${Math.max(h, 6)}%` : '4px', backgroundColor: paid ? 'var(--accent-green)' : 'var(--bg-tertiary)' }} />
                  <span className="text-[10px] text-slate-500 mt-1">{monthName(b.month)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top income sources - from items data + transaction history */}
      {projected.sources.length > 0 && (
        <div>
          <span className="text-xs text-slate-500 mb-2 block">{t('Fuentes de ingreso', 'Income sources')}</span>
          <div className="space-y-1.5">
            {projected.sources.slice(0, 5).map((s) => {
              const pct = estAnnual > 0 ? (s.annual / estAnnual) * 100 : 0
              return (
                <div key={s.symbol} className="flex items-center gap-2">
                  <span className="text-xs text-white font-medium w-16 truncate">{s.symbol}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--accent-green)' }} />
                  </div>
                  <span className="text-xs text-slate-400 w-20 text-right">{formatCurrency(s.annual)}/yr</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 12-month income calendar */}
      {projected.sources.length > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Calendario de ingresos', 'Income calendar')}</span>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
            {incomeCalendar.map((amt, m) => {
              const paid = amt > 0
              return (
                <div key={m} className="text-center p-1.5 rounded-lg border transition-transform hover:scale-[1.03]" style={paid
                  ? { backgroundColor: 'var(--alert-success-bg)', borderColor: 'var(--alert-success-border)' }
                  : { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: 'var(--card-border)' }}>
                  <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{monthName(m)}</span>
                  <span className="text-xs font-semibold" style={{ color: paid ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {paid ? formatCurrency(amt) : '—'}
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
          <span className="text-xs text-slate-500 mb-2 block">{t('Mayores pagadores', 'Top payers')}</span>
          <div className="space-y-1.5">
            {stats.topPayers.map((p) => {
              const pct = stats.totalAll > 0 ? (p.total / stats.totalAll) * 100 : 0
              return (
                <div key={p.symbol} className="flex items-center gap-2">
                  <span className="text-xs text-white font-medium w-16 truncate">{p.symbol}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--accent-green)' }} />
                  </div>
                  <span className="text-xs text-slate-400 w-16 text-right">{formatCurrency(p.total)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
