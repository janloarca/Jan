'use client'

import { useState, useMemo, Fragment } from 'react'
import { getItemValue, getTypeCategory } from './utils'

const DEBT_TERM_LABELS = {
  '3m': '3 meses', '6m': '6 meses', '12m': '12 meses',
  '24m': '24 meses', '36m': '36 meses',
  payday: 'Día de pago', revolving: 'Revolving', custom: 'Custom',
}

const SUBTYPE_LABELS = {
  mortgage: { es: 'Hipoteca', en: 'Mortgage' },
  personal_loan: { es: 'Préstamo Personal', en: 'Personal Loan' },
  credit_card: { es: 'Tarjeta de Crédito', en: 'Credit Card' },
  financing: { es: 'Financiamiento', en: 'Financing' },
  auto_loan: { es: 'Préstamo Auto', en: 'Auto Loan' },
  student_loan: { es: 'Préstamo Estudiantil', en: 'Student Loan' },
  other: { es: 'Otro', en: 'Other' },
}

const REWARD_ICONS = { miles: '✈', cashback: '$', points: '★' }

function fmt(val) {
  return Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctFmt(val) {
  return val.toFixed(2) + '%'
}

export default function DebtSpreadsheet({ items, lang, onEditItem, onAdd }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [sortBy, setSortBy] = useState('balance')
  const [sortDir, setSortDir] = useState('desc')

  const debts = useMemo(() => {
    if (!items) return []
    return items
      .filter(it => it.isDebt && !it.isReceivable)
      .map(it => {
        const balance = Math.abs(getItemValue(it))
        const rate = it.interestRate || 0
        const monthly = it.monthlyPayment || it.minimumPayment || 0
        const remaining = it.installmentsRemaining || 0
        const totalRemaining = remaining > 0 && monthly > 0 ? remaining * monthly : balance
        const monthlyInterest = balance * (rate / 100 / 12)
        return { ...it, balance, rate, monthly, remaining, totalRemaining, monthlyInterest }
      })
  }, [items])

  const sorted = useMemo(() => {
    const arr = [...debts]
    arr.sort((a, b) => {
      let va, vb
      if (sortBy === 'balance') { va = a.balance; vb = b.balance }
      else if (sortBy === 'rate') { va = a.rate; vb = b.rate }
      else if (sortBy === 'monthly') { va = a.monthly; vb = b.monthly }
      else if (sortBy === 'remaining') { va = a.remaining; vb = b.remaining }
      else { va = a.balance; vb = b.balance }
      return sortDir === 'desc' ? vb - va : va - vb
    })
    return arr
  }, [debts, sortBy, sortDir])

  const totals = useMemo(() => {
    const totalBalance = debts.reduce((s, d) => s + d.balance, 0)
    const totalMonthly = debts.reduce((s, d) => s + d.monthly, 0)
    const totalInterest = debts.reduce((s, d) => s + d.monthlyInterest, 0)
    const avgRate = debts.length > 0
      ? debts.reduce((s, d) => s + d.rate * d.balance, 0) / (totalBalance || 1)
      : 0
    return { totalBalance, totalMonthly, totalInterest, avgRate }
  }, [debts])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const sortIcon = (col) => {
    if (sortBy !== col) return '↕'
    return sortDir === 'desc' ? '↓' : '↑'
  }

  // Avalanche vs Snowball recommendation
  const avalancheFirst = useMemo(() => {
    if (debts.length < 2) return null
    const byRate = [...debts].sort((a, b) => b.rate - a.rate)
    const byBalance = [...debts].sort((a, b) => a.balance - b.balance)
    return {
      avalanche: byRate[0],
      snowball: byBalance[0],
      same: byRate[0]?.id === byBalance[0]?.id,
    }
  }, [debts])

  if (debts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-sm">{t('No tienes deudas registradas.', 'No debts recorded.')}</p>
        <p className="text-slate-300 text-xs mt-1">{t('Agrega una deuda desde el dashboard.', 'Add a debt from the dashboard.')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {onAdd && (
        <div className="flex justify-end">
          <button onClick={onAdd}
            className="px-4 py-2 text-xs font-medium bg-red-600 rounded-lg hover:bg-red-500 transition-colors flex items-center gap-1.5" style={{ color: '#ffffff' }}>
            + {t('Agregar deuda', 'Add debt')}
          </button>
        </div>
      )}
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Deuda Total', 'Total Debt')}</p>
          <p className="text-xl font-bold text-red-600 mt-1">${fmt(totals.totalBalance)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Pago Mensual', 'Monthly Payment')}</p>
          <p className="text-xl font-bold text-slate-800 mt-1">${fmt(totals.totalMonthly)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Interés Mensual', 'Monthly Interest')}</p>
          <p className="text-xl font-bold text-amber-600 mt-1">${fmt(totals.totalInterest)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Tasa Promedio', 'Avg Rate')}</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{pctFmt(totals.avgRate)}</p>
        </div>
      </div>

      {/* Strategy recommendation */}
      {avalancheFirst && !avalancheFirst.same && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-700 mb-1">{t('Estrategia de pago', 'Payoff strategy')}</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-blue-500 font-medium">Avalanche ({t('menos interés', 'less interest')})</p>
              <p className="text-slate-600">{t('Paga primero', 'Pay first')}: <strong>{avalancheFirst.avalanche.name || avalancheFirst.avalanche.symbol}</strong> ({pctFmt(avalancheFirst.avalanche.rate)})</p>
            </div>
            <div>
              <p className="text-blue-500 font-medium">Snowball ({t('motivación', 'motivation')})</p>
              <p className="text-slate-600">{t('Paga primero', 'Pay first')}: <strong>{avalancheFirst.snowball.name || avalancheFirst.snowball.symbol}</strong> (${fmt(avalancheFirst.snowball.balance)})</p>
            </div>
          </div>
        </div>
      )}

      {/* Debt table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Nombre', 'Name')}</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Tipo', 'Type')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('balance')}>
                  {t('Saldo', 'Balance')} {sortIcon('balance')}
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('rate')}>
                  {t('Tasa', 'Rate')} {sortIcon('rate')}
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('monthly')}>
                  {t('Pago/Mes', 'Payment/Mo')} {sortIcon('monthly')}
                </th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Plazo', 'Term')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('remaining')}>
                  {t('Cuotas', 'Payments')} {sortIcon('remaining')}
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Int/Mes', 'Int/Mo')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('% Deuda', '% Debt')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((debt, i) => {
                const pct = totals.totalBalance > 0 ? (debt.balance / totals.totalBalance) * 100 : 0
                const subtypeLabel = SUBTYPE_LABELS[debt.subtype]?.[lang] || debt.subtype || ''
                const isCC = debt.subtype === 'credit_card' || /credit.?card|tarjeta/i.test(debt.type)
                return (
                  <Fragment key={debt.id || i}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {onEditItem ? (
                            <button onClick={() => onEditItem(debt)} className="text-sm font-medium text-slate-800 hover:text-blue-600 text-left transition-colors">
                              {debt.name || debt.symbol}
                            </button>
                          ) : (
                            <span className="text-sm font-medium text-slate-800">{debt.name || debt.symbol}</span>
                          )}
                          {isCC && debt.rewardType && (
                            <span className="text-xs" title={debt.rewardType}>{REWARD_ICONS[debt.rewardType] || ''}</span>
                          )}
                        </div>
                        {debt.institution && <p className="text-xs text-slate-400 mt-0.5">{debt.institution}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-slate-500">{subtypeLabel}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm text-red-600 font-medium">${fmt(debt.balance)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-mono text-sm ${debt.rate > 20 ? 'font-semibold' : ''}`} style={{ color: debt.rate > 20 ? '#ef4444' : debt.rate > 0 ? '#d97706' : '#94a3b8' }}>
                          {debt.rate > 0 ? pctFmt(debt.rate) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm text-slate-700">{debt.monthly > 0 ? `$${fmt(debt.monthly)}` : '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-xs text-slate-500">{DEBT_TERM_LABELS[debt.debtTerm] || debt.debtTerm || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm text-slate-700">{debt.remaining > 0 ? debt.remaining : '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm" style={{ color: debt.monthlyInterest > 100 ? '#ef4444' : '#f59e0b' }}>
                          {debt.monthlyInterest > 0 ? `$${fmt(debt.monthlyInterest)}` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs text-slate-400">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                    {/* Credit card reward row */}
                    {isCC && debt.rewardBalance > 0 && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={9} className="px-8 py-1.5">
                          <span className="text-xs text-slate-400">
                            {REWARD_ICONS[debt.rewardType]} {debt.rewardType}: {debt.rewardBalance?.toLocaleString()}
                            {debt.cardBrand && ` · ${debt.cardBrand.toUpperCase()}`}
                            {debt.rewardRate && ` · ${debt.rewardRate}% earn rate`}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td className="px-4 py-3 text-sm font-bold text-slate-700" colSpan={2}>Total</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold text-red-600">${fmt(totals.totalBalance)}</td>
                <td className="px-3 py-3 text-right font-mono text-sm text-amber-600">{pctFmt(totals.avgRate)}</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-700">${fmt(totals.totalMonthly)}</td>
                <td colSpan={2}></td>
                <td className="px-3 py-3 text-right font-mono text-sm text-amber-500">${fmt(totals.totalInterest)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
