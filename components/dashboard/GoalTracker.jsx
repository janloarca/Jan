'use client'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'

import { useState, useMemo, useEffect } from 'react'
import { formatCurrency, formatCompact } from './utils'
import { runMonteCarloSimulation } from './analytics'
import { monthsUntilGoal, monthlyNeeded, measuredMonthlyContribution } from '@/lib/goalProjection'

// Rango legal del año objetivo: el input declara min/max pero un type="number"
// no impide TECLEAR 99999, y `yearsLeft` alimenta directo al Monte Carlo
// (años × 12 meses × 500 simulaciones): sin tope, un año basura ya guardado
// congelaba el navegador. Se clampa al GUARDAR y también al LEER, para que un
// dato malo ya escrito no reviente la card.
export const GOAL_MAX_YEAR = 2060
export function clampTargetYear(v, currentYear = new Date().getFullYear()) {
  const n = parseInt(v)
  if (!Number.isFinite(n)) return currentYear + 5
  return Math.min(GOAL_MAX_YEAR, Math.max(currentYear, n))
}

// Un valor guardado se lee con coerción NUMÉRICA y default explícito, nunca con
// `||`: un goal guardado en 0 es falsy, así que `goals.incomeGoal ||
// form.incomeGoal` caía al STRING del formulario. Dos daños: lo
// tecleado-y-CANCELADO se mostraba en la vista de lectura como si se hubiera
// guardado, y con un string menor a 1000 `formatCompact` moría en
// `'999'.toFixed is not a function` (su última rama llama .toFixed sobre el
// valor crudo) y la card entera crasheaba.
export function readGoal(v, dflt) {
  if (v == null || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}

// FASE LL. Una meta tiene MONEDA propia (decision del usuario, 26 ago 2026):
// antes se comparaba contra el patrimonio en la moneda base DEL MOMENTO, asi
// que cambiar la base re-interpretaba la meta en silencio (una meta de
// 100,000 pasaba de dolares a quetzales sin que nadie la tocara). Ahora cada
// guardado estampa `goalCurrency` (la base que el usuario estaba viendo al
// teclear los numeros) y el progreso CONVIERTE la meta a la base actual.
//
// Una meta vieja sin `goalCurrency` conserva el comportamiento de siempre
// (se lee en la base del momento): inventarle una moneda a un dato viejo
// seria adivinar; se estampa sola en el proximo guardado. Y sin converter
// (tasas aun sin cargar) cae al monto crudo, el mismo respaldo del resto de
// la app.
export function goalInBase(amount, goalCurrency, baseCurrency, convert) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  if (!goalCurrency || !baseCurrency || goalCurrency === baseCurrency) return n
  if (typeof convert !== 'function') return n
  const out = convert(n, goalCurrency, baseCurrency)
  return Number.isFinite(out) ? out : n
}

// ⛔ Una meta de "Tamaño de portfolio" se mide contra los ACTIVOS, no contra el
// patrimonio neto. Con una deuda viva las dos cifras difieren, y contra el neto
// pagar la deuda contaría como crecimiento del portafolio (y pedir prestado como
// encogimiento) sin que un solo activo se hubiera movido: la misma distinción
// que FASE LU/LV fijó para el rendimiento, acá para la meta. `netWorth` se
// conserva como respaldo para un caller que no pase activos, y sin deuda las dos
// son la misma cifra.
function portfolioValue(totalAssets, netWorth) {
  const a = Number(totalAssets)
  if (Number.isFinite(a) && a !== 0) return a
  const n = Number(netWorth)
  return Number.isFinite(n) ? n : 0
}

export default function GoalTracker({ netWorth, totalAssets = null, annualDividends, estimatedAnnualIncome, goals, onSaveGoals, volatility, lang, convert = null, baseCurrency = null, transactions = null, items = null }) {
  const [editing, setEditing] = useState(false)
  // El form trabaja SIEMPRE en la base actual: lo guardado se siembra ya
  // convertido (si la meta vivia en otra moneda) para que lo que se ve, lo que
  // se edita y lo que se estampa (goalCurrency = base actual) signifiquen lo
  // mismo. Se siembra al ABRIR la edicion, no al montar, para no sembrar con
  // las tasas aun frias.
  const [form, setForm] = useState({
    incomeGoal: goals?.incomeGoal || 12000,
    portfolioGoal: goals?.portfolioGoal || 100000,
    targetYear: goals?.targetYear || new Date().getFullYear() + 5,
  })

  const t = (es, en) => lang === 'es' ? es : en

  // La vista de lectura sale SOLO de lo guardado (con defaults), jamás del
  // form: ver readGoal arriba. Antes del primer guardado los defaults son los
  // mismos que sembraban el form, así que nada cambia para una cuenta nueva.
  // FASE LL: la meta guardada se convierte a la base ACTUAL para comparar y
  // mostrar; su significado vive en goalCurrency y ya no se mueve con la base.
  const goalCurrency = goals?.goalCurrency || null
  const incomeGoal = goalInBase(readGoal(goals?.incomeGoal, 12000), goalCurrency, baseCurrency, convert)
  const portfolioGoal = goalInBase(readGoal(goals?.portfolioGoal, 100000), goalCurrency, baseCurrency, convert)
  const targetYear = clampTargetYear(goals?.targetYear)
  // Meses, no años enteros: ver monthsUntilGoal. El horizonte se endurece solo
  // mes a mes en vez de quedarse quieto doce meses y caer de golpe en enero.
  const monthsLeft = monthsUntilGoal(targetYear)

  const portfolioNow = portfolioValue(totalAssets, netWorth)
  const effectiveIncome = Math.max(annualDividends || 0, estimatedAnnualIncome || 0)
  // Clamp por AMBOS lados: un patrimonio negativo (deuda mayor que activos)
  // producía un "-15%" con barra invisible.
  const incomePct = incomeGoal > 0 ? Math.max(0, Math.min(100, (effectiveIncome / incomeGoal) * 100)) : 0
  const portfolioPct = portfolioGoal > 0 ? Math.max(0, Math.min(100, (portfolioNow / portfolioGoal) * 100)) : 0

  const scenarios = useMemo(() => {
    const rates = [
      // Eran hexes del tema oscuro: 1.67:1 y 1.81:1 sobre la card blanca. La
      // etiqueta ("Conservador/Base/Optimista") ya dice cuál es cuál, así que el
      // color solo tenía que ser legible.
      { key: 'conservative', rate: 5, label: t('Conservador', 'Conservative'), color: 'var(--alert-warn-icon)' },
      { key: 'base', rate: 7, label: t('Base', 'Base'), color: 'var(--accent-green)' },
      { key: 'optimistic', rate: 10, label: t('Optimista', 'Optimistic'), color: 'var(--accent-blue)' },
    ]
    return rates.map((s) => ({
      ...s,
      monthly: monthlyNeeded(portfolioNow, portfolioGoal, s.rate, monthsLeft),
    }))
  }, [portfolioNow, portfolioGoal, monthsLeft, lang])

  // Lo que el usuario aporta DE VERDAD, medido de sus propios movimientos.
  const contribution = useMemo(
    () => measuredMonthlyContribution({ transactions, items, convert, baseCurrency }),
    [transactions, items, convert, baseCurrency],
  )

  // ⛔ La simulación corre con el aporte MEDIDO, jamás con el "necesario": ver
  // lib/goalProjection.js. Con el necesario la pregunta era circular y la
  // respuesta salía ~50% aunque la meta fuera imposible.
  //
  // Sin aporte medible NO se muestra probabilidad: inventarle un ritmo de
  // aporte a alguien que nunca capturó su historia es afirmar algo sobre su
  // conducta que nadie dijo, y es justo lo que hacía la versión vieja.
  //
  // Corre en un EFECTO y jamás durante el render, aunque un useMemo pareciera
  // lo natural: la simulación usa `Math.random()`, así que el servidor y el
  // cliente producen números DISTINTOS y React descarta el árbol servido
  // (errores de hidratación #418/#423/#425, medidos en el navegador; el defecto
  // venía de antes de esta pasada). Es la misma lección que la fecha de corte
  // del link compartido y la de la pantalla de error: lo que no puede dar el
  // mismo resultado en los dos lados se calcula después de montar.
  const [goalProbability, setGoalProbability] = useState(null)
  useEffect(() => {
    if (monthsLeft <= 0 || portfolioGoal <= 0 || portfolioNow <= 0 || !contribution.measurable) {
      setGoalProbability(null)
      return
    }
    const vol = volatility ? volatility / 100 : 0.15
    const result = runMonteCarloSimulation({
      startValue: portfolioNow,
      monthlyContribution: contribution.monthly,
      years: monthsLeft / 12,
      expectedReturn: 0.07,
      volatility: vol,
      numSimulations: 500,
      goalValue: portfolioGoal,
    })
    setGoalProbability(result.goalProbability)
  }, [portfolioNow, portfolioGoal, monthsLeft, volatility, contribution])

  const handleSave = async () => {
    if (onSaveGoals) {
      await onSaveGoals({
        incomeGoal: parseAmount(form.incomeGoal),
        portfolioGoal: parseAmount(form.portfolioGoal),
        // Clampeado al escribir además de al leer: el min/max del input no
        // impide teclear un año fuera de rango.
        targetYear: clampTargetYear(form.targetYear),
        // FASE LL: los numeros tecleados significan la moneda que el usuario
        // estaba viendo. Sin base conocida no se estampa nada (legacy intacto).
        ...(baseCurrency ? { goalCurrency: baseCurrency } : {}),
      })
    }
    setEditing(false)
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('METAS FINANCIERAS', 'FINANCIAL GOALS')}
        </h3>
        <div className="flex items-center gap-2">
          {/* En MESES cuando faltan menos de tres años: es un conteo regresivo y
              tiene que verse bajar. En años enteros se quedaba quieto doce meses
              seguidos y despues caia de golpe. */}
          {!editing && (
            <span className="text-xs text-slate-500 bg-theme-base px-2 py-0.5 rounded">
              {t(`Meta: ${targetYear}`, `Target: ${targetYear}`)} · {monthsLeft < 36
                ? `${monthsLeft}${t(' meses', 'mo')}`
                : `${Math.round(monthsLeft / 12)}${t(' años', 'y')}`}
            </span>
          )}
          <button onClick={() => { setEditing(!editing); if (!editing) setForm({ incomeGoal, portfolioGoal, targetYear }) }}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            {editing ? t('Cancelar', 'Cancel') : t('Editar', 'Edit')}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t('Meta de ingreso pasivo anual', 'Annual passive income goal')}</label>
              <AmountInput value={form.incomeGoal} onChange={(e) => setForm({ ...form, incomeGoal: e.target.value })}
                placeholder="12000"
                className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t('Meta de portfolio', 'Portfolio goal')}</label>
              <AmountInput value={form.portfolioGoal} onChange={(e) => setForm({ ...form, portfolioGoal: e.target.value })}
                placeholder="100000"
                className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('Año objetivo', 'Target year')}</label>
            <input value={form.targetYear} onChange={(e) => setForm({ ...form, targetYear: e.target.value })}
              type="number" inputMode="numeric" min={new Date().getFullYear()} max="2060" placeholder="2030"
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
          <button onClick={handleSave}
            className="w-full py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
            {t('Guardar metas', 'Save goals')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* La meta vive en OTRA moneda que la base actual: decirlo es lo que
              hace visible que cambiar la base ya no la re-interpreta. */}
          {goalCurrency && baseCurrency && goalCurrency !== baseCurrency && (
            <p className="text-[11px] -mb-2" style={{ color: 'var(--text-muted)' }}>
              {t(`Meta fijada en ${goalCurrency}; se muestra convertida a ${baseCurrency}.`,
                 `Goal set in ${goalCurrency}; shown converted to ${baseCurrency}.`)}
            </p>
          )}
          {/* Income goal */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white font-medium">{t('Ingreso pasivo', 'Passive income')}</span>
                <span className="text-xs text-slate-500 bg-theme-base px-1.5 py-0.5 rounded">{formatCompact(incomeGoal)}/{t('año', 'yr')}</span>
              </div>
              <span className="text-xs font-bold" style={{ color: incomePct >= 75 ? 'var(--accent-green)' : incomePct >= 25 ? 'var(--accent-orange)' : 'var(--text-negative)' }}>{incomePct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="h-full rounded-full bar-fill"
                style={{ width: `${incomePct}%`, background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-blue-soft))' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-slate-500">{formatCurrency(effectiveIncome)}</span>
              <span className="text-xs text-slate-500">{formatCurrency(incomeGoal)}</span>
            </div>
          </div>

          {/* Portfolio goal */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white font-medium">{t('Tamaño de portfolio', 'Portfolio size')}</span>
                <span className="text-xs text-slate-500 bg-theme-base px-1.5 py-0.5 rounded">{formatCompact(portfolioGoal)}</span>
              </div>
              <span className="text-xs font-bold" style={{ color: portfolioPct >= 75 ? 'var(--accent-green)' : portfolioPct >= 25 ? 'var(--accent-orange)' : 'var(--text-negative)' }}>{portfolioPct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="h-full rounded-full bar-fill"
                style={{ width: `${portfolioPct}%`, background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-blue-soft))' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-slate-500">{formatCurrency(portfolioNow)}</span>
              <span className="text-xs text-slate-500">{formatCurrency(portfolioGoal)}</span>
            </div>
          </div>

          {/* Goal probability */}
          {goalProbability != null && (() => {
            const probColor = goalProbability >= 70 ? 'var(--accent-green)' : goalProbability >= 40 ? 'var(--accent-orange)' : 'var(--text-negative)'
            const probLabel = goalProbability >= 70 ? t('Alta', 'High') : goalProbability >= 40 ? t('Moderada', 'Moderate') : t('Baja', 'Low')
            return (
              <div className="flex items-center gap-4 px-4 py-3 bg-theme-base rounded-xl border border-glass-border/50">
                <div className="relative w-20 h-20 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--bg-tertiary)" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15" fill="none"
                      stroke={probColor}
                      strokeWidth="2.5" strokeDasharray={`${goalProbability * 0.942} 94.2`}
                      strokeLinecap="round" transform="rotate(-90 18 18)" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold text-white leading-none">{goalProbability}%</span>
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-white block">{t('Probabilidad de éxito', 'Probability of success')}</span>
                  <span className="text-xs font-medium mt-0.5 block" style={{ color: probColor }}>{probLabel}</span>
                  {/* Decir CON QUÉ APORTE se corrió es la mitad del dato: sin
                      eso, un 12% se lee como "la meta es mala" cuando lo que
                      dice es "a este ritmo de aporte no llegas". */}
                  <span className="text-xs text-slate-600 mt-1 block">
                    {t(`Monte Carlo · 500 simulaciones · con tu aporte medido de ${formatCurrency(contribution.monthly)}/mes y retorno 7%/año`,
                       `Monte Carlo · 500 simulations · with your measured ${formatCurrency(contribution.monthly)}/mo contribution and 7%/yr return`)}
                    {volatility ? '' : t(' y volatilidad 15%', ' and 15% volatility')}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Scenario-based monthly needed */}
          {monthsLeft > 0 && portfolioGoal > portfolioNow && (() => {
            const base = scenarios.find((s) => s.key === 'base')
            const gap = contribution.measurable && base ? contribution.monthly - base.monthly : null
            return (
              <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
                <span className="text-xs text-slate-400 mb-2 block">
                  {t(`Inversión mensual necesaria · ${monthsLeft} meses`, `Monthly investment needed · ${monthsLeft} months`)}
                </span>
                <div className="space-y-1.5">
                  {scenarios.map((s) => (
                    <div key={s.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>
                        <span className="text-xs text-slate-600">{s.rate}%/yr</span>
                      </div>
                      {/* Un "$0.00/mes" es cierto (a esa tasa el crecimiento
                          solo ya llega) pero se lee como "no se sabe": se dice
                          con palabras. */}
                      {s.monthly > 0 ? (
                        <span className="text-sm font-bold text-white">{formatCurrency(s.monthly)}<span className="text-xs text-slate-500 font-normal">/{t('mes', 'mo')}</span></span>
                      ) : (
                        <span className="text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>{t('sin aportar nada', 'no contributions needed')}</span>
                      )}
                    </div>
                  ))}
                </div>
                {/* La comparación que de verdad contesta "¿voy bien?": lo que
                    hace falta contra lo que estás aportando. Sale de tus propios
                    movimientos, así que solo se dibuja cuando se pudo medir. */}
                {gap != null && (
                  <div className="mt-2.5 pt-2.5 border-t flex items-center justify-between" style={{ borderColor: 'var(--card-border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('Estás aportando', 'You are contributing')}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: gap >= 0 ? 'var(--accent-green)' : 'var(--alert-warn-icon)' }}>
                      {formatCurrency(contribution.monthly)}/{t('mes', 'mo')}
                      {' · '}
                      {gap >= 0
                        ? t(`${formatCurrency(gap)} de sobra`, `${formatCurrency(gap)} to spare`)
                        : t(`faltan ${formatCurrency(-gap)}`, `${formatCurrency(-gap)} short`)}
                    </span>
                  </div>
                )}
                {!contribution.measurable && (
                  <p className="text-xs mt-2.5 pt-2.5 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
                    {contribution.reason === 'too-short'
                      ? t('Todavía no hay suficiente historial para medir cuánto aportas al mes, así que no se estima probabilidad de éxito.',
                          'Not enough history yet to measure your monthly contribution, so no probability of success is estimated.')
                      : t('No hay movimientos registrados de los cuales medir cuánto aportas al mes, así que no se estima probabilidad de éxito. Registra tus aportes y aparece sola.',
                          'No recorded movements to measure your monthly contribution from, so no probability of success is estimated. Record your contributions and it shows up on its own.')}
                  </p>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
