'use client'

import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { detectRecurringCharges } from '@/lib/recurringCharges'

// Suscripciones y cargos recurrentes, detectados del histórico ya importado.
// Describe lo que ya pasa: la nómina mensual con su total, el alza de precio
// que nadie notó fila por fila, y el cargo que este mes no cayó (que es a la
// vez un detector de "cancelé y sigue" y de captura rota). NO es un
// presupuesto y no impone ningún límite; ver lib/recurringCharges.js.
const VISIBLE_ROWS = 8

export default function RecurringChargesCard({ transactions = [], convert = null, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [showAll, setShowAll] = useState(false)

  const nowDate = useMemo(() => new Date().toLocaleDateString('en-CA'), [])
  const { monthly, totalMonthlyGtq } = useMemo(
    () => detectRecurringCharges(transactions, { convert, nowDate }),
    [transactions, convert, nowDate]
  )

  // Sin nómina no hay card: una card vacía prometiendo una función es ruido.
  if (monthly.length === 0) return null

  const fmtQ = (v) => `Q${Math.abs(v || 0).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // La fila imprime el monto en SU moneda (una suscripción de $20 no es Q20);
  // el total del encabezado sí va convertido, porque suma monedas distintas.
  const fmtRow = (v, cur) => `${cur === 'USD' ? '$' : cur === 'GTQ' ? 'Q' : `${cur} `}${Math.abs(v || 0).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthLabel = (mk) => {
    if (!mk) return ''
    const [y, m] = mk.split('-').map(Number)
    return new Date(y, m - 1, 1)
      .toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short' })
      .replace('.', '')
  }

  const rows = showAll ? monthly : monthly.slice(0, VISIBLE_ROWS)

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="card-title">
          <RefreshCw size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
          {t('CARGOS RECURRENTES', 'RECURRING CHARGES')}
        </h3>
        <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
          {fmtQ(totalMonthlyGtq)}{t('/mes', '/mo')}
        </span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('Lo que se cobra solo, mes a mes, detectado de tu propio historial. Describe lo que ya pasa: no es un presupuesto ni un límite.',
           'What bills itself month after month, detected from your own history. It describes what already happens: not a budget, not a limit.')}
      </p>

      <div className="space-y-2">
        {rows.map((m) => (
          <div key={m.key}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate min-w-0" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
              <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                {fmtRow(m.latestAmount, m.currency)}{t('/mes', '/mo')} · {t(`día ~${m.expectedDay}`, `~day ${m.expectedDay}`)}
              </span>
            </div>
            {/* Un alza de precio y un cobro que no cayó son las dos noticias
                que esta card existe para dar: van en ámbar, con el dato. */}
            {m.rise && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--alert-warn-icon)' }}>
                {t(`Subió de ${fmtRow(m.rise.from, m.currency)} a ${fmtRow(m.rise.to, m.currency)} en ${monthLabel(m.rise.month)}.`,
                   `Went up from ${fmtRow(m.rise.from, m.currency)} to ${fmtRow(m.rise.to, m.currency)} in ${monthLabel(m.rise.month)}.`)}
              </p>
            )}
            {m.missing && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--alert-warn-icon)' }}>
                {t('Este mes no ha cobrado. ¿Lo cancelaste, o falta importar el estado?',
                   'No charge this month yet. Did you cancel it, or is a statement missing?')}
              </p>
            )}
          </div>
        ))}
      </div>

      {monthly.length > VISIBLE_ROWS && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full mt-3 py-1.5 text-xs rounded-lg border transition-colors"
          style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
          {showAll ? t('Mostrar menos', 'Show less') : t(`Ver los ${monthly.length}`, `Show all ${monthly.length}`)}
        </button>
      )}
    </div>
  )
}
