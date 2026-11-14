// Toast con acción "Deshacer" (FASE SB). Lógica pura, sin React, para poder
// probar el temporizador y el estado sin montar el tablero.
//
// Reglas que fija este módulo:
//  - UN solo toast con Deshacer a la vez: mostrar otro reemplaza al anterior y
//    el anterior pierde su Deshacer (ya no es la última acción).
//  - Se cierra solo a los 5 s; pasado ese plazo la acción queda hecha.
//  - Deshacer corre UNA vez: un doble toque no puede restaurar dos veces.
//
// Solo se usa para acciones seguras y reversibles (editar campos de una
// cuenta, descartar una sugerencia). NUNCA para borrados ni para movimientos
// que mueven saldo entre cuentas: esos ya piden confirmación.

export const UNDO_TOAST_MS = 5000

export function createUndoToastController({
  onChange,
  durationMs = UNDO_TOAST_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  let current = null
  let timer = null
  let seq = 0

  const snapshot = () => (current ? { id: current.id, message: current.message } : null)
  const publish = () => { if (typeof onChange === 'function') onChange(snapshot()) }
  const stopTimer = () => {
    if (timer != null) { clearTimer(timer); timer = null }
  }

  const show = ({ message, onUndo } = {}) => {
    stopTimer()
    seq += 1
    const id = seq
    current = { id, message: message || '', onUndo: typeof onUndo === 'function' ? onUndo : null }
    timer = setTimer(() => {
      // Solo cierra el toast que lo programó (por si el disparo llega tarde).
      if (current && current.id === id) { current = null; timer = null; publish() }
    }, durationMs)
    publish()
    return id
  }

  // Devuelve lo que devuelva onUndo (puede ser una promesa) o false si no
  // había nada que deshacer.
  const undo = () => {
    if (!current) return false
    const fn = current.onUndo
    stopTimer()
    current = null
    publish()
    return fn ? fn() : false
  }

  const dismiss = () => {
    if (!current) return
    stopTimer()
    current = null
    publish()
  }

  const destroy = () => { stopTimer(); current = null }

  return { show, undo, dismiss, destroy, getState: snapshot }
}

// Qué campos cambia una edición y cuál era su valor ANTES, sobre el ítem CRUDO
// (nunca el enriquecido: sus precios vienen convertidos a la moneda base y
// restaurarlos los escribiría en la moneda equivocada).
// Un campo que no existía antes se restaura a null: updateItem descarta los
// undefined, así que un undefined no lo quitaría.
export function previousFieldValues(raw, next) {
  const prev = {}
  if (!raw || !next) return prev
  for (const [k, v] of Object.entries(next)) {
    if (k === 'id' || v === undefined) continue
    const before = raw[k]
    if (JSON.stringify(before) === JSON.stringify(v)) continue
    prev[k] = before === undefined ? null : before
  }
  return prev
}
