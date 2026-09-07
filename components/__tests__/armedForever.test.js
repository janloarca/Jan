/**
 * FASE ND (Ronda 4 de la auditoría de UX, lo que quedó): armado para siempre y
 * descartes que mataban categorías enteras.
 *
 *  - useAutoDisarm: los dos-toques ad-hoc (Eliminar -> Confirmar de Ajustes,
 *    EditAccountModal, DocumentVault, InstrumentSheetsManager) quedaban ARMADOS
 *    sin salida: tocar "Eliminar todo" solo para leer la advertencia dejaba la
 *    app a un toque accidental de borrar todo el resto de la sesión.
 *  - NotificationCenter: los ids de descarte no distinguían estados. Descartar
 *    "vence en 3 meses" silenciaba la escalada de "vence en 3 DÍAS" (mismo id),
 *    y un solo descarte de `div-recent` mataba los avisos de dividendo PARA
 *    SIEMPRE (id constante).
 *
 * Componentes y hooks REALES vía @testing-library (arnés de FASE JB2).
 */

import React from 'react'
import { render, act, renderHook, fireEvent } from '@testing-library/react'
import { useAutoDisarm } from '../../hooks/useAutoDisarm'
import NotificationCenter from '../dashboard/NotificationCenter'

describe('useAutoDisarm: armado nunca es para siempre', () => {
  it('desarma solo pasado el timeout', () => {
    jest.useFakeTimers()
    const disarm = jest.fn()
    const { rerender } = renderHook(({ armed }) => useAutoDisarm(armed, disarm), {
      initialProps: { armed: false },
    })
    act(() => { jest.advanceTimersByTime(10000) })
    expect(disarm).not.toHaveBeenCalled() // sin armar no hay nada que desarmar

    rerender({ armed: true })
    act(() => { jest.advanceTimersByTime(5100) })
    expect(disarm).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it('un re-render del padre NO reinicia el timer (el disarm viaja por ref)', () => {
    // El tablero re-renderiza con cada tick de precios (~5 min entre fetches,
    // pero muchos renders por minuto). Si la identidad del callback inline
    // entrara a las deps, cada render reiniciaría el timeout y el desarme no
    // llegaría nunca: exactamente el bug que este hook existe para no tener.
    jest.useFakeTimers()
    const calls = []
    const { rerender } = renderHook(
      ({ armed, tag }) => useAutoDisarm(armed, () => calls.push(tag)),
      { initialProps: { armed: true, tag: 'a' } }
    )
    act(() => { jest.advanceTimersByTime(3000) })
    rerender({ armed: true, tag: 'b' }) // nueva arrow inline, mismo armed
    act(() => { jest.advanceTimersByTime(2100) })
    // 5.1s desde el ARMADO original: disparó, y con el callback más reciente.
    expect(calls).toEqual(['b'])
    jest.useRealTimers()
  })

  it('desarmar antes del timeout cancela el timer', () => {
    jest.useFakeTimers()
    const disarm = jest.fn()
    const { rerender } = renderHook(({ armed }) => useAutoDisarm(armed, disarm), {
      initialProps: { armed: true },
    })
    rerender({ armed: false })
    act(() => { jest.advanceTimersByTime(10000) })
    expect(disarm).not.toHaveBeenCalled()
    jest.useRealTimers()
  })
})

describe('NotificationCenter: descartar un aviso no mata su escalada ni su categoría', () => {
  const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10)

  const matureItem = (days) => ({
    id: 'bond1', name: 'VITALI', quantity: 1, currentPrice: 6000,
    maturityDate: iso(days),
  })

  const renderNC = (items, transactions = []) => render(
    <NotificationCenter items={items} transactions={transactions} lang="es" settings={{}} />
  )

  beforeEach(() => { localStorage.removeItem('chispudo-dismissed-notifs') })

  it('descartar el aviso de 90 días NO silencia la escalada urgente de 30', () => {
    // El usuario descarta "vence en 3 meses"...
    const first = renderNC([matureItem(60)])
    fireEvent.click(first.getByText('×'))
    expect(first.queryByText(/vence en/)).toBeNull()
    first.unmount()

    // ...y cuando el vencimiento entra a la ventana URGENTE, el aviso VUELVE:
    // el id de la escalada es otro, el descarte viejo no lo cubre. Con el id
    // compartido de antes, este render salía vacío y el vencimiento de 3 días
    // pasaba en silencio.
    const second = renderNC([matureItem(10)])
    expect(second.queryByText(/vence en/)).not.toBeNull()
  })

  it('descartar el aviso urgente sí lo descarta (dentro del mismo estado persiste)', () => {
    const first = renderNC([matureItem(10)])
    fireEvent.click(first.getByText('×'))
    first.unmount()
    const second = renderNC([matureItem(9)])
    expect(second.queryByText(/vence en/)).toBeNull()
  })

  it('un dividendo NUEVO vuelve a anunciarse aunque el aviso anterior se haya descartado', () => {
    const div = (date, amount) => ({ id: `d-${date}`, type: 'DIVIDEND', date, totalAmount: amount, currency: 'USD' })
    const today = iso(0)
    const yesterday = iso(-1)

    const first = renderNC([matureItem(400)], [div(yesterday, 240)])
    fireEvent.click(first.getByText('×'))
    expect(first.queryByText(/dividendo/)).toBeNull()
    first.unmount()

    // Mismo lote: sigue descartado (el id se llavea por el pago más reciente).
    const second = renderNC([matureItem(400)], [div(yesterday, 240)])
    expect(second.queryByText(/dividendo/)).toBeNull()
    second.unmount()

    // Entra un pago NUEVO: el aviso regresa. Con el id constante `div-recent`
    // de antes, un solo descarte mataba la categoría para siempre.
    const third = renderNC([matureItem(400)], [div(yesterday, 240), div(today, 300)])
    expect(third.queryByText(/dividendo/)).not.toBeNull()
  })

  it('con más de 5 avisos, el corte se DICE en vez de esconderse', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `b${i}`, name: `Bono ${i}`, quantity: 1, currentPrice: 100, maturityDate: iso(40 + i),
    }))
    const { queryByText } = renderNC(items)
    expect(queryByText(/\+2 avisos más/)).not.toBeNull()
  })
})
