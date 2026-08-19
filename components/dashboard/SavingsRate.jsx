'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'

const FREQUENCIES = {
  weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, annual: 1,
}

export default function SavingsRate({ goals, transactions, netWorth, snapshots, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const recurring = useMemo(() => goals?.recurringTransactions || [], [goals])

  const rates = useMemo(() => {
    let monthlyIncome = 0
    let monthlySavings = 0
    let monthlyExpenses = 0

    recurring.forEach((r) => {
      const monthly = (r.amount * (FREQUENCIES[r.frequency] || 12)) / 12
      if (r.isInflow) {
        if (r.category === 'income') monthlyIncome += monthly
        else if (r.category === 'savings' || r.category === 'investment') monthlySavings += monthly
      } else {
        monthlyExpenses += monthly
      }
    })

    const totalIncome = monthlyIncome + monthlySavings
    const savingsRate = totalIncome > 0 ? (monthlySavings / totalIncome) * 100 : 0
    const investmentRate = totalIncome > 0
      ? (recurring.filter((r) => r.isInflow && r.category === 'investment')
          .reduce((s, r) => s + (r.amount * (FREQUENCIES[r.frequency] || 12)) / 12, 0) / totalIncome) * 100
      : 0

    return { monthlyIncome: totalIncome, monthlySavings, monthlyExpenses, savingsRate, investmentRate }
  }, [recurring])

  const growthFromSavings = useMemo(() => {
    if (snapshots.length < 2) return null
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const startVal = first.netWorthUSD ?? first.totalActivosUSD ?? 0
    const endVal = last.netWorthUSD ?? last.totalActivosUSD ?? 0
    if (startVal <= 0) return null

    const daysBetween = Math.ceil((new Date(last.date) - new Date(first.date)) / 86400000)
    if (daysBetween < 7) return null

    const depositsTotal = (transactions || [])
      .filter((tx) => (tx.type || '').toUpperCase() === 'DEPOSIT')
      .reduce((s, tx) => s + (tx.totalAmount || 0), 0)

    const withdrawalsTotal = (transactions || [])
      .filter((tx) => (tx.type || '').toUpperCase() === 'WITHDRAWAL')
      .reduce((s, tx) => s + (tx.totalAmount || 0), 0)

    const netFlows = depositsTotal - withdrawalsTotal
    const investmentGain = (endVal - startVal) - netFlows

    return {
      totalGrowth: endVal - startVal,
      fromFlows: netFlows,
      fromInvestment: investmentGain,
      fromFlowsPct: startVal > 0 ? (netFlows / startVal) * 100 : 0,
      fromInvestmentPct: startVal > 0 ? (investmentGain / startVal) * 100 : 0,
    }
  }, [snapshots, transactions])

  const fireNumber = useMemo(() => {
    if (rates.monthlyExpenses <= 0) return null
    const annualExpenses = rates.monthlyExpenses * 12
    return annualExpenses * 25
  }, [rates])

  if (recurring.length === 0 && !growthFromSavings) return null

  const ringPct = Math.min(rates.savingsRate, 100)
  const ringColor = rates.savingsRate >= 30 ? 'var(--accent-green)' : rates.savingsRate >= 15 ? 'var(--alert-warn-icon)' : 'var(--text-negative)'

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        🎯 {t('Tasa de Ahorro', 'Savings Rate')}
      </h3>

      {recurring.length > 0 && (
        <div className="flex items-center gap-4 mb-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              {/* Pista del anillo: token de tema (ver ValueBreakdown, mismo defecto). */}
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--card-border)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke={ringColor} strokeWidth="3"
                strokeDasharray={`${ringPct * 0.94} 100`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold" style={{ color: ringColor }}>{rates.savingsRate.toFixed(0)}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('Ingreso mensual', 'Monthly income')}</span>
              <span className="text-white font-medium">{formatCurrency(rates.monthlyIncome)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('Ahorro/inversión', 'Savings/investment')}</span>
              <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{formatCurrency(rates.monthlySavings)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('Gastos', 'Expenses')}</span>
              <span className="font-medium" style={{ color: 'var(--text-negative)' }}>{formatCurrency(rates.monthlyExpenses)}</span>
            </div>
          </div>
        </div>
      )}

      {growthFromSavings && (
        <div className="mb-3 p-3 bg-theme-base rounded-lg border border-glass-border/50">
          <div className="text-xs text-slate-500 mb-2">{t('Crecimiento del portafolio', 'Portfolio growth breakdown')}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <div className="text-sm font-bold" style={{ color: growthFromSavings.fromFlows >= 0 ? 'var(--accent-blue-soft)' : 'var(--text-negative)' }}>
                {formatCurrency(growthFromSavings.fromFlows)}
              </div>
              <div className="text-xs text-slate-500">{t('De aportes netos', 'From net deposits')}</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-bold" style={{ color: growthFromSavings.fromInvestment >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {formatCurrency(growthFromSavings.fromInvestment)}
              </div>
              <div className="text-xs text-slate-500">{t('De inversiones', 'From investments')}</div>
            </div>
          </div>
        </div>
      )}

      {fireNumber && netWorth > 0 && (
        <div className="pt-3 border-t border-glass-border/30">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-500">FIRE {t('número', 'number')} (25x)</span>
            <span className="text-white font-medium">{formatCurrency(fireNumber)}</span>
          </div>
          <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min((netWorth / fireNumber) * 100, 100)}%` }} />
          </div>
          <div className="text-xs text-slate-600 mt-1 text-right">
            {((netWorth / fireNumber) * 100).toFixed(1)}% {t('alcanzado', 'reached')}
          </div>
        </div>
      )}
    </div>
  )
}
