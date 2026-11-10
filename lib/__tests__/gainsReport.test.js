import { buildGainsReport } from '../gainsReport'

describe('ganancias: invertible separado del inmueble (FASE RQ)', () => {
  const items = [
    { id: 'voo', symbol: 'VOO', type: 'ETF', currentPrice: 600 },
    { id: 'casa', symbol: 'CASA', name: 'Casa', type: 'Real Estate', currentPrice: 125000 },
  ]
  const lots = [
    { symbol: 'VOO', itemId: 'voo', status: 'open', quantity: 10, costBasis: 500, acquisitionDate: '2024-01-15' },
    { symbol: 'VOO', itemId: 'voo', status: 'open', quantity: 10, costBasis: 550, acquisitionDate: '2026-06-01' },
    { symbol: 'CASA', itemId: 'casa', status: 'open', quantity: 1, costBasis: 100000, acquisitionDate: '2020-01-01' },
    { symbol: 'X', status: 'closed', realizedGain: 40 },
  ]
  const r = buildGainsReport({ lots, items, now: new Date('2026-11-10T12:00:00Z') })

  test('la plusvalía de la casa NO entra a la no realizada invertible', () => {
    expect(r.investable.unrealized).toBe(1500)
    expect(r.realEstate.unrealized).toBe(25000)
    expect(r.investable.realized).toBe(40)
  })

  test('costo por unidad ponderado y plazo del lote más viejo', () => {
    const voo = r.investable.symbols.find((s) => s.symbol === 'VOO')
    expect(voo.avgCost).toBe(525)
    expect(voo.since).toBe('2024-01-15')
    expect(voo.term).toBe('long')
    expect(voo.openLots).toBe(2)
  })
})
