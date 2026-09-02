'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { parseRate } from '@/lib/numberParse'
import { ArrowRight, Repeat, Target } from 'lucide-react'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatCurrency } from './utils'
import {
  normalizePlan, planTotalsByMonth, planTotalsForFutureYear, firstPlannedMonth, serializePlan, REPEAT_MONTHLY,
} from '@/lib/incomePlan'
import { projectWealth, projectToGoal, savingsRateForGoal, suggestSavingsRate, annualizedReturnPct, savingsRateFromProfile } from '@/lib/wealthProjection'
import { clampTargetYear, readGoal, goalInBase, portfolioValue } from '@/lib/goalFields'

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

// Cuántos meses cerrados hacen falta para que "lo que ahorraste" sea una
// medición y no una muestra. Con dos meses de ingreso a medio registrar, el
// resultado era un 0% presentado con la misma autoridad que un dato bueno.
const MIN_MEASURED_MONTHS = 3

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Control de porcentaje con − / + y tecleo directo (FASE LN, pedido del
// usuario: "hacelo más ágil"). Lo que lo hace ágil en un teléfono:
//   (a) − / + ajustan de un toque, sin abrir el teclado;
//   (b) tocar el número selecciona TODO el valor, así que se teclea el nuevo
//       encima sin borrar el viejo dígito por dígito;
//   (c) mientras se teclea manda un BORRADOR local y se guarda al salir
//       (Enter o blur). Antes cada tecla guardaba a Firestore Y el onChange
//       re-parseaba el texto en caliente, o sea teclear "6.5" perdía el punto
//       en cuanto se escribía.
// El parseo/clamp sigue viviendo en el CALLER (onCommit recibe el string
// crudo), para no duplicar las semánticas que ya existían: vacío en un mes
// borra el override, vacío en la tasa vuelve a "sin configurar".
// Vive a nivel de módulo a propósito: un componente definido dentro del
// render se desmonta y remonta en cada render y PIERDE clics (lección FASE JF).
function PctStepper({ value, onCommit, step, min = 0, max = 100, accent = false, ariaLabel, inputTestId = null }) {
  const [draft, setDraft] = useState(null)
  const shown = draft != null ? draft : String(value)
  const bump = (delta) => {
    const base = parseRate(shown)
    const next = Math.min(max, Math.max(min, (Number.isFinite(base) ? base : 0) + delta))
    setDraft(null)
    // Redondeo al paso para que 6.5 + 1 no deje colas binarias (7.5, no 7.4999...).
    onCommit(String(Math.round(next * 100) / 100))
  }
  const commitDraft = () => {
    if (draft == null) return
    onCommit(draft)
    setDraft(null)
  }
  const btnCls = 'w-7 h-7 shrink-0 rounded-md border flex items-center justify-center text-base leading-none select-none'
  const btnStyle = { borderColor: 'var(--card-border)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }
  return (
    <span className="flex items-center gap-1">
      <button type="button" aria-label={`${ariaLabel}: -${step}`} className={btnCls} style={btnStyle} onClick={() => bump(-step)}>−</button>
      <span className="flex items-baseline gap-0.5 rounded-md border px-1.5"
        style={{ borderColor: accent ? 'var(--accent-blue)' : 'var(--card-border)' }}>
        <input
          type="text" inputMode="decimal"
          aria-label={ariaLabel}
          {...(inputTestId != null ? { 'data-proj-input': inputTestId } : {})}
          className="w-9 bg-transparent font-mono tabular-nums text-center outline-none"
          style={{ color: accent ? 'var(--accent-blue)' : 'var(--text-primary)' }}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => { const el = e.target; setTimeout(() => el.select(), 0) }}
          onBlur={commitDraft}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitDraft(); e.currentTarget.blur() } }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>%</span>
      </span>
      <button type="button" aria-label={`${ariaLabel}: +${step}`} className={btnCls} style={btnStyle} onClick={() => bump(step)}>+</button>
    </span>
  )
}

export default function WealthProjectionCard({
  netWorth = 0, plan: rawPlan, onSavePlan, financeTransactions = [], profile,
  convert, baseCurrency = 'USD', returnSinceStart, sinceStartDate, goals, totalAssets = null,
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
    () => suggestSavingsRate(financeTransactions, {
      year, month: today.getUTCMonth(), minMonths: MIN_MEASURED_MONTHS, convert, to: 'GTQ',
    }),
    [financeTransactions, year, today, convert]
  )
  const declaredSavings = useMemo(() => savingsRateFromProfile(profile), [profile])
  const suggestedReturn = useMemo(
    () => annualizedReturnPct(returnSinceStart, sinceStartDate, today),
    [returnSinceStart, sinceStartDate, today]
  )

  // El ahorro por defecto: lo que la persona de VERDAD ahorró si se puede
  // medir, y si no un punto de partida declarado. Cero sería igual de
  // arbitrario y además deja la card inerte: una proyección plana no enseña
  // que los controles hacen algo.
  // La prioridad, y el orden importa: una medición sobre meses SUFICIENTES le
  // gana a un auto-reporte, y un auto-reporte le gana a una muestra de dos
  // meses o a un número inventado. Lo que el usuario haya tecleado manda sobre
  // todo lo demás.
  const savingsSource = plan.defaultSavingsRate != null ? 'user'
    : suggestedSavings ? 'measured'
    : declaredSavings ? 'profile'
    : 'fallback'
  const savingsDefault = plan.defaultSavingsRate != null ? plan.defaultSavingsRate
    : suggestedSavings ? suggestedSavings.pct
    : declaredSavings ? declaredSavings.pct
    : FALLBACK_SAVINGS

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

  // La meta se lee con los MISMOS helpers que la card de Metas, nunca con una
  // segunda copia: si esta proyección midiera contra otro número, las dos
  // pantallas dirían cosas distintas sobre la misma meta (que es exactamente
  // el duplicado que FASE MW vino a cerrar).
  // El default es CERO y no los 100,000 que usa la card de Metas, y la
  // divergencia es deliberada: allá el default es un marcador de posición en
  // la pantalla donde justamente se fija la meta, acá sería esta card
  // afirmando que vas hacia una meta que nadie puso. Sin meta guardada, el
  // bloque no existe.
  const goalValue = goalInBase(readGoal(goals?.portfolioGoal, 0), goals?.goalCurrency, baseCurrency, convert)
  const targetYear = clampTargetYear(goals?.targetYear, year)
  const growthPct = plan.incomeGrowthPct != null ? plan.incomeGrowthPct : 0

  // Un año FUTURO no es este año repetido: el salario mensual ya arrancó, así
  // que corre los doce meses. Ver `planTotalsForFutureYear`.
  const futureIncome = useMemo(
    () => planTotalsForFutureYear(plan, { convert, to: baseCurrency }),
    [plan, convert, baseCurrency]
  )

  // Solo tiene sentido preguntar "¿voy a llegar?" cuando la meta apunta a un
  // año POSTERIOR: si es este año, la proyección a diciembre de arriba ya lo
  // contestó y repetirlo abajo sería el mismo número dos veces.
  const goalOn = goalValue > 0 && targetYear > year
  const goalRun = useMemo(() => {
    if (!goalOn) return null
    const params = {
      // ⛔ El ARRANQUE de la carrera hacia la meta son los ACTIVOS, no el
      // patrimonio neto, y sale del mismo helper que usa la card de Metas: si
      // midiera contra otra base, las dos pantallas darían dos respuestas a
      // "¿cuánto me falta?" sobre la misma meta el mismo día. La proyección a
      // diciembre de arriba sí arranca en el patrimonio neto, porque contesta
      // otra pregunta ("¿en cuánto termino?").
      startValue: portfolioValue(totalAssets, netWorth),
      currentYearIncome: income,
      futureYearIncome: futureIncome,
      savingsRate: plan.savingsRate,
      defaultSavingsRate: savingsDefault,
      annualReturnPct: returnPct,
      incomeGrowthPct: growthPct,
      fromMonth,
      currentYear: year,
      throughYear: targetYear,
      goalValue,
    }
    return { ...projectToGoal(params), neededPct: savingsRateForGoal(params) }
  }, [goalOn, totalAssets, netWorth, income, futureIncome, plan.savingsRate, savingsDefault, returnPct, growthPct, fromMonth, year, targetYear, goalValue])

  const setSavingsFor = useCallback((month, value) => {
    // parseRate y no Number(): Number('42,5') es NaN y caia a 0, o sea el
    // porcentaje se perdia entero al teclear una coma. El clamp 0-100 se queda
    // y reemplaza al min/max que el input dejo de tener al pasar a texto.
    const pct = value === '' ? null : Math.min(100, Math.max(0, parseRate(value)))
    const next = { ...plan, savingsRate: { ...plan.savingsRate } }
    if (pct == null) delete next.savingsRate[month]
    else next.savingsRate[month] = pct
    savePlan(next)
  }, [plan, savePlan])

  const applyToAll = useCallback((value) => {
    const pct = Math.min(100, Math.max(0, parseRate(value)))
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
    <div className="card p-4 sm:p-5">
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
              <span className="text-h1 font-mono tabular-nums" style={{ color: 'var(--accent-blue)' }}>{fmt(projection.endValue)}</span>
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
              <PctStepper
                value={returnPct}
                step={1}
                min={0}
                max={100}
                ariaLabel={t('Rendimiento anual esperado', 'Expected annual return')}
                onCommit={(raw) => savePlan({ ...plan, returnRate: raw === '' ? null : parseRate(raw) })}
              />
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
              <PctStepper
                value={savingsDefault}
                step={5}
                ariaLabel={t('Porcentaje de ahorro por defecto', 'Default savings percentage')}
                onCommit={applyToAll}
              />
              {savingsSource !== 'user' && (
                <span data-savings-source={savingsSource} className="text-[10px] block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {savingsSource === 'measured'
                    ? t(`lo que ahorraste en ${suggestedSavings.months} meses`, `what you saved over ${suggestedSavings.months} months`)
                    : savingsSource === 'profile'
                      ? t('de tu perfil financiero', 'from your financial profile')
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
                    <PctStepper
                      value={p.pct}
                      step={5}
                      accent={plan.savingsRate[p.month] != null}
                      ariaLabel={t(`Ahorro de ${months[p.month]}`, `${months[p.month]} savings`)}
                      inputTestId={p.month}
                      onCommit={(raw) => setSavingsFor(p.month, raw)}
                    />
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

          {goalRun && (
            <div data-goal-block className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h4 className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <Target size={12} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
                  {t(`¿Llegás a ${fmt(goalValue)} en ${targetYear}?`, `Do you reach ${fmt(goalValue)} by ${targetYear}?`)}
                </h4>
              </div>

              <p data-goal-verdict className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                {goalRun.reachedYear != null ? (
                  <>
                    <strong style={{ color: 'var(--accent-green)' }}>
                      {t(`Sí, en ${goalRun.reachedYear}.`, `Yes, in ${goalRun.reachedYear}.`)}
                    </strong>{' '}
                    {t(`Cerrás ${targetYear} con ${fmt(goalRun.endValue)}.`, `You close ${targetYear} with ${fmt(goalRun.endValue)}.`)}
                  </>
                ) : (
                  <>
                    {t(`Con este ritmo cerrás ${targetYear} con ${fmt(goalRun.endValue)}: te faltan ${fmt(goalRun.gap)}.`,
                       `At this pace you close ${targetYear} with ${fmt(goalRun.endValue)}: ${fmt(goalRun.gap)} short.`)}{' '}
                    {goalRun.neededPct != null
                      ? t(`Ahorrando ${goalRun.neededPct}% en vez de ${savingsDefault}% sí llegás.`,
                          `Saving ${goalRun.neededPct}% instead of ${savingsDefault}% gets you there.`)
                      : t('Ni ahorrando el 100% de lo planeado alcanza: la meta o el año necesitan moverse.',
                          'Not even saving 100% of the plan gets there: the goal or the year needs to move.')}
                  </>
                )}
              </p>

              {goalRun.neededPct != null && goalRun.reachedYear == null && (
                <button
                  type="button"
                  data-goal-apply
                  onClick={() => applyToAll(String(goalRun.neededPct))}
                  className="text-[11px] font-medium hover:underline mb-2 block"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  {t(`Poner el ahorro en ${goalRun.neededPct}%`, `Set savings to ${goalRun.neededPct}%`)}
                </button>
              )}

              <label className="flex items-center justify-between gap-2 rounded-lg border p-2 mb-2" style={{ borderColor: 'var(--card-border)' }}>
                <span className="text-[11px] min-w-0" style={{ color: 'var(--text-muted)' }}>
                  {t('Tu ingreso crece cada año', 'Your income grows each year')}
                </span>
                <PctStepper
                  value={growthPct}
                  step={1}
                  max={50}
                  ariaLabel={t('Crecimiento anual del ingreso', 'Annual income growth')}
                  onCommit={(raw) => savePlan({ ...plan, incomeGrowthPct: raw === '' ? null : Math.min(50, Math.max(0, parseRate(raw))) })}
                />
              </label>

              <div className="space-y-0.5">
                {goalRun.years.map((y) => (
                  <div key={y.year} data-goal-year={y.year} className="flex items-center justify-between gap-2 text-[11px]">
                    <span style={{ color: 'var(--text-muted)' }}>
                      {y.year}
                      {y.year === goalRun.reachedYear && (
                        <span className="ml-1 font-semibold" style={{ color: 'var(--accent-green)' }}>
                          {t('· meta', '· goal')}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums" style={{ color: y.year === goalRun.reachedYear ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                      {fmt(y.value)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                {t(`Los años después de ${year} repiten tu plan con ese crecimiento. La meta y el año salen de la card de Metas.`,
                   `Years after ${year} repeat your plan with that growth. The goal and the year come from the Goals card.`)}
              </p>
            </div>
          )}

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
