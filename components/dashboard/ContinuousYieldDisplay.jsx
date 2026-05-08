'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, getItemPrice } from './utils'

export default function ContinuousYieldDisplay({ items, lang }) {
  const [tick, setTick] = useState(0)

  const continuousItems = useMemo(() =>
    (items || []).filter(it => it.rateType === 'continuous' && it.incomeRate > 0),
    [items]
  )

  useEffect(() => {
    if (continuousItems.length === 0) return
    const interval = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(interval)
  }, [continuousItems.length])

  if (continuousItems.length === 0) return null

  const t = (es, en) => lang === 'es' ? es : en
  const now = Date.now()

  const yields = continuousItems.map(it => {
    const balance = (it.quantity || 1) * getItemPrice(it)
    const rate = it.incomeRate / 100
    const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : now - 86400000 * 30
    const elapsedSeconds = (now - acqDate) / 1000
    const secondsPerYear = 365.25 * 24 * 3600
    const accrued = balance * (Math.exp(rate * elapsedSeconds / secondsPerYear) - 1)
    const dailyRate = balance * (Math.exp(rate / 365.25) - 1)
    return { ...it, balance, accrued, dailyRate, rate: it.incomeRate }
  })

  const totalAccrued = yields.reduce((s, y) => s + y.accrued, 0)
  const totalDaily = yields.reduce((s, y) => s + y.dailyRate, 0)

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        {t('RENDIMIENTO CONTINUO', 'CONTINUOUS YIELD')}
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <span className="text-xs text-slate-500 block">{t('Acumulado total', 'Total accrued')}</span>
          <span className="text-lg font-bold text-cyan-400">{formatCurrency(totalAccrued)}</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">{t('Tasa diaria', 'Daily rate')}</span>
          <span className="text-lg font-bold text-emerald-400">{formatCurrency(totalDaily)}/d</span>
        </div>
      </div>

      <div className="space-y-2">
        {yields.map(y => (
          <div key={y.id || y.symbol} className="flex items-center justify-between bg-[#0f172a] rounded-lg p-2.5 border border-[#334155]/30">
            <div className="min-w-0">
              <span className="text-xs text-white font-medium truncate block">{y.name || y.symbol}</span>
              <span className="text-xs text-slate-500">{y.rate}% · {formatCurrency(y.balance)}</span>
            </div>
            <div className="text-right shrink-0 ml-2">
              <span className="text-xs text-cyan-400 font-medium block">{formatCurrency(y.accrued)}</span>
              <span className="text-xs text-slate-500">{formatCurrency(y.dailyRate)}/d</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
