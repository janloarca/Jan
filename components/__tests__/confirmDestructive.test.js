/**
 * FASE NC (Ronda 4 de la auditoría de UX): destructivo sin red.
 *
 * Tres piezas, cada una con su regresión de origen:
 *  - ConfirmTap: el primitivo de dos toques que reemplazó a los CUATRO sitios
 *    que borraban/revocaban con UN toque (PortfolioSelector, OptimizeModal,
 *    el revocar de ShareTab, el ocultar de Rebalanceo).
 *  - useDirtyClose: el telón de un formulario largo con cambios encima ya no
 *    cierra al primer click.
 *  - FinanceWipePanel: armar con "Descargar y borrar" y tocar el "Borrar"
 *    pelado ejecutaba el borrado SIN respaldo; ahora cada botón confirma solo
 *    su propia intención.
 *
 * Componentes REALES vía @testing-library (arnés de FASE JB2), nunca copias.
 */

import React from 'react'
import { render, fireEvent, act, renderHook } from '@testing-library/react'
import ConfirmTap from '../ui/ConfirmTap'
import { useDirtyClose } from '../../hooks/useDirtyClose'
import FinanceWipePanel from '../settings/FinanceWipePanel'

describe('ConfirmTap: dos toques, nunca uno', () => {
  it('el primer toque ARMA y no ejecuta; el segundo ejecuta una vez', () => {
    const onConfirm = jest.fn()
    const { getByRole } = render(
      <ConfirmTap onConfirm={onConfirm} confirmContent="¿Borrar?">x</ConfirmTap>
    )
    fireEvent.click(getByRole('button'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(getByRole('button').textContent).toBe('¿Borrar?')
    fireEvent.click(getByRole('button'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('sin segundo toque se desarma solo (la ventana no queda armada para siempre)', () => {
    jest.useFakeTimers()
    const onConfirm = jest.fn()
    const { getByRole } = render(
      <ConfirmTap onConfirm={onConfirm} confirmContent="¿Borrar?">x</ConfirmTap>
    )
    fireEvent.click(getByRole('button'))
    act(() => { jest.advanceTimersByTime(4000) })
    expect(getByRole('button').textContent).toBe('x')
    // Un toque DESPUÉS del desarme vuelve a armar, no ejecuta: el usuario que
    // volvió a la fila un minuto después no hereda el toque viejo.
    fireEvent.click(getByRole('button'))
    expect(onConfirm).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('el toque no burbujea al contenedor (vive dentro de filas y telones clickeables)', () => {
    const onRow = jest.fn()
    const { getByRole } = render(
      <div onClick={onRow}><ConfirmTap onConfirm={() => {}}>x</ConfirmTap></div>
    )
    fireEvent.click(getByRole('button'))
    expect(onRow).not.toHaveBeenCalled()
  })
})

describe('useDirtyClose: el telón respeta lo tecleado', () => {
  it('limpio cierra al primer click, igual que siempre', () => {
    const onClose = jest.fn()
    const { result } = renderHook(() => useDirtyClose(onClose))
    act(() => { result.current.onBackdropClick() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sucio: el primer click ARMA (no cierra) y el segundo descarta', () => {
    const onClose = jest.fn()
    const { result } = renderHook(() => useDirtyClose(onClose))
    act(() => { result.current.markDirty() })
    act(() => { result.current.onBackdropClick() })
    expect(onClose).not.toHaveBeenCalled()
    expect(result.current.backdropArmed).toBe(true)
    act(() => { result.current.onBackdropClick() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('acepta el booleano calculado al click (el camino de CashFlowModal)', () => {
    const onClose = jest.fn()
    const { result } = renderHook(() => useDirtyClose(onClose))
    act(() => { result.current.onBackdropClick(true) })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { result.current.onBackdropClick(false) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('un onClick que pasa el EVENTO no cuenta como booleano', () => {
    const onClose = jest.fn()
    const { result } = renderHook(() => useDirtyClose(onClose))
    // Limpio + un objeto de evento como argumento: cierra (cae al ref).
    act(() => { result.current.onBackdropClick({ type: 'click' }) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('FinanceWipePanel: cada botón confirma SOLO su propia intención', () => {
  const TXS = [
    { id: 't1', type: 'EXPENSE', amount: 100, currency: 'GTQ', date: '2026-08-05', category: 'Alimentación', description: 'a', source: 'manual' },
    { id: 't2', type: 'EXPENSE', amount: 50, currency: 'GTQ', date: '2026-08-06', category: 'Transporte', description: 'b', source: 'manual' },
  ]

  it('armar con "Descargar y borrar" y tocar "Borrar" NO ejecuta: re-arma', async () => {
    const onDeleteByIds = jest.fn()
    const onDeleteAll = jest.fn()
    const { getByText } = render(
      <FinanceWipePanel transactions={TXS} onDeleteByIds={onDeleteByIds} onDeleteAll={onDeleteAll} lang="es" />
    )
    fireEvent.click(getByText('Descargar y borrar'))
    // El botón de respaldo quedó armado...
    expect(getByText('Confirmar y descargar')).toBeTruthy()
    // ...y el pelado sigue diciendo "Borrar", no "Confirmar": no hereda el arme.
    fireEvent.click(getByText('Borrar'))
    expect(onDeleteByIds).not.toHaveBeenCalled()
    expect(onDeleteAll).not.toHaveBeenCalled()
    // Ese toque RE-ARMÓ hacia el borrado pelado; el segundo toque del MISMO
    // botón sí ejecuta.
    await act(async () => { fireEvent.click(getByText('Confirmar')) })
    expect(onDeleteAll).toHaveBeenCalledTimes(1)
  })
})
