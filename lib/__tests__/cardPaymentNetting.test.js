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

  // Este test afirmaba lo CONTRARIO ("uno ya neteado tampoco") y describía un
  // defecto: como el neteo APARTA la fila del otro estado en vez de escribirla,
  // sacar a la degradada de los candidatos hacía que el segundo import no
  // emparejara nada y la fila apartada entrara como nueva. El doble conteo
  // volvía por la puerta de atrás.
  it('uno ya neteado SIGUE siendo candidato: es lo que aparta su mitad en cada re-import', () => {
    expect(cardPaymentCandidates([cardPayment({ _nettedTransfer: true })])).toHaveLength(1)
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

  // Mismo caso que en la dirección 1, y el mismo defecto: este test fijaba que
  // una fila ya degradada dejaba de ser candidata, y eso es justo lo que
  // reabría el doble conteo al re-importar.
  it('uno ya neteado SIGUE siendo candidato', () => {
    expect(bankPaymentCandidates([recordedBank({ _nettedTransfer: true })])).toHaveLength(1)
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

// El neteo APARTA la fila del otro estado en vez de escribirla, así que en un
// re-import no hay ninguna fila nueva que la absorba: la única que puede
// hacerlo es la que quedó degradada la vez anterior. Si esa deja de ser
// candidata, el segundo import no empareja, la fila apartada entra como NUEVA y
// el doble conteo vuelve.
describe('re-importar el MISMO estado no re-introduce el doble conteo', () => {
  it('banco: el débito sigue apartado en el segundo import', () => {
    const yaNeteada = { ...cardPayment(), ...transferDemotion('INCOME') }
    expect(planCardPaymentNetting([bankRow()], [yaNeteada]).rowIndexes.has(0)).toBe(true)
  })

  it('tarjeta: el pago sigue apartado en el segundo import', () => {
    const yaNeteado = { id: 'b1', ...bankRow(), ...transferDemotion('EXPENSE') }
    expect(planStatementPaymentNetting([cardPayment()], [yaNeteado]).rowIndexes.has(0)).toBe(true)
  })

  it('pero no se re-escribe una degradación que ya está puesta', () => {
    // Emparejar sí, escribir no: sería un write por nada en cada re-import.
    const yaNeteada = { ...cardPayment(), ...transferDemotion('INCOME') }
    expect(planCardPaymentNetting([bankRow()], [yaNeteada]).demotions).toHaveLength(0)
    const yaNeteado = { id: 'b1', ...bankRow(), ...transferDemotion('EXPENSE') }
    expect(planStatementPaymentNetting([cardPayment()], [yaNeteado]).demotions).toHaveLength(0)
  })
})

// ⛔ FASE MN. El emparejamiento tomaba el PRIMER candidato que calzara, así que
// con dos pagos del mismo monto dentro de la ventana (±5 días) el resultado
// dependía del orden en que Firestore devolvió los documentos. No cambia los
// totales del import, pero sí QUÉ fila deja de contar: con la ventana cruzando
// un fin de mes, eso mueve el dinero de un mes al otro.
describe('FASE MN: gana el pago más cercano en fecha, no el primero', () => {
  const bankRows = [{ type: 'EXPENSE', description: 'PAGO TARJETA', amount: 2000, currency: 'GTQ', date: '2026-08-02' }]
  const jul = { id: 'jul', type: 'INCOME', kind: 'payment', amount: 2000, currency: 'GTQ', date: '2026-07-30' }
  const ago = { id: 'ago', type: 'INCOME', kind: 'payment', amount: 2000, currency: 'GTQ', date: '2026-08-03' }

  it('elige el del 3 de agosto (1 día) sobre el del 30 de julio (3 días)', () => {
    expect(planCardPaymentNetting(bankRows, [jul, ago]).demotions.map((d) => d.id)).toEqual(['ago'])
  })

  it('y da lo MISMO con el arreglo al revés: el orden ya no decide', () => {
    expect(planCardPaymentNetting(bankRows, [ago, jul]).demotions.map((d) => d.id)).toEqual(['ago'])
  })

  // Control POSITIVO: con un solo candidato sigue emparejando igual que siempre.
  it('control: un solo pago dentro de la ventana se sigue emparejando', () => {
    const r = planCardPaymentNetting(bankRows, [jul])
    expect(r.demotions.map((d) => d.id)).toEqual(['jul'])
    expect(r.rowIndexes.has(0)).toBe(true)
  })

  // Control NEGATIVO: fuera de la ventana no se empareja nada, o si no "elige el
  // más cercano" pasaría por emparejar con cualquier cosa.
  it('control: fuera de la ventana no empareja', () => {
    const lejos = { ...jul, id: 'lejos', date: '2026-07-01' }
    expect(planCardPaymentNetting(bankRows, [lejos]).demotions).toEqual([])
  })

  it('dos débitos y dos pagos: cada uno con el suyo, 1:1', () => {
    const dos = [
      { type: 'EXPENSE', description: 'PAGO TARJETA', amount: 2000, currency: 'GTQ', date: '2026-08-02' },
      { type: 'EXPENSE', description: 'PAGO TARJETA', amount: 2000, currency: 'GTQ', date: '2026-07-29' },
    ]
    const ids = planCardPaymentNetting(dos, [jul, ago]).demotions.map((d) => d.id).sort()
    expect(ids).toEqual(['ago', 'jul'])
  })
})

// ── FASE OF: pago en OTRA moneda, sugerido y nunca neteado solo ─────────────
//
// El banco en quetzales paga la tarjeta en dólares: el débito dice Q1,540 y el
// pago registrado dice $200. A la tasa de la app (7.72) serían Q1,544: no
// coincide al centavo porque el banco convirtió con su spread, y `pairRows`
// exige misma moneda. Se SUGIERE dentro de una banda, y el usuario decide.
describe('FASE OF: sugerencia de pago en otra moneda', () => {
  const { acceptNettingSuggestions, CROSS_CURRENCY_TOLERANCE } = require('../cardPaymentNetting')
  const RATE = 7.72
  const convert = (amt, from, to) => {
    if (from === to) return amt
    if (from === 'USD' && to === 'GTQ') return amt * RATE
    if (from === 'GTQ' && to === 'USD') return amt / RATE
    return amt // sin tasa: monto crudo, como hace el convert real
  }
  const usdPayment = (over = {}) => cardPayment({ id: 'usd1', amount: 200, currency: 'USD', date: '2026-08-01', ...over })
  const gtqDebit = (over = {}) => bankRow({ amount: 1540, currency: 'GTQ', date: '2026-08-02', description: 'PAGO TC VISA USD', ...over })

  it('el débito en quetzales del pago en dólares se SUGIERE, no se netea', () => {
    const out = planCardPaymentNetting([gtqDebit()], [usdPayment()], { convert })
    expect(out.pairs).toHaveLength(0)
    expect(out.rowIndexes.size).toBe(0)
    expect(out.demotions).toEqual([])
    expect(out.suggestions).toHaveLength(1)
    const s = out.suggestions[0]
    expect(s.index).toBe(0)
    expect(s.match.id).toBe('usd1')
    expect(s.impliedRate).toBeCloseTo(7.7, 6)
    expect(s.appRate).toBeCloseTo(RATE, 6)
    expect(s.deviation).toBeLessThan(CROSS_CURRENCY_TOLERANCE)
  })

  it('sin `convert` no se sugiere nada: sin tasa no hay contra qué medir', () => {
    const out = planCardPaymentNetting([gtqDebit()], [usdPayment()])
    expect(out.suggestions).toEqual([])
  })

  it('una moneda para la que convert devuelve el monto CRUDO no sostiene una sugerencia', () => {
    // $200 contra Q205: sin tasa, `convert` devolvería 200 y 205 quedaría
    // "dentro de la banda" del número equivocado.
    const noRate = (amt) => amt
    const out = planCardPaymentNetting([gtqDebit({ amount: 205 })], [usdPayment()], { convert: noRate })
    expect(out.suggestions).toEqual([])
  })

  it('fuera de la banda del 3% no se sugiere: un gasto real que por casualidad se parece no es un pago', () => {
    const out = planCardPaymentNetting([gtqDebit({ amount: 1700 })], [usdPayment()], { convert })
    expect(out.suggestions).toEqual([])
  })

  it('fuera de la ventana de fechas tampoco', () => {
    const out = planCardPaymentNetting([gtqDebit({ date: '2026-08-20' })], [usdPayment()], { convert })
    expect(out.suggestions).toEqual([])
  })

  it('la pasada exacta gana: un pago ya reclamado al centavo no vuelve a sugerirse', () => {
    const exact = cardPayment({ id: 'q1', amount: 1540, currency: 'GTQ', date: '2026-08-01' })
    const out = planCardPaymentNetting([gtqDebit()], [exact, usdPayment()], { convert })
    expect(out.pairs.map((p) => p.match.id)).toEqual(['q1'])
    expect(out.suggestions).toEqual([])
  })

  it('1:1 por cercanía a la tasa de la app: dos débitos parecidos, cada uno con el suyo', () => {
    const rows = [gtqDebit({ amount: 1560 }), gtqDebit({ amount: 1540 })]
    const pays = [usdPayment(), usdPayment({ id: 'usd2', date: '2026-08-03' })]
    const out = planCardPaymentNetting(rows, pays, { convert })
    expect(out.suggestions).toHaveLength(2)
    const ids = out.suggestions.map((s) => s.match.id).sort()
    expect(ids).toEqual(['usd1', 'usd2'])
    expect(new Set(out.suggestions.map((s) => s.index)).size).toBe(2)
  })

  it('aceptarla la vuelve un par: la fila se aparta y el pago se degrada a transferencia', () => {
    const base = planCardPaymentNetting([gtqDebit()], [usdPayment()], { convert })
    const plan = acceptNettingSuggestions(base, new Set([0]))
    expect(plan.rowIndexes.has(0)).toBe(true)
    expect(plan.pairs).toHaveLength(1)
    expect(plan.pairs[0].crossCurrency).toBe(true)
    expect(plan.demotions).toEqual([{ id: 'usd1', updates: transferDemotion('INCOME') }])
    // La base no se toca: desmarcar vuelve a decidir desde ella.
    expect(base.rowIndexes.size).toBe(0)
    expect(base.demotions).toEqual([])
    const back = acceptNettingSuggestions(base, new Set())
    expect(back.rowIndexes.size).toBe(0)
    expect(back.demotions).toEqual([])
  })

  it('dirección espejo: el estado de la TARJETA en dólares contra un débito bancario en quetzales', () => {
    const cardRow = { kind: 'payment', type: 'INCOME', amount: 200, currency: 'USD', date: '2026-08-01', description: 'GRACIAS POR SU PAGO' }
    const bankDebit = { id: 'bank1', type: 'EXPENSE', source: 'bi_import', amount: 1540, currency: 'GTQ', date: '2026-08-02', description: 'PAGO TC' }
    const base = planStatementPaymentNetting([cardRow], [bankDebit], { convert })
    expect(base.pairs).toHaveLength(0)
    expect(base.suggestions).toHaveLength(1)
    const plan = acceptNettingSuggestions(base, [0])
    expect(plan.demotions).toEqual([{ id: 'bank1', updates: transferDemotion('EXPENSE') }])
  })

  it('un pago ya degradado en otra moneda sigue siendo candidato a sugerencia (re-import)', () => {
    const out = planCardPaymentNetting([gtqDebit()], [usdPayment({ _nettedTransfer: true, category: 'Transferencia Recibida' })], { convert })
    expect(out.suggestions).toHaveLength(1)
    // ...pero aceptarla no vuelve a escribir la degradación que ya está puesta.
    expect(acceptNettingSuggestions(out, [0]).demotions).toEqual([])
  })
})

// El cableado vive en JSX que jest no monta sin subir un archivo real, así que
// se fija leyendo la FUENTE (precedente moneyInputs.test.js).
describe('FASE OF: cableado de las sugerencias', () => {
  const fs = require('fs')
  const path = require('path')
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8')

  it('las dos páginas le pasan `convert` al importador', () => {
    for (const page of ['app/dashboard/page.jsx', 'app/finances/page.jsx']) {
      const src = read(page)
      const start = src.indexOf('<FileImportModal')
      expect(start).toBeGreaterThan(-1)
      const block = src.slice(start, src.indexOf('/>', start))
      expect(block).toMatch(/convert=\{convert\}/)
    }
  })

  it('el importador pasa `convert` a los DOS planificadores y aplica las aceptadas desde la base', () => {
    const src = read('components/FileImportModal.jsx')
    expect(src).toMatch(/planStatementPaymentNetting\([^)]*\{ convert \}\)/)
    expect(src).toMatch(/planCardPaymentNetting\([^)]*\{ convert \}\)/)
    expect(src).toMatch(/acceptNettingSuggestions\(biNettingBase, next\)/)
    // Apagadas por default: nunca se pre-aceptan.
    expect(src).toMatch(/setBiNettingAccepted\(new Set\(\)\)/)
  })
})
