/**
 * FASE OL. "Agregar a posición" (el merge del aviso de duplicado en
 * AddAccountModal) sobre un activo de saldo: (1) no chequeaba la MONEDA del
 * ítem existente y sumaba quetzales con dólares como si fueran la misma
 * unidad; (2) escribía `acquisitionDate` = la fecha de ESTA compra sobre el
 * ítem, pisando la fecha real de adquisición (la Hoja y la gráfica gatean el
 * pasado con ella). Componente REAL vía @testing-library.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AddAccountModal from '@/components/AddAccountModal'

jest.mock('../../lib/authFetch', () => ({
  authFetch: jest.fn(async () => ({ ok: false })),
  safeJson: jest.fn(async () => null),
}))

afterEach(cleanup)

const EXISTING_ID = 'bono-idc'
const existing = (currency) => ({
  id: EXISTING_ID, name: 'Bono IDC', symbol: 'BONO-IDC', type: 'Bond', institution: 'IDC',
  quantity: 1, purchasePrice: 5000, currentPrice: 5000, currency,
  acquisitionDate: '2026-01-06', createdAt: '2026-01-06T15:00:00.000Z',
})

async function openMergeStep2({ existingCurrency, activePortfolio = '__all__', existingTag = {} }) {
  const onAdd = jest.fn(async () => EXISTING_ID)
  const onAddTransaction = jest.fn(async () => {})
  const onAddLot = jest.fn(async () => {})
  render(
    <AddAccountModal onClose={() => {}} onAdd={onAdd} onAddTransaction={onAddTransaction} onAddLot={onAddLot}
      existingItems={[{ ...existing(existingCurrency), ...existingTag }]} activePortfolio={activePortfolio} lang="es" baseCurrency="USD" />
  )
  fireEvent.click(screen.getByRole('button', { name: /Bono\/Instrumento/ }))
  fireEvent.change(document.getElementById('add-name'), { target: { value: 'Bono IDC' } })
  fireEvent.change(document.getElementById('add-institution'), { target: { value: 'IDC' } })
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
  await screen.findByText(/Este activo ya existe/)
  fireEvent.click(screen.getByRole('button', { name: /Agregar a posición/ }))
  await waitFor(() => expect(document.getElementById('add-currency')).toBeTruthy())
  // El monto del bono vive en el paso 2.
  fireEvent.change(document.getElementById('add-amountInvested'), { target: { value: '1000' } })
  return { onAdd, onAddTransaction, onAddLot }
}

describe('FASE OL: merge de posición y la moneda', () => {
  it('al entrar a "Agregar a posición" la moneda ya viene en la del ítem existente', async () => {
    await openMergeStep2({ existingCurrency: 'GTQ' })
    expect(document.getElementById('add-currency').value).toBe('GTQ')
  })

  it('con otra moneda que la del existente NO suma: rehúsa y nombra las dos', async () => {
    const { onAdd, onAddTransaction } = await openMergeStep2({ existingCurrency: 'GTQ' })
    fireEvent.change(document.getElementById('add-currency'), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(document.body.textContent).toMatch(/no se pueden sumar/))
    await new Promise((r) => setTimeout(r, 50))
    expect(onAdd).not.toHaveBeenCalled()
    expect(onAddTransaction).not.toHaveBeenCalled()
    const err = document.body.textContent
    expect(err).toMatch(/USD/)
    expect(err).toMatch(/GTQ/)
  })

  it('con la MISMA moneda suma el monto, conserva la fecha de compra ORIGINAL y el depósito lleva la de hoy', async () => {
    const { onAdd, onAddTransaction } = await openMergeStep2({ existingCurrency: 'USD' })
    const today = document.getElementById('add-acquisitionDate').value
    expect(today).not.toBe('2026-01-06')
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const item = onAdd.mock.calls[0][0]
    expect(item.id).toBe(EXISTING_ID)
    expect(item.currency).toBe('USD')
    expect(item.purchasePrice).toBe(6000)
    expect(item.quantity).toBe(1)
    // La fecha de adquisición del ÍTEM es la más vieja: la de la primera compra.
    expect(item.acquisitionDate).toBe('2026-01-06')
    await waitFor(() => expect(onAddTransaction).toHaveBeenCalled())
    const dep = onAddTransaction.mock.calls.find((c) => c[0].type === 'DEPOSIT')[0]
    expect(dep.totalAmount).toBe(1000)
    expect(dep.currency).toBe('USD')
    expect(dep.date).toBe(today)
    expect(dep._linkedItemId).toBe(EXISTING_ID)
  })

  it('un merge NO re-etiqueta: la posición se queda en su portafolio aunque el activo sea otro', async () => {
    const { onAdd } = await openMergeStep2({ existingCurrency: 'USD', activePortfolio: 'pA', existingTag: { portfolioId: 'pB' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const item = onAdd.mock.calls[0][0]
    expect(item.id).toBe(EXISTING_ID)
    expect(item).not.toHaveProperty('portfolioId')
  })

  it('control: "Crear separado" bajo un portafolio sí nace etiquetado en ese portafolio', async () => {
    const onAdd = jest.fn(async () => 'new-id')
    render(
      <AddAccountModal onClose={() => {}} onAdd={onAdd} onAddTransaction={async () => {}} onAddLot={async () => {}}
        existingItems={[existing('USD')]} activePortfolio="pA" lang="es" baseCurrency="USD" />
    )
    fireEvent.click(screen.getByRole('button', { name: /Bono\/Instrumento/ }))
    fireEvent.change(document.getElementById('add-name'), { target: { value: 'Bono IDC' } })
    fireEvent.change(document.getElementById('add-institution'), { target: { value: 'IDC' } })
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText(/Este activo ya existe/)
    fireEvent.click(screen.getByRole('button', { name: /Crear separado/ }))
    await waitFor(() => expect(document.getElementById('add-amountInvested')).toBeTruthy())
    fireEvent.change(document.getElementById('add-amountInvested'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const item = onAdd.mock.calls[0][0]
    expect(item.id).toBeUndefined()
    expect(item.portfolioId).toBe('pA')
    expect(item.purchasePrice).toBe(1000)
  })
})
