'use client'

// FASE NC. El aviso que acompaña a useDirtyClose: aparece cuando el primer
// click en el telón encontró cambios sin guardar. Vive como componente para
// que los tres formularios largos no tengan cada uno su copia del markup.
//
// Se posiciona ABSOLUTO dentro del telón (que es fixed inset-0), abajo y al
// centro, la misma zona donde viven los toasts. El fondo se compone opaco
// sobre --bg-primary, la regla de lib/toastStyle (un aviso flotante
// translúcido se ve a través).
export default function DiscardHint({ show, lang = 'es' }) {
  if (!show) return null
  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full text-xs font-medium shadow-lg max-w-[90vw] text-center"
      onClick={(e) => e.stopPropagation()}
      role="status"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--alert-warn-icon) 16%, var(--bg-primary))',
        border: '1px solid var(--alert-warn-border)',
        color: 'var(--alert-warn-icon)',
      }}>
      {lang === 'es'
        ? 'Tienes cambios sin guardar. Toca afuera otra vez para descartar.'
        : 'You have unsaved changes. Tap outside again to discard.'}
    </div>
  )
}
