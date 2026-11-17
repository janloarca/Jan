// FASE SK. Cuenta de broker conciliada contra su archivo (PortfolioAnalyst).
//
// El fixture es SINTÉTICO y anónimo (el repo es público): la forma exacta de un
// reporte de PortfolioAnalyst, generado fuera del repo con los montos
// escalados, símbolos genéricos y ningún nombre ni número de cuenta. Escalar
// los montos no cambia los retornos, así que los % del broker (YTD +2.85%,
// desde el inicio +77.32%) se reproducen exactos.
import fs from 'fs'
import path from 'path'
import { parseIBKRFile, formatIBKRFileResult, extractAnalysisPeriodEnd, parseAccountMonthlyReturns } from '../parsers/ibkrFileParser'
import { computeLedgerTWR } from '../ledgerTwr'
import { planLedgerReconcile, ledgerInstitutionOptions, defaultLedgerInstitution } from '../ledgerReconcile'
import { dropLedgerSupersededFlows, ledgerItemIds, LEDGER_SOURCE } from '../ledgerFlows'
import { computeWindowGrowth } from '@/components/dashboard/utils'
import { transactionDocId } from '../transactionDocId'

const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'ibkr-portfolio-analyst-ledger.csv'), 'utf8')
const parsed = formatIBKRFileResult(parseIBKRFile(csv))

describe('parser: PortfolioAnalyst con ledger', () => {
  it('el fixture no trae datos de la cuenta real', () => {
    expect(csv).not.toMatch(/U\*{3}9|U\d{5,}/)
    expect(csv).toMatch(/U\*\*\*00000/)
  })

  it('fecha el NAV del mes en curso al fin del periodo del reporte, no al día del import', () => {
    expect(parsed.periodEnd).toBe('2026-11-16')
    const last = parsed.equityHistory[parsed.equityHistory.length - 1]
    expect(last.date).toBe('2026-11-16')
    expect(last.netWorthUSD).toBeCloseTo(14235.338164, 4)
    expect(parsed.equityHistory.every((e) => e.date <= '2026-11-16')).toBe(true)
  })

  it('lee los 42 retornos mensuales de la cuenta y los pega a su cierre de mes', () => {
    expect(parsed.accountReturns).toHaveLength(42)
    expect(parsed.accountReturns[0]).toMatchObject({ month: '2023-06' })
    expect(parsed.accountReturns.every((r) => r.account === 'U***00000')).toBe(true)
    const withR = parsed.equityHistory.filter((e) => Number.isFinite(e._brokerMonthlyReturn))
    expect(withR).toHaveLength(42)
    expect(parsed.cumulativeReturn).toBeCloseTo(77.3237, 3)
  })

  it('trae los 21 depósitos/retiros del ledger y los símbolos que la cuenta tuvo', () => {
    const flows = parsed.transactions.filter((t) => t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL')
    expect(flows).toHaveLength(21)
    expect(parsed.historicalSymbols).toEqual(expect.arrayContaining(['OLDA', 'ZZZ.OLD', 'STKB']))
  })

  it('sin "Analysis Period" no inventa un fin de periodo', () => {
    expect(extractAnalysisPeriodEnd({ Trades: { meta: {}, headers: [], rows: [] } })).toBeNull()
    expect(parseAccountMonthlyReturns({})).toEqual([])
  })
})

const navOf = (p) => p.equityHistory.filter((e) => !e._type).map((e) => ({ d: e.date, v: e.netWorthUSD, r: e._brokerMonthlyReturn }))
const flowsOf = (p) => p.transactions
  .filter((t) => t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL')
  .map((t) => ({ date: t.date, amount: (t.type === 'WITHDRAWAL' ? -1 : 1) * Math.abs(t.totalAmount) }))

describe('computeLedgerTWR: el % del broker', () => {
  const nav = navOf(parsed)
  const flows = flowsOf(parsed)

  it('YTD = +2.85% (ancla en el cierre del 31 dic)', () => {
    const r = computeLedgerTWR({ nav, flows, from: '2026-01-01' })
    expect(r.anchor.d).toBe('2025-12-31')
    expect(r.pct).toBeCloseTo(2.85, 2)
  })

  it('desde el inicio = +77.32%, el CumulativeReturn del reporte', () => {
    const r = computeLedgerTWR({ nav, flows, from: null })
    expect(r.pct).toBeCloseTo(parsed.cumulativeReturn, 2)
  })

  it('MTD ancla en el cierre del mes anterior', () => {
    const r = computeLedgerTWR({ nav, flows, from: '2026-11-01' })
    expect(r.anchor.d).toBe('2026-10-31')
    expect(r.pct).toBeCloseTo(-2.021, 2)
  })

  it('suma el tramo vivo desde el último cierre (sin flujos: cambio simple)', () => {
    const last = nav[nav.length - 1].v
    const r = computeLedgerTWR({ nav, flows, from: '2026-01-01', to: '2026-11-17', endValue: last * 0.99 })
    expect(r.live.pct).toBeCloseTo(-1, 6)
    expect(r.pct).toBeCloseTo(((1.0285 * 0.99) - 1) * 100, 1)
  })

  it('sin retorno publicado cae a Dietz con los flujos del mes', () => {
    const r = computeLedgerTWR({
      nav: [{ d: '2025-12-31', v: 1000 }, { d: '2026-01-31', v: 1600 }],
      flows: [{ date: '2026-01-31', amount: 500 }],
      from: '2026-01-01',
    })
    expect(r.pct).toBeCloseTo(10, 6)
  })
})

describe('ganancia en $ del año con los insumos del ledger', () => {
  it('= NAV fin − NAV 31 dic − aportes netos del año', () => {
    const nav = navOf(parsed)
    const dec31 = nav.find((p) => p.d === '2025-12-31').v
    const end = nav[nav.length - 1].v
    const flows2026 = flowsOf(parsed).filter((f) => f.date >= '2026-01-01').reduce((s, f) => s + f.amount, 0)
    expect(dec31).toBeCloseTo(7444.51845, 4)
    expect(flows2026).toBeCloseTo(6548.60, 2)
    const g = computeWindowGrowth({ firstVal: dec31, lastVal: end, investedBase: dec31 + flows2026 })
    expect(g.displayAbs).toBeCloseTo(242.22, 2)
  })
})

describe('dropLedgerSupersededFlows', () => {
  const txs = [
    { id: 'a', type: 'DEPOSIT', _linkedItemId: 'x', totalAmount: 10 },
    { id: 'b', type: 'BUY', _linkedItemId: 'x', totalAmount: 10 },
    { id: 'c', type: 'WITHDRAWAL', symbol: 'GOLD', totalAmount: 5 },
  ]
  it('sin cuentas conciliadas devuelve la MISMA lista', () => {
    expect(dropLedgerSupersededFlows(txs, new Set())).toBe(txs)
    expect(dropLedgerSupersededFlows(txs, ledgerItemIds([{ id: 'x' }]))).toBe(txs)
  })
  it('quita los depósitos reemplazados y los vinculados a una cuenta conciliada; deja el ledger', () => {
    const list = [
      ...txs,
      { id: 'd', type: 'DEPOSIT', _ledgerSuperseded: true, totalAmount: 1 },
      { id: 'e', type: 'DEPOSIT', _source: LEDGER_SOURCE, _ledgerAccount: 'ibkr', totalAmount: 1 },
    ]
    const out = dropLedgerSupersededFlows(list, ledgerItemIds([{ id: 'x', _ledgerAccount: 'ibkr' }]))
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'e'])
  })
})

describe('planLedgerReconcile', () => {
  // La cuenta en Chispu: algunas posiciones que siguen, otras cerradas en el
  // broker, una cargada por error en IBKR que es de otra cuenta (ZZZ), y una
  // cuenta distinta con su propio retiro (GOLD en "Otra casa").
  const items = [
    { id: 'i1', symbol: 'STKB', institution: 'IBKR', quantity: 2, purchasePrice: 100, currentPrice: 350, acquisitionDate: '2025-03-01' },
    { id: 'i2', symbol: 'STKC', institution: 'IBKR', quantity: 3, purchasePrice: 200, currentPrice: 340 },
    { id: 'i3', symbol: 'OLDA', institution: 'IBKR', quantity: 0 },
    { id: 'i4', symbol: 'OLDB', institution: 'Interactive Brokers', quantity: 4, purchasePrice: 50 },
    { id: 'i5', symbol: 'ZZZ', institution: 'IBKR', quantity: 100, purchasePrice: 36 },
    { id: 'g1', symbol: 'GOLD', institution: 'Otra casa', quantity: 1, purchasePrice: 2000 },
  ]
  const lots = [
    { id: 'l1', symbol: 'STKB', itemId: 'i1', quantity: 2, status: 'open' },
    { id: 'l2', symbol: 'OLDB', itemId: 'i4', quantity: 4, status: 'open' },
    { id: 'l3', symbol: 'ZZZ', itemId: 'i5', quantity: 100, status: 'open' },
    { id: 'l4', symbol: 'GOLD', itemId: 'g1', quantity: 1, status: 'open' },
    { id: 'l5', symbol: 'OLDC', institution: 'IBKR', quantity: 1, status: 'open' },
  ]
  const transactions = [
    { id: 't1', type: 'DEPOSIT', _linkedItemId: 'i1', _source: 'manual_new_account', totalAmount: 200, date: '2026-02-01' },
    { id: 't2', type: 'DEPOSIT', _linkedItemId: 'gone', symbol: 'OLDE', totalAmount: 300, date: '2026-03-01' },
    { id: 't3', type: 'WITHDRAWAL', _linkedItemId: 'g1', symbol: 'GOLD', totalAmount: 3622, date: '2026-01-01' },
    { id: 't4', type: 'DEPOSIT', _linkedItemId: 'i5', totalAmount: 3622, date: '2025-05-01' },
    { id: 't5', type: 'DIVIDEND', _linkedItemId: 'i2', totalAmount: 5, date: '2026-06-01' },
  ]
  let n = 0
  const plan = planLedgerReconcile({ parsed, accountKey: 'ibkr', items, lots, transactions, now: '2026-11-17T12:00:00.000Z', newId: () => `new${++n}` })

  it('la institución "IBKR" e "Interactive Brokers" son la misma cuenta, sin duplicar', () => {
    const opts = ledgerInstitutionOptions(items)
    expect(defaultLedgerInstitution(opts)).toMatchObject({ key: 'ibkr', name: 'IBKR' })
    expect(plan.institution).toBe('IBKR')
    expect(plan.bulk.items.every((it) => it.institution === 'IBKR')).toBe(true)
  })

  it('actualiza lo que existe, crea lo que falta y no toca precios', () => {
    expect(plan.bulk.updateItems.map((u) => u.id).sort()).toEqual(['i1', 'i2'])
    const b = plan.bulk.updateItems.find((u) => u.id === 'i1').fields
    expect(b).toMatchObject({ quantity: 3, _ledgerAccount: 'ibkr' })
    expect(b.purchasePrice).toBeCloseTo(parsed.items.find((it) => it.symbol === 'STKB').purchasePrice, 8)
    expect(b.currentPrice).toBeUndefined()
    // 9 posiciones del archivo − 2 existentes = 7, más el efectivo.
    expect(plan.bulk.items).toHaveLength(8)
    const cash = plan.bulk.items.find((it) => it.symbol === 'CASH-USD')
    expect(cash).toMatchObject({ type: 'Bank', purchasePrice: 1, _ledgerAccount: 'ibkr' })
    // Ningún ítem activa la maquinaria del sync de IBKR.
    expect(plan.bulk.items.some((it) => it._source === 'ibkr')).toBe(false)
  })

  it('borra solo las posiciones que el broker dice cerradas; la cargada por error queda', () => {
    expect(plan.bulk.deleteIds.sort()).toEqual(['i3', 'i4'])
    expect(plan.summary.keptIds).toEqual(['i5'])
    expect(plan.bulk.deleteIds).not.toContain('g1')
  })

  it('cierra (no borra) los lotes viejos de la cuenta y abre uno por posición', () => {
    expect(plan.bulk.updateLots.map((u) => u.id).sort()).toEqual(['l1', 'l2', 'l5'])
    expect(plan.bulk.updateLots[0].fields).toMatchObject({ status: 'closed', closedDate: '2026-11-16' })
    expect(plan.bulk.lots).toHaveLength(9)
    const qtySum = plan.bulk.lots.reduce((s, l) => s + l.quantity, 0)
    expect(qtySum).toBeCloseTo(parsed.items.filter((it) => it.type !== 'Bank').reduce((s, it) => s + it.quantity, 0), 8)
  })

  it('escribe el ledger (21 movimientos) y no importa dividendos ni comisiones', () => {
    expect(plan.bulk.transactions).toHaveLength(21)
    expect(plan.bulk.transactions.every((t) => t._source === LEDGER_SOURCE && t._ledgerAccount === 'ibkr' && t.symbol === 'CASH')).toBe(true)
    expect(plan.summary.netFlows).toBeCloseTo(11980.65, 2)
    expect(plan.summary.skipped.DIVIDEND).toBeGreaterThan(0)
    // Ids deterministas: volver a subir el archivo sobreescribe, no duplica.
    const again = planLedgerReconcile({ parsed, accountKey: 'ibkr', items, lots, transactions })
    expect(again.bulk.transactions.map(transactionDocId)).toEqual(plan.bulk.transactions.map(transactionDocId))
  })

  it('marca como reemplazados los depósitos manuales de la cuenta; no los de otra cuenta', () => {
    const ids = plan.bulk.updateTransactions.map((u) => u.id).sort()
    expect(ids).toEqual(['t1', 't2'])
    expect(ids).not.toContain('t3') // el retiro de GOLD es de otra cuenta
    expect(ids).not.toContain('t4') // ZZZ quedó fuera de la conciliación
  })

  it('guarda los cierres de mes con su retorno para la gráfica, sin número de cuenta', () => {
    expect(plan.ledgerAccount.nav).toHaveLength(42)
    expect(plan.ledgerAccount.nav[plan.ledgerAccount.nav.length - 1]).toMatchObject({ d: '2026-11-16' })
    expect(plan.ledgerAccount.periodEnd).toBe('2026-11-16')
    expect(JSON.stringify(plan.ledgerAccount)).not.toMatch(/U\*\*\*|U\d{5}/)
    const r = computeLedgerTWR({ nav: plan.ledgerAccount.nav, flows: [], from: '2026-01-01' })
    expect(r.pct).toBeCloseTo(2.85, 2)
  })

  it('con keepIds explícito respeta lo que el usuario desmarcó', () => {
    const p2 = planLedgerReconcile({ parsed, accountKey: 'ibkr', items, lots, transactions, keepIds: new Set(['i4']) })
    expect(p2.bulk.deleteIds.sort()).toEqual(['i3', 'i5'])
    expect(p2.bulk.updateLots.map((u) => u.id)).not.toContain('l2')
  })
})
