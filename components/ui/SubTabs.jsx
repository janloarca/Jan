'use client'

// El segundo nivel de un selector: una fila de chips DEBAJO de SegmentedTabs,
// dentro de la misma card (nunca un menú flotante). Vivía escrita a mano en
// Análisis; con Asignación de Activos usándola también, dos copias es cómo una
// se queda atrás, así que vive acá.
//
// Mismo idioma de "seleccionado" que SegmentedTabs (relleno neutro + tinta
// primaria), un nivel más liviano: el gris plano del riel en vez de la pastilla
// blanca elevada.
export default function SubTabs({ tabs, value, onChange, ariaLabel, className = '' }) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex flex-wrap items-center gap-1 ${className}`}>
      {tabs.map((v) => {
        const on = v.key === value
        return (
          <button key={v.key} type="button" onClick={() => onChange(v.key)}
            aria-pressed={on}
            className="px-2.5 min-h-[28px] text-caption rounded-md transition-colors"
            style={on
              ? { color: 'var(--text-primary)', backgroundColor: 'var(--bg-tertiary)', fontWeight: 600 }
              : { color: 'var(--text-muted)' }}>
            {v.label}
          </button>
        )
      })}
    </div>
  )
}
