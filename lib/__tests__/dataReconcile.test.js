import { buildWealthBridge, assessDataSources } from '@/lib/dataReconcile'

const snap = (date, v) => ({ date, netWorthUSD: v, totalActivosUSD: v })
const tx = (type, date, amount, symbol = 'CASH') => ({ type, date, totalAmount: amount, symbol, currency: 'USD' })

describe('buildWealthBridge', () => {
  it('needs at least two snapshots to measure a change', () => {
    expect(buildWealthBridge({ snapshots: [snap('2026-01-01', 100)] })).toBeNull()
    expect(buildWealthBridge({ snapshots: [] })).toBeNull()
  })

  it('closes the identity: change = flows + income + costs + market', () => {
    const b = buildWealthBridge({
      snapshots: [snap('2026-01-01', 1000), snap('2026-07-01', 2000)],
      transactions: [
        tx('DEPOSIT', '2026-02-01', 500),
        tx('DIVIDEND', '2026-03-01', 30, 'KO'),
        tx('FEE', '2026-03-01', 10),
      ],
    })
    expect(b.changeInNav).toBe(1000)
    expect(b.flows).toBe(500)
    expect(b.income).toBe(30)
    expect(b.costs).toBe(-10)
    expect(b.flows + b.income + b.costs + b.market).toBeCloseTo(b.changeInNav, 6)
  })

  it('a withdrawal reduces flows', () => {
    const b = buildWealthBridge({
      snapshots: [snap('2026-01-01', 1000), snap('2026-07-01', 900)],
      transactions: [tx('DEPOSIT', '2026-02-01', 100), tx('WITHDRAWAL', '2026-03-01', 50)],
    })
    expect(b.flows).toBe(50)
  })

  it('ignores movements dated outside the snapshot window', () => {
    // Counting them would invent a residual: they cannot explain a change we
    // have no snapshots to see.
    const b = buildWealthBridge({
      snapshots: [snap('2026-01-01', 1000), snap('2026-07-01', 1000)],
      transactions: [tx('DEPOSIT', '2020-05-01', 9999)],
    })
    expect(b.flows).toBe(0)
    expect(b.market).toBe(0)
  })

  it('pushes unrecorded activity into the market residual', () => {
    // A user who never imported their deposits sees the whole rise attributed
    // to "market", which is the signal that data is missing.
    const b = buildWealthBridge({
      snapshots: [snap('2026-01-01', 1000), snap('2026-07-01', 6000)],
      transactions: [],
    })
    expect(b.market).toBe(5000)
    expect(b.recordedShare).toBe(0)
  })

  it('survives a missing FX rate instead of producing NaN', () => {
    const b = buildWealthBridge({
      snapshots: [snap('2026-01-01', 1000), snap('2026-07-01', 1200)],
      transactions: [{ type: 'DEPOSIT', date: '2026-02-01', totalAmount: 100, currency: 'XYZ' }],
      convert: () => NaN,
      baseCurrency: 'USD',
    })
    expect(Number.isFinite(b.flows)).toBe(true)
    expect(b.flows).toBe(100)
  })
})

describe('assessDataSources', () => {
  const items = [
    { id: '1', symbol: 'AAPL' },
    { id: '2', symbol: 'MSFT' },
    { id: '3', symbol: 'CASH-USD' },
  ]
  const months = (n) => Array.from({ length: n }, (_, i) =>
    snap(`2026-0${(i % 9) + 1}-01`, 100))

  it('scores an empty account at zero and asks for positions first', () => {
    const a = assessDataSources({})
    expect(a.score).toBe(0)
    expect(a.next).toBe('positions')
  })

  it('positions alone land around a third', () => {
    const a = assessDataSources({ items })
    expect(a.score).toBe(33)
    expect(a.next).toBe('history')
  })

  it('positions plus a real value history unlock the second stage', () => {
    const a = assessDataSources({ items, snapshots: months(6) })
    expect(a.score).toBe(70)
    expect(a.next).toBe('movements')
  })

  it('reaches 100 only when movements cover the holdings', () => {
    const a = assessDataSources({
      items,
      snapshots: months(6),
      transactions: [tx('BUY', '2026-02-01', 100, 'AAPL'), tx('BUY', '2026-03-01', 100, 'MSFT')],
    })
    expect(a.score).toBe(100)
    expect(a.next).toBeNull()
  })

  it('does not credit full movements when most holdings are still undated', () => {
    // One ledger entry against a ten-symbol portfolio is not a ledger.
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, symbol: `S${i}` }))
    const a = assessDataSources({
      items: many,
      snapshots: months(6),
      transactions: [tx('BUY', '2026-02-01', 100, 'S0')],
    })
    expect(a.next).toBe('movements')
    expect(a.score).toBeLessThan(100)
    expect(a.symbolCoverage).toBeCloseTo(0.1, 5)
  })

  it('ignores cash rows when measuring movement coverage', () => {
    const a = assessDataSources({
      items,
      snapshots: months(6),
      transactions: [tx('BUY', '2026-02-01', 100, 'AAPL'), tx('BUY', '2026-03-01', 100, 'MSFT')],
    })
    expect(a.symbolCoverage).toBe(1)
  })

  it('gives partial credit for a short history instead of nothing', () => {
    const a = assessDataSources({ items, snapshots: months(2) })
    expect(a.score).toBeGreaterThan(33)
    expect(a.score).toBeLessThan(70)
  })
})
