import { computeMonthlyAnalysis } from '../financeMonth'
import { buildPnlStatement } from '../financePnl'
import { resolveCategoryModel } from '../financeCategoryModel'
import { annualPaymentsOfMonth } from '../recurringCharges'

// FASE OQ. Dos defectos del mismo borde: el CERO.
//
// 1. Un mes sin un solo movimiento cerraba con `bottom: {amount: 0, surplus:
//    true}`, y el componente pinta `surplus` con el verde de una ganancia: la
//    app afirmando "cerraste en cero" sobre un mes donde no hay nada capturado.
//    `surplus` sigue existiendo (decide la PALABRA: "Resultado", que en cero es
//    correcta, contra "Déficit", que sería falsa), y lo que se agrega es el
//    tercer estado para el COLOR.
//
// 2. `annualPaymentsOfMonth` devuelve `totalGtq` y la página leía `.total`, o
//    sea `undefined > 0` y la línea de pagos anuales NUNCA se renderizó. Acá se
//    fija la FORMA del retorno, que es lo que hace imposible volver a suponer
//    un nombre: un campo leído que nadie escribe no falla, simplemente no
//    dibuja nada.

const MODEL = resolveCategoryModel(null)
const ID = (v) => v

const pnlFor = (txs, when) => buildPnlStatement(computeMonthlyAnalysis(txs, when, ID), MODEL)

describe('FASE OQ: el cero exacto no es superávit', () => {
  it('un mes sin movimientos se declara vacío y su resultado NO es superávit pintable', () => {
    const txs = [{ id: 'a', date: '2026-07-05', type: 'EXPENSE', category: 'Alimentación', amount: 500, currency: 'GTQ' }]
    const a = computeMonthlyAnalysis(txs, { month: 3, year: 2026 }, ID)
    expect(a.status).toBe('empty')

    const p = buildPnlStatement(a, MODEL)
    expect(p.bottom.amount).toBe(0)
    // Regresión NEGATIVA: esto es lo que hacía que se pintara de verde.
    expect(p.bottom.surplus).toBe(true)
    // Y esto es lo que ahora lo impide.
    expect(p.bottom.zero).toBe(true)
  })

  it('un mes CON datos que cierra exactamente en cero tampoco es superávit', () => {
    const p = pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 1000, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 1000, currency: 'GTQ' },
    ], { month: 6, year: 2026 })
    expect(p.bottom.amount).toBeCloseTo(0, 6)
    expect(p.bottom.zero).toBe(true)
  })

  it('un superávit y un déficit REALES conservan su estado (control positivo)', () => {
    const sup = pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 1000, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 400, currency: 'GTQ' },
    ], { month: 6, year: 2026 })
    expect(sup.bottom.zero).toBe(false)
    expect(sup.bottom.surplus).toBe(true)

    const def = pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 400, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 1000, currency: 'GTQ' },
    ], { month: 6, year: 2026 })
    expect(def.bottom.zero).toBe(false)
    expect(def.bottom.surplus).toBe(false)
  })

  it('medio centavo sigue siendo ruido de redondeo, un centavo no', () => {
    const at = (expense) => pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 1000, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: expense, currency: 'GTQ' },
    ], { month: 6, year: 2026 })
    expect(at(1000.004).bottom.zero).toBe(true)
    expect(at(1000.01).bottom.zero).toBe(false)
  })
})

describe('FASE OQ: la forma de annualPaymentsOfMonth', () => {
  const txs = [
    { id: 'a', date: '2026-07-10', type: 'EXPENSE', category: 'Seguros', amount: 5000, currency: 'GTQ', _annualCadence: true, description: 'Poliza' },
  ]

  it('el total se llama totalGtq y NO existe ningún `total`', () => {
    const out = annualPaymentsOfMonth(txs, '2026-07', { convert: ID })
    expect(out.totalGtq).toBeCloseTo(5000, 6)
    // Regresión NEGATIVA: la página leía `.total` y por eso su línea nunca
    // apareció. Que la llave no exista es lo que vuelve imposible el error.
    expect('total' in out).toBe(false)
    expect(out.total).toBeUndefined()
  })

  it('un mes sin pagos anuales devuelve totalGtq en cero, no undefined', () => {
    const out = annualPaymentsOfMonth(txs, '2026-08', { convert: ID })
    expect(out.totalGtq).toBe(0)
  })
})
