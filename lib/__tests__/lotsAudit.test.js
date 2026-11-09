import { buildLotsAudit } from '../lotsAudit'

describe('buildLotsAudit', () => {
  it('suma posiciones y lotes abiertos por simbolo e ignora cerrados', () => {
    const items = [
      { id: 'a', symbol: 'tsla', quantity: 3, institution: 'X' },
      { id: 'b', symbol: 'TSLA', quantity: 2, institution: 'Y' },
    ]
    const lots = [
      { id: 'l1', symbol: 'TSLA', quantity: 4, status: 'open', acquisitionDate: '2026-01-02' },
      { id: 'l2', symbol: 'TSLA', quantity: 9, status: 'closed' },
    ]
    const [g] = buildLotsAudit(items, lots)
    expect(g.qty).toBe(5)
    expect(g.openQty).toBe(4)
    expect(g.gap).toBe(1)
    expect(g.openLots).toHaveLength(1)
  })
  it('no escribe ni muta entradas', () => {
    const items = Object.freeze([Object.freeze({ id: 'a', symbol: 'X', quantity: 1 })])
    expect(() => buildLotsAudit(items, Object.freeze([]))).not.toThrow()
  })
})
