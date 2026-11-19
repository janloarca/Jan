// FASE SM-c. Lotes REALES del broker en una cuenta conciliada.
//
// La conciliación con PortfolioAnalyst abre UN lote por posición (el archivo
// no trae fechas de compra). Un Flex Query con Open Positions a nivel "Lot"
// trae cada parcela con su fecha y su costo: con eso se abre un lote de Chispu
// por lote de IBKR, sin tocar los cierres ni los retornos ya guardados.
// Datos SINTÉTICOS (repo público).
import { collapseLotRows } from '../parsers/ibkrFlex'
import { planLedgerReconcile, brokerParcels } from '../ledgerReconcile'
import { sanitizeImportItem } from '../validation'

const row = (over) => ({
  symbol: 'AAA', quantity: 1, purchasePrice: 10, currency: 'USD', _ibkrConId: '1', _ibkrAccountId: 'U***00000', ...over,
})

describe('collapseLotRows conserva las parcelas', () => {
  it('resumen + lotes: la cantidad y el costo del resumen, las parcelas aparte', () => {
    const out = collapseLotRows([
      row({ quantity: 3, purchasePrice: 20, _levelOfDetail: 'SUMMARY' }),
      row({ quantity: 1, purchasePrice: 15, acquisitionDate: '2025-03-04', _levelOfDetail: 'LOT' }),
      row({ quantity: 2, purchasePrice: 22.5, acquisitionDate: '2024-07-01', _levelOfDetail: 'LOT' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].quantity).toBe(3)
    expect(out[0].acquisitionDate).toBe('2024-07-01')
    expect(out[0]._lots).toEqual([
      { acquisitionDate: '2024-07-01', quantity: 2, costBasisPrice: 22.5 },
      { acquisitionDate: '2025-03-04', quantity: 1, costBasisPrice: 15 },
    ])
  })

  it('sin nivel de lote no agrega nada', () => {
    const out = collapseLotRows([row({ quantity: 3 })])
    expect(out[0]._lots).toBeUndefined()
  })
})

describe('brokerParcels', () => {
  it('escala el costo para que el total sea el del broker', () => {
    const lots = brokerParcels({
      quantity: 3, cost: 20, acquisitionDate: '2024-07-01',
      parcels: [{ acquisitionDate: '2024-07-01', quantity: 2, costBasisPrice: 22 }, { acquisitionDate: '2025-03-04', quantity: 1, costBasisPrice: 15 }],
    })
    const total = lots.reduce((s, l) => s + l.quantity * l.costBasis, 0)
    expect(total).toBeCloseTo(60, 4)
    expect(lots.map((l) => l.acquisitionDate)).toEqual(['2024-07-01', '2025-03-04'])
  })

  it('si las parcelas no suman la cantidad, null (un lote como antes)', () => {
    expect(brokerParcels({ quantity: 3, cost: 20, parcels: [{ quantity: 2, costBasisPrice: 20 }] })).toBeNull()
    expect(brokerParcels({ quantity: 3, cost: 20 })).toBeNull()
  })
})

describe('planLedgerReconcile con un Flex de lotes sobre una cuenta ya conciliada', () => {
  const existingLedgerAccount = {
    nav: [{ d: '2026-09-30', v: 900, r: 1.5 }, { d: '2026-10-31', v: 950, r: 2 }],
    periodEnd: '2026-11-16',
    cumulativeReturnPct: 12.5,
  }
  const items = [{ id: 'it1', symbol: 'AAA', institution: 'IBKR', quantity: 3, purchasePrice: 20 }]
  const lots = [{ id: 'oldLot', symbol: 'AAA', itemId: 'it1', quantity: 3, costBasis: 20, status: 'open', acquisitionDate: '2025-01-01' }]
  const parsed = {
    periodEnd: null,
    items: [{
      symbol: 'AAA', quantity: 3, purchasePrice: 20, currency: 'USD',
      _lots: [{ acquisitionDate: '2024-07-01', quantity: 2, costBasisPrice: 22.5 }, { acquisitionDate: '2025-03-04', quantity: 1, costBasisPrice: 15 }],
    }],
    transactions: [{ type: 'DEPOSIT', date: '2026-09-26', totalAmount: 100 }],
    // Un Flex trae NAV diarios SIN retorno del broker: no deben pisar los guardados.
    equityHistory: [{ date: '2026-10-15', netWorthUSD: 940 }],
  }
  const plan = planLedgerReconcile({ parsed, accountKey: 'ibkr', items, lots, existingLedgerAccount, now: '2026-11-19T18:00:00.000Z' })

  it('un lote por parcela con su fecha; el viejo se cierra marcado', () => {
    expect(plan.bulk.lots).toHaveLength(2)
    expect(plan.bulk.lots.map((l) => [l.acquisitionDate, l.quantity])).toEqual([['2024-07-01', 2], ['2025-03-04', 1]])
    expect(plan.bulk.lots.every((l) => l.itemId === 'it1' && l._source === 'ledger_reconcile')).toBe(true)
    expect(plan.bulk.updateLots).toEqual([{ id: 'oldLot', fields: expect.objectContaining({ status: 'closed', _ledgerSuperseded: true }) }])
    const total = plan.bulk.lots.reduce((s, l) => s + l.quantity * l.costBasis, 0)
    expect(total).toBeCloseTo(60, 4)
  })

  it('los cierres, el fin de periodo y el retorno acumulado guardados no cambian', () => {
    expect(plan.ledgerAccount.nav).toEqual(existingLedgerAccount.nav)
    expect(plan.ledgerAccount.periodEnd).toBe('2026-11-16')
    expect(plan.ledgerAccount.cumulativeReturnPct).toBe(12.5)
  })

  it('no reescribe el ledger de depósitos (sigue siendo el de PortfolioAnalyst)', () => {
    expect(plan.bulk.transactions).toEqual([])
  })

  it('las parcelas no viajan al documento de la posición', () => {
    expect(JSON.stringify(plan.bulk.updateItems)).not.toMatch(/_lots/)
    expect(sanitizeImportItem({ symbol: 'AAA', quantity: 1, _lots: [{}] })._lots).toBeUndefined()
  })
})

describe('cableado del modal', () => {
  it('"Conciliar" se ofrece con un Flex de lotes si la cuenta ya está conciliada', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../components/FileImportModal.jsx'), 'utf8')
    expect(src).toMatch(/const reconcileLotsOnly = /)
    expect(src).toMatch(/\(ibkrData\.periodEnd && \(ibkrData\.equityHistory \|\| \[\]\)\.length > 0\) \|\| reconcileLotsOnly/)
  })
})
