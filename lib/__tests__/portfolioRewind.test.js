import { buildTxEvents, buildCashFlows, qtyAtTs, cashAtTs, isTradeLedgerComplete, lotsReconcile } from '../portfolioRewind'

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

describe('isTradeLedgerComplete', () => {
  it('accepts a ledger that accounts for the current quantity', () => {
    const events = [{ ts: d('2026-02-01'), qtyDelta: 10 }, { ts: d('2026-06-01'), qtyDelta: -3 }]
    expect(isTradeLedgerComplete(events, 7)).toBe(true)
  })

  it('accepts sell-only ledgers (unrecorded early buys → larger past position)', () => {
    expect(isTradeLedgerComplete([{ ts: d('2026-06-01'), qtyDelta: -3 }], 7)).toBe(true)
  })

  it('rejects an inflow-only ledger (Ledger on-chain sync) implying a negative start', () => {
    // 65,262.24 in over the years, 727.12 left on-chain, outflows never imported:
    // rewinding through this ledger would clamp every past month to 0.
    expect(isTradeLedgerComplete([{ ts: d('2021-02-01'), qtyDelta: 65262.24 }], 727.12)).toBe(false)
  })

  it('rejects empty/garbage ledgers', () => {
    expect(isTradeLedgerComplete([], 7)).toBe(false)
    expect(isTradeLedgerComplete(null, 7)).toBe(false)
  })
})

describe('lotsReconcile', () => {
  const now = d('2026-08-05')

  it('accepts open lots whose sum matches the current quantity', () => {
    expect(lotsReconcile([
      { qty: 400, acquiredTs: d('2025-01-01'), closedTs: null },
      { qty: 327.12, acquiredTs: d('2025-06-01'), closedTs: null },
    ], 727.12, now)).toBe(true)
  })

  it('rejects stale never-closed lots (the phantom Ledger ~$65K line → fake -98.9%)', () => {
    // 65,262.24 USDC imported in 2021; the wallet now holds 727.12 and no sale
    // was ever recorded, so the lot was never FIFO-closed. Trusting it drew a
    // flat ~$65K history that "crashed" to the real $727 at the live point.
    expect(lotsReconcile([{ qty: 65262.24, acquiredTs: d('2021-02-01'), closedTs: null }], 727.12, now)).toBe(false)
  })

  it('accepts a fully sold position (all lots closed, zero current)', () => {
    expect(lotsReconcile([{ qty: 100, acquiredTs: d('2024-01-01'), closedTs: d('2025-01-01') }], 0, now)).toBe(true)
  })

  it('rejects closed lots when a live position exists without open lots', () => {
    expect(lotsReconcile([{ qty: 100, acquiredTs: d('2024-01-01'), closedTs: d('2025-01-01') }], 50, now)).toBe(false)
  })

  it('rejects empty lots', () => {
    expect(lotsReconcile([], 7, now)).toBe(false)
    expect(lotsReconcile(null, 7, now)).toBe(false)
  })
})
