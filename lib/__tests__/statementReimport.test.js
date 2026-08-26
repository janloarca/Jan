// El SEGUNDO import del mismo estado es parte del caso base, no un extremo.
//
// El neteo y la reconciliación se probaban cada uno por su lado, y los dos
// pasaban: el defecto vivía en cómo se COMPONEN. El neteo APARTA la fila del
// otro estado en vez de escribirla, así que al re-importar no hay ninguna fila
// nueva que la absorba y la única que puede hacerlo es la que quedó degradada.
// Cuando esa dejaba de ser candidata, el neteo no emparejaba nada, la fila
// apartada llegaba intacta a la reconciliación y entraba como NUEVA.
//
// Acá se corre la secuencia EXACTA de FileImportModal (netear → filtrar →
// reconciliar) dos veces seguidas, con lo que la primera pasada dejó escrito.
import { planCardPaymentNetting, planStatementPaymentNetting, transferDemotion } from '../cardPaymentNetting'
import { reconcileStatement, enrichmentFor } from '../statementReconcile'
import { matchStatement } from '../statementMatcher'

const PAGO = 8175.09

// Lo que el parser saca del estado de la TARJETA: el pago más una compra.
const cardStatement = () => [
  { type: 'INCOME', kind: 'payment', category: 'Salario', amount: PAGO, currency: 'GTQ',
    date: '2026-07-15', description: 'GRACIAS POR SU PAGO', cardKey: 'bi:9856' },
  { type: 'EXPENSE', kind: 'purchase', category: 'Alimentación', amount: 120.5, currency: 'GTQ',
    date: '2026-07-10', description: 'MCDONALDS 50 BANCOS', cardKey: 'bi:9856' },
]

// Lo que el parser saca del estado del BANCO: el débito que paga esa tarjeta.
const bankStatement = () => [
  { type: 'EXPENSE', amount: PAGO, currency: 'GTQ', date: '2026-07-15',
    description: 'PAGO TARJETA DE CREDITO' },
  { type: 'INCOME', amount: 15000, currency: 'GTQ', date: '2026-07-01', description: 'ACREDITAMIENTO PLANILLA' },
]

let seq = 0
const store = (rows, source) => rows.map((r) => ({ ...r, id: `t${++seq}`, source }))

// Una pasada del importador de TARJETA, tal como la arma el modal: netear,
// filtrar, reconciliar, y aplicar el enriquecimiento a lo ya confirmado.
function importCard(rows, ledger) {
  const netting = planStatementPaymentNetting(rows, ledger)
  const importable = rows.filter((_, i) => !netting.rowIndexes.has(i))
  const match = reconcileStatement(importable, ledger)
  const written = store(match.newTxs, 'card_import')

  // El modal solo escribe cuando el parche no está vacío.
  const enrich = new Map()
  for (const c of match.confirmed) {
    const updates = enrichmentFor(c.row, c.match).updates
    if (c.match?.id && Object.keys(updates).length) enrich.set(c.match.id, updates)
  }

  const next = ledger.map((tx) => {
    const d = netting.demotions.find((x) => x.id === tx.id)
    const e = enrich.get(tx.id)
    return d || e ? { ...tx, ...(d ? d.updates : {}), ...(e || {}) } : tx
  })
  return {
    added: written.length,
    netted: netting.pairs.length,
    updated: enrich.size,
    ledger: [...next, ...written],
  }
}

// Una pasada del importador del BANCO. Usa matchStatement, no reconcile: son
// dos caminos distintos en el modal y el bug tenía que poder darse en los dos.
function importBank(rows, ledger) {
  const netting = planCardPaymentNetting(rows, ledger)
  const importable = rows.filter((_, i) => !netting.rowIndexes.has(i))
  const match = matchStatement(importable, ledger)
  const written = store(match.newTxs, 'bi_import')
  const next = ledger.map((tx) => {
    const d = netting.demotions.find((x) => x.id === tx.id)
    return d ? { ...tx, ...d.updates } : tx
  })
  return { added: written.length, netted: netting.pairs.length, ledger: [...next, ...written] }
}

beforeEach(() => { seq = 0 })

describe('tarjeta primero, después el banco', () => {
  it('el segundo import del estado del BANCO no agrega nada', () => {
    const a = importCard(cardStatement(), [])
    expect(a.added).toBe(2) // el pago y la compra

    const b = importBank(bankStatement(), a.ledger)
    // El débito se apartó (no es gasto) y solo entra la planilla.
    expect(b.netted).toBe(1)
    expect(b.added).toBe(1)

    // Y acá vivía el bug: la fila degradada tiene que seguir apartando su mitad.
    const c = importBank(bankStatement(), b.ledger)
    expect(c.netted).toBe(1)
    expect(c.added).toBe(0)
  })
})

describe('banco primero, después la tarjeta', () => {
  it('el segundo import del estado de la TARJETA no agrega nada', () => {
    const a = importBank(bankStatement(), [])
    expect(a.added).toBe(2)

    const b = importCard(cardStatement(), a.ledger)
    expect(b.netted).toBe(1)
    expect(b.added).toBe(1) // solo la compra

    const c = importCard(cardStatement(), b.ledger)
    expect(c.netted).toBe(1)
    expect(c.added).toBe(0)
    // La compra la agregó la pasada anterior, así que ESTA es la primera vez
    // que el estado la confirma: un write legítimo.
    expect(c.updated).toBe(1)

    // Y de ahí en adelante, cero. `_confirmedBy` se estampaba SIEMPRE, así que
    // el parche nunca quedaba vacío y cada fila confirmada costaba un write por
    // re-import sobre datos idénticos (79 en un estado real), con la pantalla
    // final reportando "N actualizadas" cuando no se actualizó nada.
    const d = importCard(cardStatement(), c.ledger)
    expect(d.added).toBe(0)
    expect(d.updated).toBe(0)
  })
})

describe('el dinero no se cuenta dos veces en ningún orden', () => {
  const totals = (ledger) => {
    const live = ledger.filter((tx) => !tx._nettedTransfer)
    const sum = (t) => live.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0)
    return { income: sum('INCOME'), expense: sum('EXPENSE') }
  }

  it('los dos órdenes, con re-import incluido, dan el MISMO mes', () => {
    let x = importCard(cardStatement(), [])
    x = importBank(bankStatement(), x.ledger)
    x = importBank(bankStatement(), x.ledger)

    let y = importBank(bankStatement(), [])
    y = importCard(cardStatement(), y.ledger)
    y = importCard(cardStatement(), y.ledger)

    // La planilla real y la compra real. El pago de Q8,175 no aparece de
    // ninguno de los dos lados: es dinero moviéndose entre cuentas propias.
    expect(totals(x.ledger)).toEqual({ income: 15000, expense: 120.5 })
    expect(totals(y.ledger)).toEqual(totals(x.ledger))
  })
})
