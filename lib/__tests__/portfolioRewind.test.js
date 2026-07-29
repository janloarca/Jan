import { buildTxEvents, buildCashFlows, qtyAtTs, cashAtTs } from '../portfolioRewind'

const d = (s) => new Date(s).getTime()

describe('buildTxEvents', () => {
  it('groups BUY/SELL deltas by symbol, sorted by date', () => {
    const events = buildTxEvents([
      { type: 'BUY', symbol: 'meta', date: '2026-03-01', quantity: 5 },
      { type: 'SELL', symbol: 'META', date: '2026-05-01', quantity: 2 },
      { type: 'BUY', symbol: 'TSM', date: '2026-02-01', quantity: 10 },
      { type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-15', quantity: 1 },
    ])
    expect(events.META).toEqual([
      { ts: d('2026-03-01'), qtyDelta: 5 },
      { ts: d('2026-05-01'), qtyDelta: -2 },
    ])
    expect(events.TSM).toHaveLength(1)
    expect(events.CASH).toBeUndefined()
  })

  it('skips junk rows', () => {
    expect(buildTxEvents([{ type: 'BUY', symbol: '', date: '2026-01-01', quantity: 1 }])).toEqual({})
    expect(buildTxEvents([{ type: 'BUY', symbol: 'A', date: 'nope', quantity: 1 }])).toEqual({})
    expect(buildTxEvents(null)).toEqual({})
  })
})

describe('qtyAtTs', () => {
  const events = [
    { ts: d('2026-02-01'), qtyDelta: 10 },
    { ts: d('2026-04-01'), qtyDelta: 5 },
    { ts: d('2026-06-01'), qtyDelta: -3 },
  ]
  it('rewinds buys and sells from the current quantity', () => {
    // current 12 = 10 (feb buy) + 5 (apr buy) - 3 (jun sell)
    expect(qtyAtTs(12, events, d('2026-07-01'))).toBe(12)
    expect(qtyAtTs(12, events, d('2026-05-01'))).toBe(15)  // before the sell
    expect(qtyAtTs(12, events, d('2026-03-01'))).toBe(10)  // only feb buy so far
    expect(qtyAtTs(12, events, d('2026-01-01'))).toBe(0)   // before first buy
  })
})

describe('buildCashFlows + cashAtTs', () => {
  const txs = [
    { type: 'DEPOSIT', date: '2026-01-10', totalAmount: 5000, currency: 'USD' },
    { type: 'BUY', date: '2026-02-01', totalAmount: 3000, commission: 1, currency: 'USD' },
    { type: 'DEPOSIT', date: '2026-03-15', totalAmount: 2000, currency: 'USD' },
    { type: 'DIVIDEND', date: '2026-04-01', totalAmount: 50, currency: 'USD' },
    { type: 'DIVIDEND', date: '2026-04-02', totalAmount: 99, currency: 'USD', _reinvested: true },
    { type: 'SELL', date: '2026-05-01', totalAmount: 1000, commission: 1, currency: 'USD' },
    { type: 'WITHDRAWAL', date: '2026-06-01', totalAmount: 500, currency: 'USD' },
  ]

  it('signs each flow like a bank statement (reinvested dividends excluded)', () => {
    const flows = buildCashFlows(txs)
    expect(flows.map((f) => f.amount)).toEqual([5000, -3001, 2000, 50, 999, -500])
  })

  it('rewinds the cash balance to any point in time', () => {
    const flows = buildCashFlows(txs)
    // current = 5000 - 3001 + 2000 + 50 + 999 - 500 = 4548
    const current = 4548
    expect(cashAtTs(current, flows, d('2026-07-01'))).toBe(4548)
    expect(cashAtTs(current, flows, d('2026-05-15'))).toBe(5048)  // before withdrawal
    expect(cashAtTs(current, flows, d('2026-01-15'))).toBe(5000)  // just the first deposit
    expect(cashAtTs(current, flows, d('2026-01-01'))).toBe(0)     // account empty pre-deposit
  })

  it('converts currencies through the provided converter', () => {
    const flows = buildCashFlows(
      [{ type: 'DEPOSIT', date: '2026-01-10', totalAmount: 100, currency: 'EUR' }],
      (amt, cur) => (cur === 'EUR' ? amt * 1.1 : amt)
    )
    expect(flows[0].amount).toBeCloseTo(110)
  })
})
