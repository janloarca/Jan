'use client'

// Señal de confianza: esta persona tiene un broker conectado y sincronizando.
//
// Lo decide el SERVIDOR a partir de los vaults de broker, cuyo `lastSync` lo
// estampa la ruta del propio broker al terminar un sync real
// (lib/friendsVerified.js). Antes salía de un porcentaje que calculaba y
// mandaba el cliente, o sea la insignia se podía auto-otorgar: y no le habla al
// usuario, le habla a sus amigos.
//
// El texto afirma exactamente eso y no más. Decía "portafolio sincronizado",
// que sugiere que la mayor parte del portafolio viene del broker — cierto o no,
// eso ya no es lo que se verifica.
export default function VerifiedBadge({ lang }) {
  return (
    <span
      title={lang === 'es' ? 'Tiene un broker conectado y sincronizando' : 'Has a broker connected and syncing'}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold shrink-0"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 22%, transparent)', color: 'var(--accent-green)' }}
    >
      ✓
    </span>
  )
}
