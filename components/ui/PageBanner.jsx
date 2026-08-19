'use client'

// La tira de aviso ANCHA que va arriba de una pantalla, antes del contenido.
//
// Por qué no es `InlineNotice`: aquel es un aviso COMPACTO dentro de una card
// (una línea a 12px, acción subrayada como salida secundaria). Este es de nivel
// de página: texto a 14px, ícono propio, un botón relleno que es la acción
// principal, y a veces una salida secundaria al lado. Meter los dos en un solo
// componente pedía props de tamaño, de ícono y un slot de acciones, o sea
// convertirlo en una bolsa de configuración donde el ahorro sería ilusorio.
//
// Lo que sí comparten, y es lo que importa que no derive: los MISMOS tokens
// `--alert-*`, que ya traen su juego real para tema claro y oscuro. Ningún hex
// fijo en ninguno de los dos.
//
// El duplicado que esto elimina era real: `app/dashboard/page.jsx` tenía SEIS
// copias casi idénticas de un bloque de ~20 líneas, que solo diferían en el
// texto, en el rótulo del botón y en si llevaba o no el link de "Desconectar".

const ICONS = {
  warn: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
  ),
  refresh: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  ),
}

export default function PageBanner({
  tone = 'warn',
  // 'warn' (triángulo) o 'refresh' (flechas). Se elige aparte del tono porque
  // el aviso de versión nueva es informativo pero su ícono es de recarga.
  icon = 'warn',
  children,
  actionLabel,
  onAction,
  // La salida secundaria (hoy: "Desconectar"). Va como texto, no como botón:
  // deshacer la conexión no es lo que el aviso está pidiendo que hagas.
  secondaryLabel,
  onSecondary,
  className = '',
}) {
  // `brand` es el azul de marca, para un aviso que no es una alerta (la versión
  // nueva). Sale de `--accent-blue` por color-mix en vez de los rgba fijos que
  // estaban escritos a mano, así que sigue al token si la marca cambia.
  const isBrand = tone === 'brand'
  const ink = isBrand ? 'var(--accent-blue)' : `var(--alert-${tone}-icon)`
  const bg = isBrand ? 'color-mix(in srgb, var(--accent-blue) 10%, transparent)' : `var(--alert-${tone}-bg)`
  const edge = isBrand ? 'color-mix(in srgb, var(--accent-blue) 20%, transparent)' : `var(--alert-${tone}-border)`

  return (
    <div
      role="status"
      // `flex-wrap` + `gap-y-2`: en un teléfono el `justify-between` con botones
      // `shrink-0` estrujaba el texto a una palabra por línea (FASE HX).
      className={`px-4 py-3 rounded-xl flex flex-wrap items-center justify-between gap-y-2 ${className}`}
      style={{ backgroundColor: bg, border: `1px solid ${edge}` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg aria-hidden="true" className="w-4 h-4 shrink-0" style={{ color: ink }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {ICONS[icon] || ICONS.warn}
        </svg>
        <p className="text-sm font-medium" style={{ color: ink }}>{children}</p>
      </div>

      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-3 shrink-0">
          {secondaryLabel && onSecondary && (
            <button type="button" onClick={onSecondary} className="text-xs transition-colors"
              style={{ color: ink, opacity: 0.7 }}>
              {secondaryLabel}
            </button>
          )}
          {actionLabel && onAction && (
            <button type="button" onClick={onAction}
              className="text-xs font-medium px-3 py-1.5 min-h-[28px] rounded-lg transition-colors"
              style={{ backgroundColor: ink, color: '#fff' }}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
