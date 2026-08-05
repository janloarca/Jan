import {
  calibrationAnchorDate, calibrationCoveredByRealData, dedupeCalibrations,
  fitSeriesToAnchors, solveDietzStartValue, computeModifiedDietz,
} from '../utils'

// Calibration redesign: 7 optional periods, anchors pinned at the period start
// with the capture date stored, the estimated curve FITTED through the anchors
// (no more flat straight line to the first real datapoint), and roll-forward
// of the displayed % via Modified Dietz with a live end value.

describe('calibrationAnchorDate', () => {
  const today = '2026-08-05'

  it('resolves every kind with string-prefix / UTC math only', () => {
    expect(calibrationAnchorDate('1w', today)).toBe('2026-07-29')
    expect(calibrationAnchorDate('mtd', today)).toBe('2026-08-01')
    expect(calibrationAnchorDate('1m', today)).toBe('2026-07-05')
    expect(calibrationAnchorDate('3m', today)).toBe('2026-05-05')
    expect(calibrationAnchorDate('ytd', today)).toBe('2026-01-01')
    expect(calibrationAnchorDate('1y', today)).toBe('2025-08-05')
    expect(calibrationAnchorDate('all', today, '2023-04-17')).toBe('2023-04-17')
  })

  it('clamps calendar-month shifts to the target month last day', () => {
    // Mar 31 - 1 month: Feb 31 does not exist (2026 is not a leap year).
    expect(calibrationAnchorDate('1m', '2026-03-31')).toBe('2026-02-28')
    // Mar 31 - 3 months: Dec 31 exists, keep the 31st.
    expect(calibrationAnchorDate('3m', '2026-03-31')).toBe('2025-12-31')
    // Leap year: Feb 29 - 1y lands on Feb 28 of the non-leap year.
    expect(calibrationAnchorDate('1y', '2024-02-29')).toBe('2023-02-28')
  })

  it('handles month and year boundaries', () => {
    expect(calibrationAnchorDate('1w', '2026-01-03')).toBe('2025-12-27')
    expect(calibrationAnchorDate('mtd', '2026-01-15')).toBe('2026-01-01')
    expect(calibrationAnchorDate('1m', '2026-01-15')).toBe('2025-12-15')
    expect(calibrationAnchorDate('ytd', '2026-12-31')).toBe('2026-01-01')
  })

  it('returns null for unknown kinds or missing inputs', () => {
    expect(calibrationAnchorDate('6m', today)).toBeNull()
    expect(calibrationAnchorDate('all', today)).toBeNull()
    expect(calibrationAnchorDate('all', today, 'not-a-date')).toBeNull()
    expect(calibrationAnchorDate('1w', '')).toBeNull()
    expect(calibrationAnchorDate('ytd', '05-08-2026')).toBeNull()
  })
})

describe('calibrationCoveredByRealData', () => {
  const realDates = ['2026-07-15', '2026-07-20', '2026-08-01']

  it('anchors on or after the first real datapoint are covered', () => {
    expect(calibrationCoveredByRealData('2026-07-15', realDates)).toBe(true)
    expect(calibrationCoveredByRealData('2026-08-01', realDates)).toBe(true)
  })

  it('anchors before the first real datapoint still need calibration', () => {
    expect(calibrationCoveredByRealData('2026-01-01', realDates)).toBe(false)
    expect(calibrationCoveredByRealData('2026-07-14', realDates)).toBe(false)
  })

  it('no real data means nothing is covered', () => {
    expect(calibrationCoveredByRealData('2026-08-01', [])).toBe(false)
    expect(calibrationCoveredByRealData('2026-08-01', null)).toBe(false)
    expect(calibrationCoveredByRealData(null, realDates)).toBe(false)
  })
})

describe('dedupeCalibrations', () => {
  it('keeps the most recently captured doc per (account, kind, date)', () => {
    const cals = [
      { id: '2026-01-01', date: '2026-01-01', _calibrationKind: 'ytd', netWorthUSD: 9000 },
      { id: '2026-01-01~ytd~global', date: '2026-01-01', _calibrationKind: 'ytd', netWorthUSD: 9500, capturedAt: '2026-08-01' },
    ]
    const out = dedupeCalibrations(cals)
    expect(out).toHaveLength(1)
    expect(out[0].netWorthUSD).toBe(9500)
  })

  it('does not merge different kinds, dates or accounts', () => {
    const cals = [
      { date: '2026-01-01', _calibrationKind: 'ytd', netWorthUSD: 1, capturedAt: '2026-08-01' },
      { date: '2026-08-01', _calibrationKind: 'mtd', netWorthUSD: 2, capturedAt: '2026-08-02' },
      { date: '2026-01-01', _calibrationKind: 'ytd', _account: 'ibkr', netWorthUSD: 3, capturedAt: '2026-08-01' },
    ]
    expect(dedupeCalibrations(cals)).toHaveLength(3)
  })
})

describe('fitSeriesToAnchors', () => {
  const day = 86400000
  const t0 = Date.UTC(2026, 0, 1)
  // Estimated prefix: a straight ramp 100 -> 200 over 10 days.
  const points = Array.from({ length: 11 }, (_, i) => ({ ts: t0 + i * day, total: 100 + i * 10 }))

  it('returns the input unchanged when there are no anchors', () => {
    const out = fitSeriesToAnchors(points, [])
    expect(out.map((p) => p.total)).toEqual(points.map((p) => p.total))
    expect(fitSeriesToAnchors(points, null).map((p) => p.total)).toEqual(points.map((p) => p.total))
  })

  it('passes EXACTLY through a single anchor and joins the seam', () => {
    // Anchor mid-series: raw 150 must become 165 (factor 1.1 there); the seam
    // (first real point) pins the end at 220 (factor 1.1 too): uniform result.
    const seam = { ts: t0 + 10 * day, valueUSD: 220, capturedAt: 'zzzz-seam' }
    const out = fitSeriesToAnchors(points, [
      { ts: t0 + 5 * day, valueUSD: 165, capturedAt: '2026-08-01' },
      seam,
    ])
    expect(out.find((p) => p.ts === t0 + 5 * day).total).toBeCloseTo(165, 8)
    expect(out[out.length - 1].total).toBeCloseTo(220, 8)
    // Both constraints imply factor 1.1, so the whole curve scales uniformly.
    expect(out[0].total).toBeCloseTo(110, 8)
  })

  it('interpolates the scale factor between consecutive anchors', () => {
    // Anchor A: raw 120 -> 120 (factor 1). Anchor B: raw 160 -> 192 (factor 1.2).
    const out = fitSeriesToAnchors(points, [
      { ts: t0 + 2 * day, valueUSD: 120, capturedAt: '2026-08-01' },
      { ts: t0 + 6 * day, valueUSD: 192, capturedAt: '2026-08-01' },
    ])
    expect(out.find((p) => p.ts === t0 + 2 * day).total).toBeCloseTo(120, 8)
    expect(out.find((p) => p.ts === t0 + 6 * day).total).toBeCloseTo(192, 8)
    // Halfway between the anchors the factor is the midpoint (1.1): raw 140 -> 154.
    expect(out.find((p) => p.ts === t0 + 4 * day).total).toBeCloseTo(154, 8)
    // Before the first anchor the factor holds at the first constraint (1).
    expect(out[0].total).toBeCloseTo(100, 8)
    // After the last anchor it holds at the last constraint (1.2).
    expect(out[out.length - 1].total).toBeCloseTo(240, 8)
  })

  it('dedupes same-day anchors keeping the latest capturedAt', () => {
    const out = fitSeriesToAnchors(points, [
      { ts: t0 + 5 * day, valueUSD: 300, capturedAt: '2026-07-01' },
      { ts: t0 + 5 * day, valueUSD: 180, capturedAt: '2026-08-01' },
    ])
    expect(out.find((p) => p.ts === t0 + 5 * day).total).toBeCloseTo(180, 8)
  })

  it('ignores anchors without a positive value', () => {
    const out = fitSeriesToAnchors(points, [{ ts: t0 + 5 * day, valueUSD: 0, capturedAt: '2026-08-01' }])
    expect(out.map((p) => p.total)).toEqual(points.map((p) => p.total))
  })
})

// Roll-forward: the calibration stays pinned at its anchor date and the
// displayed % moves with the market, because the anchor feeds Modified Dietz
// as a FIXED start value against a LIVE end value.
describe('calibration roll-forward', () => {
  const day = 86400000
  const startTs = Date.UTC(2026, 0, 1)
  const endTs = startTs + 216 * day

  it('a 6% YTD calibration becomes ~7% when positions rise 1% with no flows', () => {
    const { startValue, error } = solveDietzStartValue({
      endValue: 10600, startTs, endTs, transactions: [], targetPct: 6,
    })
    expect(error).toBeUndefined()
    expect(startValue).toBeCloseTo(10000, 6)
    // Next day: positions +1%, end value 10600 * 1.01, same anchor, no flows.
    const { pct } = computeModifiedDietz({
      startValue, endValue: 10600 * 1.01, startTs, endTs: endTs + day, transactions: [],
    })
    expect(pct).toBeCloseTo(1.06 * 1.01 * 100 - 100, 4) // 7.06%
    expect(pct).toBeGreaterThan(7)
    expect(pct).toBeLessThan(7.2)
  })

  it('rolls forward with flows too: the solved anchor reproduces the target, then moves with the market', () => {
    const iso = (ts) => new Date(ts).toISOString().slice(0, 10)
    const transactions = [
      { type: 'DEPOSIT', date: iso(startTs + 50 * day), totalAmount: 2000, currency: 'USD' },
      { type: 'WITHDRAWAL', date: iso(startTs + 120 * day), totalAmount: 500, currency: 'USD' },
    ]
    const { startValue, error } = solveDietzStartValue({
      endValue: 10106.754497, startTs, endTs, transactions, targetPct: 8.6059,
    })
    expect(error).toBeUndefined()
    const { pct: pctThen } = computeModifiedDietz({ startValue, endValue: 10106.754497, startTs, endTs, transactions })
    expect(pctThen).toBeCloseTo(8.6059, 8)
    // Market +1% with no new flows: the % moves up, the anchor does not.
    const { pct: pctNow } = computeModifiedDietz({
      startValue, endValue: 10106.754497 * 1.01, startTs, endTs: endTs + day, transactions,
    })
    expect(pctNow).toBeGreaterThan(pctThen)
  })
})
