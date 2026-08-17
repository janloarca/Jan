'use client'

// Señal blanda de confianza: el portafolio viene mayormente sincronizado de un
// broker, no tecleado a mano. Lo decide el servidor a partir de syncedPct
// (app/api/friends/route.js), aunque ese dato sigue siendo auto-reportado: la
// insignia se puede auto-otorgar y verificarla de verdad es otra función.
export default function VerifiedBadge({ lang }) {
  return (
    <span
      title={lang === 'es' ? 'Portafolio sincronizado con un broker' : 'Portfolio synced with a broker'}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold shrink-0"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 22%, transparent)', color: 'var(--accent-green)' }}
    >
      ✓
    </span>
  )
}
