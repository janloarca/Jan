import {
  normalizePlan, firstPlannedMonth, chipsForMonth, expandPlan,
  planTotalsByMonth, realIncomeByMonth,
  upsertChip, removeChip, moveChip, serializePlan,
  REPEAT_MONTHLY, REPEAT_ONCE,
} from '../incomePlan'

// El caso del usuario: salario fijo de 15,000 todos los meses y una cátedra de
// 4,000 que a veces cae en noviembre y a veces en diciembre.
const salario = { id: 'a', label: 'Salario', amount: 15000, currency: 'GTQ', repeat: REPEAT_MONTHLY, startMonth: 0 }
const catedra = { id: 'b', label: 'Cátedra', amount: 4000, currency: 'GTQ', repeat: REPEAT_ONCE, month: 11 }
const basePlan = (chips = [salario, catedra]) => normalizePlan({ year: 2026, chips }, 2026)

describe('normalizePlan', () => {
  it('descarta cuadritos sin id o sin monto válido', () => {
    const plan = normalizePlan({ year: 2026, chips: [salario, { label: 'sin id', amount: 1 }, { id: 'x', amount: 'hola' }] }, 2026)
    expect(plan.chips.map((c) => c.id)).toEqual(['a'])
  })

  it('acota el mes al rango 0..11 en vez de aceptar basura', () => {
    const plan = normalizePlan({ year: 2026, chips: [{ ...catedra, month: 47 }] }, 2026)
    expect(plan.chips[0].month).toBe(11)
  })

  it('al cambiar de año, el mensual arranca en enero y el de una vez conserva su mes', () => {
    const plan = normalizePlan({ year: 2026, chips: [{ ...salario, startMonth: 7, skip: [9] }, catedra] }, 2027)
    expect(plan.year).toBe(2027)
    expect(plan.chips[0].startMonth).toBe(0)
    expect(plan.chips[0].skip).toEqual([])
    expect(plan.chips[1].month).toBe(11) // la cátedra sigue en diciembre
  })

  it('acota la tasa de ahorro a 0..100', () => {
    const plan = normalizePlan({ year: 2026, savingsRate: { 5: 150, 6: -20, 7: 40 } }, 2026)
    expect(plan.savingsRate).toEqual({ 5: 100, 6: 0, 7: 40 })
  })
})

describe('firstPlannedMonth', () => {
  it('es el mes actual dentro del año del plan', () => {
    expect(firstPlannedMonth(2026, new Date('2026-08-19T12:00:00Z'))).toBe(7)
  })
  it('es enero para un año futuro', () => {
    expect(firstPlannedMonth(2027, new Date('2026-08-19T12:00:00Z'))).toBe(0)
  })
  it('no deja ningún mes planificable en un año ya cerrado', () => {
    expect(firstPlannedMonth(2025, new Date('2026-08-19T12:00:00Z'))).toBe(12)
  })
})

describe('chipsForMonth', () => {
  it('el mensual aparece en todos los meses desde su arranque', () => {
    const plan = basePlan()
    expect(chipsForMonth(plan, 0).map((c) => c.id)).toEqual(['a'])
    expect(chipsForMonth(plan, 6).map((c) => c.id)).toEqual(['a'])
    expect(chipsForMonth(plan, 11).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('los meses anteriores a la frontera del plan quedan vacíos: ahí manda lo real', () => {
    const plan = basePlan()
    expect(chipsForMonth(plan, 3, 7)).toEqual([])
    expect(chipsForMonth(plan, 7, 7).map((c) => c.id)).toEqual(['a'])
  })

  it('un mes saltado no muestra el mensual pero los demás sí', () => {
    const plan = basePlan([{ ...salario, skip: [9] }])
    expect(chipsForMonth(plan, 9)).toEqual([])
    expect(chipsForMonth(plan, 10).map((c) => c.id)).toEqual(['a'])
  })
})

describe('planTotalsByMonth', () => {
  it('suma los cuadritos de cada mes', () => {
    const totals = planTotalsByMonth(basePlan())
    expect(totals[6]).toBe(15000)
    expect(totals[11]).toBe(19000)
  })

  it('convierte a la moneda pedida', () => {
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD' ? amt / 7.7 : amt)
    const totals = planTotalsByMonth(basePlan([salario]), { convert, to: 'USD' })
    expect(totals[0]).toBeCloseTo(15000 / 7.7, 6)
  })

  it('sin tasa disponible usa el monto crudo en vez de propagar NaN', () => {
    const convert = () => NaN
    const totals = planTotalsByMonth(basePlan([salario]), { convert, to: 'USD' })
    expect(totals[0]).toBe(15000)
  })

  it('respeta la frontera: los meses cerrados suman cero', () => {
    const totals = planTotalsByMonth(basePlan(), { fromMonth: 7 })
    expect(totals.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(totals[7]).toBe(15000)
  })
})

describe('realIncomeByMonth', () => {
  const txs = [
    { type: 'INCOME', date: '2026-03-15', amount: 12000, currency: 'GTQ' },
    { type: 'INCOME', date: '2026-03-28', amount: 500, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-03-10', amount: 900, currency: 'GTQ' },
    { type: 'INCOME', date: '2025-03-15', amount: 99999, currency: 'GTQ' },
  ]

  it('suma solo los ingresos del año pedido', () => {
    const real = realIncomeByMonth(txs, 2026)
    expect(real[2]).toBe(12500)
    expect(real.reduce((a, b) => a + b, 0)).toBe(12500)
  })

  it('convierte cada movimiento antes de sumar, nunca mezcla monedas', () => {
    const convert = (amt, from, to) => (from === 'USD' && to === 'GTQ' ? amt * 7.7 : amt)
    const real = realIncomeByMonth(
      [{ type: 'INCOME', date: '2026-01-05', amount: 100, currency: 'USD' },
       { type: 'INCOME', date: '2026-01-06', amount: 100, currency: 'GTQ' }],
      2026, { convert, to: 'GTQ' }
    )
    expect(real[0]).toBe(870)
  })
})

describe('mutaciones', () => {
  it('mover la cátedra de diciembre a noviembre y de vuelta', () => {
    let plan = basePlan()
    plan = moveChip(plan, 'b', 10)
    expect(chipsForMonth(plan, 10).map((c) => c.id)).toContain('b')
    expect(chipsForMonth(plan, 11).map((c) => c.id)).not.toContain('b')
    plan = moveChip(plan, 'b', 11)
    expect(chipsForMonth(plan, 11).map((c) => c.id)).toContain('b')
  })

  it('un cuadrito mensual no se mueve: está en todos los meses', () => {
    const plan = basePlan()
    expect(moveChip(plan, 'a', 3)).toBe(plan)
  })

  it('quitar un mensual de UN mes lo salta ahí y lo conserva en los demás', () => {
    const plan = removeChip(basePlan(), 'a', { month: 9 })
    expect(chipsForMonth(plan, 9)).toEqual([])
    expect(chipsForMonth(plan, 10).map((c) => c.id)).toEqual(['a'])
    expect(plan.chips.find((c) => c.id === 'a')).toBeTruthy()
  })

  it('quitar un mensual sin mes lo borra entero', () => {
    const plan = removeChip(basePlan(), 'a')
    expect(plan.chips.map((c) => c.id)).toEqual(['b'])
  })

  it('editar el mensual cambia el monto en todos los meses de una sola vez', () => {
    const plan = upsertChip(basePlan(), { ...salario, amount: 17000 })
    const totals = planTotalsByMonth(plan)
    expect(totals[0]).toBe(17000)
    expect(totals[6]).toBe(17000)
    expect(plan.chips.filter((c) => c.id === 'a')).toHaveLength(1)
  })

  it('las mutaciones no mutan el plan de entrada', () => {
    const plan = basePlan()
    const before = JSON.stringify(plan)
    moveChip(plan, 'b', 3); removeChip(plan, 'a'); upsertChip(plan, { ...salario, amount: 1 })
    expect(JSON.stringify(plan)).toBe(before)
  })
})

describe('serializePlan', () => {
  it('nunca emite undefined: Firestore los rechaza', () => {
    const doc = serializePlan(normalizePlan({ year: 2026, chips: [salario, catedra] }, 2026))
    const seen = JSON.stringify(doc)
    expect(seen).not.toContain('undefined')
    for (const chip of doc.chips) {
      for (const v of Object.values(chip)) expect(v).not.toBeUndefined()
    }
    expect(doc.returnRate).toBeNull()
  })

  it('los cuadritos salen como ARRAY, para que borrar uno sea borrarlo', () => {
    // Con un mapa por mes, el merge de Firestore fusiona campo a campo y el
    // cuadrito borrado sobreviviría a la escritura (lección FASE FT).
    const doc = serializePlan(removeChip(basePlan(), 'b'))
    expect(Array.isArray(doc.chips)).toBe(true)
    expect(doc.chips.map((c) => c.id)).toEqual(['a'])
  })

  it('el round-trip por Firestore conserva el plan', () => {
    const plan = basePlan()
    expect(normalizePlan(JSON.parse(JSON.stringify(serializePlan(plan))), 2026)).toEqual(plan)
  })
})

// FASE LK — el "real" del calendario excluye transferencias entre cuentas
// propias: sin esto, un pago de tarjeta degradado a 'Transferencia Recibida'
// por el neteo (FASE KV) inflaba el ingreso real del mes. Misma regla que los
// tres motores de financeMonth.
describe('realIncomeByMonth excluye transferencias (FASE LK)', () => {
  const { realIncomeByMonth } = require('../incomePlan')
  it('una Transferencia Recibida no es ingreso real', () => {
    const rows = [
      { type: 'INCOME', date: '2026-07-01', amount: 15000, currency: 'GTQ', category: 'Salario' },
      { type: 'INCOME', date: '2026-07-22', amount: 8175, currency: 'GTQ', category: 'Transferencia Recibida' },
    ]
    const out = realIncomeByMonth(rows, 2026, { convert: null })
    expect(out[6]).toBeCloseTo(15000, 2)
  })
})
