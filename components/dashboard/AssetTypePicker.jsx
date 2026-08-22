'use client'

import { Check } from 'lucide-react'
import { FIRST_RUN_CATEGORIES } from '@/lib/firstRunPlan'

/**
 * "¿Qué tienes?", UNA sola vez.
 *
 * La misma pregunta se hace ahora en dos lugares: en la pantalla de bienvenida
 * (donde ES la pantalla) y dentro del recorrido guiado (cuando alguien vuelve
 * con "Agregar algo más"). Dos copias de la grilla es exactamente cómo una se
 * queda atrás, así que acá vive la única: una sola regla de deshabilitado, un
 * solo contador, un solo lugar donde se escribe "Empezar (N)".
 *
 * No tiene estado propio A PROPÓSITO: `picked` lo posee quien lo monta. Eso es
 * lo que permite que la selección sobreviva a entrar y salir del recorrido sin
 * inventar una segunda fuente de verdad.
 *
 * La marca de seleccionado NO puede ser solo el color: este repo ya fija como
 * invariante que el significado nunca lo carga un tinte solo (verde y rojo
 * miden 1.14:1 entre sí, y un tinte azul sobre una card blanca es todavía más
 * sutil). Por eso va un check dentro de la pastilla, más `aria-pressed`.
 */
export default function AssetTypePicker({
  picked = [],
  onToggle,
  onStart,
  lang = 'es',
  // 'page' respira más y usa tres columnas donde hay ancho; 'modal' conserva
  // las dos de siempre. Cambia el espacio, jamás las opciones ni la regla.
  variant = 'page',
  startAction = null,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const cols = variant === 'page' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'

  return (
    <div className="space-y-4">
      <div className={`grid ${cols} gap-2`}>
        {FIRST_RUN_CATEGORIES.map((c) => {
          const on = picked.includes(c.key)
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(c.key)}
              // Son nueve, así que en dos columnas la última queda huérfana con
              // medio renglón vacío al lado. La última es justo el broker, que
              // NO es un tipo de activo sino un atajo, así que ocupar el ancho
              // llena el hueco y de paso dice que es de otra naturaleza. En tres
              // columnas los nueve cierran exacto y no hace falta.
              className={`flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-xl text-caption text-left transition-colors${
                c.isBroker ? (variant === 'page' ? ' col-span-2 sm:col-span-1' : ' col-span-2') : ''}`}
              style={{
                border: on ? '1px solid var(--accent-blue)' : 'var(--glass-border)',
                backgroundColor: on
                  ? 'color-mix(in srgb, var(--accent-blue) 12%, transparent)'
                  : 'var(--bg-card)',
                color: 'var(--text-primary)',
              }}
            >
              <span className="text-lg shrink-0" aria-hidden="true">{c.icon}</span>
              <span className="min-w-0 flex-1">{t(c.es, c.en)}</span>
              {/* La señal que no depende del color. */}
              {on && (
                <Check size={15} strokeWidth={3} className="shrink-0"
                  style={{ color: 'var(--accent-blue)' }} aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      {onStart && (
        <button
          type="button"
          onClick={onStart}
          disabled={picked.length === 0}
          className="w-full px-4 py-3 min-h-[44px] rounded-xl text-body font-semibold transition-opacity disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
        >
          {picked.length === 0
            ? t('Marca al menos uno', 'Check at least one')
            : (startAction || t(`Empezar (${picked.length})`, `Start (${picked.length})`))}
        </button>
      )}
    </div>
  )
}
