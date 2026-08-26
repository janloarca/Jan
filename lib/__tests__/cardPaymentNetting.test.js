import {
  planCardPaymentNetting, planStatementPaymentNetting,
  cardPaymentCandidates, bankPaymentCandidates, transferDemotion,
} from '../cardPaymentNetting'
import { computeMonthlyAnalysis, getMonthStatus } from '../financeMonth'
import { isTransferCategory } from '../financeCategories'
import { suggestSavingsRate } from '../wealthProjection'

// El pago que el estado de la TARJETA registró como ingreso (FASE KQ: entra
// como 'Salario' pero conserva su kind).
const cardPayment = (over = {}) => ({
  id: 'p1', type: 'INCOME', kind: 'payment', category: 'Salario',
  amount: 8175.09, currency: 'GTQ', date: '2026-07-15',
  description: 'GRACIAS POR SU PAGO', source: 'card_import', ...over,
})

// Una fila del estado del BANCO.
const bankRow = (over = {}) => ({
  type: 'EXPENSE', amount: 8175.09, currency: 'GTQ', date: '2026-07-15',
  description: 'PAGO TARJETA DE CREDITO', source: 'bi_import', ...over,
})

describe('qué fila puede ser la otra mitad', () => {
  it('un pago de tarjeta ya registrado', () => {
    expect(cardPaymentCandidates([cardPayment()])).toHaveLength(1)
  })

  it('un ingreso normal no, aunque el monto coincida', () => {
    expect(cardPaymentCandidates([cardPayment({ kind: undefined })])).toHaveLength(0)
  })

  it('un gasto no', () => {
    expect(cardPaymentCandidates([cardPayment({ type: 'EXPENSE' })])).toHaveLength(0)
  })

  it('uno ya neteado tampoco: re-importar el mismo estado no puede netearlo dos veces', () => {
    expect(cardPaymentCandidates([cardPayment({ _nettedTransfer: true })])).toHaveLength(0)
  })
})

describe('emparejar el débito del banco con el pago de la tarjeta', () => {
  it('mismo monto y fecha cercana: es el mismo dinero', () => {
    const out = planCardPaymentNetting([bankRow()], [cardPayment()])
    expect(out.pairs).toHaveLength(1)
    expect(out.rowIndexes.has(0)).toBe(true)
    expect(out.demotions.map((d) => d.id)).toEqual(['p1'])
  })

  // La evidencia es el monto exacto, no el texto: no hay ningún estado bancario
  // real de este usuario del cual sacar el vocabulario del banco.
  it('empareja aunque el banco lo describa de una forma que no reconocemos', () => {
    const out = planCardPaymentNetting([bankRow({ description: 'DEB AUT 0091 REF 88213' })], [cardPayment()])
    expect(out.pairs).toHaveLength(1)
  })

  it('un centavo de diferencia NO empareja', () => {
    const out = planCardPaymentNetting([bankRow({ amount: 8175.08 })], [cardPayment()])
    expect(out.pairs).toHaveLength(0)
  })

  it('otra moneda NO empareja', () => {
    const out = planCardPaymentNetting([bankRow({ currency: 'USD' })], [cardPayment()])
    expect(out.pairs).toHaveLength(0)
  })

  it('lejos en el tiempo NO empareja', () => {
    const out = planCardPaymentNetting([bankRow({ date: '2026-08-20' })], [cardPayment()])
    expect(out.pairs).toHaveLength(0)
  })

  it('un crédito del banco nunca es la salida hacia la tarjeta', () => {
    const out = planCardPaymentNetting([bankRow({ type: 'INCOME' })], [cardPayment()])
    expect(out.pairs).toHaveLength(0)
  })

  it('sin nada registrado no hay nada que netear', () => {
    expect(planCardPaymentNetting([bankRow()], []).pairs).toHaveLength(0)
  })
})

describe('1:1, como reconcileStatement', () => {
  it('dos pagos iguales el mismo mes siguen siendo dos', () => {
    const bank = [bankRow({ date: '2026-07-15' }), bankRow({ date: '2026-07-16' })]
    const rec = [cardPayment({ id: 'p1' }), cardPayment({ id: 'p2', date: '2026-07-16' })]
    const out = planCardPaymentNetting(bank, rec)
    expect(out.pairs).toHaveLength(2)
    expect(out.demotions.map((d) => d.id).sort()).toEqual(['p1', 'p2'])
  })

  it('un solo pago registrado no puede netear dos débitos', () => {
    const bank = [bankRow({ date: '2026-07-15' }), bankRow({ date: '2026-07-16' })]
    const out = planCardPaymentNetting(bank, [cardPayment()])
    expect(out.pairs).toHaveLength(1)
    expect(out.rowIndexes.size).toBe(1)
  })

  it('con dos débitos del mismo monto gana el que además lo dice', () => {
    // El texto solo desempata; el índice apartado tiene que ser el del que sí
    // nombra la tarjeta, no el primero del archivo.
    const bank = [
      bankRow({ description: 'RETIRO CAJERO' }),
      bankRow({ description: 'PAGO TARJETA VISA' }),
    ]
    const out = planCardPaymentNetting(bank, [cardPayment()])
    expect(out.pairs).toHaveLength(1)
    expect(out.rowIndexes.has(1)).toBe(true)
    expect(out.rowIndexes.has(0)).toBe(false)
  })
})

describe('lo que se le escribe a la fila registrada', () => {
  it('la degrada a transferencia y la marca decidida', () => {
    const d = transferDemotion('INCOME')
    expect(isTransferCategory(d.category)).toBe(true)
    expect(d._nettedTransfer).toBe(true)
    // Para que Reclasificar nunca la devuelva a Salario.
    expect(d._categorySetByUser).toBe(true)
  })
})

describe('una transferencia no cuenta en ningún total', () => {
  const convert = (n) => n
  const mes = { month: 6, year: 2026 } // julio

  it('el caso completo: las dos caras dejan de inflarse', () => {
    // Sueldo real del banco, compras reales de la tarjeta, y el pago que
    // aparecía en las DOS mitades.
    const base = [
      { type: 'INCOME', category: 'Salario', amount: 15000, date: '2026-07-01' },
      { type: 'EXPENSE', category: 'Alimentación', amount: 8175.09, date: '2026-07-10' },
    ]
    const sinNetear = [
      ...base,
      { type: 'INCOME', category: 'Salario', amount: 8175.09, date: '2026-07-15' },
      { type: 'EXPENSE', category: 'Otros Gastos', amount: 8175.09, date: '2026-07-15' },
    ]
    const neteado = [
      ...base,
      { type: 'INCOME', category: 'Transferencia Recibida', amount: 8175.09, date: '2026-07-15' },
    ]

    const malo = computeMonthlyAnalysis(sinNetear, mes, convert)
    expect(malo.income).toBeCloseTo(23175.09, 2)
    expect(malo.expenses).toBeCloseTo(16350.18, 2)

    const bueno = computeMonthlyAnalysis(neteado, mes, convert)
    expect(bueno.income).toBe(15000)
    expect(bueno.expenses).toBeCloseTo(8175.09, 2)
    // El ahorro ya era correcto por accidente (las dos caras se inflaban por lo
    // mismo); lo que estaba mal eran las dos cifras que la gente lee.
    expect(bueno.savings).toBeCloseTo(malo.savings, 2)
  })

  it('tampoco entra al desglose por grupo', () => {
    const out = computeMonthlyAnalysis([
      { type: 'EXPENSE', category: 'Transferencia Enviada', amount: 500, date: '2026-07-02' },
      { type: 'EXPENSE', category: 'Alimentación', amount: 100, date: '2026-07-03' },
    ], mes, convert)
    expect(out.expenses).toBe(100)
    const total = out.groups.reduce((s, g) => s + g.amount, 0)
    expect(total).toBeCloseTo(100, 2)
  })

  it('la tasa de ahorro sugerida tampoco las cuenta', () => {
    // Tres motores suman el mismo mes (la card de Flujo, el motor mensual y
    // esta sugerencia). Si uno contara las transferencias, la pantalla se
    // contradiría consigo misma.
    const base = [
      { type: 'INCOME', category: 'Salario', amount: 10000, date: '2026-06-01' },
      { type: 'EXPENSE', category: 'Alimentación', amount: 5000, date: '2026-06-10' },
    ]
    const conTransfer = [
      ...base,
      { type: 'INCOME', category: 'Transferencia Recibida', amount: 90000, date: '2026-06-15' },
      { type: 'EXPENSE', category: 'Transferencia Enviada', amount: 90000, date: '2026-06-15' },
    ]
    const a = suggestSavingsRate(base, { year: 2026, month: 6 })
    const b = suggestSavingsRate(conTransfer, { year: 2026, month: 6 })
    expect(a.pct).toBe(50)
    expect(b.pct).toBe(a.pct)
  })

  it('un mes de puras transferencias está vacío, no completo', () => {
    const txs = [
      { type: 'INCOME', category: 'Transferencia Recibida', amount: 500, date: '2026-07-01' },
      { type: 'EXPENSE', category: 'Transferencia Enviada', amount: 500, date: '2026-07-01' },
    ]
    expect(getMonthStatus(txs, '2026-07')).toBe('empty')
  })
})

// ── El caso espejo: primero el banco, después la tarjeta ────────────────────
//
// El orden de importación no lo decide nadie, así que la mitad simétrica hace
// falta: con el débito del banco ya registrado, la fila de pago del estado de
// la tarjeta entraría como ingreso sin que nada las empareje.
describe('llega el estado de la TARJETA con el del banco ya importado', () => {
  const recordedBank = (over = {}) => ({ id: 'b1', ...bankRow(), ...over })

  it('empareja el pago de la tarjeta con el débito ya registrado', () => {
    const out = planStatementPaymentNetting([cardPayment()], [recordedBank()])
    expect(out.pairs).toHaveLength(1)
    expect(out.rowIndexes.has(0)).toBe(true)
    expect(out.demotions).toEqual([{ id: 'b1', updates: transferDemotion('EXPENSE') }])
  })

  it('el débito del banco se degrada al lado del GASTO, no al del ingreso', () => {
    // Cruzar las dos categorías dejaría la fila con una que su propia pantalla
    // no ofrece: 'Transferencia Recibida' solo existe para ingresos.
    const out = planStatementPaymentNetting([cardPayment()], [recordedBank()])
    expect(out.demotions[0].updates.category).toBe('Transferencia Enviada')
  })

  it('una compra del estado de la tarjeta nunca se netea, solo un pago', () => {
    const compra = { ...cardPayment(), kind: 'purchase', type: 'EXPENSE' }
    expect(planStatementPaymentNetting([compra], [recordedBank()]).pairs).toHaveLength(0)
  })

  it('un gasto TECLEADO a mano no es candidato, aunque el monto coincida', () => {
    // "Cualquier gasto registrado" sería un conjunto demasiado ancho para
    // emparejar solo por monto: mejor no netear que netear una compra real.
    expect(bankPaymentCandidates([recordedBank({ source: 'manual' })])).toHaveLength(0)
    expect(bankPaymentCandidates([recordedBank({ source: undefined })])).toHaveLength(0)
    expect(bankPaymentCandidates([recordedBank()])).toHaveLength(1)
  })

  it('un INGRESO del banco tampoco: el pago sale, no entra', () => {
    expect(bankPaymentCandidates([recordedBank({ type: 'INCOME' })])).toHaveLength(0)
  })

  it('re-importar el mismo estado no netea dos veces', () => {
    expect(bankPaymentCandidates([recordedBank({ _nettedTransfer: true })])).toHaveLength(0)
  })

  it('sigue siendo 1:1', () => {
    const rows = [cardPayment({ id: undefined }), cardPayment({ id: undefined, date: '2026-07-16' })]
    const out = planStatementPaymentNetting(rows, [recordedBank()])
    expect(out.pairs).toHaveLength(1)
    expect(out.rowIndexes.size).toBe(1)
  })

  it('las dos direcciones dejan UNA sola fila, rotulada como transferencia', () => {
    // Importar en un orden o en el otro tiene que terminar igual: una fila que
    // no cuenta en ningún total, no dos y no cero.
    const a = planCardPaymentNetting([bankRow()], [cardPayment()])
    const b = planStatementPaymentNetting([cardPayment()], [recordedBank()])
    expect(a.rowIndexes.size).toBe(1)
    expect(b.rowIndexes.size).toBe(1)
    expect(a.demotions).toHaveLength(1)
    expect(b.demotions).toHaveLength(1)
    expect(isTransferCategory(a.demotions[0].updates.category)).toBe(true)
    expect(isTransferCategory(b.demotions[0].updates.category)).toBe(true)
  })
})
