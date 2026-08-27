'use client'

import { useMemo, useState } from 'react'
import { Hourglass } from 'lucide-react'
import { buildDebtAging } from '@/lib/debtAging'

// ¿Cuánto tardo en pagar lo que gasto con la tarjeta?
//
// La regla es la que fijó el usuario: cada depósito de pago ataca el gasto más
// viejo que siga sin pagar (FIFO). La aritmética vive completa en
// lib/debtAging.js; acá solo se muestra.
//
// Lo que se dice y lo que NO:
//   · El promedio va ponderado por MONTO, y la card lo dice, porque un promedio
//     simple deja que veinte cafés pagados rápido tapen una compra grande que
//     se viene arrastrando.
//   · Sin ningún pago registrado no se imprime "0 días": se dice que todavía no
//     hay con qué medirlo.
//   · Los pagos que no encontraron a qué cargo atacar se NOMBRAN. Es el caso
//     normal del primer estado que uno sube (ese pago cubre consumos de un mes
//     que nunca se importó), y esconderlo dejaría el promedio midiendo una
//     historia incompleta sin que nada lo advirtiera.
const VISIBLE_ROWS = 5

const CARD_LABEL = { bi: 'BI', gyt: 'G&T', bac: 'BAC' }

function cardName(key) {
  const [bank, last4] = String(key || '').split(':')
  const name = CARD_LABEL[bank] || (bank === 'card' ? '' : bank)
  return [name, last4 ? `••${last4}` : ''].filter(Boolean).join(' ') || 'Tarjeta'
}

export default function DebtAgingCard({ transactions = [], lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openCard, setOpenCard] = useState(null)

  const groups = useMemo(() => buildDebtAging(transactions), [transactions])

  // Sin ninguna tarjeta importada no hay nada que contestar, y una card vacía
  // prometiendo una función es ruido.
  if (!groups.length) return null

  const loc = lang === 'es' ? 'es-GT' : 'en-US'
  const money = (v, cur) => {
    const sym = cur === 'USD' ? '$' : cur === 'GTQ' ? 'Q' : `${cur} `
    return `${sym}${Math.abs(v || 0).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const days = (n) => (n == null ? null : `${Math.round(n)} ${Math.round(n) === 1 ? t('día', 'day') : t('días', 'days')}`)

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="card-title">
          <Hourglass size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
          {t('Cuánto tardas en pagar', 'How long you take to pay')}
        </h3>
      </div>
      <p className="text-caption mb-4" style={{ color: 'var(--text-muted)' }}>
        {t(
          'Cada pago ataca el gasto más viejo que sigue sin pagar.',
          'Each payment goes against the oldest charge still unpaid.'
        )}
      </p>

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const key = `${g.card}|${g.currency}`
          const open = openCard === key
          const rows = open ? g.outstanding : g.outstanding.slice(0, VISIBLE_ROWS)
          return (
            <div key={key} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {cardName(g.card)} · {g.currency}
                </span>
                <span className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {g.outstandingTotal > 0
                    ? t(`${money(g.outstandingTotal, g.currency)} sin pagar`, `${money(g.outstandingTotal, g.currency)} unpaid`)
                    : t('Al día', 'All paid')}
                </span>
              </div>

              {/* La cifra que contesta la pregunta. Sin pagos registrados NO se
                  imprime un cero: se dice que no se puede medir todavía. */}
              {g.avgDays != null ? (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {days(g.avgDays)}
                  </span>
                  <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
                    {t(
                      `en promedio, sobre ${g.settledCount} ${g.settledCount === 1 ? 'gasto pagado' : 'gastos pagados'} · ponderado por monto`,
                      `on average, over ${g.settledCount} paid ${g.settledCount === 1 ? 'charge' : 'charges'} · weighted by amount`
                    )}
                  </span>
                </div>
              ) : (
                <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'Todavía no hay pagos registrados en esta tarjeta, así que no se puede medir.',
                    'No payments recorded on this card yet, so there is nothing to measure.'
                  )}
                </p>
              )}

              {g.medianDays != null && g.medianDays !== Math.round(g.avgDays) && (
                <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                  {t(`La mitad se paga en ${days(g.medianDays)} o menos.`, `Half of them are paid within ${days(g.medianDays)}.`)}
                </p>
              )}

              {g.oldest && (
                <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    `Lo más viejo sin pagar lleva ${days(g.oldest.ageDays)}: ${g.oldest.description}.`,
                    `The oldest unpaid charge is ${days(g.oldest.ageDays)} old: ${g.oldest.description}.`
                  )}
                </p>
              )}

              {rows.length > 0 && (
                <ul className="flex flex-col gap-1 mt-1">
                  {rows.map((c, i) => (
                    <li key={`${c.date}-${i}`} className="flex items-baseline justify-between gap-3 text-caption">
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{c.description}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {money(c.remaining, g.currency)} · {days(c.ageDays)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {g.outstanding.length > VISIBLE_ROWS && (
                <button
                  type="button"
                  onClick={() => setOpenCard(open ? null : key)}
                  className="self-start text-caption underline"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  {open
                    ? t('Ver menos', 'Show less')
                    : t(`Ver los ${g.outstanding.length}`, `Show all ${g.outstanding.length}`)}
                </button>
              )}

              {/* No se esconde: sin esto el promedio mediría una historia
                  incompleta y nada lo diría. */}
              {g.unattributed > 0.005 && (
                <p className="text-caption" style={{ color: 'var(--alert-warn-icon)' }}>
                  {t(
                    `${money(g.unattributed, g.currency)} de pagos no cuadran con ningún gasto registrado: casi siempre cubren consumos de un mes que todavía no has importado.`,
                    `${money(g.unattributed, g.currency)} in payments match no recorded charge: they usually cover a month you have not imported yet.`
                  )}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
