'use client'

import BusyLabel from '@/components/ui/BusyLabel'

// Aviso COMPACTO dentro de una card: una línea, un tono, y opcionalmente una
// acción para reintentar. Es lo que va cuando el contenido no se pudo cargar
// pero la pantalla sigue siendo usable.
//
// Por qué existe pudiendo usar components/ui/ErrorState.jsx: aquel es un bloque
// de PÁGINA ENTERA (py-12, ícono grande, centrado) y pinta en rojo con rgba
// fijos de tema oscuro. Dos problemas para este caso. Uno, ocupar media
// pantalla para decir "no se pudo cargar el ranking" es desproporcionado. Dos,
// la regla de producto que fija lib/toastStyle.js: el ROJO queda reservado para
// algo grave o irreversible, y algo que se arregla tocando "Reintentar" no es
// ninguna de las dos: eso es ámbar.
//
// La forma ya estaba DUPLICADA a mano en el repo (los banners de
// app/dashboard/page.jsx y la tira de PortfolioGrowthChart.jsx), así que esto no
// inventa un patrón: le da casa. Migrar esos dos es un cambio aparte; mientras
// tanto el consumidor es la pantalla de Amigos.
//
// Los colores salen de los tokens --alert-*, que ya tienen su juego real para
// tema claro y oscuro (globals.css). Nada de hex fijos: un ámbar de tema oscuro
// sobre una card blanca es exactamente el defecto que este archivo evita.

const ICON = { warn: '⚠', info: 'ℹ', error: '✕', success: '✓' }

export default function InlineNotice({
  tone = 'warn',
  children,
  actionLabel,
  onAction,
  busy = false,
  className = '',
}) {
  const name = ICON[tone] ? tone : 'warn'
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 rounded-lg text-xs border ${className}`}
      style={{
        backgroundColor: `var(--alert-${name}-bg)`,
        borderColor: `var(--alert-${name}-border)`,
        color: `var(--alert-${name}-icon)`,
      }}
    >
      <span aria-hidden="true" className="shrink-0">{ICON[name]}</span>
      <span className="flex-1 min-w-0">{children}</span>
      {onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          // `underline` y no un botón relleno: es una salida secundaria dentro
          // de un aviso, no la acción principal de la pantalla. currentColor
          // hereda el tono, así que no hay un color más que mantener.
          className="shrink-0 underline font-semibold disabled:opacity-60"
        >
          <BusyLabel busy={busy}>{actionLabel}</BusyLabel>
        </button>
      )}
    </div>
  )
}
