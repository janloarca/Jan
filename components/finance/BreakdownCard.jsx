'use client'

import { useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { categoryLabel } from '@/lib/financeCategories'

// El desglose del mes, UNA card por lado.
//
// Antes esta pantalla dibujaba el mismo dinero seis veces: los gastos salían en
// la tarjeta de resumen, en "Gastos por grupo" y otra vez en "Gastos por
// categoría"; los ingresos, en el resumen, en cuatro tiles y otra vez en
// "Ingresos por categoría". Y no eran informes distintos: la vista por
// categoría ERA la de grupos expandida un nivel, sobre el mismo arreglo y con
// el mismo total. Encima las dos barras estaban a escalas DISTINTAS (una
// dividía entre el grupo más grande y la otra entre el total del mes), así que
// la misma cantidad se dibujaba de dos tamaños según la card.
//
// Ahora es una sola vista: los grupos, y cada grupo se despliega a sus
// categorías. Una sola escala para los dos niveles, así una categoría siempre
// se ve más corta que el grupo que la contiene, que es la verdad.
export default function BreakdownCard({
  title, groups = [], total = 0, lang = 'es',
  // Por qué las variaciones están calladas. Se dice UNA vez en la cabecera en
  // lugar de dejar que cada fila parezca no tener dato.
  silentReason = null,
  emptyText,
  accentFallback = 'var(--text-muted)',
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const [open, setOpen] = useState(() => new Set())

  const toggle = useCallback((key) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Un negativo va en paréntesis contables, que es la convención que el reporte
  // impreso ya usa. Aparece cuando los reembolsos de una categoría superan lo
  // gastado en ella ese mes: una devolución grande que cae en un mes distinto
  // al de la compra. Es real y hay que mostrarlo.
  const fmt = (v) => {
    const n = Math.round((v || 0) * 100) / 100
    const s = Math.abs(n).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return n < 0 ? `(Q${s})` : `Q${s}`
  }

  // Se muestra todo lo que se movió, en cualquier dirección. Filtrar los
  // negativos haría DESAPARECER una categoría en la que hubo actividad real, y
  // desde afuera una fila omitida y una fila rota se ven igual.
  const rows = [...groups].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).filter((g) => g.amount !== 0)
  // La MISMA escala para grupos y categorías: el movimiento más grande del mes,
  // en magnitud, para que un negativo se dibuje del largo que le toca.
  const max = Math.max(...rows.map((g) => Math.abs(g.amount)), 1)
  // El ancho nunca puede ser negativo (CSS lo clampa a 0 y la barra desaparece
  // sin decir por qué): la magnitud da el largo y el signo lo carga el número.
  const barWidth = (v) => `${Math.min(100, (Math.abs(v || 0) / max) * 100)}%`

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>{fmt(total)}</span>
      </div>

      {silentReason && rows.length > 0 && (
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>{silentReason}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {emptyText || t('Sin datos este mes', 'No data this month')}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((g) => {
            const isOpen = open.has(g.key)
            const color = g.color || accentFallback
            const label = t(g.label, g.labelEn || g.label)
            const expandable = (g.categories || []).length > 1
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => expandable && toggle(g.key)}
                  aria-expanded={expandable ? isOpen : undefined}
                  disabled={!expandable}
                  className={`w-full text-left rounded-lg px-2 py-1.5 -mx-2 transition-colors ${expandable ? 'hover:bg-theme-elevated cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-secondary)' }}>
                      <span aria-hidden="true">{g.icon}</span>
                      <span className="truncate">{label}</span>
                      {expandable && (
                        <ChevronDown
                          size={12}
                          aria-hidden="true"
                          className="shrink-0 transition-transform"
                          style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none' }}
                        />
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(g.amount)}</span>
                      {/* La variación se dibuja SOLO cuando las dos ventanas
                          miden lo mismo: ver `isComparable` en financeMonth. */}
                      {g.comparable && g.momPct != null && (
                        <span
                          title={t('vs mes pasado', 'vs last month')}
                          style={{ color: g.momPct > 5 ? 'var(--alert-warn-icon)' : g.momPct < -5 ? 'var(--accent-green)' : 'var(--text-muted)' }}
                        >
                          {g.momPct >= 0 ? '↑' : '↓'}{Math.abs(g.momPct).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
                    <div className="h-full rounded-full" style={{ width: barWidth(g.amount), backgroundColor: color }} />
                  </div>
                </button>

                {isOpen && (
                  // Solo el TEXTO se indenta; las barras arrancan donde arrancan
                  // las de los grupos. Con la lista entera indentada (ml-4 +
                  // pl-3 + borde = 29px de 278) el track quedaba más angosto y
                  // una categoría se dibujaba ~10% más corta de lo que le toca:
                  // el mismo dinero a dos tamaños dentro de la misma card, que
                  // es justo lo que este rediseño vino a quitar. Medido, no a
                  // ojo: con la sangría, la suma de las barras hijas daba 271.6
                  // contra 278.3 de su padre.
                  //
                  // `px-2` es el MISMO inset horizontal que el botón del grupo
                  // (que lleva `px-2 -mx-2`): sin él las barras hijas quedaban
                  // 16px más ANCHAS que la del padre, o sea el mismo error al
                  // revés. Los dos niveles comparten track exacto.
                  <ul className="mt-1.5 mb-2 space-y-1.5 px-2">
                    {(g.categories || []).map((c) => (
                      <li key={c.category}>
                        <div className="flex items-center justify-between gap-2 text-[11px] mb-0.5 pl-4">
                          <span className="truncate flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                            {categoryLabel(c.category, lang)}
                            {c.auto && (
                              <span
                                className="text-[9px] px-1 rounded shrink-0"
                                style={{ color: 'var(--alert-info-icon)', backgroundColor: 'var(--alert-info-bg)' }}
                                title={t('Sale de los dividendos e intereses de tu portafolio. No se captura aquí.', 'Comes from your portfolio\'s dividends and interest. Not entered here.')}
                              >
                                auto
                              </span>
                            )}
                          </span>
                          <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>{fmt(c.amount)}</span>
                        </div>
                        {/* Misma escala que el grupo de arriba. */}
                        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
                          <div className="h-full rounded-full" style={{ width: barWidth(c.amount), backgroundColor: color, opacity: 0.55 }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
