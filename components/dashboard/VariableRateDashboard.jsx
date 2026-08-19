'use client'

import { useMemo } from 'react'
import { formatCurrency, getItemPrice } from './utils'

export default function VariableRateDashboard({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const variableItems = useMemo(() =>
    (items || []).filter(it =>
      (it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) ||
      (it.rateType === 'continuous' && it.incomeRate > 0)
    ).map(it => {
      const balance = (it.quantity || 1) * getItemPrice(it)
      const midRate = it.rateType === 'variable' ? (it.rateMin + it.rateMax) / 2 : it.incomeRate
      const estAnnual = balance * (midRate / 100)
      return { ...it, balance, midRate, estAnnual }
    }).sort((a, b) => b.estAnnual - a.estAnnual),
    [items]
  )

  if (variableItems.length === 0) return null

  const totalBalance = variableItems.reduce((s, it) => s + it.balance, 0)
  const totalEstAnnual = variableItems.reduce((s, it) => s + it.estAnnual, 0)
  const weightedRate = totalBalance > 0 ? (totalEstAnnual / totalBalance) * 100 : 0

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="card-title mb-3">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('TASAS VARIABLES', 'VARIABLE RATES')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <span className="text-xs text-slate-500 block">{t('Balance total', 'Total balance')}</span>
          <span className="text-sm font-bold text-white">{formatCurrency(totalBalance)}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 block">{t('Tasa pond.', 'Wtd. rate')}</span>
          <span className="text-sm font-bold text-blue-400">{weightedRate.toFixed(2)}%</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">{t('Ingreso est.', 'Est. income')}</span>
          <span className="text-sm font-bold text-emerald-400">{formatCurrency(totalEstAnnual)}/yr</span>
        </div>
      </div>

      <div className="space-y-2">
        {variableItems.map(it => {
          const isVariable = it.rateType === 'variable'
          return (
            <div key={it.id || it.symbol} className="bg-theme-base rounded-lg p-2.5 border border-glass-border/30">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-white font-medium truncate">{it.name || it.symbol}</span>
                <span className="text-xs text-emerald-400 font-medium">{formatCurrency(it.estAnnual)}/yr</span>
              </div>
              <div className="flex items-center gap-2">
                {isVariable ? (
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                      <span>{it.rateMin}%</span>
                      <span className="text-blue-400 font-medium">{it.midRate.toFixed(1)}%</span>
                      <span>{it.rateMax}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500/40 to-blue-400 rounded-full"
                        style={{ width: '100%' }} />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-cyan-400 font-medium">{it.incomeRate}% {t('continua', 'continuous')}</span>
                      <span className="text-slate-500">{formatCurrency(it.balance)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
