'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowRight, Repeat } from 'lucide-react'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatCurrency } from './utils'
import {
  normalizePlan, planTotalsByMonth, firstPlannedMonth, serializePlan, REPEAT_MONTHLY,
} from '@/lib/incomePlan'
import { projectWealth, suggestSavingsRate, annualizedReturnPct } from '@/lib/wealthProjection'

// El otro lado del plan de ingresos: en Flujo se arma el calendario, acá se
// juega con lo que ese calendario le hace al patrimonio de aquí a diciembre.
//
// Los cuadritos NO se editan acá a propósito: hay un solo lugar donde se
// escribe el plan (Flujo) y dos pantallas que lo muestran. Lo que sí se edita
// acá es lo que solo tiene sentido contra el patrimonio: cuánto de cada mes se
// ahorra, y a qué tasa rinde lo ya invertido.

// Punto de partida cuando no hay historial de Flujo del cual medir el ahorro
// real. Va declarado como constante para que se lea como lo que es: un valor
// para empezar a jugar, no una medición.
const FALLBACK_SAVINGS = 50

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function WealthProjectionCard({
  netWorth = 0, plan: rawPlan, onSavePlan, financeTransactions = [],
  convert, baseCurrency = 'USD', returnSinceStart, sinceStartDate,
  lang = 'es', today = new Date(), onOpenFlow,
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const months = lang === 'es' ? MONTHS_ES : MONTHS_EN
  const year = today.getUTCFullYear()
  const fromMonth = firstPlannedMonth(year, today)

  const rawSig = JSON.stringify(rawPlan || null)
  const [plan, setPlan] = useState(() => normalizePlan(rawPlan, year))
  useEffect(() => { setPlan(normalizePlan(JSON.parse(rawSig), year)) }, [rawSig, year])

  const savePlan = useCallback((next) => {
    setPlan(next)
    if (typeof onSavePlan === 'function') onSavePlan(serializePlan(next))
  }, [onSavePlan])

  // El salario está en quetzales y el patrimonio en la moneda base: se convierte
  // con el mismo `convert` que usa toda la app, para que la proyección viva en
  // una sola moneda comparable con el patrimonio de arriba.
  const income = useMemo(
    () => planTotalsByMonth(plan, { fromMonth, convert, to: baseCurrency }),
    [plan, fromMonth, convert, baseCurrency]
  )

  const suggestedSavings = useMemo(
    () => suggestSavingsRate(financeTransactions, { year, month: today.getUTCMonth(), convert, to: 'GTQ' }),
    [financeTransactions, year, today, convert]
  )
  const suggestedReturn = useMemo(
    () => annualizedReturnPct(returnSinceStart, sinceStartDate, today),
    [returnSinceStart, sinceStartDate, today]
  )

  // El ahorro por defecto: lo que la persona de VERDAD ahorró si se puede
  // medir, y si no un punto de partida declarado. Cero sería igual de
  // arbitrario y además deja la card inerte: una proyección plana no enseña
  // que los controles hacen algo.
  const savingsDefault = plan.defaultSavingsRate != null
    ? plan.defaultSavingsRate
    : (suggestedSavings ? suggestedSavings.pct : FALLBACK_SAVINGS)

  // La tasa NO se precarga con el retorno histórico, y es a propósito. Un
  // portafolio que hizo +100% en tres años anualiza a ~26%, y usar eso como
  // "lo que espero" convierte la proyección en una fantasía que la app estaría
  // firmando. Un ahorro es una DECISIÓN del usuario (un default es un punto de
  // partida); un retorno es una propiedad del mercado (un default es una
  // afirmación). Así que el histórico se ofrece a un toque y nunca se aplica
  // solo, el mismo patrón que ya usa la sugerencia de % de empresa al dar de
  // alta un alternativo.
  const returnPct = plan.returnRate != null ? plan.returnRate : 0
  const returnHint = plan.returnRate == null && suggestedReturn != null
    ? Math.round(suggestedReturn * 10) / 10
    : null

  const projection = useMemo(() => projectWealth({
    startValue: netWorth,
    monthlyIncome: income,
    savingsRate: plan.savingsRate,
    defaultSavingsRate: savingsDefault,
    annualReturnPct: returnPct,
    fromMonth,
  }), [netWorth, income, plan.savingsRate, savingsDefault, returnPct, fromMonth])

  const setSavingsFor = useCallback((month, value) => {
    const pct = value === '' ? null : Math.min(100, Math.max(0, Number(value) || 0))
    const next = { ...plan, savingsRate: { ...plan.savingsRate } }
    if (pct == null) delete next.savingsRate[month]
    else next.savingsRate[month] = pct
    savePlan(next)
  }, [plan, savePlan])

  const applyToAll = useCallback((value) => {
    const pct = Math.min(100, Math.max(0, Number(value) || 0))
    savePlan({ ...plan, defaultSavingsRate: pct, savingsRate: {} })
  }, [plan, savePlan])

  const fmt = (v) => formatCurrency(v, baseCurrency)
  const hasPlan = income.slice(fromMonth).some((v) => v > 0)
  const chart = useMemo(() => {
    const vals = [projection.startValue, ...projection.points.map((p) => p.value)]
    if (vals.length < 2) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    // Sin movimiento no hay nada que dibujar: una línea plana pegada al borde
    // se ve como un bloque en blanco, que es peor que no tener gráfica.
    const span = max - min
    if (!(span > 0)) return null
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * 100
      const y = 100 - ((v - min) / span) * 100
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    return { line: pts.join(' '), area: `0,100 ${pts.join(' ')} 100,100` }
  }, [projection])

  if (fromMonth >= 12) return null

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          {t(`Proyección a diciembre ${year}`, `Projection to December ${year}`)}
          <InfoTip text={t(
            'Toma tu patrimonio de hoy, le suma el ahorro de cada mes según lo que planeaste en Flujo, y hace crecer lo ya invertido a la tasa que pongas. El aporte de un mes no rinde ese mismo mes. Es una proyección: no toca tu historial ni tus retornos.',
            'Takes today net worth, adds each month savings from your Flow plan, and grows what is already invested at the rate you set. A month contribution does not earn a return that same month. It is a projection: it never touches your record or your returns.'
          )} />
        </h3>
      </div>

      {!hasPlan ? (
        <div className="py-3">
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            {t('Todavía no hay ingresos planeados para lo que queda del año. El calendario se arma en Flujo y esta proyección lo lee.',
               'No income planned for the rest of the year yet. The calendar is built in Flow and this projection reads it.')}
          </p>
          {onOpenFlow && (
            <button type="button" onClick={onOpenFlow} className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--accent-blue)' }}>
              {t('Armar el plan en Flujo', 'Build the plan in Flow')} <ArrowRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Dos filas y no un flex-wrap: a 390px el tercer bloque se iba solo
              a una línea aparte y se leía como algo roto. */}
          <div className="flex items-end gap-2 mb-1">
            <div className="min-w-0">
              <span className="text-[11px] block" style={{ color: 'var(--text-muted)' }}>{t('Hoy', 'Today')}</span>
              <span className="text-sm font-bold font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(projection.startValue)}</span>
            </div>
            <ArrowRight size={14} className="mb-1 shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            <div className="min-w-0">
              <span className="text-[11px] block" style={{ color: 'var(--text-muted)' }}>{t('Diciembre (proyectado)', 'December (projected)')}</span>
              <span className="text-lg font-bold font-mono tabular-nums" style={{ color: 'var(--accent-blue)' }}>{fmt(projection.endValue)}</span>
            </div>
          </div>
          <p className="text-[11px] font-mono tabular-nums mb-3" style={{ color: 'var(--text-muted)' }}>
            {t('aportás', 'you add')} {fmt(projection.totalSaved)} · {t('rinde', 'it earns')} {fmt(projection.totalGrowth)}
          </p>

          {chart && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-16 mb-3" aria-hidden="true">
              <polygon points={chart.area} fill="var(--accent-blue)" opacity="0.12" />
              <polyline points={chart.line} fill="none" stroke="var(--accent-blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="rounded-lg border p-2" style={{ borderColor: 'var(--card-border)' }}>
              <span className="text-[11px] block mb-1" style={{ color: 'var(--text-muted)' }}>{t('Rendimiento anual', 'Annual return')}</span>
              <span className="flex items-baseline gap-1">
                <input
                  type="number" step="0.1" inputMode="decimal"
                  aria-label={t('Rendimiento anual esperado', 'Expected annual return')}
                  className="w-10 bg-transparent font-mono tabular-nums text-right outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  value={returnPct}
                  onChange={(e) => savePlan({ ...plan, returnRate: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>%</span>
              </span>
              {returnHint != null ? (
                <button type="button" onClick={() => savePlan({ ...plan, returnRate: returnHint })}
                  className="text-[10px] block mt-0.5 hover:underline text-left" style={{ color: 'var(--accent-blue)' }}>
                  {t(`tu histórico: ${returnHint}% · usar`, `yours so far: ${returnHint}% · use it`)}
                </button>
              ) : (
                plan.returnRate == null && (
                  <span className="text-[10px] block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t('poné la que esperás', 'set what you expect')}
                  </span>
                )
              )}
            </label>

            <label className="rounded-lg border p-2" style={{ borderColor: 'var(--card-border)' }}>
              <span className="text-[11px] block mb-1" style={{ color: 'var(--text-muted)' }}>{t('Ahorro por defecto', 'Default savings')}</span>
              <span className="flex items-baseline gap-1">
                <input
                  type="number" step="1" min="0" max="100" inputMode="decimal"
                  aria-label={t('Porcentaje de ahorro por defecto', 'Default savings percentage')}
                  className="w-10 bg-transparent font-mono tabular-nums text-right outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  value={savingsDefault}
                  onChange={(e) => applyToAll(e.target.value)}
                />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>%</span>
              </span>
              {plan.defaultSavingsRate == null && (
                <span className="text-[10px] block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {suggestedSavings
                    ? t(`lo que ahorraste en ${suggestedSavings.months} mes(es)`, `what you saved over ${suggestedSavings.months} month(s)`)
                    : t('punto de partida, cambialo', 'a starting point, change it')}
                </span>
              )}
            </label>
          </div>

          <div className="space-y-1">
            {projection.points.map((p) => (
              <div key={p.month} data-proj-month={p.month} className="rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--card-border)' }}>
                {/* El control de ahorro va en la primera línea, como pastilla:
                    globals.css fuerza 16px en todo input (para que iOS no haga
                    zoom al enfocar), así que un porcentaje "chiquito" al lado de
                    texto de 10px no existe. En vez de pelear con esa regla, el
                    control se dibuja como lo que es. */}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium w-8 shrink-0" style={{ color: 'var(--text-secondary)' }}>{months[p.month]}</span>
                    <span className="flex items-baseline gap-0.5 rounded-md border px-1.5 shrink-0"
                      style={{ borderColor: plan.savingsRate[p.month] != null ? 'var(--accent-blue)' : 'var(--card-border)' }}>
                      <input
                        type="number" step="5" min="0" max="100" inputMode="decimal"
                        aria-label={t(`Ahorro de ${months[p.month]}`, `${months[p.month]} savings`)}
                        data-proj-input={p.month}
                        className="w-8 bg-transparent font-mono tabular-nums text-right outline-none"
                        style={{ color: plan.savingsRate[p.month] != null ? 'var(--accent-blue)' : 'var(--text-primary)' }}
                        value={p.pct}
                        onChange={(e) => setSavingsFor(p.month, e.target.value)}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>%</span>
                    </span>
                  </span>
                  <span className="text-xs font-mono tabular-nums font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>{fmt(p.value)}</span>
                </div>
                <div className="mt-0.5">
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {fmt(p.income)} · {t('ahorro', 'saved')} {fmt(p.saved)} · {t('rend.', 'return')} {fmt(p.growth)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Repeat size={9} aria-hidden="true" />
            {t('Los ingresos vienen del plan de Flujo. El mes en curso cuenta completo.',
               'Income comes from the Flow plan. The current month counts as a full month.')}
            {onOpenFlow && (
              <button type="button" onClick={onOpenFlow} className="font-medium hover:underline" style={{ color: 'var(--accent-blue)' }}>
                {t('Editar en Flujo', 'Edit in Flow')}
              </button>
            )}
          </p>
        </>
      )}
    </div>
  )
}
