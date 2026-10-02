/**
 * Un activo de MERCADO (acción, cripto, fondo con lotes reales) no se puede
 * mover con un MONTO: los escritores que usa esta pantalla (debitFields/
 * creditFields/buildContributionFields) harían `cantidad = monto / precio de
 * HOY`, una aproximación silenciosa que corrompe cantidad y costo base. Se
 * excluyen de origen, destino Y vínculo (lib/transferFields.js,
 * lib/contributions.js). Componente REAL vía @testing-library, no props
 * hechos a mano — verificar una copia de la lógica es el atajo que ya dejó
 * pasar un crash real (FASE GQ3).
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import CashFlowModal from '@/components/CashFlowModal'

afterEach(cleanup)

const marketItem = {
  id: 'm1', name: 'Apple', type: 'Stock', symbol: 'AAPL',
  quantity: 10, currentPrice: 150, purchasePrice: 140, currency: 'USD', institution: 'IBKR',
}
const bankItem = {
  id: 'b1', name: 'Mi Banco', type: 'Bank', symbol: 'BI',
  quantity: 1, currentPrice: 5000, purchasePrice: 5000, currency: 'USD', institution: 'BI',
}

function renderModal(props = {}) {
  return render(
    <CashFlowModal
      onClose={() => {}}
      onAddTransaction={jest.fn(async () => {})}
      onTransfer={jest.fn(async () => {})}
      onExecuteContribution={jest.fn(async () => {})}
      onConfirmNewMoney={jest.fn(async () => {})}
      existingItems={[marketItem, bankItem]}
      transactions={[]}
      convert={(amt) => amt}
      lang="es"
      baseCurrency="USD"
      {...props}
    />
  )
}

describe('CashFlowModal: un ítem de mercado no se puede mover con un monto', () => {
  it('depósito externo (default): el vínculo excluye el ítem de mercado y avisa', () => {
    renderModal()
    expect(screen.queryByText(/Apple/)).toBeNull()
    expect(screen.getByText(/Mi Banco/)).toBeTruthy()
    expect(screen.getByText(/no aparecen aquí: un monto no se puede convertir en cantidad exacta/)).toBeTruthy()
  })

  it('transferencia entre cuentas: origen y destino excluyen el ítem de mercado', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /De otra cuenta/ }))
    expect(screen.queryByText(/Apple/)).toBeNull()
    expect(screen.getAllByText(/Mi Banco/).length).toBeGreaterThan(0)
    expect(screen.getByText(/usa la pantalla de Transferir/)).toBeTruthy()
  })

  it('pago de deuda: la cuenta que paga excluye el ítem de mercado', () => {
    // Sin ninguna deuda cargada el chip "Pago de deuda" ni se ofrece — se
    // agrega una deuda al fixture solo para este caso.
    const debtItem = { id: 'd1', name: 'Préstamo', isDebt: true, quantity: 1, currentPrice: 1000, purchasePrice: 1000, currency: 'USD' }
    renderModal({ existingItems: [marketItem, bankItem, debtItem] })
    fireEvent.click(screen.getByRole('button', { name: /Retiro/ }))
    fireEvent.click(screen.getByRole('button', { name: /Pago de deuda/ }))
    expect(screen.queryByText(/Apple/)).toBeNull()
    expect(screen.getByText(/Mi Banco/)).toBeTruthy()
    expect(screen.getByText(/no aparecen aquí: para sacar dinero exacto de ellas usa Vender/)).toBeTruthy()
  })

  it('gasto de un activo: el selector de atribución SÍ incluye mercado, el de la cuenta que paga NO', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /Retiro/ }))
    fireEvent.click(screen.getByRole('button', { name: /Gasto de un activo/ }))
    // costForId (atribución: a qué activo es el gasto, nunca toca SU saldo) sí
    // ofrece el ítem de mercado.
    expect(screen.getByText('Apple (IBKR)')).toBeTruthy()
    // El select de "¿de qué cuenta pagaste?" (balance-type: SÍ mueve un saldo)
    // no debe ofrecerlo, aunque el texto "Apple" ya exista arriba de él.
    const selects = screen.getAllByRole('combobox')
    // Orden de montaje: costForId (0), linked "¿de qué cuenta pagaste?" (1), moneda (2).
    const linkedSelect = selects[1]
    expect(within(linkedSelect).queryByText(/Apple/)).toBeNull()
    expect(within(linkedSelect).getByText(/Mi Banco/)).toBeTruthy()
  })

  it('un finding puede prefillar linkedId con un ítem de mercado (income-never-received no está gateado por isMarket): se limpia solo, sin crashear', () => {
    renderModal({ prefill: { flowType: 'DEPOSIT', origin: 'yield', linkedId: marketItem.id } })
    const selects = screen.getAllByRole('combobox')
    // Orden bajo isYield: yieldSourceId (0, sin filtrar: atribución), linked (1, filtrado), moneda (2).
    expect(selects[1].value).toBe('')
  })
})
