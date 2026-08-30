import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import AddFinanceTransactionModal from '@/components/finance/AddFinanceTransactionModal'

// ⛔ FASE MJ. El defecto se paga en la PANTALLA, no en el helper, así que se
// prueba montando el modal REAL: verificar una copia de la lógica es el atajo
// que dejó pasar el crash de FASE GQ3.
//
// Flujo está organizado por MES, así que un gasto tecleado a las 7pm del último
// día del mes se pre-llenaba con el mes SIGUIENTE: salía del mes en que ocurrió
// y engordaba el otro, moviendo el total, el desglose por categoría y la tasa
// de ahorro de DOS meses a la vez. La suite corre fijada en America/Guatemala
// (FASE LF), que es lo que hace observable el bug.
describe('la fecha que Flujo pre-llena es la del usuario, no la de UTC', () => {
  afterEach(() => { cleanup(); jest.useRealTimers() })

  const fecha = () => document.querySelector('input[type="date"]').value

  it('7pm del 31 de agosto se pre-llena 2026-08-31, no 2026-09-01', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T01:00:00Z'))
    render(<AddFinanceTransactionModal onClose={() => {}} onAdd={() => {}} />)
    expect(fecha()).toBe('2026-08-31')
  })

  it('de mañana no cambia nada respecto de antes', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T15:00:00Z'))
    render(<AddFinanceTransactionModal onClose={() => {}} onAdd={() => {}} />)
    expect(fecha()).toBe('2026-08-30')
  })

  // Control POSITIVO: sin esto, "la fecha es 2026-08-31" podría pasar porque el
  // input está vacío o el modal no renderizó.
  it('control: el campo existe y trae una fecha con forma ISO', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T01:00:00Z'))
    render(<AddFinanceTransactionModal onClose={() => {}} onAdd={() => {}} />)
    expect(document.querySelector('input[type="date"]')).toBeTruthy()
    expect(fecha()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
