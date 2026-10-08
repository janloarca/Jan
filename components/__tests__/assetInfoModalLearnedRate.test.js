/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssetInfoModal from '../dashboard/AssetInfoModal'

const item = {
  id: 'f1', name: 'Fondo', type: 'Cuenta de ahorro', symbol: 'FONDO', currency: 'USD',
  quantity: 1, currentPrice: 1000, purchasePrice: 1000, incomeMode: 'percent', incomeRate: 4,
  institution: 'Banco',
}
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
const observations = (() => {
  let v = 1000
  return MONTHS.map((month, i) => {
    if (i > 0) { const [y, m] = month.split('-').map(Number); v *= Math.pow(1.06, new Date(Date.UTC(y, m, 0)).getUTCDate() / 365.25) }
    return { itemId: 'f1', month, value: Math.round(v * 100) / 100, currency: 'USD' }
  })
})()
const base = { item, items: [item], transactions: [], observations, currentMonthKey: '2026-10', lang: 'es', onClose: () => {} }

test('sugiere la tasa y NO escribe nada hasta que el usuario toca', async () => {
  const onUpdateItem = jest.fn().mockResolvedValue()
  render(<AssetInfoModal {...base} onUpdateItem={onUpdateItem} />)
  expect(screen.getByText(/Tasa que parece rendir/)).toBeTruthy()
  expect(onUpdateItem).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(/^Usar /))
  await waitFor(() => expect(onUpdateItem).toHaveBeenCalledTimes(1))
  const [id, patch] = onUpdateItem.mock.calls[0]
  expect(id).toBe('f1')
  expect(patch.incomeRate).toBeCloseTo(6, 1)
  expect(patch._learnedRate.dismissed).toBe(false)
})

test('"No, gracias" guarda el descarte con la firma', async () => {
  const onUpdateItem = jest.fn().mockResolvedValue()
  render(<AssetInfoModal {...base} onUpdateItem={onUpdateItem} />)
  fireEvent.click(screen.getByText('No, gracias'))
  await waitFor(() => expect(onUpdateItem).toHaveBeenCalled())
  expect(onUpdateItem.mock.calls[0][1]._learnedRate.dismissed).toBe(true)
  expect(onUpdateItem.mock.calls[0][1].incomeRate).toBeUndefined()
})

test('sin observaciones suficientes la tarjeta no existe', () => {
  render(<AssetInfoModal {...base} observations={observations.slice(0, 2)} onUpdateItem={jest.fn()} />)
  expect(screen.queryByText(/Tasa que parece rendir/)).toBeNull()
})
