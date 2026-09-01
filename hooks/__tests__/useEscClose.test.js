/**
 * FASE ME6: Esc cierra SOLO el modal de más arriba.
 *
 * Antes cada modal registraba su propio listener de window, así que con un
 * modal anidado (BrokerConnectModal dentro de ConnectionsModal,
 * InstrumentSheetsManager dentro de SettingsModal) un Esc los cerraba TODOS.
 * La pila hace que responda únicamente la entrada más reciente.
 */
import { renderHook } from '@testing-library/react'
import { useEscClose } from '../useEscClose'

const pressEsc = () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

describe('useEscClose (FASE ME6)', () => {
  test('un modal solo: Esc lo cierra', () => {
    const onClose = jest.fn()
    renderHook(() => useEscClose(onClose))
    pressEsc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('anidado: Esc cierra SOLO el de arriba, nunca los dos', () => {
    const parent = jest.fn()
    const child = jest.fn()
    // El padre monta primero (renderiza al hijo), igual que en la app.
    renderHook(() => useEscClose(parent))
    const childHook = renderHook(() => useEscClose(child))
    pressEsc()
    expect(child).toHaveBeenCalledTimes(1)
    expect(parent).not.toHaveBeenCalled()
    // Cerrado el hijo, el siguiente Esc sí le toca al padre.
    childHook.unmount()
    pressEsc()
    expect(parent).toHaveBeenCalledTimes(1)
  })

  test('inactive no entra a la pila: el Esc cae al de abajo', () => {
    const below = jest.fn()
    const above = jest.fn()
    renderHook(() => useEscClose(below))
    renderHook(() => useEscClose(above, false))
    pressEsc()
    expect(above).not.toHaveBeenCalled()
    expect(below).toHaveBeenCalledTimes(1)
  })

  test('onClose no-función (onCancel opcional ausente) no revienta ni bloquea', () => {
    const below = jest.fn()
    renderHook(() => useEscClose(below))
    renderHook(() => useEscClose(undefined))
    pressEsc()
    // El de arriba no existe en la pila, así que el de abajo responde.
    expect(below).toHaveBeenCalledTimes(1)
  })

  test('otras teclas no hacen nada', () => {
    const onClose = jest.fn()
    renderHook(() => useEscClose(onClose))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
