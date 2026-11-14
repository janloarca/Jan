'use client'

// FASE SG (B6): UNA lectura de Firestore que FALLA no es una cuenta vacía.
// El tablero ya lo distinguía (FASE JA3) con un bloque escrito a mano; Flujo,
// la Hoja y Costos no, así que con la red caída o una regla denegando decían
// "Aún no tienes activos" / "Aún no hay costos" sobre cuentas llenas, e
// invitaban a volver a crear lo que ya existe. Una sola tarjeta para las cuatro
// pantallas, para que digan lo mismo y no vuelvan a divergir.
//
// Reintentar recarga la página a propósito: los listeners de Firestore no se
// re-suscriben solos tras un error de permisos, y una recarga es la única
// forma confiable de volver a pedir todo. El código va en chico al pie porque
// en un teléfono no hay consola y es lo que permite diagnosticarlo desde una
// captura.
export default function LoadErrorCard({ error, lang = 'es', onRetry, className = '' }) {
  const es = lang === 'es'
  const retry = onRetry || (() => { if (typeof window !== 'undefined') window.location.reload() })
  return (
    <div role="alert" className={`card p-5 sm:p-6 text-center ${className}`}>
      <p className="text-base font-semibold mb-2" style={{ color: 'var(--alert-warn-icon)' }}>
        {es ? 'No pudimos cargar tus datos' : 'We could not load your data'}
      </p>
      <p className="text-sm mb-4 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
        {es
          ? 'Tus datos siguen guardados: esto es un problema de conexión, no una cuenta vacía. Revisa tu internet y vuelve a intentarlo.'
          : 'Your data is still saved: this is a connection problem, not an empty account. Check your internet and try again.'}
      </p>
      <button type="button" onClick={retry} className="btn-primary px-4 py-2 text-sm min-h-[44px]">
        {es ? 'Reintentar' : 'Try again'}
      </button>
      {error ? (
        <p className="text-xs mt-3 font-mono" style={{ color: 'var(--text-muted)' }}>{String(error)}</p>
      ) : null}
    </div>
  )
}
