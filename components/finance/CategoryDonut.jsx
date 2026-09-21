'use client'

import { useState, useMemo, useCallback } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { buildDonut, DONUT_RADIUS } from '@/lib/financeDonut'

// La composición del gasto: parte contra todo, por MES o por AÑO.
//
// El SVG va `aria-hidden` a propósito: lo que de verdad se lee (con lector de
// pantalla o sin él) es la leyenda de abajo, que lleva el rótulo, el porcentaje
// y el monto de cada rebanada. La dona es el resumen visual, la lista es el
// dato. Mismo criterio que la gráfica de metas (FASE NE).
//
// Los colores son los de los GRUPOS, los mismos que usa el resto de la
// pantalla: una rebanada y su línea en el estado de resultados tienen que ser
// del mismo color o serían dos lenguajes sobre el mismo dinero.

const VIEWBOX = 140
const CENTER = VIEWBOX / 2
const STROKE = 22

export default function CategoryDonut({
  monthTotals, yearTotals, groups, model = null, monthLabel, year,
  lang = 'es', initialScope = 'month',
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const [scope, setScope] = useState(initialScope)
  const [active, setActive] = useState(null)

  const donut = useMemo(
    () => buildDonut(scope === 'year' ? yearTotals : monthTotals, groups, { model }),
    [scope, yearTotals, monthTotals, groups, model]
  )

  const fmt = (v) => `Q${Math.round(Math.abs(v || 0)).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US')}`

  const selected = donut.slices.find((s) => s.key === active) || null
  const centerLabel = selected
    ? (lang === 'es' ? selected.label : selected.labelEn)
    : (scope === 'year' ? String(year) : monthLabel)
  const centerValue = selected ? selected.amount : donut.total

  return (
    <div className="card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="card-title">{t('En qué se va', 'Where it goes')}</h3>
        <SegmentedTabs
          value={scope}
          onChange={(v) => { setScope(v); setActive(null) }}
          tabs={[
            { key: 'month', label: t('Mes', 'Month') },
            { key: 'year', label: t('Año', 'Year') },
          ]}
          deps={[lang]}
          ariaLabel={t('Período de la composición', 'Composition period')}
        />
      </div>

      {donut.slices.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('Sin gastos registrados en este período', 'No spending logged in this period')}
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative shrink-0" style={{ width: VIEWBOX, height: VIEWBOX }}>
            <svg width={VIEWBOX} height={VIEWBOX} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} aria-hidden="true">
              <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                {/* La pista, para que una sola rebanada del 100% no se lea como
                    un anillo cortado y para que el hueco tenga borde. En
                    --track-base y no en --bg-card-hover, que en tema claro es
                    #FFFFFF: ahí la pista no existía y el anillo se leía cortado,
                    que es justo lo que este círculo viene a evitar. */}
                <circle cx={CENTER} cy={CENTER} r={DONUT_RADIUS} fill="none"
                  stroke="var(--track-base)" strokeWidth={STROKE} />
                {donut.slices.map((s) => (
                  <circle
                    key={s.key}
                    cx={CENTER} cy={CENTER} r={DONUT_RADIUS}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={active && active !== s.key ? STROKE - 6 : STROKE}
                    strokeDasharray={s.dashArray}
                    strokeDashoffset={s.dashOffset}
                    opacity={active && active !== s.key ? 0.35 : 1}
                    style={{ transition: 'stroke-width var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)' }}
                  />
                ))}
              </g>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
              <span className="text-[10px] leading-tight truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
                {centerLabel}
              </span>
              <span className="text-sm font-bold font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {fmt(centerValue)}
              </span>
            </div>
          </div>

          <ul className="w-full min-w-0 space-y-0.5">
            {donut.slices.map((s) => {
              const on = active === s.key
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setActive(on ? null : s.key)}
                    aria-pressed={on}
                    className="w-full flex items-center gap-2 text-[11px] rounded-lg px-2 py-1 -mx-2 transition-colors hover:bg-theme-elevated"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
                    <span className="truncate min-w-0 flex-1 text-left"
                      style={{ color: on ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: on ? 600 : 400 }}>
                      {lang === 'es' ? s.label : s.labelEn}
                    </span>
                    <span className="font-mono tabular-nums shrink-0 w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                      {s.pct < 10 ? s.pct.toFixed(1) : s.pct.toFixed(0)}%
                    </span>
                    <span className="font-mono tabular-nums shrink-0 w-16 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {fmt(s.amount)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Una rebanada negativa no se puede dibujar (ver lib/financeDonut.js), y
          omitirla en silencio rompería la suma: se dice. */}
      {donut.negativeTotal < 0 && (
        <p className="mt-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t(
            `No se dibujan ${fmt(donut.negativeTotal)} de reembolsos netos: una devolución no es una rebanada del gasto.`,
            `${fmt(donut.negativeTotal)} of net refunds is not drawn: a refund is not a slice of spending.`
          )}
        </p>
      )}
    </div>
  )
}
