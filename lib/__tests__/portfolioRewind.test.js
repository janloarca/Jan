import { buildTxEvents, buildCashFlows, qtyAtTs, cashAtTs, staticItemValueAtTs, isTradeLedgerComplete, lotsReconcile } from '../portfolioRewind'

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

describe('staticItemValueAtTs', () => {
  // ClubCashIn case (FASE FD): an item with BOTH its own opening deposit
  // (flows) AND monthly reinvested dividends (incomeEvents) into itself.
  // 600 opening deposit (Jan 1) + 6 × 10 reinvested dividends (Feb-Jul,
  // 10th of each month) = 660 today.
  const flows = [{ ts: d('2026-01-01'), amount: 600 }]
  const incomeEvents = [
    { ts: d('2026-02-10'), amount: 10, itemId: 'club2', reinvested: true },
    { ts: d('2026-03-10'), amount: 10, itemId: 'club2', reinvested: true },
    { ts: d('2026-04-10'), amount: 10, itemId: 'club2', reinvested: true },
    { ts: d('2026-05-10'), amount: 10, itemId: 'club2', reinvested: true },
    { ts: d('2026-06-10'), amount: 10, itemId: 'club2', reinvested: true },
    { ts: d('2026-07-10'), amount: 10, itemId: 'club2', reinvested: true },
  ]
  const current = 660

  it('reverses BOTH the deposit and every dividend after ts, not just the deposit', () => {
    // Before any dividend: only the deposit remains.
    expect(staticItemValueAtTs(current, d('2026-01-15'), { flows, incomeEvents, itemId: 'club2' })).toBe(600)
    // Between Apr and May payments: deposit + Feb/Mar/Apr dividends (30).
    expect(staticItemValueAtTs(current, d('2026-04-15'), { flows, incomeEvents, itemId: 'club2' })).toBe(630)
    // Today: nothing left to reverse.
    expect(staticItemValueAtTs(current, d('2026-08-01'), { flows, incomeEvents, itemId: 'club2' })).toBe(660)
  })

  it('is the bug this fixes: the deposit alone (old behavior) held the CURRENT total flat from the deposit date onward', () => {
    // Regression pin: calling with NO incomeEvents (the pre-fix call site,
    // cashAtTs alone) reproduces the old bug on the exact same data — the
    // Jan 1 deposit is the only flow, so for any ts on/after it there is
    // nothing left to reverse and the value pins at TODAY's 660 the whole
    // time, as if all six months of dividends had already landed on day
    // one. That is worse than merely "flat at the deposit": it is flat at
    // the WRONG (future) number, which is exactly the "no funciona" the
    // user reported — a chart that shows no growth at all.
    const oldBehavior = staticItemValueAtTs(current, d('2026-04-15'), { flows, itemId: 'club2' })
    expect(oldBehavior).toBe(660)
    const fixed = staticItemValueAtTs(current, d('2026-04-15'), { flows, incomeEvents, itemId: 'club2' })
    expect(fixed).toBe(630)
    expect(fixed).not.toBe(oldBehavior)
  })

  it('an item with ONLY a deposit and no income events reconstructs exactly as before (no regression)', () => {
    expect(staticItemValueAtTs(600, d('2026-01-15'), { flows, itemId: 'other-item' })).toBe(600)
    expect(staticItemValueAtTs(600, d('2025-12-01'), { flows, itemId: 'other-item' })).toBe(0)
  })

  it('an item with ONLY income events and no flows reconstructs exactly as before (VITALI/IDC path, no regression)', () => {
    const vitaliIncome = [{ ts: d('2026-05-15'), amount: 240, itemId: 'vitali' }]
    expect(staticItemValueAtTs(6240, d('2026-03-01'), { incomeEvents: vitaliIncome, itemId: 'vitali', clampZero: true })).toBe(6000)
    expect(staticItemValueAtTs(6240, d('2026-06-01'), { incomeEvents: vitaliIncome, itemId: 'vitali', clampZero: true })).toBe(6240)
  })

  it('falls back to symbol matching when an income event carries no itemId', () => {
    const bySym = [{ ts: d('2026-02-10'), amount: 10, itemId: null, symbol: 'CLUB2' }]
    expect(staticItemValueAtTs(610, d('2026-01-15'), { incomeEvents: bySym, itemId: 'club2', itemSym: 'CLUB2', clampZero: true })).toBe(600)
  })

  it('only reverses events belonging to THIS item, not another item sharing the scope', () => {
    const mixed = [...incomeEvents, { ts: d('2026-03-10'), amount: 999, itemId: 'someone-else' }]
    expect(staticItemValueAtTs(current, d('2026-01-15'), { flows, incomeEvents: mixed, itemId: 'club2' })).toBe(600)
  })

  it('clampZero floors the COMBINED reversal at 0, same as each branch already did alone', () => {
    expect(staticItemValueAtTs(100, d('2025-01-01'), { flows: [{ ts: d('2026-01-01'), amount: 600 }], clampZero: true })).toBe(0)
    const bigIncome = [{ ts: d('2026-02-10'), amount: 10000, itemId: 'x' }]
    expect(staticItemValueAtTs(100, d('2026-01-01'), { incomeEvents: bigIncome, itemId: 'x', clampZero: true })).toBe(0)
  })

  it('without clampZero, a flow-driven negative is left alone (legitimate margin cash)', () => {
    expect(staticItemValueAtTs(100, d('2025-01-01'), { flows: [{ ts: d('2026-01-01'), amount: 600 }] })).toBe(-500)
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
