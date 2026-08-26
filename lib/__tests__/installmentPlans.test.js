import { activeInstallmentPlans, installmentsInMonth, addMonths } from '../installmentPlans'

// El caso real de FASE JW: diez cuotas de un plan de 36 posteadas de un solo
// golpe, Q268.85 cada una.
const inst = (date, n, of, amount = 268.85, extra = {}) => ({
  date, type: 'EXPENSE', amount, currency: 'GTQ',
  description: `ISHOP GUATEMALA NL 01 (${n}/${of})`,
  merchant: `ISHOP GUATEMALA NL 01 (${n}/${of})`,
  installment: { num: n, of },
  category: 'Financiamiento', source: 'card_import',
  ...extra,
})

describe('addMonths', () => {
  it('suma meses con rollover de anio', () => {
    expect(addMonths('2026-07', 14)).toBe('2027-09')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', 0)).toBe('2026-01')
  })
})

describe('activeInstallmentPlans', () => {
  it('diez cuotas posteadas de golpe: manda la MAS ALTA, no un promedio', () => {
    const rows = []
    for (let n = 13; n <= 22; n++) rows.push(inst('2026-07-08', n, 36))
    const [p] = activeInstallmentPlans(rows)
    expect(p.paid).toBe(22)
    expect(p.of).toBe(36)
    expect(p.remaining).toBe(14)
    expect(p.monthly).toBeCloseTo(268.85)
    expect(p.remainingAmount).toBeCloseTo(14 * 268.85)
    // El estimado de liberacion: mes de la ultima cuota vista + las que faltan.
    expect(p.freesUpMonth).toBe('2027-09')
    // Y la etiqueta pierde el "(n/m)": es el mismo plan, no diez.
    expect(p.label).toBe('ISHOP GUATEMALA NL 01')
  })

  it('un plan que llego a su ultima cuota NO es activo', () => {
    const done = [inst('2026-07-08', 12, 12)]
    expect(activeInstallmentPlans(done)).toHaveLength(0)
  })

  it('dos planes del MISMO comercio con totales distintos son dos contratos', () => {
    const rows = [inst('2026-07-08', 5, 12), inst('2026-07-08', 22, 36)]
    const plans = activeInstallmentPlans(rows)
    expect(plans).toHaveLength(2)
  })

  it('ignora reversos, no-gastos y filas sin installment', () => {
    const rows = [
      inst('2026-07-08', 5, 12, -268.85),                       // reverso
      { ...inst('2026-07-08', 5, 12), type: 'INCOME' },          // no gasto
      { date: '2026-07-08', type: 'EXPENSE', amount: 100, description: 'CAFE' },
      { ...inst('2026-07-08', 13, 12) },                          // num > of: corrupto
    ]
    expect(activeInstallmentPlans(rows)).toHaveLength(0)
  })

  it('convierte a GTQ con el convert del caller y cae al crudo sin el', () => {
    const usd = [inst('2026-07-08', 3, 12, 100, { currency: 'USD' })]
    const conv = (v, from, to) => (from === 'USD' && to === 'GTQ' ? v * 7.7 : v)
    expect(activeInstallmentPlans(usd, { convert: conv })[0].monthly).toBeCloseTo(770)
    expect(activeInstallmentPlans(usd)[0].monthly).toBeCloseTo(100)
  })

  it('marca stale un plan sin cuota vista en ~2 meses, y lo dice en vez de esconderlo', () => {
    const rows = [inst('2026-03-08', 5, 12)]
    const [p] = activeInstallmentPlans(rows, { nowMonth: '2026-08' })
    expect(p.stale).toBe(true)
    const [fresh] = activeInstallmentPlans(rows, { nowMonth: '2026-04' })
    expect(fresh.stale).toBe(false)
  })

  it('ordena por compromiso restante: lo mas pesado primero', () => {
    const rows = [
      inst('2026-07-08', 11, 12, 50),   // faltan 50
      inst('2026-07-08', 22, 36, 268.85, { description: 'OTRO PLAN (22/36)', merchant: 'OTRO PLAN (22/36)' }),
    ]
    const plans = activeInstallmentPlans(rows)
    expect(plans[0].label).toBe('OTRO PLAN')
  })
})

describe('installmentsInMonth', () => {
  it('suma solo las cuotas del mes pedido', () => {
    const rows = []
    for (let n = 13; n <= 22; n++) rows.push(inst('2026-07-08', n, 36))
    rows.push(inst('2026-06-08', 12, 36))
    rows.push({ date: '2026-07-10', type: 'EXPENSE', amount: 500, description: 'CAFE' })
    const r = installmentsInMonth(rows, '2026-07')
    expect(r.count).toBe(10)
    expect(r.sum).toBeCloseTo(2688.5)
  })
})
