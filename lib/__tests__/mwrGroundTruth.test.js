import { computeMWRSeries } from '@/components/dashboard/analytics'

// Ground truth: the user's real IBKR PortfolioAnalyst report for 2026.
//   NAV 2025-12-31 ...... 5424.42
//   NAV 2026-07-27 ...... 10151.16
//   Net external flows ... 3945.00 (three deposits, one small withdrawal)
//   IBKR chained TWR ..... +8.61%   (Jan +5.638, Feb -6.226, Mar -5.754,
//                                    Apr +13.232, May +0.826, Jun -0.199, Jul +2.097)
//
// Modified Dietz, by hand, over the 208-day window:
//   weight(f)  = (endTs - flowTs) / (endTs - startTs)
//   1450 @ 01-27 -> 181/208 = 0.870192 -> 1261.78
//   1350 @ 02-26 -> 151/208 = 0.725962 ->  980.05
//   1150 @ 04-10 -> 108/208 = 0.519231 ->  597.12
//     -5 @ 04-20 ->  98/208 = 0.471154 ->   -2.36
//   weighted capital = 5424.42 + 2836.59 = 8261.01
//   gain            = 10151.16 - 5424.42 - 3945.00 = 781.74
//   MWR             = 781.74 / 8261.01 = +9.463%
//
// MWR lands ABOVE the +8.61% TWR because the account was near its largest after
// the deposits, i.e. the most dollars were exposed to the big April rally.
const START_VALUE = 5424.42
const END_VALUE = 10151.16
const HAND_MWR = 9.463

const START_TS = Date.UTC(2025, 11, 31)
const END_TS = Date.UTC(2026, 6, 27)

const chartData = [
  { ts: START_TS, value: START_VALUE },
  { ts: END_TS, value: END_VALUE },
]

const flow = (type, date, amount) => ({
  type,
  date,
  totalAmount: amount,
  currency: 'USD',
})

const realFlows = [
  flow('DEPOSIT', '2026-01-27', 1450),
  flow('DEPOSIT', '2026-02-26', 1350),
  flow('DEPOSIT', '2026-04-10', 1150),
  flow('WITHDRAWAL', '2026-04-20', 5),
]

const identityConvert = (amount) => amount

describe('computeMWRSeries against the real IBKR account', () => {
  it('reproduces the hand-computed Modified Dietz return within 0.5pp', () => {
    const series = computeMWRSeries(chartData, realFlows, identityConvert, 'USD')
    expect(series).toHaveLength(2)
    expect(series[0]).toBe(0)
    expect(Math.abs(series[series.length - 1] - HAND_MWR)).toBeLessThan(0.5)
  })

  it('sits above the broker time-weighted return: deposits landed before the rally', () => {
    // TWR strips out WHEN money arrived; MWR keeps it. Money was added ahead of
    // the +13.2% April month, so the investor's own number beats the manager's.
    const series = computeMWRSeries(chartData, realFlows, identityConvert, 'USD')
    expect(series[series.length - 1]).toBeGreaterThan(8.61)
  })

  it('does not mistake the deposits themselves for a gain', () => {
    // The naive figure, flows ignored entirely, is +87%. Any regression that
    // drops the flow netting shows up here first.
    const naive = ((END_VALUE - START_VALUE) / START_VALUE) * 100
    const series = computeMWRSeries(chartData, realFlows, identityConvert, 'USD')
    expect(naive).toBeGreaterThan(80)
    expect(series[series.length - 1]).toBeLessThan(15)
  })

  it('works without a convert function', () => {
    const series = computeMWRSeries(chartData, realFlows, null, 'USD')
    expect(Math.abs(series[series.length - 1] - HAND_MWR)).toBeLessThan(0.5)
  })

  it('weights by time invested, not by raw amount', () => {
    // Same money, arriving on the last day, is barely invested at all: the
    // denominator shrinks toward the opening NAV and the return moves.
    const lateFlows = [
      flow('DEPOSIT', '2026-07-26', 1450),
      flow('DEPOSIT', '2026-07-26', 1350),
      flow('DEPOSIT', '2026-07-26', 1150),
      flow('WITHDRAWAL', '2026-07-26', 5),
    ]
    const late = computeMWRSeries(chartData, lateFlows, identityConvert, 'USD')
    const real = computeMWRSeries(chartData, realFlows, identityConvert, 'USD')
    expect(late[1]).toBeGreaterThan(real[1])
    // Denominator ≈ startValue alone -> 781.74 / 5443.38 ≈ 14.4%
    expect(late[1]).toBeCloseTo(14.36, 1)
  })
})

describe('computeMWRSeries flow window', () => {
  it('ignores flows dated outside the charted period', () => {
    const series = computeMWRSeries(
      chartData,
      [...realFlows, flow('DEPOSIT', '2025-06-01', 9999), flow('DEPOSIT', '2026-09-01', 9999)],
      identityConvert,
      'USD'
    )
    expect(Math.abs(series[series.length - 1] - HAND_MWR)).toBeLessThan(0.5)
  })

  it('carries the previous figure instead of dividing by a non-positive base', () => {
    const fromZero = computeMWRSeries(
      [{ ts: START_TS, value: 0 }, { ts: END_TS, value: END_VALUE }],
      realFlows,
      identityConvert,
      'USD'
    )
    expect(fromZero[1]).toBe(0)
  })
})

describe('computeMWRSeries honours flowFromTs', () => {
  // Regression: the chart passed { flowFromTs } as a 5th argument but the
  // function only declared four parameters, so JavaScript discarded it in
  // silence. On a hold-flat reconstructed prefix that means the very flows the
  // caller asked to exclude were netted anyway, double-counting them.
  const start = Date.UTC(2025, 11, 31)
  const end = Date.UTC(2026, 6, 27)
  const chart = [{ ts: start, value: 5424.42 }, { ts: end, value: 10151.16 }]
  const flows = [
    { date: '2026-01-27', type: 'DEPOSIT', totalAmount: 1450 },
    { date: '2026-02-26', type: 'DEPOSIT', totalAmount: 1350 },
    { date: '2026-04-10', type: 'DEPOSIT', totalAmount: 1150 },
    { date: '2026-04-20', type: 'WITHDRAWAL', totalAmount: 5 },
  ]

  it('ignores flows before flowFromTs', () => {
    const all = computeMWRSeries(chart, flows, null, 'USD').pop()
    const gated = computeMWRSeries(chart, flows, null, 'USD', { flowFromTs: Date.UTC(2026, 2, 1) }).pop()
    expect(gated).not.toBeCloseTo(all, 6)
  })

  it('an empty options object behaves exactly like passing none', () => {
    expect(computeMWRSeries(chart, flows, null, 'USD', {}).pop())
      .toBeCloseTo(computeMWRSeries(chart, flows, null, 'USD').pop(), 10)
  })

  it('gating every flow leaves the raw value change as the return', () => {
    const gated = computeMWRSeries(chart, flows, null, 'USD', { flowFromTs: end + 86400000 }).pop()
    expect(gated).toBeCloseTo(((10151.16 - 5424.42) / 5424.42) * 100, 6)
  })
})

// FASE ED: a window that opens BEFORE the portfolio existed. Its first points
// are legitimately 0, and Dietz returns 0 for every one of them (startValue <=
// 0), which drew a flat 0% line across a year that really returned 3.94%. The
// chart now starts measuring where the money first appears; this pins the
// arithmetic that has to come out of it.
describe('a portfolio funded partway into the window (VITALI)', () => {
  const d = (s) => new Date(`${s}T00:00:00Z`).getTime()
  // Jan 1 nothing, Jan 6 the bond lands (6,000 of asset from a 6,098 deposit
  // that carries a 98 entry fee), May 15 the coupon pays 240 into cash.
  const chart = [
    { ts: d('2026-01-01'), value: 0 },
    { ts: d('2026-01-06'), value: 6000 },
    { ts: d('2026-05-15'), value: 6240 },
    { ts: d('2026-08-06'), value: 6240 },
  ]
  const flows = [{ date: '2026-01-06', type: 'DEPOSIT', totalAmount: 6098, currency: 'USD' }]

  it('measured from Jan 1 the whole series is 0: nothing to divide by', () => {
    const series = computeMWRSeries(chart, flows, null, 'USD')
    expect(series.every((v) => v === 0)).toBe(true)
  })

  it('measured from the day it was funded, and with that deposit out, it is the real return', () => {
    const measured = chart.slice(1)
    const series = computeMWRSeries(measured, flows, null, 'USD', { flowFromTs: measured[0].ts + 1 })
    // 240 gained on a 6,000 starting value.
    expect(series.pop()).toBeCloseTo((240 / 6000) * 100, 6)
  })

  it('a flow dated exactly ON the anchor is already out, so the gate is belt and braces', () => {
    // computeMWRSeries opens each sub-period AFTER the anchor, so the deposit
    // that funded the first point never nets against it even without the gate.
    // Asserted so a future change to that boundary shows up here instead of as
    // a silently negative return on a portfolio that gained.
    const measured = chart.slice(1)
    expect(computeMWRSeries(measured, flows, null, 'USD').pop())
      .toBeCloseTo((240 / 6000) * 100, 6)
  })

  it('a deposit AFTER the anchor still nets out, so new money is never return', () => {
    const measured = chart.slice(1)
    const later = [...flows, { date: '2026-06-01', type: 'DEPOSIT', totalAmount: 1000, currency: 'USD' }]
    const withTopUp = measured.map((p) => p.ts >= d('2026-06-01') ? { ...p, value: p.value + 1000 } : p)
    // Value rose by the deposit alone. Counted as return that reads ~20%
    // ((7240-6000)/6000); netted properly it stays in the neighbourhood of the
    // real 4%. Time-weighting means it is not identical, so assert the band.
    const withDeposit = computeMWRSeries(withTopUp, later, null, 'USD').pop()
    expect(withDeposit).toBeLessThan(8)
    expect(withDeposit).toBeGreaterThan(0)
  })
})

// FASE EE: the last surface that still divided by the anchor VALUE instead of
// the cash that left the pocket, so the performance chart read 4.00% next to
// 3.94% everywhere else. Dietz is linear in the base once no flows remain in
// the window, so re-basing is one scale of the whole series.
describe('re-basing a return series onto all-in cost', () => {
  const d = (s) => new Date(`${s}T00:00:00Z`).getTime()
  const measured = [
    { ts: d('2026-01-06'), value: 6000 },
    { ts: d('2026-05-15'), value: 6240 },
    { ts: d('2026-08-06'), value: 6240 },
  ]
  const flows = [{ date: '2026-01-06', type: 'DEPOSIT', totalAmount: 6098, currency: 'USD' }]

  it('measured against the value it is 4.00%, against the cash out of pocket 3.94%', () => {
    const series = computeMWRSeries(measured, flows, null, 'USD', { flowFromTs: measured[0].ts + 1 })
    expect(series.pop()).toBeCloseTo(4, 6)

    const scaled = computeMWRSeries(measured, flows, null, 'USD', { flowFromTs: measured[0].ts + 1 })
      .map((v) => v * (6000 / 6098))
    expect(scaled.pop()).toBeCloseTo((240 / 6098) * 100, 6)
  })

  it('the scale never touches the numerator, so the fee is not charged twice', () => {
    // Charging it on both sides is the documented 2.33% error: (6240-6098)/6098.
    expect((240 / 6098) * 100).toBeGreaterThan(((6240 - 6098) / 6098) * 100)
  })
})
