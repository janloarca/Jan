'use client'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'

import { useState, useMemo } from 'react'
import { formatCurrency, formatCompact } from './utils'
import { runMonteCarloSimulation } from './analytics'

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

function compoundMonthlyNeeded(currentValue, goalValue, annualRate, years) {
  if (years <= 0 || goalValue <= currentValue) return 0
  const r = annualRate / 100 / 12
  const n = years * 12
  if (r === 0) return (goalValue - currentValue) / n
  const fvCurrent = currentValue * Math.pow(1 + r, n)
  const gap = goalValue - fvCurrent
  if (gap <= 0) return 0
  return (gap * r) / (Math.pow(1 + r, n) - 1)
}

export default function GoalTracker({ netWorth, annualDividends, estimatedAnnualIncome, goals, onSaveGoals, volatility, lang, convert = null, baseCurrency = null }) {
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
  const yearsLeft = Math.max(0, targetYear - new Date().getFullYear())

  const effectiveIncome = Math.max(annualDividends || 0, estimatedAnnualIncome || 0)
  // Clamp por AMBOS lados: un patrimonio negativo (deuda mayor que activos)
  // producía un "-15%" con barra invisible.
  const incomePct = incomeGoal > 0 ? Math.max(0, Math.min(100, (effectiveIncome / incomeGoal) * 100)) : 0
  const portfolioPct = portfolioGoal > 0 ? Math.max(0, Math.min(100, (netWorth / portfolioGoal) * 100)) : 0

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
      monthly: compoundMonthlyNeeded(netWorth, portfolioGoal, s.rate, yearsLeft),
    }))
  }, [netWorth, portfolioGoal, yearsLeft, lang])

  const goalProbability = useMemo(() => {
    if (yearsLeft <= 0 || portfolioGoal <= 0 || netWorth <= 0) return null
    const baseMonthly = scenarios.find((s) => s.key === 'base')?.monthly || 0
    const vol = volatility ? volatility / 100 : 0.15
    const result = runMonteCarloSimulation({
      startValue: netWorth,
      monthlyContribution: baseMonthly,
      years: yearsLeft,
      expectedReturn: 0.07,
      volatility: vol,
      numSimulations: 500,
      goalValue: portfolioGoal,
    })
    return result.goalProbability
  }, [netWorth, portfolioGoal, yearsLeft, volatility, scenarios])

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
          {!editing && (
            <span className="text-xs text-slate-500 bg-theme-base px-2 py-0.5 rounded">
              {t(`Meta: ${targetYear}`, `Target: ${targetYear}`)} · {yearsLeft}{t(' años', 'y')}
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
              <span className="text-xs text-slate-500">{formatCurrency(netWorth)}</span>
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
                  <span className="text-xs text-slate-600 mt-1 block">
                    {t('Monte Carlo · 500 simulaciones · supone retorno 7%/año', 'Monte Carlo · 500 simulations · assumes 7%/yr return')}
                    {volatility ? '' : t(' y volatilidad 15%', ' and 15% volatility')}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Scenario-based monthly needed */}
          {yearsLeft > 0 && portfolioGoal > netWorth && (
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
              <span className="text-xs text-slate-400 mb-2 block">{t('Inversión mensual necesaria', 'Monthly investment needed')}</span>
              <div className="space-y-1.5">
                {scenarios.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-xs text-slate-600">{s.rate}%/yr</span>
                    </div>
                    <span className="text-sm font-bold text-white">{formatCurrency(s.monthly)}<span className="text-xs text-slate-500 font-normal">/{t('mes', 'mo')}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
