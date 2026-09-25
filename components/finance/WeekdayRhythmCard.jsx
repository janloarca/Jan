'use client'

import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { buildMerchantLabelIndex } from '@/lib/merchantLabels'
import { categoryLabel } from '@/lib/financeCategories'
import { detectRecurringCharges, annualPaymentsOfMonth } from '@/lib/recurringCharges'
import { formatFinanceDate } from '@/lib/financeMonth'
import {
  buildSpendingRhythm, windowRange, monthKeysBetween, MIN_WEEKS_OBSERVED,
  RHYTHM_WINDOWS, WIDEST_RHYTHM_MONTHS,
} from '@/lib/spendingByWeekday'
import { nowDateKey, weekdayRhythmHasContent } from '@/lib/financeSections'

// El ritmo: semana a semana cuánto salió cada día, y qué días de la semana
// pesan más (y en qué).
//
// Dos mitades con dos varas distintas a propósito. La rejilla muestra HECHOS
// (lo que salió el martes 16) y se dibuja siempre. La sensibilidad afirma un
// PATRÓN ("los lunes gastás más en padel") y solo habla con suficientes
// observaciones: con dos lunes eso es ruido con cara de dato.
//
// Toda la aritmética vive en lib/spendingByWeekday.js, que suma con la MISMA
// definición de gasto que el encabezado del mes, así que las dos superficies no
// pueden contradecirse.

// El default es 3 meses: es la ventana donde el piso de semanas observadas se
// cumple y el patrón significa algo. "Este mes" existe porque es la pregunta
// natural, aunque casi siempre caiga bajo el piso y la card lo diga.
//
// La escala de la rejilla SATURA a partir del doble del día mediano. Sin eso,
// una prima anual de Q39,782 dejaría los otros noventa días en blanco: la
// rejilla dejaría de informar justo por el dato que ya se explica aparte con su
// punto ámbar. El monto exacto de cada día sigue a un toque y en su aria-label.
const SATURATE_AT_MEDIAN_X = 2

export default function WeekdayRhythmCard({
  transactions = [], convert = null, rules = [], recurring = null, lang = 'es', today = null,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [months, setMonths] = useState(3)
  const [picked, setPicked] = useState(null)

  const todayKey = today || nowDateKey()
  const labelIndex = useMemo(() => buildMerchantLabelIndex(transactions, rules), [transactions, rules])

  // Los días con un pago anual o semestral adentro, la unión de la marca manual
  // y la cadencia detectada (FASE LJ). Mismo insumo que usa YearInViewCard para
  // marcar meses; acá marca DÍAS. `recurring` llega de la página, que lo detecta
  // una vez; sin el prop se detecta acá para que la card siga montándose sola.
  const widest = useMemo(() => windowRange(WIDEST_RHYTHM_MONTHS, todayKey), [todayKey])
  const annualDates = useMemo(() => {
    if (!widest) return new Set()
    const { longCadence } = recurring || detectRecurringCharges(transactions, { convert })
    const out = new Set()
    for (const key of monthKeysBetween(widest.fromDate, widest.toDate)) {
      for (const row of annualPaymentsOfMonth(transactions, key, { convert, longCadence }).rows) {
        if (row.date) out.add(row.date)
      }
    }
    return out
  }, [transactions, convert, recurring, widest])

  const range = useMemo(() => windowRange(months, todayKey), [months, todayKey])
  const rhythm = useMemo(() => buildSpendingRhythm(transactions, {
    fromDate: range?.fromDate, toDate: range?.toDate, convert, labelIndex, annualDates,
  }), [transactions, range, convert, labelIndex, annualDates])

  // Un portafolio sin un solo gasto no gana una card vacía. Se pregunta con el
  // selector COMPARTIDO (lib/financeSections.js), que es el mismo que decide si
  // la sección tiene contenido debajo de su encabezado.
  const anySpend = useMemo(
    () => weekdayRhythmHasContent(transactions, { convert, today: todayKey }),
    [transactions, convert, todayKey]
  )
  if (!anySpend || !rhythm.weeks.length) return null

  const locale = lang === 'es' ? 'es-GT' : 'en-US'
  const fmt = (v) => `Q${Math.abs(v || 0).toLocaleString(locale, { maximumFractionDigits: 0 })}`
  const fmtExact = (v) => `Q${Math.abs(v || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const dayNames = lang === 'es'
    ? ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayInitials = lang === 'es' ? ['L', 'M', 'M', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const shortDate = (iso) => formatFinanceDate(iso).slice(0, 5)

  const positives = rhythm.days.filter((d) => d.total > 0).map((d) => d.total).sort((a, b) => a - b)
  const med = positives.length ? positives[positives.length >> 1] : 0
  const ref = med > 0 ? med * SATURATE_AT_MEDIAN_X : Math.max(...positives, 1)
  const shade = (total) => {
    if (total < 0) return { backgroundColor: 'color-mix(in srgb, var(--accent-green) 35%, transparent)' }
    if (total === 0) return { backgroundColor: 'var(--bg-tertiary)' }
    const pct = Math.min(1, total / ref)
    return { backgroundColor: `color-mix(in srgb, var(--text-negative) ${Math.round(12 + pct * 76)}%, transparent)` }
  }

  const { claim, profile } = rhythm
  const maxAvg = Math.max(...profile.map((p) => p.avg), 1)
  const sel = picked ? rhythm.days.find((d) => d.date === picked) : null

  // La frase del día caro. Se arma por partes porque cada una tiene su propia
  // condición: el porcentaje solo existe con día típico, el comercio solo si se
  // lo ganó, y la nota del cargo único solo cuando el promedio está jalado.
  const topName = claim.top ? dayNames[claim.top.weekday] : ''
  const clause = (() => {
    const p = claim.top
    if (!p) return ''
    if (p.merchant) return t(` Casi siempre en ${p.merchant.label}.`, ` Mostly at ${p.merchant.label}.`)
    if (p.category) return t(` Sobre todo en ${categoryLabel(p.category.category, lang)}.`, ` Mostly on ${categoryLabel(p.category.category, lang)}.`)
    return ''
  })()

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="card-title">
          <CalendarDays size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
          {t('RITMO DE GASTO', 'SPENDING RHYTHM')}
        </h3>
        <SegmentedTabs
          variant="range"
          value={months}
          onChange={setMonths}
          deps={[lang]}
          ariaLabel={t('Ventana de historial', 'History window')}
          tabs={RHYTHM_WINDOWS.map((n) => ({
            key: n,
            label: n === 1 ? t('Este mes', 'This month') : t(`${n} meses`, `${n} months`),
          }))}
        />
      </div>

      {/* ── SEMANA A SEMANA ── */}
      {/* Acotada: sin tope, en escritorio las celdas se estiran a ~100px y el
          total de la semana queda a un palmo de su propia fila. Una rejilla de
          calendario se lee por cercanía, no por ancho disponible. */}
      <div className="grid gap-1 max-w-[560px]" style={{ gridTemplateColumns: '2.6rem repeat(7, minmax(0, 1fr)) 3.9rem' }}>
        <span aria-hidden="true" />
        {dayInitials.map((d, i) => (
          <span key={i} className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }} aria-hidden="true">{d}</span>
        ))}
        <span aria-hidden="true" />

        {rhythm.weeks.map((wk) => (
          <WeekRow
            key={wk.start} wk={wk} shade={shade} picked={picked} setPicked={setPicked}
            todayKey={todayKey} fmt={fmt} fmtExact={fmtExact} shortDate={shortDate}
            dayNames={dayNames} t={t}
          />
        ))}
      </div>

      <p className="text-[11px] mt-2 min-h-[1.1rem]" style={{ color: 'var(--text-muted)' }}>
        {sel ? (
          <>
            <span style={{ color: 'var(--text-primary)' }}>{dayNames[sel.weekday]} {formatFinanceDate(sel.date)}</span>
            {' · '}{sel.count === 0 ? t('sin gastos', 'nothing spent') : fmtExact(sel.total)}
            {sel.topLabel ? ` · ${sel.topLabel}` : ''}
            {sel.hasAnnual ? t(' · incluye un pago anual', ' · includes an annual payment') : ''}
          </>
        ) : t('Tocá un día para ver su monto.', 'Tap a day to see its amount.')}
      </p>

      {/* ── SENSIBILIDAD ── */}
      <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--card-border)' }}>
        <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('Promedio por día de la semana', 'Average by day of week')}
        </p>
        <div className="flex flex-col gap-1">
          {profile.map((p) => {
            const isTop = claim.top && p.weekday === claim.top.weekday
            const isBottom = claim.bottom && p.weekday === claim.bottom.weekday && !isTop
            return (
              <div key={p.weekday} className="grid items-center gap-2" style={{ gridTemplateColumns: '4.6rem 1fr 4.2rem' }}>
                <span className="text-[11px] truncate" style={{ color: isTop ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {dayNames[p.weekday]}
                </span>
                <span className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--track-base)' }} aria-hidden="true">
                  <span
                    className="block h-full rounded-full bar-fill"
                    style={{
                      width: `${Math.max(p.avg > 0 ? 3 : 0, (Math.max(0, p.avg) / maxAvg) * 100)}%`,
                      backgroundColor: isTop ? 'var(--text-negative)' : 'color-mix(in srgb, var(--text-negative) 45%, transparent)',
                    }}
                  />
                </span>
                <span className="text-[11px] text-right tabular-nums" style={{ color: isTop ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {fmt(p.avg)}
                </span>
                <span className="sr-only">
                  {t(`${p.occurrences} ${dayNames[p.weekday]} observados`, `${p.occurrences} ${dayNames[p.weekday]}s observed`)}
                  {isTop ? t(', el más caro', ', the priciest') : ''}
                  {isBottom ? t(', el más barato', ', the cheapest') : ''}
                </span>
              </div>
            )
          })}
        </div>

        <div className="text-[11px] mt-3 space-y-1" style={{ color: 'var(--text-muted)' }}>
          {claim.status === 'insufficient' && (
            <p>{t(
              `Todavía no se puede hablar de un patrón: hacen falta al menos ${MIN_WEEKS_OBSERVED} semanas del mismo día y por ahora hay ${claim.weeksObserved}. La rejilla de arriba sí es un hecho.`,
              `Not enough to call it a pattern yet: it takes at least ${MIN_WEEKS_OBSERVED} of the same weekday and there are ${claim.weeksObserved} so far. The grid above is still a fact.`
            )}</p>
          )}

          {claim.status === 'flat' && (
            <p>{t(
              `Tus días son parejos: el ${topName} es el más caro con ${fmt(claim.top.avg)} de promedio, pero ninguno se despega de los demás.`,
              `Your days are even: ${topName} is the priciest at ${fmt(claim.top.avg)} on average, but none really stands out.`
            )}</p>
          )}

          {/* El porcentaje se calla en dos casos, por la MISMA razón: no
              describiría la conducta. Sin día típico (mediana en cero) sería
              una división entre cero; con el promedio jalado por un solo
              cargo describiría ese cargo, y encima chocaría de frente con la
              línea de abajo que da la mediana sin él. El hecho (cuál es el
              día más caro y cuánto) se afirma igual en los dos. */}
          {claim.status === 'ok' && (
            <p style={{ color: 'var(--text-secondary)' }}>
              {claim.overPct != null && !claim.top.pulledBy
                ? t(
                  `Los ${topName} gastás ${fmt(claim.top.avg)} en promedio, un ${Math.round(claim.overPct)}% más que un día normal.`,
                  `On ${topName}s you spend ${fmt(claim.top.avg)} on average, ${Math.round(claim.overPct)}% more than a typical day.`
                )
                : t(
                  `El ${topName} es tu día más caro: ${fmt(claim.top.avg)} en promedio.`,
                  `${topName} is your priciest day: ${fmt(claim.top.avg)} on average.`
                )}
              {clause}
            </p>
          )}

          {claim.status !== 'insufficient' && claim.bottom && claim.bottom.weekday !== claim.top?.weekday && (
            <p>{t(
              `El más barato es el ${dayNames[claim.bottom.weekday]}: ${fmt(claim.bottom.avg)}.`,
              `The cheapest is ${dayNames[claim.bottom.weekday]}: ${fmt(claim.bottom.avg)}.`
            )}</p>
          )}

          {/* El promedio jalado por un solo cargo se DICE, nunca se esconde: el
              dinero sigue entero en el día y en el total del mes. */}
          {claim.top?.pulledBy && (
            <p style={{ color: 'var(--alert-warn-icon)' }}>
              {t(
                `Ojo: ese promedio lo jala un solo cargo de ${fmtExact(claim.top.pulledBy.amount)} (${claim.top.pulledBy.label}) del ${formatFinanceDate(claim.top.pulledBy.date)}. Sin él, un ${topName} normal es ${fmt(claim.top.median)}.`,
                `Heads up: that average is pulled by a single ${fmtExact(claim.top.pulledBy.amount)} charge (${claim.top.pulledBy.label}) on ${formatFinanceDate(claim.top.pulledBy.date)}. Without it, a normal ${topName} is ${fmt(claim.top.median)}.`
              )}
            </p>
          )}

          {annualDates.size > 0 && (
            <p>
              <span className="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1" style={{ backgroundColor: 'var(--alert-warn-icon)' }} />
              {t('Día con un pago anual o semestral adentro.', 'Day with an annual or semiannual payment in it.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function WeekRow({ wk, shade, picked, setPicked, todayKey, fmt, fmtExact, shortDate, dayNames, t }) {
  return (
    <>
      <span className="text-[10px] tabular-nums self-center" style={{ color: 'var(--text-muted)' }} aria-hidden="true">
        {shortDate(wk.start)}
      </span>
      {wk.days.map((d) => {
        if (!d.inWindow) return <span key={d.date} aria-hidden="true" />
        const isToday = d.date === todayKey
        const isPicked = d.date === picked
        return (
          <button
            key={d.date}
            onClick={() => setPicked(isPicked ? null : d.date)}
            aria-pressed={isPicked}
            aria-label={`${dayNames[d.weekday]} ${d.date}: ${d.count === 0 ? t('sin gastos', 'nothing spent') : fmtExact(d.total)}`}
            title={`${shortDate(d.date)}: ${fmtExact(d.total)}`}
            className="relative h-7 min-h-[28px] rounded-[5px] transition-transform"
            style={{
              ...shade(d.total),
              outline: isPicked ? '2px solid var(--accent-blue)' : (isToday ? '1px solid var(--text-muted)' : 'none'),
              outlineOffset: '-1px',
            }}
          >
            {d.hasAnnual && (
              // El halo no es adorno: sobre una celda saturada de rojo, un
              // punto ámbar a secas es invisible, y justo el día del pago anual
              // es el que más necesita distinguirse.
              <span
                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: 'var(--alert-warn-icon)', boxShadow: '0 0 0 1.5px var(--bg-card)' }}
                aria-hidden="true"
              />
            )}
          </button>
        )
      })}
      <span className="text-[11px] text-right tabular-nums self-center" style={{ color: 'var(--text-muted)' }}>
        {fmt(wk.total)}
      </span>
    </>
  )
}
