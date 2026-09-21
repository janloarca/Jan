'use client'

import { useMemo, useState } from 'react'
import { Hourglass } from 'lucide-react'
import { buildDebtAging } from '@/lib/debtAging'
import { buildMerchantLabelIndex, merchantDisplay } from '@/lib/merchantLabels'

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

export default function DebtAgingCard({ transactions = [], rules = [], lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openCard, setOpenCard] = useState(null)

  const groups = useMemo(() => buildDebtAging(transactions), [transactions])
  // Lo que el usuario escribió él mismo para cada comercio. Sin esto, la lista
  // imprime la cadena cruda del banco ("DONALD EXPRESS GT") aunque él ya haya
  // dicho que Donald es su mecánico: el dato existía y nadie lo leía acá.
  const labels = useMemo(() => buildMerchantLabelIndex(transactions, rules), [transactions, rules])

  // Sin ninguna tarjeta importada no hay nada que contestar, y una card vacía
  // prometiendo una función es ruido.
  if (!groups.length) return null

  const loc = lang === 'es' ? 'es-GT' : 'en-US'
  const money = (v, cur) => {
    const sym = cur === 'USD' ? '$' : cur === 'GTQ' ? 'Q' : `${cur} `
    return `${sym}${Math.abs(v || 0).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const days = (n) => (n == null ? null : `${Math.round(n)} ${Math.round(n) === 1 ? t('día', 'day') : t('días', 'days')}`)
  const anyUnattributed = groups.some((g) => g.unattributed > 0.005)

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

      {/* Dos columnas a partir de lg. No es decoración: la card mide ~1200px y
          cada fila ponía el comercio en el borde izquierdo y su cifra en el
          derecho, con mil píxeles de nada en medio — el ojo no puede unir los
          dos extremos. Partirla en dos acerca nombre y número Y deja las
          tarjetas lado a lado, que es justo la comparación que uno viene a
          hacer ("¿en cuál tardo más?"). */}
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        {groups.map((g, gi) => {
          const key = `${g.card}|${g.currency}`
          const open = openCard === key
          const rows = open ? g.outstanding : g.outstanding.slice(0, VISIBLE_ROWS)
          // Una sola línea de contexto en vez de tres párrafos apilados del
          // mismo tamaño y el mismo gris, que era la mitad del aspecto de
          // "pared de texto".
          const meta = [
            t(
              `en promedio, sobre ${g.settledCount} ${g.settledCount === 1 ? 'gasto pagado' : 'gastos pagados'}`,
              `on average, over ${g.settledCount} paid ${g.settledCount === 1 ? 'charge' : 'charges'}`
            ),
            g.medianDays != null && g.medianDays !== Math.round(g.avgDays)
              ? t(`la mitad en ${days(g.medianDays)} o menos`, `half within ${days(g.medianDays)}`)
              : null,
            t('ponderado por monto', 'weighted by amount'),
          ].filter(Boolean).join(' · ')
          return (
            <div
              key={key}
              className={`flex flex-col gap-2 ${gi > 0 ? 'pt-5 border-t lg:pt-0 lg:border-t-0' : ''}`}
              style={gi > 0 ? { borderColor: 'var(--card-border)' } : undefined}
            >
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
                  <span className="text-caption" style={{ color: 'var(--text-muted)' }}>{meta}</span>
                </div>
              ) : (
                <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'Todavía no hay pagos registrados en esta tarjeta, así que no se puede medir.',
                    'No payments recorded on this card yet, so there is nothing to measure.'
                  )}
                </p>
              )}

              {/* ⛔ Acá vivía "Lo más viejo sin pagar lleva N días: X", y era
                  el MISMO hecho que la primera fila de la lista de abajo, tres
                  centímetros más arriba: `oldest` ES `outstanding[0]` (la misma
                  referencia, verificado ejecutando el motor), y la fila dice
                  más, porque además trae el monto. Lo que sí faltaba y nadie
                  decía es el ORDEN de la lista, que es lo que convierte a esa
                  primera fila en "lo más viejo". */}
              {rows.length > 0 && (
                <>
                  <p className="text-caption mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('Sin pagar, del más viejo primero', 'Unpaid, oldest first')}
                  </p>
                  <ul className="grid gap-y-1 text-caption" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                    {rows.map((c, i) => (
                      <li key={`${c.date}-${i}`} className="contents">
                        {/* Un poco de tracking: casi toda cadena de banco viene
                            en MAYÚSCULAS, y las mayúsculas sin espaciado se
                            leen apretadas. Es tipografía, no una transformación
                            del texto: ninguna letra cambia. */}
                        <span className="truncate" style={{ color: 'var(--text-secondary)', letterSpacing: '0.01em' }}>
                          {merchantDisplay(c.description, labels)}
                        </span>
                        <span className="pl-4 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {money(c.remaining, g.currency)}
                        </span>
                        <span className="pl-3 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {days(c.ageDays)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
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
                  incompleta y nada lo diría. Pero solo la CIFRA va por grupo
                  (es por tarjeta y por moneda, y sumarlas necesitaría una tasa,
                  que es justo lo que este módulo no hace); la explicación es una
                  sola y vive al pie de la card.
                  ⛔ Y es un RÓTULO, no una oración: la oración entera repetida
                  por grupo seguía leyéndose como el mismo párrafo tres veces
                  aunque el "por qué" ya hubiera bajado al pie. */}
              {g.unattributed > 0.005 && (
                <p className="text-caption mt-1" style={{ color: 'var(--alert-warn-icon)' }}>
                  {t(
                    `${money(g.unattributed, g.currency)} en pagos sin cargo asociado`,
                    `${money(g.unattributed, g.currency)} in unmatched payments`
                  )}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* ⛔ Esta oración vivía DENTRO del bucle, así que con dos tarjetas y dos
          monedas se imprimía hasta cuatro veces seguidas. La cifra cambia por
          grupo; el por qué no. */}
      {anyUnattributed && (
        <p className="text-caption mt-4 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
          {t(
            'Un pago que no cuadra con ningún gasto registrado casi siempre cubre consumos de un mes que todavía no has importado.',
            'A payment that matches no recorded charge usually covers a month you have not imported yet.'
          )}
        </p>
      )}
    </div>
  )
}
