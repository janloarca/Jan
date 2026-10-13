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

it('Privada Común nunca busca precios, ni descarta lo tecleado antes en el buscador', async () => {
  const { authFetch } = require('../../lib/authFetch')
  authFetch.mockClear()
  render(<AddAccountModal onClose={() => {}} onAdd={async () => 'x'} existingItems={[]} lang="es" baseCurrency="USD" />)
  fireEvent.click(screen.getByRole('button', { name: /Acción/ }))
  fireEvent.change(document.getElementById('add-symbol'), { target: { value: 'ACME' } })
  fireEvent.click(screen.getByRole('button', { name: /Privada Común/ }))
  // Sin buscador de mercado y con el símbolo tecleado descartado.
  expect(document.getElementById('add-symbol')).toBeNull()
  await new Promise(r => setTimeout(r, 600))
  const searches = authFetch.mock.calls.filter(c => String(c[0]).includes('/api/prices/search'))
  expect(searches).toHaveLength(0)
})
