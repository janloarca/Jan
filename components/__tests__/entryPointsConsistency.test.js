/**
 * FASE QK. Consistencia entre puertas: lo que una pantalla protege, la otra
 * también; lo que una puerta siembra, la otra lo respeta.
 *
 * Cada bloque lleva la regresión de su origen:
 *  - Transferir y Vender mueven dinero y se cerraban con UN toque en el telón,
 *    mientras CashFlowModal (que mueve el mismo dinero) ya pedía un segundo.
 *  - El alta GUIADA era la única ruta sin protección del telón, y es la del
 *    primerizo, que es quien más fácil toca fuera por accidente.
 *  - FinanceWipePanel se quedaba armado para siempre (los otros cuatro
 *    dos-toques de FASE ND se desarman solos).
 *  - AddAccountModal no aceptaba `defaults`: "+ Agregar deuda" de la Hoja y las
 *    altas rápidas de Patrimonio aterrizaban todas en el tipo por defecto.
 *
 * Componentes REALES vía @testing-library (arnés de FASE JB2), nunca copias.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import TransferModal from '@/components/TransferModal'
import SellModal from '@/components/SellModal'
import AddAccountModal from '@/components/AddAccountModal'
import FinanceWipePanel from '@/components/settings/FinanceWipePanel'

jest.mock('../../lib/authFetch', () => ({
  authFetch: jest.fn(async () => ({ ok: false })),
  safeJson: jest.fn(async () => null),
}))

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

const HINT = /Tienes cambios sin guardar/

describe('Transferir: el telón respeta lo tecleado', () => {
  const ITEMS = [
    { id: 'a', name: 'Cuenta A', type: 'Bank', institution: 'BI', quantity: 1, currentPrice: 1000, purchasePrice: 1000, currency: 'USD' },
    { id: 'b', name: 'Cuenta B', type: 'Bank', institution: 'BAC', quantity: 1, currentPrice: 500, purchasePrice: 500, currency: 'USD' },
  ]
  const mount = (onClose) => render(
    <TransferModal onClose={onClose} onTransfer={async () => {}} onAddTransaction={async () => {}}
      existingItems={ITEMS} convert={(v) => v} lang="es" />
  )

  it('limpio cierra al primer toque en el telón, igual que siempre', () => {
    const onClose = jest.fn()
    mount(onClose)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('con un monto tecleado el primer toque ARMA (no cierra) y el segundo descarta', () => {
    const onClose = jest.fn()
    mount(onClose)
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '250' } })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(HINT)).toBeTruthy()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('la × es un gesto explícito: cierra al instante aunque haya cambios', () => {
    const onClose = jest.fn()
    mount(onClose)
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '250' } })
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Vender: el telón respeta lo tecleado', () => {
  const ITEM = { id: 's1', symbol: 'AAPL', name: 'Apple', type: 'Stock', institution: 'IBKR', quantity: 10, currentPrice: 150, purchasePrice: 100, currency: 'USD' }
  const mount = (onClose) => render(
    <SellModal item={ITEM} onClose={onClose} onExecuteSale={async () => {}} existingItems={[ITEM]} lang="es" convert={(v) => v} />
  )

  it('limpio cierra al primer toque', () => {
    const onClose = jest.fn()
    mount(onClose)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('con una cantidad tecleada el primer toque ARMA y el segundo descarta', () => {
    const onClose = jest.fn()
    mount(onClose)
    fireEvent.change(screen.getByPlaceholderText(/Max/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(HINT)).toBeTruthy()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Alta guiada: la ruta del primerizo también protege lo tecleado', () => {
  const mount = ({ onExitGuided, onClose }) => render(
    <AddAccountModal guidedType="Bank" guidedProgress={{ items: ['Bank'], index: 0 }}
      onExitGuided={onExitGuided} onClose={onClose} onAdd={async () => 'id'} onSaved={() => {}}
      existingItems={[]} lang="es" baseCurrency="USD" />
  )

  it('limpio, el telón sale del recorrido al primer toque', () => {
    const onExitGuided = jest.fn()
    mount({ onExitGuided, onClose: jest.fn() })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onExitGuided).toHaveBeenCalledTimes(1)
  })

  it('con el banco tecleado el primer toque ARMA y el segundo sale', () => {
    const onExitGuided = jest.fn()
    mount({ onExitGuided, onClose: jest.fn() })
    fireEvent.change(screen.getByPlaceholderText('Banco Industrial'), { target: { value: 'BAM' } })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onExitGuided).not.toHaveBeenCalled()
    expect(screen.getByText(HINT)).toBeTruthy()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onExitGuided).toHaveBeenCalledTimes(1)
  })
})

describe('FinanceWipePanel: armado nunca es para siempre', () => {
  const TXS = [
    { id: 't1', type: 'EXPENSE', amount: 100, currency: 'GTQ', date: '2026-08-05', category: 'Alimentación', description: 'a', source: 'manual' },
  ]

  it('leer la advertencia y no confirmar desarma solo, sin haber borrado nada', () => {
    jest.useFakeTimers()
    const onDeleteByIds = jest.fn()
    const onDeleteAll = jest.fn()
    render(<FinanceWipePanel transactions={TXS} onDeleteByIds={onDeleteByIds} onDeleteAll={onDeleteAll} lang="es" />)
    fireEvent.click(screen.getByText('Borrar'))
    expect(screen.getByText('Confirmar')).toBeTruthy()
    act(() => { jest.advanceTimersByTime(5100) })
    expect(screen.getByText('Borrar')).toBeTruthy()
    expect(screen.queryByText('Confirmar')).toBeNull()
    // Un toque DESPUÉS del desarme vuelve a armar: no hereda el viejo.
    fireEvent.click(screen.getByText('Borrar'))
    expect(onDeleteByIds).not.toHaveBeenCalled()
    expect(onDeleteAll).not.toHaveBeenCalled()
  })
})

describe('AddAccountModal acepta `defaults` (antes era un no-op silencioso en la Hoja)', () => {
  const mount = (defaults, extra = {}) => {
    const onAdd = jest.fn(async () => 'new-id')
    const onAddTransaction = jest.fn(async () => {})
    const onAddLot = jest.fn(async () => {})
    render(
      <AddAccountModal onClose={() => {}} onAdd={onAdd} onAddTransaction={onAddTransaction} onAddLot={onAddLot}
        existingItems={[]} activePortfolio="__all__" lang="es" baseCurrency="USD" defaults={defaults} {...extra} />
    )
    return { onAdd, onAddTransaction, onAddLot }
  }

  it("{ type: 'Debt' } abre directo en una deuda y entrega un ítem con isDebt", async () => {
    const { onAdd } = mount({ type: 'Debt' })
    fireEvent.change(document.getElementById('add-name'), { target: { value: 'Hipoteca' } })
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(document.getElementById('add-debtBalance')).toBeTruthy())
    fireEvent.change(document.getElementById('add-debtBalance'), { target: { value: '40000' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const item = onAdd.mock.calls[0][0]
    expect(item.isDebt).toBe(true)
    expect(item.purchasePrice).toBe(40000)
  })

  it("{ type: 'RealEstate', subtype: 'property' } abre con los campos de inmueble", async () => {
    mount({ type: 'RealEstate', subtype: 'property' })
    fireEvent.change(document.getElementById('add-name'), { target: { value: 'Apartamento Zona 14' } })
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(document.getElementById('add-propertyPurchasePrice')).toBeTruthy())
    expect(document.getElementById('add-downPayment')).toBeTruthy()
  })

  it('control: sin defaults el alta nace como Acción (el tipo de siempre)', () => {
    mount(undefined)
    expect(document.getElementById('add-symbol')).toBeTruthy()
    expect(document.getElementById('add-name')).toBeNull()
  })

  it('el modo guiado manda sobre `defaults`: su tipo y su subtipo no se pisan', () => {
    render(
      <AddAccountModal guidedType="Bank" guidedProgress={{ items: ['Bank'], index: 0 }} defaults={{ type: 'Debt' }}
        onExitGuided={() => {}} onClose={() => {}} onAdd={async () => 'id'} onSaved={() => {}}
        existingItems={[]} lang="es" baseCurrency="USD" />
    )
    // Sigue preguntando por el banco (Bank), no por una deuda.
    expect(screen.getByPlaceholderText('Banco Industrial')).toBeTruthy()
  })
})
