'use client'

import { useState, useMemo, Fragment } from 'react'
import { getItemValue, getTypeCategory, debtTermLabel } from './utils'
import { debtBreakdown, debtMonthlyRate } from '@/lib/debtMath'

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
        // FASE LT: el interés del mes salía SIEMPRE de rate/12, así que una
        // tasa MENSUAL (el 1.5% del préstamo familiar del caso real) se leía
        // como anual y el interés aparecía 12x menor. lib/debtMath.js lee el
        // período. `rateAnnualEq` es la tasa comparable ENTRE deudas (una
        // 1.5% mensual es MÁS cara que una 15% anual): ordena, promedia y
        // decide avalanche; la tecleada se muestra con su período al lado.
        const monthlyRate = debtMonthlyRate(it)
        const rateAnnualEq = monthlyRate * 12 * 100
        const monthlyInterest = balance * monthlyRate
        const bd = debtBreakdown(it, { balance })
        return { ...it, balance, rate, rateAnnualEq, monthly, remaining, monthlyInterest, bd }
      })
  }, [items])

  const sorted = useMemo(() => {
    const arr = [...debts]
    arr.sort((a, b) => {
      let va, vb
      if (sortBy === 'balance') { va = a.balance; vb = b.balance }
      else if (sortBy === 'rate') { va = a.rateAnnualEq; vb = b.rateAnnualEq }
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
    // Promediar la tasa TECLEADA mezclaba mensuales con anuales (1.5 y 7.5
    // promediados a secas no significan nada): se pondera la anual equivalente.
    const avgRate = debts.length > 0
      ? debts.reduce((s, d) => s + d.rateAnnualEq * d.balance, 0) / (totalBalance || 1)
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
    const byRate = [...debts].sort((a, b) => b.rateAnnualEq - a.rateAnnualEq)
    const byBalance = [...debts].sort((a, b) => a.balance - b.balance)
    return {
      avalanche: byRate[0],
      snowball: byBalance[0],
      same: byRate[0]?.id === byBalance[0]?.id,
    }
  }, [debts])

  // FASE ME: toda esta pantalla era `bg-white` + grises de tema claro FIJOS, con
  // clases remapeadas (text-slate-500) encima: en tema oscuro (el default) los
  // encabezados de la tabla resolvían a casi-blanco sobre blanco (1.11:1) y la
  // tabla de deudas quedaba sin nombres de columna. Ahora usa `.card` y tokens,
  // así que se lee igual en los dos temas.
  if (debts.length === 0) {
    return (
      <div className="card p-8 text-center">
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
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Deuda Total', 'Total Debt')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-negative)' }}>${fmt(totals.totalBalance)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Pago Mensual', 'Monthly Payment')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>${fmt(totals.totalMonthly)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Interés Mensual', 'Monthly Interest')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--alert-warn-icon)' }}>${fmt(totals.totalInterest)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Tasa Promedio (anual equiv.)', 'Avg Rate (annual eq.)')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{pctFmt(totals.avgRate)}</p>
        </div>
      </div>

      {/* Strategy recommendation */}
      {avalancheFirst && !avalancheFirst.same && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--accent-blue)' }}>{t('Estrategia de pago', 'Payoff strategy')}</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-blue-500 font-medium">Avalanche ({t('menos interés', 'less interest')})</p>
              <p style={{ color: 'var(--text-secondary)' }}>{t('Paga primero', 'Pay first')}: <strong>{avalancheFirst.avalanche.name || avalancheFirst.avalanche.symbol}</strong> ({pctFmt(avalancheFirst.avalanche.rateAnnualEq)} {t('anual equiv.', 'annual eq.')})</p>
            </div>
            <div>
              <p className="text-blue-500 font-medium">Snowball ({t('motivación', 'motivation')})</p>
              <p style={{ color: 'var(--text-secondary)' }}>{t('Paga primero', 'Pay first')}: <strong>{avalancheFirst.snowball.name || avalancheFirst.snowball.symbol}</strong> (${fmt(avalancheFirst.snowball.balance)})</p>
            </div>
          </div>
        </div>
      )}

      {/* Debt table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-theme-tertiary border-b border-glass-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Nombre', 'Name')}</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Tipo', 'Type')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300" onClick={() => toggleSort('balance')}>
                  {t('Saldo', 'Balance')} {sortIcon('balance')}
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300" onClick={() => toggleSort('rate')}>
                  {t('Tasa', 'Rate')} {sortIcon('rate')}
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300" onClick={() => toggleSort('monthly')}>
                  {t('Pago/Mes', 'Payment/Mo')} {sortIcon('monthly')}
                </th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Plazo', 'Term')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300" onClick={() => toggleSort('remaining')}>
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
                    <tr className="border-b border-glass-border hover:bg-theme-tertiary transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {onEditItem ? (
                            <button onClick={() => onEditItem(debt)} className="text-sm font-medium text-left transition-colors hover:underline" style={{ color: 'var(--text-primary)' }}>
                              {debt.name || debt.symbol}
                            </button>
                          ) : (
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{debt.name || debt.symbol}</span>
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
                        <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-negative)' }}>${fmt(debt.balance)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-mono text-sm ${debt.rateAnnualEq > 20 ? 'font-semibold' : ''}`} style={{ color: debt.rateAnnualEq > 20 ? 'var(--text-negative)' : debt.rate > 0 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                          {debt.rate > 0 ? `${pctFmt(debt.rate)}${debt.ratePeriod === 'monthly' ? t(' mens.', ' mo.') : ''}` : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{debt.monthly > 0 ? `$${fmt(debt.monthly)}` : '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-xs text-slate-500">{debtTermLabel(debt.debtTerm, lang) || '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{debt.remaining > 0 ? debt.remaining : '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono text-sm" style={{ color: debt.monthlyInterest > 100 ? 'var(--text-negative)' : 'var(--alert-warn-icon)' }}>
                          {debt.monthlyInterest > 0 ? `$${fmt(debt.monthlyInterest)}` : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-theme-tertiary rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ backgroundColor: 'var(--text-negative)', width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs text-slate-400">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                    {/* FASE LT: el desglose que faltaba. La tabla mostraba el
                        saldo NETO y nada más: ni cuánto se debe CON intereses
                        ni si el pago configurado siquiera cubre el interés. */}
                    {debt.bd && (debt.bd.totalToPay != null || debt.bd.paymentTooSmall) && (
                      <tr style={{ backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 50%, transparent)' }}>
                        <td colSpan={9} className="px-8 py-1.5">
                          <span className="text-xs text-slate-400">
                            {debt.bd.totalToPay != null && (
                              <>{t('Total a pagar con intereses', 'Total to pay with interest')}: ~${fmt(debt.bd.totalToPay)} ({t('intereses', 'interest')} ~${fmt(debt.bd.totalInterestRemaining)}{debt.bd.months != null ? ` · ~${debt.bd.months} ${t('meses', 'months')}` : ''})</>
                            )}
                            {debt.bd.paymentTooSmall && (
                              <span style={{ color: 'var(--alert-warn-icon)' }}> ⚠ {t('el pago no cubre ni el interés del mes: así la deuda no baja', 'the payment does not even cover monthly interest: the debt cannot shrink')}</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    )}
                    {/* Credit card reward row */}
                    {isCC && debt.rewardBalance > 0 && (
                      <tr style={{ backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 50%, transparent)' }}>
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
              <tr className="bg-theme-tertiary border-t-2 border-glass-border">
                <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }} colSpan={2}>Total</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-negative)' }}>${fmt(totals.totalBalance)}</td>
                <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: 'var(--alert-warn-icon)' }}>{pctFmt(totals.avgRate)}</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>${fmt(totals.totalMonthly)}</td>
                <td colSpan={2}></td>
                <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: 'var(--alert-warn-icon)' }}>${fmt(totals.totalInterest)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
