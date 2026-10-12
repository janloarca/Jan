/**
 * FASE QG. Reproduce la captura del usuario: Acción > Private Common >
 * Siguiente. El paso 2 tiene que traer los campos propios de la acción
 * privada (origen, acciones, monto, valor de hoy, fuente, cadencia).
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AddAccountModal from '@/components/AddAccountModal'

jest.mock('../../lib/authFetch', () => ({
  authFetch: jest.fn(async () => ({ ok: false })),
  safeJson: jest.fn(async () => null),
}))

afterEach(cleanup)

it('Private Common muestra monto, origen, valor, fuente y cadencia en el paso 2', async () => {
  render(<AddAccountModal onClose={() => {}} onAdd={async () => 'x'} existingItems={[]} lang="es" baseCurrency="USD" />)
  fireEvent.click(screen.getByRole('button', { name: /Acción/ }))
  const sub = document.querySelector('select[id*="subtype"]')
  if (sub) fireEvent.change(sub, { target: { value: 'private_common' } })
  else fireEvent.click(screen.getByRole('button', { name: /Privada Común/ }))
  fireEvent.change(document.getElementById('add-name'), { target: { value: 'Startup' } })
  fireEvent.change(document.getElementById('add-institution'), { target: { value: 'Carta' } })
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
  await waitFor(() => expect(document.getElementById('add-currency')).toBeTruthy())
  expect(document.getElementById('add-holdingOrigin')).toBeTruthy()
  expect(document.getElementById('add-amountInvested')).toBeTruthy()
  expect(document.getElementById('add-currentValue')).toBeTruthy()
})
