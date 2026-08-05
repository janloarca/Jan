import {
  calibrationAnchorDate, fitSeriesToAnchors, calibrationCoveredByRealData,
  snapshotDocId, computeModifiedDietz, solveDietzStartValue,
} from '../utils'

// calibrationAnchorDate backs the 7-period calibration form: each period pins
// its anchor to the period START at capture time. Everything must be derived
// by UTC/string math (new Date('YYYY-MM-DD').getMonth() runs the month back in
// UTC-6, the exact bug the house date rule exists for).
describe('calibrationAnchorDate', () => {
  const today = '2026-08-10'

  it('resolves every period kind', () => {
    expect(calibrationAnchorDate('1w', today)).toBe('2026-08-03')
    expect(calibrationAnchorDate('mtd', today)).toBe('2026-08-01')
    expect(calibrationAnchorDate('1m', today)).toBe('2026-07-10')
    expect(calibrationAnchorDate('3m', today)).toBe('2026-05-10')
    expect(calibrationAnchorDate('ytd', today)).toBe('2026-01-01')
    expect(calibrationAnchorDate('1y', today)).toBe('2025-08-10')
    expect(calibrationAnchorDate('all', today, '2020-05-01')).toBe('2020-05-01')
  })

  it('clamps calendar-month steps to the target month length', () => {
    // Mar 31 minus one calendar month is Feb 28 (2026 is not a leap year),
    // not Mar 3 (the naive Date.UTC overflow).
    expect(calibrationAnchorDate('1m', '2026-03-31')).toBe('2026-02-28')
    expect(calibrationAnchorDate('1m', '2024-03-31')).toBe('2024-02-29')
    expect(calibrationAnchorDate('1y', '2024-02-29')).toBe('2023-02-28')
  })

  it('wraps across the year boundary', () => {
    expect(calibrationAnchorDate('3m', '2026-01-15')).toBe('2025-10-15')
    expect(calibrationAnchorDate('1m', '2026-01-31')).toBe('2025-12-31')
    expect(calibrationAnchorDate('1w', '2026-01-03')).toBe('2025-12-27')
  })

  it('returns null for unknown kinds and unusable inputs', () => {
    expect(calibrationAnchorDate('6m', today)).toBeNull()
    expect(calibrationAnchorDate('all', today)).toBeNull()
    expect(calibrationAnchorDate('all', today, 'not-a-date')).toBeNull()
    expect(calibrationAnchorDate('ytd', '')).toBeNull()
    expect(calibrationAnchorDate('ytd', null)).toBeNull()
    expect(calibrationAnchorDate('ytd', '2026-13-40')).toBeNull()
  })
})

// fitSeriesToAnchors re-scales the ESTIMATED prefix so it passes exactly
// through each calibrated anchor and splices into the first real datapoint.
describe('fitSeriesToAnchors', () => {
  const day = 86400000
  const t0 = Date.UTC(2026, 0, 1)
  // Simple rising series: 100 -> 200 over 100 days.
  const points = Array.from({ length: 11 }, (_, i) => ({ ts: t0 + i * 10 * day, total: 100 + i * 10 }))
  const at = (arr, ts) => arr.find((p) => p.ts === ts)?.total

  it('returns the series untouched when there are no constraints', () => {
    const out = fitSeriesToAnchors(points, [])
    expect(out).not.toBe(points)
    expect(out.map((p) => p.total)).toEqual(points.map((p) => p.total))
  })

  it('with only a seam constraint it reduces to the old uniform scaling', () => {
    const seam = { ts: t0 + 100 * day, valueUSD: 400, _real: true }
    const out = fitSeriesToAnchors(points, [seam])
    // Raw value at the seam ts is 200 → every point doubles.
    expect(at(out, t0)).toBeCloseTo(200, 8)
    expect(at(out, t0 + 50 * day)).toBeCloseTo(300, 8)
    expect(at(out, t0 + 100 * day)).toBeCloseTo(400, 8)
  })

  it('passes EXACTLY through every anchor and meets the seam', () => {
    const anchors = [
      { ts: t0, valueUSD: 500, capturedAt: '2026-03-01' }, // ytd calibration at Jan 1
      { ts: t0 + 50 * day, valueUSD: 700, capturedAt: '2026-04-01' }, // later calibration
      { ts: t0 + 100 * day, valueUSD: 900, _real: true }, // first real datapoint (seam)
    ]
    const out = fitSeriesToAnchors(points, anchors)
    expect(at(out, t0)).toBeCloseTo(500, 8)
    expect(at(out, t0 + 50 * day)).toBeCloseTo(700, 8)
    expect(at(out, t0 + 100 * day)).toBeCloseTo(900, 8)
    // Between constraints the scale factor interpolates, so the curve keeps
    // its shape instead of going flat: midpoint of segment 1 sits above the
    // straight chord between the two anchor values is NOT required, but it
    // must remain monotonic here (rising series, rising factors).
    expect(at(out, t0 + 20 * day)).toBeGreaterThan(at(out, t0))
    expect(at(out, t0 + 20 * day)).toBeLessThan(at(out, t0 + 50 * day))
  })

  it('dedups same-day constraints keeping the newest capturedAt', () => {
    const anchors = [
      { ts: t0, valueUSD: 500, capturedAt: '2026-03-01' },
      { ts: t0, valueUSD: 620, capturedAt: '2026-05-01' }, // newer capture wins
    ]
    const out = fitSeriesToAnchors(points, anchors)
    expect(at(out, t0)).toBeCloseTo(620, 8)
  })

  it('a real seam marker always wins its day over calibrations', () => {
    const anchors = [
      { ts: t0, valueUSD: 500, capturedAt: '2026-05-01' },
      { ts: t0, valueUSD: 300, _real: true }, // same day, real data wins
    ]
    const out = fitSeriesToAnchors(points, anchors)
    expect(at(out, t0)).toBeCloseTo(300, 8)
  })

  it('ignores unusable constraints (zero/negative/NaN values)', () => {
    const out = fitSeriesToAnchors(points, [
      { ts: t0, valueUSD: 0 },
      { ts: t0 + 10 * day, valueUSD: -5 },
      { ts: t0 + 20 * day, valueUSD: NaN },
      { ts: t0 + 30 * day, valueUSD: 260 },
    ])
    expect(at(out, t0 + 30 * day)).toBeCloseTo(260, 8)
  })

  it('scales the stretch before the first anchor by that anchor factor', () => {
    // Anchor only at day 100 (the seam): the whole earlier series moves by
    // the same factor (the old behavior the fit generalizes).
    const out = fitSeriesToAnchors(points, [{ ts: t0 + 100 * day, valueUSD: 200, _real: true }])
    expect(at(out, t0)).toBeCloseTo(100, 8) // factor 1: seam equals raw value
    const out2 = fitSeriesToAnchors(points, [{ ts: t0 + 100 * day, valueUSD: 600, _real: true }])
    expect(at(out2, t0)).toBeCloseTo(300, 8)
  })
})

// Roll-forward: the calibration stays fixed at its anchor date and the
// displayed % moves with the market because Modified Dietz keeps the anchor
// start value pinned while the end value lives.
describe('calibration roll-forward', () => {
  const day = 86400000
  const startTs = Date.UTC(2026, 0, 1)
  const endTs = startTs + 216 * day

  it('no flows: a +1% market day moves the calibrated 6% to ~7%', () => {
    const { startValue } = solveDietzStartValue({
      endValue: 10600, startTs, endTs, transactions: [], targetPct: 6,
    })
    expect(startValue).toBeCloseTo(10000, 6)
    // Next day positions are +1%: the anchor does not move, the % does.
    const { pct } = computeModifiedDietz({
      startValue, endValue: 10600 * 1.01, startTs, endTs: endTs + day, transactions: [],
    })
    expect(pct).toBeGreaterThan(6)
    expect(pct).toBeCloseTo(7.06, 2)
  })

  it('with flows: the moved % solves back to the SAME fixed anchor', () => {
    const transactions = [{ type: 'DEPOSIT', date: new Date(startTs + 60 * day).toISOString().slice(0, 10), totalAmount: 1000, currency: 'USD' }]
    const { startValue } = solveDietzStartValue({
      endValue: 10600, startTs, endTs, transactions, targetPct: 6,
    })
    const endTs2 = endTs + day
    const { pct: moved } = computeModifiedDietz({
      startValue, endValue: 10600 * 1.01, startTs, endTs: endTs2, transactions,
    })
    expect(moved).toBeGreaterThan(6)
    // Inverting the moved percentage at the new end value must land on the
    // exact anchor the calibration pinned: the % moves, the anchor does not.
    const back = solveDietzStartValue({
      endValue: 10600 * 1.01, startTs, endTs: endTs2, transactions, targetPct: moved,
    })
    expect(back.error).toBeUndefined()
    expect(back.startValue).toBeCloseTo(startValue, 6)
  })
})

// The form guard: periods whose anchor date is already covered by real
// broker/daily data are skipped (real data owns that stretch).
describe('calibrationCoveredByRealData', () => {
  const snapshots = [
    { date: '2026-07-15', _source: 'ibkr' },
    { date: '2026-07-16', _source: 'daily' },
    { date: '2026-01-01', _source: 'backfill' }, // reconstructed, NOT real
  ]

  it('covers anchors on a real day or after the first real datapoint', () => {
    expect(calibrationCoveredByRealData('2026-07-15', snapshots, true)).toBe(true)
    expect(calibrationCoveredByRealData('2026-08-01', snapshots, true)).toBe(true)
  })

  it('leaves anchors before real coverage calibratable', () => {
    expect(calibrationCoveredByRealData('2026-01-01', snapshots, true)).toBe(false)
    expect(calibrationCoveredByRealData('2026-07-01', snapshots, true)).toBe(false)
  })

  it('never guards manual accounts or empty history', () => {
    expect(calibrationCoveredByRealData('2026-08-01', snapshots, false)).toBe(false)
    expect(calibrationCoveredByRealData('2026-08-01', [], true)).toBe(false)
    expect(calibrationCoveredByRealData('2026-08-01', null, true)).toBe(false)
    expect(calibrationCoveredByRealData(null, snapshots, true)).toBe(false)
  })
})

// Calibration docs always get a compound Firestore id so they can never
// collide with (or block) the real daily NAV doc of the same date.
describe('snapshotDocId', () => {
  it('keeps the plain date for real NAV snapshots', () => {
    expect(snapshotDocId({ date: '2026-01-01', _source: 'daily' }, '2026-01-01')).toBe('2026-01-01')
    expect(snapshotDocId({ date: '2026-01-01', _source: 'ibkr' }, '2026-01-01')).toBe('2026-01-01')
  })

  it('compounds global calibrations with the global scope', () => {
    expect(snapshotDocId({ date: '2026-01-01', _calibrated: true, _calibrationKind: 'ytd' }, '2026-01-01'))
      .toBe('2026-01-01~ytd~global')
  })

  it('compounds per-account calibrations with a sanitized account key', () => {
    expect(snapshotDocId({ date: '2026-01-01', _calibrated: true, _calibrationKind: 'ytd', _account: 'hapi securities' }, '2026-01-01'))
      .toBe('2026-01-01~ytd~hapi-securities')
  })

  it('falls back gracefully without a kind', () => {
    expect(snapshotDocId({ date: '2026-01-01', _calibrated: true }, '2026-01-01'))
      .toBe('2026-01-01~cal~global')
  })
})
