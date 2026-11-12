import { openLotsOfItem } from '../itemLots'

const voo = { id: 'v1', symbol: 'VOO', institution: 'Schwab', quantity: 42 }

describe('openLotsOfItem', () => {
  test('los lotes con dueño de esta posición, ordenados por fecha', () => {
    const lots = [
      { id: 'b', itemId: 'v1', symbol: 'VOO', quantity: 2, costBasis: 691.87, acquisitionDate: '2026-11-09', status: 'open' },
      { id: 'a', itemId: 'v1', symbol: 'VOO', quantity: 40, costBasis: 435, acquisitionDate: '2024-01-02', status: 'open' },
      { id: 'c', itemId: 'otro', symbol: 'VOO', quantity: 9, costBasis: 1, acquisitionDate: '2024-01-02', status: 'open' },
      { id: 'd', itemId: 'v1', symbol: 'VOO', quantity: 5, costBasis: 1, acquisitionDate: '2023-01-02', status: 'closed' },
    ]
    const r = openLotsOfItem(voo, lots, [voo])
    expect(r.lots.map((l) => l.id)).toEqual(['a', 'b'])
    expect(r.totalQty).toBe(42)
    expect(r.sharedCount).toBe(0)
  })

  test('un lote sin dueño se atribuye solo si la posición es la única con ese símbolo', () => {
    const lots = [{ id: 'x', symbol: 'voo', quantity: 3, costBasis: 10, status: 'open' }]
    expect(openLotsOfItem(voo, lots, [voo]).lots).toHaveLength(1)
    const twin = { id: 'v2', symbol: 'VOO', institution: 'Schwab', quantity: 1 }
    const r = openLotsOfItem(voo, lots, [voo, twin])
    expect(r.lots).toHaveLength(0)
    expect(r.sharedCount).toBe(1)
  })

  test('un lote sin dueño de otra institución no es de esta posición', () => {
    const lots = [{ id: 'x', symbol: 'VOO', institution: 'IBKR', quantity: 3, costBasis: 10, status: 'open' }]
    const r = openLotsOfItem(voo, lots, [voo])
    expect(r.lots).toHaveLength(0)
    expect(r.sharedCount).toBe(0)
  })

  test('sin lotes o sin posición no afirma nada', () => {
    expect(openLotsOfItem(null, [], [])).toEqual({ lots: [], totalQty: 0, sharedCount: 0 })
    expect(openLotsOfItem(voo, null, [])).toEqual({ lots: [], totalQty: 0, sharedCount: 0 })
  })
})
