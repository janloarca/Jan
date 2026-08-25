'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'
import { monthlyIncomeAmount, acquisitionDayISO, clampPayDay, payDateFor } from '@/lib/incomeSchedule'

export default function UpcomingDividends({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const monthNames = lang === 'es'
    ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const upcoming = useMemo(() => {
    if (!items || items.length === 0) return []
    const now = new Date()
    // UTC, como TODO el resto del calendario de ingresos (clampPayDay,
    // payDateFor, el motor de useDashboardData). Esta tarjeta era la única que
    // leía local, así que al oeste de UTC podía discrepar con el motor sobre en
    // qué día estamos y ofrecer o esconder un pago del mes en curso.
    const currentMonth = now.getUTCMonth()
    const currentDay = now.getUTCDate()
    const currentYear = now.getUTCFullYear()
    const results = []

    items.forEach((it) => {
      const hasVariableRate = it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0
      if ((!it.incomeAmount || it.incomeAmount <= 0) && (!it.incomeRate || it.incomeRate <= 0) && !hasVariableRate) return
      if (!it.incomeMonths || it.incomeMonths.length === 0) return

      const originalPrice = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = (it.quantity || 1) * originalPrice
      const payDay = it.incomePayDay || 1
      const acqDay = acquisitionDayISO(it.acquisitionDate)

      for (let offset = 0; offset < 2; offset++) {
        // Con `(mes + offset) % 12` a secas, diciembre + 1 daba enero del MISMO
        // año, o sea una fecha ya pasada. El rollover se resuelve dejando que
        // Date normalice el mes.
        const d = new Date(Date.UTC(currentYear, currentMonth + offset, 1))
        const checkMonth = d.getUTCMonth()
        const checkYear = d.getUTCFullYear()
        if (!it.incomeMonths.includes(checkMonth)) continue
        if (offset === 0 && clampPayDay(payDay, checkYear, checkMonth) < currentDay) continue

        const payDate = payDateFor(checkYear, checkMonth, payDay)
        // Un pago nunca es anterior a la compra, misma regla que el motor.
        if (acqDay && payDate < acqDay) continue

        // El MISMO monto que va a escribir el motor, incluido el prorrateo del
        // primer período: esta tarjeta tenía su propia copia de las ramas (sin
        // la de devengo diario) y podía ofrecer un número que el motor nunca
        // escribiría.
        const amount = monthlyIncomeAmount({
          balance, qty: it.quantity || 1,
          isPerShare: /stock|etf|fund|crypto/i.test(it.type || ''),
          incomeMode: it.incomeMode, incomeRate: it.incomeRate, incomeAmount: it.incomeAmount,
          rateType: it.rateType, rateMin: it.rateMin, rateMax: it.rateMax,
          accrual: it.accrual, acquisitionDay: acqDay, payDate,
          incomeMonths: it.incomeMonths, incomePayDay: payDay,
        }, it.incomeMonths.length || 12)
        if (!isFinite(amount) || amount <= 0) continue

        results.push({
          symbol: it.symbol,
          name: it.name || it.symbol,
          amount,
          currency: it._originalCurrency || it.currency || 'USD',
          day: clampPayDay(payDay, checkYear, checkMonth),
          month: checkMonth,
          monthLabel: monthNames[checkMonth],
          isThisMonth: offset === 0,
        })
      }
    })

    results.sort((a, b) => {
      if (a.month !== b.month) return a.isThisMonth ? -1 : 1
      return a.day - b.day
    })
    return results.slice(0, 5)
  }, [items, monthNames])

  if (upcoming.length === 0) return null

  const totalExpected = upcoming.reduce((s, d) => s + d.amount, 0)

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
          <span className="text-emerald-400">$</span>
          {t('Próximos pagos', 'Upcoming payments')}
        </h3>
        <span className="text-xs text-emerald-400 font-medium">{formatCurrency(totalExpected)}</span>
      </div>
      <div className="space-y-2">
        {upcoming.map((d, i) => (
          <div key={`${d.symbol}-${d.month}-${i}`} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-slate-500 w-12 shrink-0">{d.monthLabel} {d.day}</span>
              <span className="text-xs text-slate-300 truncate">{d.name}</span>
            </div>
            <span className="text-xs text-emerald-400 font-medium shrink-0 ml-2">
              {formatCurrency(d.amount, d.currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
