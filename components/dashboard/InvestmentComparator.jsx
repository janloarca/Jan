'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatCurrency, formatCompact } from './utils'
import { CHART_PALETTE } from '@/lib/colors'
import {
  COMPOUND_OPTIONS, compareScenarios, newScenario, termMonthsOf,
} from '@/lib/investmentCompare'

// Tres inversiones con plazos y tasas distintas, en el mismo eje de años.
//
// Existe porque una calculadora de un solo escenario no contesta la pregunta
// real: cuando hay tres opciones sobre la mesa, lo que importa no es cuánto da
// cada una por separado sino cuál gana y en qué año se cruzan.
//
// Es una calculadora: no lee el portafolio ni escribe nada del archivo. Lo
// único que se guarda son los escenarios, para poder volver a la comparación
// otro día.

// Tres colores de la paleta ya validada en OKLCH para series de gráfica, en
// vez de inventar tres tonos nuevos para esta pantalla.
const SERIES_COLORS = [CHART_PALETTE[0], CHART_PALETTE[1], CHART_PALETTE[3]]
const MAX_SCENARIOS = 3

const DEFAULTS = [
  { name: 'A', ratePct: 7, compound: 'annually', years: 10 },
  { name: 'B', ratePct: 9, compound: 'monthly', years: 5 },
  { name: 'C', ratePct: 5.5, compound: 'quarterly', years: 2 },
]

export default function InvestmentComparator({
  scenarios: saved, onSave, netWorth = 0, baseCurrency = 'USD', lang = 'es',
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  const savedSig = JSON.stringify(saved || null)
  const [scenarios, setScenarios] = useState(() => hydrate(saved))
  useEffect(() => { setScenarios(hydrate(JSON.parse(savedSig))) }, [savedSig])

  const [editing, setEditing] = useState(0)

  const persist = useCallback((next) => {
    setScenarios(next)
    if (typeof onSave === 'function') onSave(next)
  }, [onSave])

  const patch = useCallback((i, changes) => {
    persist(scenarios.map((s, idx) => (idx === i ? { ...s, ...changes } : s)))
  }, [scenarios, persist])

  const addScenario = useCallback(() => {
    if (scenarios.length >= MAX_SCENARIOS) return
    const d = DEFAULTS[scenarios.length] || DEFAULTS[0]
    const next = [...scenarios, newScenario(`s${Date.now()}`, d.name, { ...d, initial: scenarios[0]?.initial || 0 })]
    persist(next)
    setEditing(next.length - 1)
  }, [scenarios, persist])

  const removeScenario = useCallback((i) => {
    const next = scenarios.filter((_, idx) => idx !== i)
    persist(next)
    setEditing((cur) => Math.max(0, Math.min(cur, next.length - 1)))
  }, [scenarios, persist])

  const comparison = useMemo(() => compareScenarios(scenarios), [scenarios])
  const fmt = (v) => formatCurrency(v, baseCurrency)

  // Geometría de la gráfica: una polilínea por escenario sobre el mismo eje,
  // así los cruces se ven donde de verdad ocurren.
  const chart = useMemo(() => {
    const all = comparison.results.flatMap((r) => r.balances).filter((v) => Number.isFinite(v))
    if (all.length < 2) return null
    const max = Math.max(...all)
    const min = Math.min(...all)
    // El eje va del mínimo al máximo, no de cero: todas las curvas arrancan en
    // el monto que se puso, así que con piso en cero la mitad de abajo queda
    // vacía y los cruces (que es lo que se viene a ver) se aplastan arriba. Los
    // dos extremos se imprimen debajo, así el eje recortado está declarado y no
    // exagera nada en silencio.
    const span = max - min
    const n = comparison.horizonMonths
    const y = (v) => (span > 0 ? 100 - ((v - min) / span) * 100 : 50)
    const lines = comparison.results.map((r) => ({
      id: r.id,
      points: r.balances.map((v, m) => `${((m / n) * 100).toFixed(2)},${y(v).toFixed(2)}`).join(' '),
    }))
    return { lines, max, min }
  }, [comparison])

  const cur = scenarios[editing]
  const labelCls = 'block text-[11px] mb-1'
  const labelStyle = { color: 'var(--text-muted)' }
  const inputCls = 'w-full px-2 py-1.5 rounded-lg border font-mono tabular-nums outline-none'
  const inputStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', color: 'var(--text-primary)' }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          {t('Comparar inversiones', 'Compare investments')}
          <InfoTip text={t(
            'Hasta tres opciones con plazos y tasas distintas, en el mismo eje de años. Cuando una vence, su saldo se congela en efectivo (0%) hasta el final de la comparación: así se ve el costo real de un plazo corto sin plan de qué sigue. No lee tu portafolio ni escribe nada.',
            'Up to three options with different terms and rates, on the same year axis. When one matures, its balance freezes as cash (0%) to the end of the comparison, so a short term without a follow-up plan shows its real cost. It does not read your portfolio or write anything.'
          )} />
        </h3>
        {scenarios.length < MAX_SCENARIOS && (
          <button type="button" onClick={addScenario} className="flex items-center gap-1 text-xs font-medium shrink-0" style={{ color: 'var(--accent-blue)' }}>
            <Plus size={12} aria-hidden="true" /> {t('Agregar', 'Add')}
          </button>
        )}
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('Tu patrimonio de hoy no entra acá: son montos que vos ponés para decidir.',
           'Your current net worth is not used here: these are amounts you enter to decide.')}
      </p>

      {/* Resumen: una fila por escenario, con su color de serie */}
      <div className="space-y-1.5 mb-3">
        {comparison.results.map((r, i) => (
          <div key={r.id} data-result={i} className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
            style={{ borderColor: i === comparison.winnerIndex ? SERIES_COLORS[i] : 'var(--card-border)' }}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SERIES_COLORS[i] }} aria-hidden="true" />
            <span className="text-xs font-medium truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
            <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
              {scenarios[i].ratePct}% · {Math.round(r.termMonths / 12 * 10) / 10}{t('a', 'y')}
            </span>
            <span className="ml-auto text-right shrink-0">
              <span className="block text-xs font-mono tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(r.endBalance)}</span>
              <span className="block text-[10px] font-mono tabular-nums" style={{ color: r.deltaVsBest < 0 ? 'var(--text-muted)' : SERIES_COLORS[i] }}>
                {r.deltaVsBest < 0 ? fmt(r.deltaVsBest) : t('mejor', 'best')}
              </span>
            </span>
          </div>
        ))}
      </div>

      {chart && (
        <div className="mb-3">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-28" aria-hidden="true">
            {chart.lines.map((l, i) => (
              <polyline key={l.id} points={l.points} fill="none" stroke={SERIES_COLORS[i]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span>{t('hoy', 'today')}</span>
            <span className="font-mono tabular-nums">
              {formatCompact(chart.min, baseCurrency)} – {formatCompact(chart.max, baseCurrency)}
            </span>
            <span>{Math.round(comparison.horizonMonths / 12 * 10) / 10} {t('años', 'years')}</span>
          </div>
        </div>
      )}

      {/* Editor: uno a la vez. Tres columnas de campos no entran en un
          teléfono, y comparar es leer la tabla, no editar tres a la vez. */}
      <div className="flex items-center gap-1 mb-2">
        {scenarios.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setEditing(i)} data-tab={i}
            aria-pressed={editing === i}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs transition-colors"
            style={{
              borderColor: editing === i ? SERIES_COLORS[i] : 'var(--card-border)',
              color: 'var(--text-primary)',
            }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERIES_COLORS[i] }} aria-hidden="true" />
            {s.name}
          </button>
        ))}
        {scenarios.length > 1 && (
          <button type="button" onClick={() => removeScenario(editing)} className="ml-auto p-1 rounded-lg"
            aria-label={t('Quitar este escenario', 'Remove this scenario')} style={{ color: 'var(--alert-error-icon)' }}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {cur && (
        <div className="rounded-lg border p-3 mb-3" style={{ borderColor: 'var(--card-border)' }}>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <label>
              <span className={labelCls} style={labelStyle}>{t('Nombre', 'Name')}</span>
              <input className={inputCls} style={inputStyle} value={cur.name}
                aria-label={t('Nombre del escenario', 'Scenario name')}
                onChange={(e) => patch(editing, { name: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Monto inicial', 'Initial amount')}</span>
              <input type="number" inputMode="decimal" className={inputCls} style={inputStyle} value={cur.initial}
                aria-label={t('Monto inicial', 'Initial amount')}
                onChange={(e) => patch(editing, { initial: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Aporte mensual', 'Monthly contribution')}</span>
              <input type="number" inputMode="decimal" className={inputCls} style={inputStyle} value={cur.monthly}
                aria-label={t('Aporte mensual', 'Monthly contribution')}
                onChange={(e) => patch(editing, { monthly: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Aporte anual', 'Annual contribution')}</span>
              <input type="number" inputMode="decimal" className={inputCls} style={inputStyle} value={cur.annual}
                aria-label={t('Aporte anual', 'Annual contribution')}
                onChange={(e) => patch(editing, { annual: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Tasa anual', 'Annual rate')} %</span>
              <input type="number" step="0.1" inputMode="decimal" className={inputCls} style={inputStyle} value={cur.ratePct}
                aria-label={t('Tasa anual', 'Annual rate')}
                onChange={(e) => patch(editing, { ratePct: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Capitalización', 'Compounding')}</span>
              <select className={inputCls} style={inputStyle} value={cur.compound}
                aria-label={t('Frecuencia de capitalización', 'Compounding frequency')}
                onChange={(e) => patch(editing, { compound: e.target.value })}>
                {COMPOUND_OPTIONS.map((o) => <option key={o.key} value={o.key}>{lang === 'es' ? o.es : o.en}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Años', 'Years')}</span>
              <input type="number" min="0" inputMode="numeric" className={inputCls} style={inputStyle} value={cur.years}
                aria-label={t('Plazo en años', 'Term in years')}
                onChange={(e) => patch(editing, { years: e.target.value })} />
            </label>
            <label>
              <span className={labelCls} style={labelStyle}>{t('Meses', 'Months')}</span>
              <input type="number" min="0" max="11" inputMode="numeric" className={inputCls} style={inputStyle} value={cur.months}
                aria-label={t('Plazo en meses', 'Term in months')}
                onChange={(e) => patch(editing, { months: e.target.value })} />
            </label>
          </div>

          <span className={labelCls} style={labelStyle}>{t('¿Cuándo entra el aporte?', 'When does the contribution land?')}</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'beginning', label: t('Al inicio del período', 'Beginning of period') },
              { key: 'end', label: t('Al final del período', 'End of period') },
            ].map((opt) => (
              <button key={opt.key} type="button" onClick={() => patch(editing, { contributeAt: opt.key })}
                aria-pressed={cur.contributeAt === opt.key}
                className="rounded-lg border px-2 py-1.5 text-[11px] transition-colors"
                style={{
                  borderColor: cur.contributeAt === opt.key ? 'var(--accent-blue)' : 'var(--card-border)',
                  backgroundColor: cur.contributeAt === opt.key ? 'var(--alert-info-bg)' : 'transparent',
                  color: 'var(--text-primary)',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Año por año. Scrollea dentro de su propia caja: la página nunca
          scrollea de lado. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-[11px]" style={{ minWidth: 60 + scenarios.length * 90 }}>
          <thead>
            <tr>
              <th className="text-left font-medium py-1 pr-2" style={{ color: 'var(--text-muted)' }}>{t('Año', 'Year')}</th>
              {comparison.results.map((r, i) => (
                <th key={r.id} className="text-right font-medium py-1 pl-2" style={{ color: SERIES_COLORS[i] }}>{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.yearly.map((row) => (
              <tr key={row.year} data-year={row.year} className="border-t" style={{ borderColor: 'var(--card-border)' }}>
                <td className="py-1 pr-2 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {row.partial ? `${Math.round(comparison.horizonMonths / 12 * 10) / 10}` : row.year}
                </td>
                {row.values.map((v, i) => (
                  <td key={i} className="py-1 pl-2 text-right font-mono tabular-nums"
                    style={{
                      color: i === row.bestIndex ? SERIES_COLORS[i] : 'var(--text-secondary)',
                      fontWeight: i === row.bestIndex ? 600 : 400,
                    }}>
                    {fmt(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
        {t('Al vencer un plazo, ese saldo se congela en efectivo hasta el final de la comparación. Sin impuestos ni inflación.',
           'When a term ends, that balance freezes as cash to the end of the comparison. No taxes or inflation.')}
      </p>
    </div>
  )
}

function hydrate(saved) {
  if (Array.isArray(saved) && saved.length > 0) {
    return saved.slice(0, MAX_SCENARIOS).map((s, i) => newScenario(s?.id || `s${i}`, s?.name || DEFAULTS[i]?.name || `${i + 1}`, s))
  }
  return DEFAULTS.slice(0, 2).map((d, i) => newScenario(`s${i}`, d.name, { ...d, initial: 10000 }))
}
