import { computeModifiedDietz, solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, combineAccountCalibrations, calibrationAnchorDate, calibrationKindOf, calibrationCoveredByRealData, fitSeriesToAnchors } from '../utils'

// solveDietzStartValue backs the "Calibrar rendimiento" modal: the user types
// the return their broker shows and we solve for the start value that makes
// our own Modified Dietz reproduce that percentage exactly.
describe('solveDietzStartValue', () => {
  const day = 86400000
  const startTs = Date.UTC(2026, 0, 1)
  const endTs = startTs + 216 * day
  const iso = (ts) => new Date(ts).toISOString().slice(0, 10)

  it('no flows: start value is end / (1 + r)', () => {
    const { startValue, error } = solveDietzStartValue({ endValue: 11000, startTs, endTs, transactions: [], targetPct: 10 })
    expect(error).toBeUndefined()
    expect(startValue).toBeCloseTo(10000, 6)
  })

  it('zero target returns the end value minus net flows', () => {
    const transactions = [{ type: 'DEPOSIT', date: iso(startTs + 40 * day), totalAmount: 1000, currency: 'USD' }]
    const { startValue } = solveDietzStartValue({ endValue: 5000, startTs, endTs, transactions, targetPct: 0 })
    const { pct } = computeModifiedDietz({ startValue, endValue: 5000, startTs, endTs, transactions })
    expect(pct).toBeCloseTo(0, 8)
  })

  it('mixed deposits and withdrawals: reproduces the target exactly', () => {
    const transactions = [
      { type: 'DEPOSIT', date: iso(startTs + 50 * day), totalAmount: 2000, currency: 'USD' },
      { type: 'DEPOSIT', date: iso(startTs + 90 * day), totalAmount: 2909.99, currency: 'USD' },
      { type: 'WITHDRAWAL', date: iso(startTs + 120 * day), totalAmount: 500, currency: 'USD' },
      // Non-flow types must be ignored, as computeModifiedDietz ignores them.
      { type: 'DIVIDEND', date: iso(startTs + 60 * day), totalAmount: 42, currency: 'USD' },
      // Flows outside the window must be ignored too.
      { type: 'DEPOSIT', date: iso(startTs - 30 * day), totalAmount: 99999, currency: 'USD' },
    ]
    const target = 8.6059
    const { startValue, error } = solveDietzStartValue({ endValue: 10106.754497, startTs, endTs, transactions, targetPct: target })
    expect(error).toBeUndefined()
    const { pct } = computeModifiedDietz({ startValue, endValue: 10106.754497, startTs, endTs, transactions })
    expect(pct).toBeCloseTo(target, 8)
  })

  it('negative targets solve too', () => {
    const transactions = [{ type: 'DEPOSIT', date: iso(startTs + 10 * day), totalAmount: 3000, currency: 'USD' }]
    const { startValue, error } = solveDietzStartValue({ endValue: 8000, startTs, endTs, transactions, targetPct: -12.5 })
    expect(error).toBeUndefined()
    const { pct } = computeModifiedDietz({ startValue, endValue: 8000, startTs, endTs, transactions })
    expect(pct).toBeCloseTo(-12.5, 8)
  })

  it('honors convert for foreign-currency flows', () => {
    const convert = (amt, from, to) => (from === to ? amt : amt * 20)
    const transactions = [{ type: 'DEPOSIT', date: iso(startTs + 60 * day), totalAmount: 100, currency: 'MXN' }]
    const { startValue, error } = solveDietzStartValue({ endValue: 5000, startTs, endTs, transactions, convert, baseCurrency: 'USD', targetPct: 5 })
    expect(error).toBeUndefined()
    const { pct } = computeModifiedDietz({ startValue, endValue: 5000, startTs, endTs, transactions, convert, baseCurrency: 'USD' })
    expect(pct).toBeCloseTo(5, 8)
  })

  it('rejects targets whose implied start value is not positive', () => {
    // End 100 with 500 deposited in-window and a -50% claim: no positive start
    // value can reconcile that, so the modal must show an error, not write a
    // garbage anchor.
    const res = solveDietzStartValue({
      endValue: 100, startTs, endTs,
      transactions: [{ type: 'DEPOSIT', date: iso(startTs + 90 * day), totalAmount: 500, currency: 'USD' }],
      targetPct: -50,
    })
    expect(res.error).toBe('unsolvable')
    expect(res.startValue).toBeUndefined()
  })

  it('guards bad inputs', () => {
    expect(solveDietzStartValue({ endValue: 0, startTs, endTs, transactions: [], targetPct: 5 }).error).toBe('endValue')
    expect(solveDietzStartValue({ endValue: -5, startTs, endTs, transactions: [], targetPct: 5 }).error).toBe('endValue')
    expect(solveDietzStartValue({ endValue: 100, startTs, endTs, transactions: [], targetPct: -100 }).error).toBe('targetPct')
    expect(solveDietzStartValue({ endValue: 100, startTs, endTs, transactions: [], targetPct: 201 }).error).toBe('targetPct')
    expect(solveDietzStartValue({ endValue: 100, startTs, endTs, transactions: [], targetPct: NaN }).error).toBe('targetPct')
    expect(solveDietzStartValue({ endValue: 100, startTs: endTs, endTs, transactions: [], targetPct: 5 }).error).toBe('window')
  })
})

// Per-account calibration: each broker shows ITS OWN return, so the modal
// solves a start value per account and combineAccountCalibrations swaps each
// calibrated account's estimated share of the global anchor for that solved
// value. A single global % cannot represent accounts with different returns
// (mixing them is what clamped the badge at ±200%).
describe('accountKeyOfItem', () => {
  it('maps IBKR items to the ibkr key, loosely on institution name', () => {
    expect(accountKeyOfItem({ _source: 'ibkr' })).toBe('ibkr')
    expect(accountKeyOfItem({ institution: 'Interactive Brokers' })).toBe('ibkr')
    expect(accountKeyOfItem({ institution: 'interactive brokers llc' })).toBe('ibkr')
  })

  it('normalizes other institutions like InstitutionPerformance does', () => {
    expect(accountKeyOfItem({ institution: '  Hapi   Securities ' })).toBe('hapi securities')
    expect(accountKeyOfItem({ institution: 'Ledger' })).toBe('ledger')
  })

  it('returns null for items without institution', () => {
    expect(accountKeyOfItem({ institution: '' })).toBeNull()
    expect(accountKeyOfItem({})).toBeNull()
    expect(accountKeyOfItem(null)).toBeNull()
  })
})

describe('heldFlatAccountValueUSD', () => {
  const anchorTs = Date.UTC(2026, 0, 1)
  const items = [
    { symbol: 'AAPL', institution: 'Hapi', quantity: 10, currentPrice: 100, currency: 'USD' },
    { symbol: 'BTC', institution: 'Ledger', quantity: 0.5, currentPrice: 4000, currency: 'USD' },
    { symbol: 'MSFT', _source: 'ibkr', institution: 'Interactive Brokers', quantity: 5, currentPrice: 200, currency: 'USD' },
  ]

  it('sums only the requested account at current prices', () => {
    expect(heldFlatAccountValueUSD(items, 'hapi', anchorTs)).toBe(1000)
    expect(heldFlatAccountValueUSD(items, 'ledger', anchorTs)).toBe(2000)
    expect(heldFlatAccountValueUSD(items, 'ibkr', anchorTs)).toBe(1000)
    expect(heldFlatAccountValueUSD(items, 'unknown', anchorTs)).toBe(0)
  })

  it('excludes items acquired after the anchor date', () => {
    const withLate = [...items, { symbol: 'NVDA', institution: 'Hapi', quantity: 4, currentPrice: 250, currency: 'USD', acquisitionDate: '2026-03-01' }]
    expect(heldFlatAccountValueUSD(withLate, 'hapi', anchorTs)).toBe(1000)
    // null anchorTs means "right now": nothing is gated out
    expect(heldFlatAccountValueUSD(withLate, 'hapi', null)).toBe(2000)
  })

  it('honors convert for non-USD items and skips net-worth exclusions', () => {
    const convert = (amt, from, to) => (from === to ? amt : amt / 20)
    const mxn = [
      { symbol: 'WALMEX', institution: 'GBM', quantity: 100, currentPrice: 400, currency: 'MXN' },
      { symbol: 'DEUD', institution: 'GBM', quantity: 1, currentPrice: 99999, currency: 'MXN', isReceivable: true, countInNetWorth: false },
    ]
    expect(heldFlatAccountValueUSD(mxn, 'gbm', anchorTs, convert)).toBe(2000)
  })
})

describe('combineAccountCalibrations', () => {
  const anchorTs = Date.UTC(2026, 0, 1)
  // Portfolio: Hapi held flat at 6000, IBKR held flat at 4000, base anchor 10000.
  const items = [
    { symbol: 'AAPL', institution: 'Hapi', quantity: 60, currentPrice: 100, currency: 'USD' },
    { symbol: 'MSFT', _source: 'ibkr', institution: 'Interactive Brokers', quantity: 20, currentPrice: 200, currency: 'USD' },
  ]

  it('returns null when there are no calibrations to apply', () => {
    expect(combineAccountCalibrations({ baseValueUSD: 10000, anchorTs, calibrations: [], items })).toBeNull()
    expect(combineAccountCalibrations({ baseValueUSD: 10000, anchorTs, calibrations: null, items })).toBeNull()
  })

  it('swaps a manual account estimated share for its calibrated start', () => {
    const res = combineAccountCalibrations({
      baseValueUSD: 10000, anchorTs,
      calibrations: [{ _account: 'hapi', netWorthUSD: 5000 }],
      items,
    })
    // 10000 - 6000 (hapi estimate) + 5000 (calibrated) = 9000
    expect(res.startValueUSD).toBeCloseTo(9000, 8)
    expect(res.applied).toEqual(['hapi'])
  })

  it('estimates the IBKR share as base minus non-IBKR held flat (inverse of augmentSnapshots)', () => {
    const res = combineAccountCalibrations({
      baseValueUSD: 10000, anchorTs,
      calibrations: [{ _account: 'ibkr', netWorthUSD: 4500 }],
      items,
    })
    // IBKR estimate = 10000 - 6000 (non-IBKR) = 4000; 10000 - 4000 + 4500 = 10500
    expect(res.startValueUSD).toBeCloseTo(10500, 8)
  })

  it('combines several accounts at once', () => {
    const res = combineAccountCalibrations({
      baseValueUSD: 10000, anchorTs,
      calibrations: [
        { _account: 'hapi', netWorthUSD: 5000 },
        { _account: 'ibkr', netWorthUSD: 4500 },
      ],
      items,
    })
    // 10000 - 4000 - 6000 + 5000 + 4500 = 9500
    expect(res.startValueUSD).toBeCloseTo(9500, 8)
  })

  it('rebuilds the base from uncalibrated items when there is no portfolio anchor', () => {
    const res = combineAccountCalibrations({
      baseValueUSD: null, anchorTs,
      calibrations: [{ _account: 'hapi', netWorthUSD: 5000 }],
      items,
    })
    // Base = held-flat of uncalibrated items (IBKR 4000); calibrated account skipped: 4000 + 5000
    expect(res.startValueUSD).toBeCloseTo(9000, 8)
  })

  it('ignores calibrations without a positive value', () => {
    expect(combineAccountCalibrations({
      baseValueUSD: 10000, anchorTs,
      calibrations: [{ _account: 'hapi', netWorthUSD: 0 }],
      items,
    })).toBeNull()
  })
})

// 7-period redesign: each period calibrates against the START of its window at
// capture time, computed in pure UTC/string arithmetic (never
// new Date('YYYY-MM-DD').getMonth(), which shifts the month in UTC-6).
describe('calibrationAnchorDate', () => {
  const today = '2026-08-17'

  it('resolves every period kind', () => {
    expect(calibrationAnchorDate('1w', today)).toBe('2026-08-10')
    expect(calibrationAnchorDate('mtd', today)).toBe('2026-08-01')
    expect(calibrationAnchorDate('1m', today)).toBe('2026-07-17')
    expect(calibrationAnchorDate('3m', today)).toBe('2026-05-17')
    expect(calibrationAnchorDate('ytd', today)).toBe('2026-01-01')
    expect(calibrationAnchorDate('1y', today)).toBe('2025-08-17')
    expect(calibrationAnchorDate('all', today, '2023-04-02')).toBe('2023-04-02')
  })

  it('clamps the day when the target month is shorter', () => {
    // Mar 31 minus one month is Feb 28 (not Mar 3 from a Date rollover).
    expect(calibrationAnchorDate('1m', '2026-03-31')).toBe('2026-02-28')
    expect(calibrationAnchorDate('1y', '2024-03-31')).toBe('2023-03-31')
    // Leap year: Feb 2024 has 29 days.
    expect(calibrationAnchorDate('1m', '2024-03-31')).toBe('2024-02-29')
  })

  it('crosses year boundaries by string math', () => {
    expect(calibrationAnchorDate('mtd', '2026-01-15')).toBe('2026-01-01')
    expect(calibrationAnchorDate('1m', '2026-01-15')).toBe('2025-12-15')
    expect(calibrationAnchorDate('3m', '2026-02-10')).toBe('2025-11-10')
    expect(calibrationAnchorDate('1y', '2026-02-10')).toBe('2025-02-10')
    expect(calibrationAnchorDate('1w', '2026-01-03')).toBe('2025-12-27')
  })

  it('guards bad input', () => {
    expect(calibrationAnchorDate('all', today)).toBeNull()
    expect(calibrationAnchorDate('all', today, 'not-a-date')).toBeNull()
    expect(calibrationAnchorDate('2w', today)).toBeNull()
    expect(calibrationAnchorDate('ytd', '')).toBeNull()
    expect(calibrationAnchorDate('ytd', '17/08/2026')).toBeNull()
  })
})

describe('calibrationKindOf', () => {
  it('reads the explicit kind when present', () => {
    expect(calibrationKindOf({ date: '2026-08-01', _calibrationKind: 'mtd' })).toBe('mtd')
  })

  it('infers the kind for legacy calibrations (no _calibrationKind)', () => {
    expect(calibrationKindOf({ date: '2026-01-01' })).toBe('ytd')
    expect(calibrationKindOf({ date: '2023-04-02' })).toBe('all')
  })

  it('returns null without a date', () => {
    expect(calibrationKindOf({ _calibrationKind: 'ytd' })).toBeNull()
    expect(calibrationKindOf(null)).toBeNull()
  })
})

// The modal skips (without aborting the rest) any period whose anchor date is
// already covered by real broker data: that stretch is measured, not estimated.
describe('calibrationCoveredByRealData', () => {
  const snapshots = [
    { date: '2026-07-15', _source: 'ibkr' },
    { date: '2026-08-01', _source: 'daily' },
    { date: '2026-08-10', _source: 'backfill' }, // reconstructed: NOT real
    { date: '2026-08-12', _source: 'manual' },   // manual NAV: not broker data
  ]

  it('covers anchors at/after the first real datapoint', () => {
    expect(calibrationCoveredByRealData('2026-07-15', snapshots)).toBe(true)
    expect(calibrationCoveredByRealData('2026-08-10', snapshots)).toBe(true)
  })

  it('leaves older anchors calibratable', () => {
    expect(calibrationCoveredByRealData('2026-07-14', snapshots)).toBe(false)
    expect(calibrationCoveredByRealData('2026-01-01', snapshots)).toBe(false)
  })

  it('ignores backfill/manual docs and empty input', () => {
    expect(calibrationCoveredByRealData('2026-08-11', [
      { date: '2026-08-10', _source: 'backfill' },
    ])).toBe(false)
    expect(calibrationCoveredByRealData('2026-08-11', [])).toBe(false)
    expect(calibrationCoveredByRealData(null, snapshots)).toBe(false)
  })
})

// fitSeriesToAnchors re-scales the ESTIMATED prefix so it passes exactly
// through the calibrated anchors and lands on the first real datapoint: one
// coherent curve instead of a flat invented line.
describe('fitSeriesToAnchors', () => {
  const day = 86400000
  const t0 = Date.UTC(2026, 0, 1)
  const points = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
    ts: t0 + i * day,
    total: 100 + i * 10, // linear estimate: 100, 110, ..., 190
  }))

  it('returns the points untouched when there are no anchors', () => {
    expect(fitSeriesToAnchors(points, [])).toBe(points)
    expect(fitSeriesToAnchors(points, null)).toBe(points)
    expect(fitSeriesToAnchors(points, [{ ts: t0, value: -5 }])).toBe(points)
  })

  it('passes EXACTLY through a single anchor and lands on the seam', () => {
    const seam = { ts: t0 + 10 * day, total: 150 }
    const fitted = fitSeriesToAnchors(points, [{ ts: t0 + 4 * day, value: 112, capturedAt: '2026-01-05' }], seam)
    // Anchor: estimate there is 140 → factor 0.8 exactly.
    expect(fitted[4].total).toBeCloseTo(112, 8)
    // Free start keeps the anchor's factor: 100 * 0.8 = 80.
    expect(fitted[0].total).toBeCloseTo(80, 8)
    // Between anchor (factor 0.8) and seam (factor 150/190) the factor
    // interpolates linearly: point 8 sits 4/6 of the way from anchor to seam.
    const fAnchor = 112 / 140
    const fSeam = 150 / 190
    const f8 = fAnchor + (fSeam - fAnchor) * (4 / 6)
    expect(fitted[8].total).toBeCloseTo(180 * f8, 8)
    // Input order/content preserved otherwise; original array not mutated.
    expect(fitted).toHaveLength(points.length)
    expect(points[4].total).toBe(140)
  })

  it('passes exactly through several anchors', () => {
    const fitted = fitSeriesToAnchors(points, [
      { ts: t0 + 2 * day, value: 60, capturedAt: '2026-01-03' },
      { ts: t0 + 7 * day, value: 255, capturedAt: '2026-01-08' },
    ])
    expect(fitted[2].total).toBeCloseTo(60, 8)
    expect(fitted[7].total).toBeCloseTo(255, 8)
    // Midway between the two anchors the factor is the midpoint factor.
    const f0 = 60 / 120
    const f1 = 255 / 170
    expect(fitted[4].total).toBeCloseTo(140 * (f0 + (f1 - f0) * (2 / 5)), 8)
    // After the last anchor (no seam) the factor stays flat at that anchor.
    expect(fitted[9].total).toBeCloseTo(190 * f1, 8)
  })

  it('anchors between points interpolate the base estimate', () => {
    const fitted = fitSeriesToAnchors(points, [{ ts: t0 + 4.5 * day, value: 145, capturedAt: '2026-01-06' }])
    // Base at the anchor = midpoint of 140 and 150 = 145 → factor 1 there.
    expect(fitted[4].total).toBeCloseTo(140, 8)
    expect(fitted[5].total).toBeCloseTo(150, 8)
  })

  it('dedups anchors on the same date keeping the most recent capturedAt', () => {
    const fitted = fitSeriesToAnchors(points, [
      { ts: t0 + 4 * day, value: 70, capturedAt: '2026-01-10' },
      { ts: t0 + 4 * day, value: 112, capturedAt: '2026-02-01' }, // newer wins
      { ts: t0 + 4 * day, value: 35 },                            // no capturedAt loses
    ])
    expect(fitted[4].total).toBeCloseTo(112, 8)
  })

  it('ignores a seam at/before the last anchor', () => {
    const fitted = fitSeriesToAnchors(points,
      [{ ts: t0 + 4 * day, value: 112, capturedAt: '2026-01-05' }],
      { ts: t0 + 2 * day, total: 999 })
    // Factor stays flat at the anchor's factor after it.
    expect(fitted[9].total).toBeCloseTo(190 * (112 / 140), 8)
  })
})

// Roll-forward: the calibration stays pinned at its anchor date and the
// displayed % moves with the market, because the Dietz end value is live.
// Yesterday YTD read 6%; positions gain 1% overnight with no flows, so today
// the same anchor reads ~7% (small drift: the weighted capital grew too).
describe('calibration roll-forward', () => {
  const day = 86400000
  const startTs = Date.UTC(2026, 0, 1)
  const iso = (ts) => new Date(ts).toISOString().slice(0, 10)

  it('a solved 6% anchor reads ~7% after a +1% market day with no flows', () => {
    const day1End = startTs + 216 * day
    const { startValue, error } = solveDietzStartValue({
      endValue: 100000, startTs, endTs: day1End, transactions: [], targetPct: 6,
    })
    expect(error).toBeUndefined()
    // Sanity: at capture time the anchor reproduces the typed 6% exactly.
    expect(computeModifiedDietz({ startValue, endValue: 100000, startTs, endTs: day1End, transactions: [] }).pct).toBeCloseTo(6, 8)

    // Next day: same anchor, end value +1%, window one day longer, no flows.
    const day2End = day1End + day
    const { pct } = computeModifiedDietz({ startValue, endValue: 101000, startTs, endTs: day2End, transactions: [] })
    expect(pct).toBeGreaterThan(6.9)
    expect(pct).toBeLessThan(7.1)
  })

  it('rolls forward exactly with flows too (same flows in solve and forward)', () => {
    const endTs = startTs + 100 * day
    const transactions = [{ type: 'DEPOSIT', date: iso(startTs + 40 * day), totalAmount: 5000, currency: 'USD' }]
    const { startValue } = solveDietzStartValue({
      endValue: 60000, startTs, endTs, transactions, targetPct: 8,
    })
    const later = endTs + 30 * day
    // Market gain only: end value reflects a +2% move on everything held.
    const { pct } = computeModifiedDietz({ startValue, endValue: 61200, startTs, endTs: later, transactions })
    expect(pct).toBeGreaterThan(8)
    expect(pct).toBeLessThan(11)
  })
})
