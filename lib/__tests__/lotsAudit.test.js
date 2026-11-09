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

describe('empareje posicion-lote (FASE RF)', () => {
  it('compara cada posicion con el lote de su fecha o su dueno', () => {
    const items = [
      { id: 'a', symbol: 'SPCX', quantity: 10, acquisitionDate: '2002-05-06' },
      { id: 'b', symbol: 'SPCX', quantity: 5, acquisitionDate: '2026-02-02' },
    ]
    const lots = [
      { id: 'l1', symbol: 'SPCX', quantity: 12, status: 'open', acquisitionDate: '2002-05-06' },
      { id: 'l2', symbol: 'SPCX', quantity: 3, status: 'open', acquisitionDate: '2026-02-02', itemId: 'b' },
    ]
    const [g] = buildLotsAudit(items, lots)
    const a = g.positions.find((p) => p.id === 'a')
    const b = g.positions.find((p) => p.id === 'b')
    expect(a.lotGap).toBe(-2)
    expect(b.lotGap).toBe(2)
  })
})
