'use client'

import { useEdgeFade } from '@/hooks/useEdgeFade'

// "Elegí uno de N", UNA sola vez.
//
// El Patrimonio tenía CUATRO lenguajes visuales para esto en la misma pantalla:
// las pestañas de Análisis (pastillas sobre un riel, con difuminado de borde),
// las de Asignación de Activos (idénticas pero `inline-flex` y SIN difuminado,
// o sea ya habían divergido de tanto copiarse a mano), el selector de modo de la
// gráfica (subrayado) y el de período (pastillas con glow). Cuatro formas de
// decir lo mismo, en un área que se lee de un vistazo.
//
// Tamaño de objetivo: 28px de alto, no los 24 exactos que tenían antes. WCAG 2.2
// SC 2.5.8 pide 24x24 y las pestañas viejas medían exactamente eso, o sea
// pasaban con cero margen; en un iPad con el pulgar, cero margen se siente como
// que no responde.
//
// El difuminado va SIEMPRE (`useEdgeFade` solo lo dibuja cuando de verdad hay
// contenido escondido), que es lo que le faltaba a la fila de Asignación.
export default function SegmentedTabs({
  tabs,
  value,
  onChange,
  // `tabs`: cambiar de vista. `range`: elegir un período. Misma familia visual,
  // la diferencia es solo cuánto respira cada pastilla.
  variant = 'tabs',
  // Se le pasa lo que deba re-medir el difuminado (idioma, número de pestañas).
  deps = [],
  ariaLabel,
  className = '',
}) {
  const fade = useEdgeFade([value, tabs.length, ...deps])
  const pad = variant === 'range' ? 'px-3 py-1.5' : 'px-3 py-1.5'

  return (
    <div
      ref={fade.ref}
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-0.5 p-1 rounded-[10px] max-w-full overflow-x-auto ${className}`}
      style={{ backgroundColor: 'var(--bg-tertiary)', ...fade.maskStyle }}
    >
      {tabs.map((tb) => {
        const active = value === tb.key
        return (
          <button
            key={tb.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tb.key)}
            title={tb.title}
            // min-h-[28px]: ver la nota de SC 2.5.8 arriba.
            className={`${pad} min-h-[28px] text-caption font-medium rounded-md transition-all whitespace-nowrap shrink-0`}
            style={active
              ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-card)' }
              : { color: 'var(--text-muted)' }}
          >
            {tb.label}
          </button>
        )
      })}
    </div>
  )
}
