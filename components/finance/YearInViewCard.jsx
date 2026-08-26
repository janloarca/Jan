'use client'

import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import { yearTotalsByMonth } from '@/lib/financeMonth'
import { detectRecurringCharges, annualPaymentsOfMonth } from '@/lib/recurringCharges'

// El año en una vista (feature 5 del plan): doce columnas con el ingreso y el
// gasto REALES, y un punto sobre los meses donde cayó un pago anual, para que
// el pico de julio se lea como "el seguro" y no como "un mes malo". Tocar un
// mes salta a él (la página entera cambia al mes elegido).
//
// ⛔ Muestra lo OCURRIDO, jamás el plan: la regla dura de lib/incomePlan.js es
// que un plan no es una transacción y ningún motor de Flujo lo lee; esta vista
// es del otro lado (solo transacciones) y las dos series nunca se mezclan.
//
// Las barras comparten UNA escala y una caja de alto fijo (la lección de la
// doble tira de FASE JT: dos escalas hermanas dibujan el mismo dinero a dos
// tamaños, y un height% dentro de un flex sin alto fijo ni siquiera resuelve
// contra algo estable).
const BAR_BOX_PX = 72

export default function YearInViewCard({
  transactions = [], convert = null, year, month, onSelectMonth = null, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const totals = useMemo(
    () => yearTotalsByMonth(transactions, year, convert),
    [transactions, year, convert]
  )
  // Los meses con pago anual/semestral (marca manual + cadencia detectada,
  // FASE LJ): el punto que convierte un pico en una explicación.
  const annualMonths = useMemo(() => {
    const { longCadence } = detectRecurringCharges(transactions, { convert })
    const out = new Map()
    for (const m of totals) {
      const a = annualPaymentsOfMonth(transactions, m.key, { convert, longCadence })
      if (a.totalGtq > 0) out.set(m.key, a.totalGtq)
    }
    return out
  }, [transactions, totals, convert])

  const hasAny = totals.some((m) => m.income > 0 || m.expenses > 0)
  // Un año sin un solo movimiento no gana una card vacía.
  if (!hasAny) return null

  const max = Math.max(...totals.map((m) => Math.max(m.income, m.expenses)), 1)
  const fmt = (v) => `Q${Math.abs(v || 0).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthNames = lang === 'es'
    ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  // A 390px doce rótulos completos chocan: eje adelgazado (uno de cada tres
  // más el seleccionado), el mismo recurso de las tiras de Ingresos Pasivos.
  const showLabel = (i) => i % 3 === 0 || i + 1 === month

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="card-title">
          <CalendarRange size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
          {t('TU AÑO', 'YOUR YEAR')} · {year}
        </h3>
        <span className="flex items-center gap-3 text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'var(--accent-green)' }} />{t('entró', 'in')}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'var(--text-negative)' }} />{t('salió', 'out')}</span>
        </span>
      </div>

      <div className="grid grid-cols-12 gap-1">
        {totals.map((m, i) => {
          const selected = i + 1 === month
          const annual = annualMonths.get(m.key)
          const empty = !(m.income > 0 || m.expenses > 0)
          return (
            <button
              key={m.key}
              onClick={() => onSelectMonth && onSelectMonth(i, year)}
              disabled={!onSelectMonth}
              aria-label={`${monthNames[i]} ${year}: ${t('entró', 'in')} ${fmt(m.income)}, ${t('salió', 'out')} ${fmt(m.expenses)}${annual ? t(`, incluye ${fmt(annual)} de pagos anuales`, `, includes ${fmt(annual)} in annual payments`) : ''}`}
              title={`${monthNames[i]}: +${fmt(m.income)} · -${fmt(m.expenses)}`}
              className="rounded-md px-0.5 pt-1 pb-0.5 transition-colors hover:bg-theme-elevated disabled:cursor-default"
              style={selected ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' } : undefined}
            >
              {/* El punto del pago anual vive ARRIBA de la columna: es la
                  explicación del pico, no parte de la barra. Reserva su alto
                  siempre para que las columnas no salten entre meses. */}
              <span className="block h-2 flex items-center justify-center" aria-hidden="true">
                {annual && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--alert-warn-icon)' }} />}
              </span>
              <span className="flex items-end justify-center gap-px" style={{ height: BAR_BOX_PX }} aria-hidden="true">
                {!empty && (
                  <>
                    <span className="w-1.5 rounded-t-sm bar-fill" style={{ height: `${Math.max(2, (m.income / max) * 100)}%`, backgroundColor: 'var(--accent-green)' }} />
                    <span className="w-1.5 rounded-t-sm bar-fill" style={{ height: `${Math.max(2, (m.expenses / max) * 100)}%`, backgroundColor: 'var(--text-negative)' }} />
                  </>
                )}
              </span>
              <span className="block text-[10px] mt-0.5" style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }} aria-hidden="true">
                {showLabel(i) ? monthNames[i] : ' '}
              </span>
            </button>
          )
        })}
      </div>

      {annualMonths.size > 0 && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1" style={{ backgroundColor: 'var(--alert-warn-icon)' }} />
          {t('Mes con un pago anual o semestral adentro: el pico es el seguro o la matrícula, no un mes malo.',
             'Month with an annual or semiannual payment in it: the spike is the insurance or tuition, not a bad month.')}
        </p>
      )}
    </div>
  )
}
