'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'

export default function DividendIncome({ transactions, lang }) {
  const stats = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
    if (divs.length === 0) return null

    const now = new Date()
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth()

    let totalAll = 0
    let totalYTD = 0
    let totalThisMonth = 0
    const byMonth = {}

    divs.forEach((tx) => {
      const amt = tx.totalAmount ?? tx.amount ?? tx.pricePerUnit ?? 0
      totalAll += amt
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
    const estAnnual = avgMonthly * 12
    const dailyAvg = totalAll / Math.max(1, divs.length > 1
      ? Math.ceil((new Date(divs[divs.length - 1].date) - new Date(divs[0].date)) / 86400000)
      : 30)

    const last6 = monthKeys.slice(-6)
    const maxBar = Math.max(...last6.map((k) => byMonth[k]), 1)

    return {
      totalAll, totalYTD, totalThisMonth, avgMonthly, estAnnual, dailyAvg,
      divCount: divs.length, byMonth, last6, maxBar,
    }
  }, [transactions])

  if (!stats) return null

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        {t('INGRESOS POR DIVIDENDOS', 'DIVIDEND INCOME')}
      </h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <span className="text-[10px] text-slate-500 block">{t('Ingreso anual estimado', 'Est. Annual Income')}</span>
          <span className="text-xl font-bold text-emerald-400">{formatCurrency(stats.estAnnual)}</span>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-500 block">YTD</span>
          <span className="text-xl font-bold text-white">{formatCurrency(stats.totalYTD)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
          <span className="text-[10px] text-slate-500">{t('Mensual', 'Monthly')}</span>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{formatCurrency(stats.totalThisMonth)}</span>
            <span className="text-[10px] text-slate-500">{t('actual', 'actual')}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400">{formatCurrency(stats.avgMonthly)}</span>
            <span className="text-[10px] text-slate-500">{t('prom.', 'avg')}</span>
          </div>
        </div>
        <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
          <span className="text-[10px] text-slate-500">{t('Diario', 'Daily')}</span>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{formatCurrency(stats.dailyAvg)}</span>
            <span className="text-[10px] text-slate-500">{t('prom.', 'avg')}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400">{stats.divCount} {t('pagos', 'payments')}</span>
          </div>
        </div>
      </div>

      {/* Mini bar chart - last 6 months */}
      {stats.last6.length > 0 && (
        <div>
          <span className="text-[10px] text-slate-500 mb-2 block">{t('Últimos meses', 'Recent months')}</span>
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
    </div>
  )
}
