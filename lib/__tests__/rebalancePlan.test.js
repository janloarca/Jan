import { contributionPlan, fundOverlap, sellCandidates } from '../rebalancePlan'

describe('rebalanceo accionable (FASE RQ)', () => {
  const cats = [
    { cat: 'stocks', current: 800, targetPct: 60 },
    { cat: 'bonds', current: 200, targetPct: 40 },
  ]
  test('con aportes nuevos va solo a lo que está por debajo, sin vender', () => {
    const p = contributionPlan(cats, 1000, 500)
    // total 1500: bonos objetivo 600, faltan 400; acciones objetivo 900, faltan 100
    expect(p.allocations.map((a) => a.cat)).toEqual(['bonds', 'stocks'])
    expect(p.allocations[0].amount).toBeCloseTo(400)
    expect(p.coversAll).toBe(true)
  })
  test('VOO ya incluye AAPL', () => {
    expect(fundOverlap([{ symbol: 'VOO' }, { symbol: 'AAPL' }, { symbol: 'BND' }])).toEqual([{ fund: 'VOO', overlap: ['AAPL'] }])
  })
  test('lote de largo plazo primero, con su ganancia', () => {
    const items = [{ id: 'a', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 200 }]
    const lots = [
      { itemId: 'a', status: 'open', quantity: 5, costBasis: 190, acquisitionDate: '2026-06-01' },
      { itemId: 'a', status: 'open', quantity: 5, costBasis: 100, acquisitionDate: '2023-01-01' },
    ]
    const [c] = sellCandidates({ cat: 'stocks', amount: 400, items, lots, now: new Date('2026-11-10') })
    expect(c.units).toBe(2)
    expect(c.lots[0].term).toBe('long')
    expect(c.lots[0].gainPerUnit).toBe(100)
  })
})
