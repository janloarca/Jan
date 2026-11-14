import { createUndoToastController, previousFieldValues, UNDO_TOAST_MS } from '../undoToast'
import { withoutIds } from '../suggestionDismissals'

function fakeTimers() {
  const pending = new Map(); let n = 0
  return {
    setTimer: (fn, ms) => { n += 1; pending.set(n, { fn, ms }); return n },
    clearTimer: (id) => pending.delete(id),
    fire: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn() } },
    pending,
  }
}

test('se cierra solo a los 5 s', () => {
  const tm = fakeTimers(); const states = []
  const c = createUndoToastController({ onChange: (s) => states.push(s), ...tm })
  c.show({ message: 'Guardado', onUndo: () => {} })
  expect(c.getState().message).toBe('Guardado')
  expect([...tm.pending.values()][0].ms).toBe(UNDO_TOAST_MS)
  tm.fire()
  expect(c.getState()).toBeNull()
})

test('Deshacer corre UNA sola vez aunque se toque dos veces', () => {
  const tm = fakeTimers(); const undo = jest.fn()
  const c = createUndoToastController({ ...tm })
  c.show({ message: 'x', onUndo: undo })
  c.undo(); c.undo()
  expect(undo).toHaveBeenCalledTimes(1)
})

test('uno a la vez: el segundo reemplaza al primero y el primero pierde su Deshacer', () => {
  const tm = fakeTimers(); const a = jest.fn(); const b = jest.fn()
  const c = createUndoToastController({ ...tm })
  c.show({ message: 'a', onUndo: a })
  c.show({ message: 'b', onUndo: b })
  expect(tm.pending.size).toBe(1)
  c.undo()
  expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1)
})

test('pasado el plazo ya no hay nada que deshacer', () => {
  const tm = fakeTimers(); const undo = jest.fn()
  const c = createUndoToastController({ ...tm })
  c.show({ message: 'x', onUndo: undo }); tm.fire()
  expect(c.undo()).toBe(false); expect(undo).not.toHaveBeenCalled()
})

test('previousFieldValues: solo los campos que cambian, sobre el item crudo', () => {
  const raw = { id: 'a', name: 'Bono', currentPrice: 100, notes: 'x' }
  expect(previousFieldValues(raw, { name: 'Bono 2', currentPrice: 100, notes: 'x' })).toEqual({ name: 'Bono' })
})

test('previousFieldValues: un campo que no existia vuelve a null (updateItem descarta undefined)', () => {
  expect(previousFieldValues({ id: 'a' }, { country: 'GT' })).toEqual({ country: null })
})

test('deshacer un descarte quita solo esos ids', () => {
  expect([...withoutIds(new Set(['a', 'b', 'c']), ['b'])]).toEqual(['a', 'c'])
})
