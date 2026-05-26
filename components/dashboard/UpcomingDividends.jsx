'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'

export default function UpcomingDividends({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const monthNames = lang === 'es'
    ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const upcoming = useMemo(() => {
    if (!items || items.length === 0) return []
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentDay = now.getDate()
    const results = []

    items.forEach((it) => {
      const hasVariableRate = it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0
      if ((!it.incomeAmount || it.incomeAmount <= 0) && (!it.incomeRate || it.incomeRate <= 0) && !hasVariableRate) return
      if (!it.incomeMonths || it.incomeMonths.length === 0) return

      const originalPrice = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      let amount = 0
      if (hasVariableRate) {
        const balance = (it.quantity || 1) * originalPrice
        const payMonths = it.incomeMonths.length || 12
        const midRate = (it.rateMin + it.rateMax) / 2
        amount = (balance * (midRate / 100)) / payMonths
      } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
        const balance = (it.quantity || 1) * originalPrice
        const payMonths = it.incomeMonths.length || 12
        amount = (balance * (it.incomeRate / 100)) / payMonths
      } else if (it.incomeAmount > 0) {
        const isPerShare = /stock|etf|fund|crypto/i.test(it.type || '')
        amount = isPerShare ? it.incomeAmount * (it.quantity || 1) : it.incomeAmount
      }
      if (!isFinite(amount) || amount <= 0) return

      const payDay = it.incomePayDay || 1

      for (let offset = 0; offset < 2; offset++) {
        const checkMonth = (currentMonth + offset) % 12
        if (!it.incomeMonths.includes(checkMonth)) continue
        if (offset === 0 && payDay < currentDay) continue

        results.push({
          symbol: it.symbol,
          name: it.name || it.symbol,
          amount,
          currency: it._originalCurrency || it.currency || 'USD',
          day: payDay,
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
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
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
