// Descartes de "Chispu te sugiere": una sola definición de dónde viven.
// Los lee la card de sugerencias Y el contador "· N pendientes" del header;
// con dos copias el contador seguía diciendo "1 pendiente" después de
// descartar todo, y su clic no llevaba a ninguna acción.

export const DISMISS_KEY = 'chispudo-dismissed-suggestions'
export const DISMISS_EVENT = 'chispudo-dismissed-changed'

export function readDismissed() {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch { return new Set() }
}

export function writeDismissed(set) {
  try {
    if (set.size === 0) localStorage.removeItem(DISMISS_KEY)
    else localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]))
  } catch {}
  try { window.dispatchEvent(new Event(DISMISS_EVENT)) } catch {}
}

export function countPending(findings, dismissed) {
  return (findings || []).filter((f) => !dismissed.has(f.id)).length
}
