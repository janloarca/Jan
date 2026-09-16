import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import FileImportModal from '@/components/FileImportModal'

// FASE OF. Un pago de tarjeta hecho en OTRA moneda (el banco en quetzales paga
// la tarjeta en dólares) no se netea solo: el banco convirtió con su spread y
// la tasa de la app solo puede SUGERIRLO. Se prueba montando el modal REAL y
// subiendo un CSV de banco por el input de archivo, que es el camino completo
// (parse -> neteo -> vista previa -> aceptar), no una copia de la lógica.

// jsdom no trae `File.prototype.text`, que es lo que el modal usa para leer un
// CSV; se rellena con FileReader, que sí existe. Arnés, no producto.
beforeAll(() => {
  if (typeof File.prototype.text !== 'function') {
    File.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = reject
        fr.readAsText(this)
      })
    }
  }
})
afterEach(cleanup)

const RATE = 7.72
const convert = (amt, from, to) => {
  if (from === to) return amt
  if (from === 'USD' && to === 'GTQ') return amt * RATE
  if (from === 'GTQ' && to === 'USD') return amt / RATE
  return amt
}
// El pago que el estado de la TARJETA en dólares ya registró como ingreso.
const usdPayment = {
  id: 'usd1', type: 'INCOME', kind: 'payment', category: 'Salario',
  amount: 200, currency: 'USD', date: '2026-08-01', description: 'GRACIAS POR SU PAGO', source: 'card_import',
}
// El estado del BANCO en quetzales: el débito hacia esa tarjeta, más una compra.
const CSV = [
  'Fecha,Descripción,Débito,Crédito,Saldo',
  '02/08/2026,PAGO TC VISA USD,1540.00,,5000.00',
  '03/08/2026,SUPER LA TORRE,120.50,,4879.50',
].join('\n')

async function mountAndUpload(props = {}) {
  const onUpdate = jest.fn(async () => true)
  const onAdd = jest.fn(async () => true)
  render(
    <FileImportModal onClose={() => {}} onImportItems={jest.fn()} onAddFinanceTransaction={onAdd}
      onUpdateFinanceTransaction={onUpdate} existingFinanceTransactions={[usdPayment]}
      existingItems={[]} lang="es" context="finance" {...props} />
  )
  const input = document.querySelector('input[type="file"]')
  const file = new File([CSV], 'estado.csv', { type: 'text/csv' })
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  await waitFor(() => expect(screen.getByText(/Importar \d/)).toBeTruthy(), { timeout: 4000 })
  return { onUpdate, onAdd }
}

describe('FASE OF: pago en otra moneda en la vista previa del importador', () => {
  it('se SUGIERE con la casilla APAGADA, y las dos filas siguen importables', async () => {
    await mountAndUpload({ convert })
    expect(screen.getByText(/1 débito\(s\) en otra moneda podría\(n\) ser un pago a tu tarjeta/)).toBeTruthy()
    const box = screen.getByLabelText('Es el mismo pago')
    expect(box.checked).toBe(false)
    // Nada se neteó solo: las dos filas del banco entran y no se actualiza nada.
    expect(screen.getByText('Importar 2 transacciones')).toBeTruthy()
    // La tasa implícita y la de la app se DICEN, con su diferencia.
    expect(screen.getByText(/tasa implícita 7\.7000 · la app tiene 7\.7200 \(0\.3% de diferencia\)/)).toBeTruthy()
  })

  it('marcarla aparta el débito y degrada el pago en dólares; desmarcarla lo deshace', async () => {
    await mountAndUpload({ convert })
    const box = screen.getByLabelText('Es el mismo pago')
    fireEvent.click(box)
    await waitFor(() => expect(screen.getByText('Importar 1 · actualizar 1')).toBeTruthy())
    expect(screen.getByText(/1 pago\(s\) a tu tarjeta: no se importan como gasto/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Es el mismo pago'))
    await waitFor(() => expect(screen.getByText('Importar 2 transacciones')).toBeTruthy())
    expect(screen.queryByText(/no se importan como gasto/)).toBeNull()
  })

  it('al confirmar con la sugerencia aceptada, entra SOLO la compra y el pago en dólares pasa a transferencia', async () => {
    const { onUpdate, onAdd } = await mountAndUpload({ convert })
    fireEvent.click(screen.getByLabelText('Es el mismo pago'))
    await waitFor(() => expect(screen.getByText('Importar 1 · actualizar 1')).toBeTruthy())
    // El selector de cuenta a actualizar: sin saldo final (0) el import no toca ítems.
    fireEvent.click(screen.getByText('Importar 1 · actualizar 1'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(onUpdate).toHaveBeenCalledWith('usd1', expect.objectContaining({ category: 'Transferencia Recibida', _nettedTransfer: true }))
    const added = onAdd.mock.calls.map(([tx]) => tx.description)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/SUPER LA TORRE/)
  })

  // Sin tasas la sugerencia no existe: el modal se ve como siempre.
  it('control: sin `convert` no aparece ninguna sugerencia y nada cambia', async () => {
    await mountAndUpload()
    expect(screen.queryByText(/en otra moneda/)).toBeNull()
    expect(screen.getByText('Importar 2 transacciones')).toBeTruthy()
  })
})
