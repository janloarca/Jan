'use client'

import { useMemo } from 'react'
import { formatCurrency, getItemPrice } from './utils'

export default function MaturityCalendar({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const events = useMemo(() => {
    const now = new Date()
    const result = []

    ;(items || []).forEach((it) => {
      if (it.maturityDate) {
        const md = new Date(it.maturityDate)
        if (md > now) {
          const days = Math.ceil((md - now) / 86400000)
          const value = (it.quantity || 1) * getItemPrice(it)
          result.push({
            type: 'maturity',
            date: typeof it.maturityDate === 'string' ? it.maturityDate : new Date(it.maturityDate?.seconds ? it.maturityDate.seconds * 1000 : it.maturityDate).toLocaleDateString(),
            days,
            name: it.name || it.symbol,
            symbol: it.symbol,
            value,
            action: it.maturityAction || 'return_capital',
            item: it,
          })
        }
      }

      if (it.incomeMonths?.length > 0 && !it.isDebt) {
        const payDay = it.incomePayDay || 15
        const balance = (it.quantity || 1) * getItemPrice(it)
        const rate = it.rateType === 'variable' && it.rateMin > 0
          ? (it.rateMin + it.rateMax) / 2
          : it.incomeRate || it.dividendYield || 0

        if (rate > 0 || it.incomeAmount > 0) {
          const freq = it.incomeMonths.length
          const paymentAmt = it.incomeAmount
            ? it.incomeAmount * (it.quantity || 1)
            : (balance * (rate / 100)) / freq

          for (let m = 0; m < 12; m++) {
            const futureDate = new Date(now.getFullYear(), now.getMonth() + m, payDay)
            if (futureDate <= now) continue
            const monthNum = futureDate.getMonth() + 1
            if (it.incomeMonths.includes(monthNum)) {
              result.push({
                type: 'payment',
                date: futureDate.toISOString().split('T')[0],
                days: Math.ceil((futureDate - now) / 86400000),
                name: it.name || it.symbol,
                symbol: it.symbol,
                value: paymentAmt,
                item: it,
              })
            }
          }
        }
      }
    })

    return result.sort((a, b) => a.days - b.days).slice(0, 15)
  }, [items])

  if (events.length === 0) return null

  const maturities = events.filter((e) => e.type === 'maturity')
  const payments = events.filter((e) => e.type === 'payment')
  const totalMaturingValue = maturities.reduce((s, e) => s + e.value, 0)
  const totalUpcomingPayments = payments.reduce((s, e) => s + e.value, 0)

  function getDayColor(days) {
    if (days <= 90) return 'text-red-400 bg-red-500/10 border-red-500/20'
    if (days <= 365) return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
  }

  function formatDays(days) {
    if (days <= 30) return `${days}d`
    if (days <= 365) return `${Math.round(days / 30)}mo`
    return `${(days / 365).toFixed(1)}yr`
  }

  return (
    <div className="bg-[#1C1C1E]/80 rounded-xl border border-[#38383A]/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        {t('CALENDARIO', 'CALENDAR')}
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {maturities.length > 0 && (
          <div>
            <span className="text-xs text-slate-500 block">{t('Vencimientos', 'Maturities')}</span>
            <span className="text-sm font-bold text-amber-400">{formatCurrency(totalMaturingValue)}</span>
            <span className="text-xs text-slate-600 block">{maturities.length} {t('instrumento(s)', 'instrument(s)')}</span>
          </div>
        )}
        {payments.length > 0 && (
          <div className={maturities.length > 0 ? 'text-right' : ''}>
            <span className="text-xs text-slate-500 block">{t('Pagos próximos', 'Upcoming payments')}</span>
            <span className="text-sm font-bold text-emerald-400">{formatCurrency(totalUpcomingPayments)}</span>
            <span className="text-xs text-slate-600 block">{payments.length} {t('pago(s)', 'payment(s)')}</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {events.slice(0, 8).map((ev, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-[#000000] rounded-lg border border-[#38383A]/30">
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded border shrink-0 ${getDayColor(ev.days)}`}>
              {formatDays(ev.days)}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-xs text-white truncate block">{ev.name}</span>
              <span className="text-xs text-slate-500">{ev.date}</span>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-xs font-medium ${ev.type === 'maturity' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {formatCurrency(ev.value)}
              </span>
              <span className="text-xs text-slate-600 block">
                {ev.type === 'maturity'
                  ? (ev.action === 'convert_equity' ? t('Convierte', 'Converts') : t('Vence', 'Matures'))
                  : t('Pago', 'Payment')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
