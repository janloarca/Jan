import { computeModifiedDietz, solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, combineAccountCalibrations, buildCalibrationNavPoints } from '../utils'

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

// buildCalibrationNavPoints converts per-account anchors into whole-portfolio
// NAV points so the growth chart and the monthly spreadsheet reflect a
// calibration too, not only the YTD badge.
describe('buildCalibrationNavPoints', () => {
  const items = [
    { symbol: 'AAPL', institution: 'Hapi', quantity: 60, currentPrice: 100, currency: 'USD' },
    { symbol: 'MSFT', _source: 'ibkr', institution: 'Interactive Brokers', quantity: 20, currentPrice: 200, currency: 'USD' },
  ]
  const calibrations = [
    { date: '2026-01-01', _account: 'ibkr', _calibrated: true, netWorthUSD: 4500 },
    { date: '2026-01-01', _account: 'hapi', _calibrated: true, netWorthUSD: 5000 },
  ]

  it('returns [] without calibrations', () => {
    expect(buildCalibrationNavPoints({ accountCalibrations: [], navSnapshots: [], items })).toEqual([])
    expect(buildCalibrationNavPoints({ accountCalibrations: null, navSnapshots: null, items })).toEqual([])
  })

  it('combines the accounts of one date against the latest prior NAV', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: calibrations,
      navSnapshots: [{ date: '2025-12-31', netWorthUSD: 10000, _source: 'daily' }],
      items,
    })
    expect(pts).toHaveLength(1)
    // Same math as combineAccountCalibrations: 10000 - 4000 - 6000 + 4500 + 5000
    expect(pts[0].netWorthUSD).toBeCloseTo(9500, 8)
    expect(pts[0].date).toBe('2026-01-01')
    expect(pts[0]._accountCombined).toBe(true)
    expect(pts[0]._calibrated).toBe(true)
    expect(pts[0]._source).toBe('manual')
  })

  it('rebuilds the base from uncalibrated items when no prior NAV exists', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: [calibrations[0]],
      navSnapshots: [],
      items,
    })
    // Base = held-flat of the uncalibrated account (hapi 6000); + 4500 calibrated
    expect(pts).toHaveLength(1)
    expect(pts[0].netWorthUSD).toBeCloseTo(10500, 8)
  })

  it('ignores NAV snapshots after the anchor date when picking the base', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: [calibrations[0]],
      navSnapshots: [
        { date: '2025-12-31', netWorthUSD: 10000, _source: 'daily' },
        { date: '2026-06-01', netWorthUSD: 99999, _source: 'daily' },
      ],
      items,
    })
    // base 10000, IBKR estimate = 10000 - 6000 (non-IBKR) = 4000 → 10000 - 4000 + 4500
    expect(pts[0].netWorthUSD).toBeCloseTo(10500, 8)
  })

  it('skips dates already anchored by a global calibration', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: calibrations,
      navSnapshots: [{ date: '2026-01-01', netWorthUSD: 9500, _source: 'manual', _calibrated: true }],
      items,
    })
    expect(pts).toEqual([])
  })

  it('emits one point per distinct date, sorted', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: [
        { date: '2026-01-01', _account: 'ibkr', _calibrated: true, netWorthUSD: 4500 },
        { date: '2025-06-01', _account: 'hapi', _calibrated: true, netWorthUSD: 3000 },
      ],
      navSnapshots: [],
      items,
    })
    expect(pts.map((p) => p.date)).toEqual(['2025-06-01', '2026-01-01'])
  })

  it('drops calibrations without a positive value or a date', () => {
    const pts = buildCalibrationNavPoints({
      accountCalibrations: [
        { date: '2026-01-01', _account: 'ibkr', _calibrated: true, netWorthUSD: 0 },
        { _account: 'hapi', _calibrated: true, netWorthUSD: 5000 },
      ],
      navSnapshots: [],
      items,
    })
    expect(pts).toEqual([])
  })
})
