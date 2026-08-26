'use client'

import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { activeInstallmentPlans, installmentsInMonth } from '@/lib/installmentPlans'

// Cuotas activas: cuánto de tu futuro ya está comprometido, y cuánto del gasto
// del mes es deuda vieja liquidándose en vez de consumo nuevo. Todo sale del
// campo `installment` que los estados de cuenta ya traían y nadie leía; ver la
// cabecera de lib/installmentPlans.js, incluida la frontera con Patrimonio
// (esto habla de PAGOS futuros, jamás del saldo de la tarjeta).
export default function InstallmentPlansCard({
  transactions = [], convert = null, monthKey = null, monthExpenses = 0, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const nowMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])

  const plans = useMemo(
    () => activeInstallmentPlans(transactions, { convert, nowMonth }),
    [transactions, convert, nowMonth]
  )
  const monthInst = useMemo(
    () => (monthKey ? installmentsInMonth(transactions, monthKey, { convert }) : { sum: 0, count: 0 }),
    [transactions, monthKey, convert]
  )

  // Sin planes no hay card: una card vacía prometiendo una función es ruido
  // para quien no compra en cuotas.
  if (plans.length === 0) return null

  const fmt = (v) => `Q${Math.abs(v || 0).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthLabel = (mk) => {
    if (!mk) return ''
    const [y, m] = mk.split('-').map(Number)
    return new Date(y, m - 1, 1)
      .toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', year: 'numeric' })
      .replace('.', '')
  }

  const committed = plans.reduce((s, p) => s + p.remainingAmount, 0)

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="card-title">
          <CalendarClock size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
          {t('CUOTAS ACTIVAS', 'ACTIVE INSTALLMENTS')}
        </h3>
        <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
          {fmt(committed)}
        </span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('Lo que queda comprometido de compras ya hechas. No es consumo nuevo: es deuda vieja liquidándose mes a mes.',
           'What remains committed from purchases already made. Not new spending: old debt clearing month by month.')}
      </p>

      {monthInst.sum > 0 && monthExpenses > 0 && (
        <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--alert-info-icon)' }}>
          {t(`${fmt(monthInst.sum)} de tus ${fmt(monthExpenses)} de gasto del mes son cuotas de compras anteriores.`,
             `${fmt(monthInst.sum)} of your ${fmt(monthExpenses)} spent this month is installments on earlier purchases.`)}
        </p>
      )}

      <div className="space-y-3">
        {plans.map((p) => (
          <div key={`${p.label}|${p.of}`}>
            <div className="flex items-center justify-between gap-2 text-xs mb-1">
              <span className="truncate min-w-0" style={{ color: 'var(--text-secondary)' }}>{p.label}</span>
              <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                {t(`${p.paid} de ${p.of}`, `${p.paid} of ${p.of}`)} · {fmt(p.monthly)}/{t('mes', 'mo')}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
              <div className="h-full rounded-full bar-fill"
                style={{ width: `${Math.min(100, (p.paid / p.of) * 100)}%`, backgroundColor: 'var(--accent-blue)' }} />
            </div>
            <div className="flex items-center justify-between gap-2 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span>
                {t(`Faltan ${fmt(p.remainingAmount)}`, `${fmt(p.remainingAmount)} to go`)}
                {/* Estimado por construcción: mes de la última cuota vista + las
                    que faltan. Un abono anticipado o un estado sin importar lo
                    corren, por eso el "aprox". */}
                {' · '}{t(`se libera aprox. ${monthLabel(p.freesUpMonth)}`, `frees up approx. ${monthLabel(p.freesUpMonth)}`)}
              </span>
              {p.stale && (
                <span className="shrink-0" style={{ color: 'var(--alert-warn-icon)' }}>
                  {t(`última cuota vista: ${monthLabel(p.lastSeenMonth)}`, `last installment seen: ${monthLabel(p.lastSeenMonth)}`)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
