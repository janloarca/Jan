/**
 * FASE OJ. InlineCreateAccount (el "+ Crear cuenta nueva" del destino de
 * ingresos) no sabe nada del portafolio seleccionado: entrega al caller la
 * cuenta SIN etiqueta de alcance, y quien la escribe tiene que ponérsela. Por
 * eso el tablero le cablea `addItemInScope` y no `addItem` crudo (guardián en
 * lib/__tests__/scopeTagWired.test.js). Componente REAL vía @testing-library.
 */
import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react'
import InlineCreateAccount from '../InlineCreateAccount'

describe('InlineCreateAccount entrega la cuenta sin etiqueta: el caller la pone', () => {
  it('el ítem que sale del widget no trae portfolioId ni entityId, y devuelve el id que le den', async () => {
    const onCreate = jest.fn(async () => 'dest-id')
    const onCreated = jest.fn()
    const { getByPlaceholderText, getByRole } = render(
      <InlineCreateAccount onCreate={onCreate} onCancel={() => {}} onCreated={onCreated} lang="es" defaultCurrency="USD" />
    )
    fireEvent.change(getByPlaceholderText(/Fondo Líquido|nombre/i), { target: { value: 'Fondo Líquido' } })
    fireEvent.click(getByRole('button', { name: /crear/i }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    const item = onCreate.mock.calls[0][0]
    expect(item.name).toBe('Fondo Líquido')
    expect(item.type).toBe('Bank')
    expect(item).not.toHaveProperty('portfolioId')
    expect(item).not.toHaveProperty('entityId')
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('dest-id', item))
  })
})
