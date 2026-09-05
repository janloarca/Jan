// FASE OB. Borrar un aporte/retiro/gasto que MOVIO un saldo lo devuelve.
// Ver la cabecera de lib/cashflowReversal.js.
import { cashflowReversalPlan, cashflowReversalLines } from '../cashflowReversal'
import { accountValue } from '../transferFields'

const caja = { id: 'caja', name: 'Caja', symbol: 'CAJA', type: 'Bank', quantity: 1, purchasePrice: 1500, currentPrice: 1500, currency: 'USD' }
const bono = { id: 'bono', name: 'Bono', symbol: 'BONO', type: 'Bond', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD' }
const accion = { id: 'acme', name: 'Acme', symbol: 'ACME', type: 'Stock', quantity: 10, purchasePrice: 50, currentPrice: 60, _originalPrice: 60, currency: 'USD' }
const dep = (o = {}) => ({ id: 'd1', type: 'DEPOSIT', date: '2026-04-01', symbol: 'CAJA', totalAmount: 500, currency: 'USD', _linkedItemId: 'caja', _source: 'manual_cashflow', _balanceMoved: true, ...o })

describe('cashflowReversalPlan', () => {
  it('un DEPOSIT que movio el saldo se QUITA de la cuenta al borrarse', () => {
    const plan = cashflowReversalPlan(dep(), [caja])
    expect(plan.side.id).toBe('caja')
    expect(plan.side.direction).toBe('debit')
    expect(accountValue({ ...caja, ...plan.side.fields })).toBe(1000)
  })
  it('un WITHDRAWAL que movio el saldo se DEVUELVE', () => {
    const plan = cashflowReversalPlan(dep({ type: 'WITHDRAWAL', totalAmount: 200 }), [caja])
    expect(plan.side.direction).toBe('credit')
    expect(accountValue({ ...caja, ...plan.side.fields })).toBe(1700)
  })
  it('un gasto pagado DESDE una cuenta le devuelve el dinero a esa cuenta', () => {
    const fee = { id: 'f1', type: 'FEE', date: '2026-05-01', symbol: 'BONO', totalAmount: 120, currency: 'USD', _linkedItemId: 'bono', _paidFromItemId: 'caja', _source: 'manual_cashflow', _balanceMoved: true }
    const plan = cashflowReversalPlan(fee, [caja, bono])
    expect(plan.side.id).toBe('caja')
    expect(accountValue({ ...caja, ...plan.side.fields })).toBe(1620)
  })
  it('tambien un activo estatico que no es banco (un bono al que se aporto)', () => {
    const plan = cashflowReversalPlan(dep({ symbol: 'BONO', _linkedItemId: 'bono', totalAmount: 1000 }), [bono])
    expect(accountValue({ ...bono, ...plan.side.fields })).toBe(5000)
  })

  // ⛔ El invariante central: solo se revierte lo que la fila DICE que movio.
  it('sin la marca _balanceMoved no hay nada que devolver ("Capturar historia", ajuste del editor, filas viejas)', () => {
    expect(cashflowReversalPlan(dep({ _balanceMoved: undefined }), [caja])).toBeNull()
    expect(cashflowReversalPlan(dep({ _balanceMoved: false }), [caja])).toBeNull()
    expect(cashflowReversalPlan(dep({ _source: 'manual_new_account', _balanceMoved: undefined }), [caja])).toBeNull()
  })
  it('un activo de MERCADO no se toca (sus unidades viven en lotes) y lo dice', () => {
    const plan = cashflowReversalPlan(dep({ symbol: 'ACME', _linkedItemId: 'acme' }), [accion])
    expect(plan.side).toBeNull()
    expect(plan.marketNote).toBe(true)
    expect(cashflowReversalLines(plan, 'es', null).join(' ')).toMatch(/unidades/)
  })
  it('la cuenta ya borrada: nada que escribir, la fila se va a secas', () => {
    const plan = cashflowReversalPlan(dep(), [])
    expect(plan.side).toBeNull()
    expect(plan.missing).toBe(true)
  })
  it('un DEPOSIT mayor que el saldo de hoy se REHUSA en vez de dejar la cuenta en cero', () => {
    const plan = cashflowReversalPlan(dep({ totalAmount: 5000 }), [caja])
    expect(plan.side).toBeNull()
    expect(plan.refused).toBe(true)
    expect(cashflowReversalLines(plan, 'en', null).join(' ')).toMatch(/cannot be undone/)
  })
  it('tipos que no son flujos de saldo no entran', () => {
    expect(cashflowReversalPlan(dep({ type: 'DIVIDEND' }), [caja])).toBeNull()
    expect(cashflowReversalPlan(dep({ type: 'TRANSFER' }), [caja])).toBeNull()
    expect(cashflowReversalPlan(dep({ totalAmount: 0 }), [caja])).toBeNull()
  })
  it('las lineas nombran el monto, la cuenta y la direccion', () => {
    const lines = cashflowReversalLines(cashflowReversalPlan(dep(), [caja]), 'es', (a, c) => `${c} ${a}`)
    expect(lines).toEqual(['Quita USD 500 de Caja'])
  })
})
