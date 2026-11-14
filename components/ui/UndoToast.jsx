'use client'

// Toast con acción "Deshacer" (FASE SB). Solo presentación: el temporizador y
// la regla de "uno a la vez" viven en lib/undoToast.js.
//
// El botón mide al menos 44px de alto (objetivo táctil de iOS) y el contenedor
// anuncia el mensaje por aria-live, igual que el toast normal del tablero.
import { toastStyleFor } from '@/lib/toastStyle'

export default function UndoToast({ toast, onUndo, onDismiss, lang = 'es' }) {
  if (!toast) return null
  const t = (es, en) => (lang === 'es' ? es : en)
  return (
    <div
      key={toast.id}
      className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1 pl-4 pr-1 rounded-lg shadow-xl text-sm font-medium animate-fade-in border max-w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
      style={toastStyleFor('info')}
    >
      <span className="min-w-0 py-2">{toast.message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 min-h-[44px] px-3 font-semibold underline underline-offset-2"
      >
        {t('Deshacer', 'Undo')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 min-h-[44px] min-w-[44px] opacity-60 hover:opacity-100 transition-opacity text-xs"
        aria-label={t('Cerrar aviso', 'Dismiss')}
      >
        ✕
      </button>
    </div>
  )
}
