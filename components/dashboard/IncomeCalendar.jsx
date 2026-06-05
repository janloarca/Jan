'use client'

import { useMemo } from 'react'
import { formatCurrency, getItemPrice } from './utils'

const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export default function IncomeCalendar({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const monthNames = lang === 'es' ? MONTH_NAMES_ES : MONTH_NAMES_EN

  const calendar = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, items: [], total: 0 }))

    ;(items || []).forEach((it) => {
      if (it.isDebt || !it.incomeMonths?.length) return

      const originalPrice = it._originalPrice || getItemPrice(it)
      const balance = (it.quantity || 1) * originalPrice
      let rate = 0
      if (it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) {
        rate = (it.rateMin + it.rateMax) / 2
      } else if (it.incomeRate > 0) {
        rate = it.incomeRate
      } else if (it.dividendYield > 0) {
        rate = it.dividendYield
      }

      const freq = it.incomeMonths.length
      let paymentAmt = 0
      if (it.incomeAmount > 0) {
        const isPerShare = /stock|etf|fund|crypto/i.test(it.type || '')
        paymentAmt = isPerShare ? it.incomeAmount * (it.quantity || 1) : it.incomeAmount
      } else if (freq > 0 && rate > 0) {
        paymentAmt = (balance * (rate / 100)) / freq
      }

      if (paymentAmt <= 0) return

      it.incomeMonths.forEach((m) => {
        if (m >= 0 && m < 12) {
          months[m].items.push({
            name: it.name || it.symbol,
            symbol: it.symbol,
            amount: paymentAmt,
            currency: it._originalCurrency || it.currency || 'USD',
          })
          months[m].total += paymentAmt
        }
      })
    })

    return months
  }, [items])

  const annualTotal = calendar.reduce((s, m) => s + m.total, 0)
  const maxMonthly = Math.max(...calendar.map((m) => m.total), 1)

  if (annualTotal <= 0) return null

  return (
    <div className="bg-[#1C1C1E]/80 rounded-xl border border-[#38383A]/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          {t('CALENDARIO DE INGRESOS', 'INCOME CALENDAR')}
        </h3>
        <span className="text-xs text-emerald-400 font-medium">{formatCurrency(annualTotal)}/yr</span>
      </div>

      {/* Monthly grid */}
      <div className="grid grid-cols-6 gap-1.5 mb-3">
        {calendar.map((m, i) => {
          const now = new Date()
          const isCurrent = i === now.getMonth()
          const isPast = i < now.getMonth()
          const barH = maxMonthly > 0 ? Math.max(4, (m.total / maxMonthly) * 32) : 0

          const intensity = maxMonthly > 0 ? m.total / maxMonthly : 0
          const barColor = m.total <= 0 ? 'bg-slate-700/30'
            : intensity > 0.75 ? 'bg-emerald-400'
            : intensity > 0.5  ? 'bg-emerald-500'
            : intensity > 0.25 ? 'bg-emerald-600'
            : 'bg-emerald-700'

          return (
            <div key={i} className={`text-center p-1.5 rounded-lg transition-colors ${
              isCurrent ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-[#000000] border border-[#38383A]/20'
            }`}>
              <div className="text-xs text-slate-500 mb-1">{monthNames[i]}</div>
              <div className="flex justify-center items-end h-8 mb-1">
                {m.total > 0 ? (
                  <div className={`w-3 rounded-t transition-all ${isPast ? barColor + '/60' : barColor}`}
                    style={{ height: `${barH}px` }} />
                ) : (
                  <div className="w-3 h-1 bg-slate-700/30 rounded" />
                )}
              </div>
              <div className={`text-xs font-medium ${m.total > 0 ? (isPast ? 'text-slate-500' : 'text-emerald-400') : 'text-slate-700'}`}>
                {m.total > 0 ? formatCurrency(m.total) : '-'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Monthly details for current + next months */}
      {(() => {
        const currentMonth = new Date().getMonth()
        const upcoming = calendar
          .map((m, i) => ({ ...m, idx: i }))
          .filter((m) => m.idx >= currentMonth && m.total > 0)
          .slice(0, 2)

        if (upcoming.length === 0) return null
        return (
          <div className="space-y-2 pt-2 border-t border-[#38383A]/30">
            {upcoming.map((m) => (
              <div key={m.idx}>
                <div className="text-xs text-slate-400 font-medium mb-1">{monthNames[m.idx]}</div>
                {m.items.map((item, j) => (
                  <div key={j} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-slate-500 truncate">{item.name}</span>
                    <span className="text-emerald-400 font-medium shrink-0 ml-2">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
