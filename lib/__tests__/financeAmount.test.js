import { cashFlowOf, flowSign, flowMagnitude, isReversal } from '../financeAmount'

const tx = (type, amount) => ({ type, amount })

describe('la dirección del dinero sale del monto, no solo del tipo', () => {
  it('un gasto normal sale', () => {
    expect(cashFlowOf(tx('EXPENSE', 100))).toBe(-100)
    expect(flowSign(tx('EXPENSE', 100))).toBe('-')
    expect(flowMagnitude(tx('EXPENSE', 100))).toBe(100)
  })

  it('un ingreso entra', () => {
    expect(cashFlowOf(tx('INCOME', 100))).toBe(100)
    expect(flowSign(tx('INCOME', 100))).toBe('+')
  })

  it('un reembolso es un gasto NEGATIVO y entra', () => {
    // El bug que esto existe para impedir: leer solo el tipo imprimía
    // "-Q-488.07" para dinero que volvió.
    const refund = tx('EXPENSE', -488.07)
    expect(cashFlowOf(refund)).toBeCloseTo(488.07, 2)
    expect(flowSign(refund)).toBe('+')
    expect(flowMagnitude(refund)).toBeCloseTo(488.07, 2)
  })

  it('marca el reembolso como lo que es, para que no se lea como un error', () => {
    expect(isReversal(tx('EXPENSE', -10))).toBe(true)
    expect(isReversal(tx('EXPENSE', 10))).toBe(false)
    expect(isReversal(tx('INCOME', 10))).toBe(false)
  })

  it('aguanta una fila sin monto sin inventar un signo', () => {
    expect(cashFlowOf({})).toBe(-0)
    expect(flowMagnitude({ type: 'EXPENSE' })).toBe(0)
    expect(flowSign({ type: 'INCOME' })).toBe('+')
  })
})

describe('un ida y vuelta se cancela solo', () => {
  it('salida y reembolso del mismo monto suman cero', () => {
    const out = tx('EXPENSE', 770)
    const back = tx('EXPENSE', -770)
    expect(cashFlowOf(out) + cashFlowOf(back)).toBe(0)
  })
})
