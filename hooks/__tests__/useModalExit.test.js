import { renderHook, act } from '@testing-library/react'
import useModalExit, { MODAL_EXIT_MS } from '../useModalExit'

// Lo que este hook garantiza, y cada garantía tiene su bug detrás:
//  - abrir es inmediato (si no, el toque no acusa recibo)
//  - cerrar sobrevive la animación (que es la función entera)
//  - cambiar de un modal a otro deja entrar al nuevo sin esperar al viejo
//    (el picker de venta hace exactamente eso en la misma vuelta)
//  - con `prefers-reduced-motion` no hay retraso en absoluto

const setReducedMotion = (matches) => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: query.includes('reduce') ? matches : false,
    media: query, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }))
}

describe('useModalExit', () => {
  beforeEach(() => { jest.useFakeTimers(); setReducedMotion(false) })
  afterEach(() => { jest.useRealTimers() })

  it('abrir es inmediato', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: null } })
    expect(result.current[0]).toBe(null)
    act(() => { rerender({ v: 'import' }) })
    expect(result.current[0]).toBe('import')
    expect(result.current[1]).toBe(false)
  })

  it('cerrar mantiene el modal montado y marcado durante la salida', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'import' } })
    act(() => { rerender({ v: null }) })
    // Sigue montado: sin esto no habría nada sobre lo que correr la animación,
    // que es exactamente por qué los modales salían de golpe.
    expect(result.current[0]).toBe('import')
    expect(result.current[1]).toBe(true)

    act(() => { jest.advanceTimersByTime(MODAL_EXIT_MS + 1) })
    expect(result.current[0]).toBe(null)
    expect(result.current[1]).toBe(false)
  })

  it('un instante antes de que termine, todavia esta montado', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'x' } })
    act(() => { rerender({ v: null }) })
    act(() => { jest.advanceTimersByTime(MODAL_EXIT_MS - 10) })
    expect(result.current[0]).toBe('x')
    act(() => { jest.advanceTimersByTime(20) })
    expect(result.current[0]).toBe(null)
  })

  // El picker de venta hace `setModal(null)` y `setSellItem(it)` en la misma
  // vuelta. El que ENTRA no puede esperar a que el otro termine de irse.
  it('cambiar de un modal a otro entra sin esperar', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'sellPicker' } })
    act(() => { rerender({ v: 'cashflow' }) })
    expect(result.current[0]).toBe('cashflow')
    expect(result.current[1]).toBe(false)
  })

  it('reabrir a mitad de la salida cancela la salida', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'x' } })
    act(() => { rerender({ v: null }) })
    expect(result.current[1]).toBe(true)
    act(() => { jest.advanceTimersByTime(50) })
    act(() => { rerender({ v: 'x' }) })
    expect(result.current[1]).toBe(false)
    // Y el temporizador viejo no lo puede desmontar despues.
    act(() => { jest.advanceTimersByTime(MODAL_EXIT_MS * 2) })
    expect(result.current[0]).toBe('x')
  })

  it('con prefers-reduced-motion se desmonta al instante', () => {
    setReducedMotion(true)
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'x' } })
    act(() => { rerender({ v: null }) })
    // Sin esto el modal quedaria montado e invisible 200ms, bloqueando la
    // pantalla sin mostrar nada: el blanket de globals.css apaga la animacion
    // pero no puede apagar el temporizador.
    expect(result.current[0]).toBe(null)
    expect(result.current[1]).toBe(false)
  })

  // Los guards booleanos (showReview, showEnrich, showGuided) pasan `false`,
  // no `null`. Tratar `false` como abierto dejaria el modal montado para
  // siempre.
  it('trata false igual que null', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: true } })
    act(() => { rerender({ v: false }) })
    expect(result.current[0]).toBe(true)
    expect(result.current[1]).toBe(true)
    act(() => { jest.advanceTimersByTime(MODAL_EXIT_MS + 1) })
    expect(result.current[0]).toBe(null)
  })

  it('cerrar algo que ya estaba cerrado no marca nada', () => {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: null } })
    act(() => { rerender({ v: undefined }) })
    expect(result.current[1]).toBe(false)
  })

  it('desmontar el consumidor no deja el temporizador vivo', () => {
    const { rerender, unmount } = renderHook(({ v }) => useModalExit(v), { initialProps: { v: 'x' } })
    act(() => { rerender({ v: null }) })
    unmount()
    // Si el cleanup no limpiara, esto correria un setState sobre un hook
    // desmontado.
    expect(() => act(() => { jest.advanceTimersByTime(MODAL_EXIT_MS + 1) })).not.toThrow()
  })
})
