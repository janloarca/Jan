import { plausibleReturnCeiling, detectInferredFlows, quarterlyOnlyPoints, staleInferredFlowIds } from '../inferredFlows'

describe('plausibleReturnCeiling', () => {
  it('scales by sqrt(time), a full year at the account\'s own volatility', () => {
    // 20% annualized vol, 1000 start, 1 year → ceiling = 1000 * 0.20 * sqrt(1) = 200
    expect(plausibleReturnCeiling(1000, 20, 1)).toBeCloseTo(200, 6)
  })

  it('a quarter gets half the annual band (sqrt(0.25) = 0.5)', () => {
    expect(plausibleReturnCeiling(1000, 20, 0.25)).toBeCloseTo(100, 6)
  })

  it('falls back to a conservative default vol when none is known', () => {
    expect(plausibleReturnCeiling(1000, null, 1)).toBeCloseTo(250, 6) // 25% default
    expect(plausibleReturnCeiling(1000, NaN, 1)).toBeCloseTo(250, 6)
    expect(plausibleReturnCeiling(1000, 0, 1)).toBeCloseTo(250, 6)
  })

  it('is 0 with no starting value or no elapsed time', () => {
    expect(plausibleReturnCeiling(0, 20, 1)).toBe(0)
    expect(plausibleReturnCeiling(1000, 20, 0)).toBe(0)
  })
})

describe('detectInferredFlows', () => {
  const vol = 20 // %

  it('flags nothing when the change is within the plausible band', () => {
    // Q1→Q2 (0.25y): ceiling ≈ 1000*0.20*0.5 = 100. A 90 move is plain market.
    const pts = [{ date: '2024-01-01', value: 1000 }, { date: '2024-04-01', value: 1090 }]
    expect(detectInferredFlows(pts, { annualizedVolatilityPct: vol })).toEqual([])
  })

  it('flags a deposit when growth blows past the plausible band', () => {
    const pts = [{ date: '2024-01-01', value: 1000 }, { date: '2024-04-01', value: 6000 }]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows).toHaveLength(1)
    expect(flows[0].type).toBe('DEPOSIT')
    expect(flows[0].amount).toBeGreaterThan(4800) // ~5000 excess minus the ~100 plausible band
    expect(flows[0].midDate).toBe('2024-02-15') // midpoint of the gap
  })

  it('flags a withdrawal when the drop is too steep for pure market', () => {
    const pts = [{ date: '2024-01-01', value: 6000 }, { date: '2024-04-01', value: 1000 }]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows).toHaveLength(1)
    expect(flows[0].type).toBe('WITHDRAWAL')
  })

  it('skips a gap already marked reviewed', () => {
    const pts = [{ date: '2024-01-01', value: 1000 }, { date: '2024-04-01', value: 6000, reviewed: true }]
    expect(detectInferredFlows(pts, { annualizedVolatilityPct: vol })).toEqual([])
  })

  it('handles multiple consecutive gaps independently', () => {
    const pts = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-04-01', value: 1050 }, // plausible, no flag
      { date: '2024-07-01', value: 6000 }, // deposit
    ]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows).toHaveLength(1)
    expect(flows[0].fromDate).toBe('2024-04-01')
    expect(flows[0].toDate).toBe('2024-07-01')
  })

  it('needs at least 2 points', () => {
    expect(detectInferredFlows([], {})).toEqual([])
    expect(detectInferredFlows([{ date: '2024-01-01', value: 1000 }], {})).toEqual([])
  })

  it('tags a normal statistical detection as source:estimate', () => {
    const pts = [{ date: '2024-01-01', value: 1000 }, { date: '2024-04-01', value: 6000 }]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows[0].source).toBe('estimate')
  })

  // A real "D"/"W" marker read off the user's own screenshot (FASE DT) is
  // direct evidence, not a guess — it must always produce a candidate, even
  // for a move small enough to look like plain market noise on its own.
  it('flags a candidate from a deposit marker even inside the plausible band', () => {
    const pts = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-04-01', value: 1050, marker: 'deposit' }, // well within the ~100 band
    ]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows).toHaveLength(1)
    expect(flows[0].type).toBe('DEPOSIT')
    expect(flows[0].source).toBe('photo')
  })

  it('flags a candidate from a withdrawal marker even inside the plausible band', () => {
    const pts = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-04-01', value: 950, marker: 'withdrawal' },
    ]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows).toHaveLength(1)
    expect(flows[0].type).toBe('WITHDRAWAL')
    expect(flows[0].source).toBe('photo')
  })

  it('a marker decides the type even when the raw delta sign disagrees', () => {
    // A deposit that was more than offset by market losses in the same
    // quarter: the NAV still fell, but the screenshot says money came IN.
    const pts = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-04-01', value: 900, marker: 'deposit' },
    ]
    const flows = detectInferredFlows(pts, { annualizedVolatilityPct: vol })
    expect(flows[0].type).toBe('DEPOSIT')
    expect(flows[0].amount).toBeGreaterThan(0)
  })
})

describe('quarterlyOnlyPoints', () => {
  const snaps = [
    { date: '2023-03-31', _source: 'ibkr_quarterly', netWorthUSD: 500 },
    { date: '2023-06-30', _source: 'ibkr_quarterly', netWorthUSD: 700, _flowReviewed: true },
    { date: '2025-01-15', _source: 'ibkr', netWorthUSD: 5000 }, // real, day-level
    { date: '2024-01-01', _source: 'manual', netWorthUSD: 900 }, // not quarterly-sourced
  ]

  it('keeps only ibkr_quarterly points at or before the real-coverage boundary', () => {
    const realEarliest = new Date('2025-01-15T00:00:00Z').getTime()
    const pts = quarterlyOnlyPoints(snaps, realEarliest)
    expect(pts.map((p) => p.date)).toEqual(['2023-03-31', '2023-06-30'])
  })

  it('carries the reviewed flag through', () => {
    const pts = quarterlyOnlyPoints(snaps, Infinity)
    expect(pts.find((p) => p.date === '2023-06-30').reviewed).toBe(true)
    expect(pts.find((p) => p.date === '2023-03-31').reviewed).toBe(false)
  })

  it('drops quarterly points that real coverage has already caught up to', () => {
    // Real data now starts 2023-05-01: the 2023-06-30 quarterly point is moot.
    const pts = quarterlyOnlyPoints(snaps, new Date('2023-05-01T00:00:00Z').getTime())
    expect(pts.map((p) => p.date)).toEqual(['2023-03-31'])
  })

  it('carries a valid _flowMarker through as marker, and drops garbage values', () => {
    const withMarkers = [
      ...snaps,
      { date: '2023-09-30', _source: 'ibkr_quarterly', netWorthUSD: 800, _flowMarker: 'deposit' },
      { date: '2023-12-31', _source: 'ibkr_quarterly', netWorthUSD: 850, _flowMarker: 'not-a-real-value' },
    ]
    const pts = quarterlyOnlyPoints(withMarkers, Infinity)
    expect(pts.find((p) => p.date === '2023-09-30').marker).toBe('deposit')
    expect(pts.find((p) => p.date === '2023-12-31').marker).toBeUndefined()
    expect(pts.find((p) => p.date === '2023-03-31').marker).toBeUndefined()
  })
})

describe('staleInferredFlowIds', () => {
  it('flags an inferred flow once real coverage reaches its date', () => {
    const txs = [
      { id: 't1', _source: 'inferred_flow', date: '2024-02-15' },
      { id: 't2', _source: 'inferred_flow', date: '2026-01-01' },
      { id: 't3', _source: 'manual_cashflow', date: '2024-02-15' },
    ]
    const ids = staleInferredFlowIds(txs, {
      earliestTs: new Date('2024-01-01T00:00:00Z').getTime(),
      latestTs: new Date('2025-01-01T00:00:00Z').getTime(),
    })
    expect(ids).toEqual(['t1'])
  })

  it('returns nothing without a known real-coverage window', () => {
    const txs = [{ id: 't1', _source: 'inferred_flow', date: '2024-02-15' }]
    expect(staleInferredFlowIds(txs, {})).toEqual([])
    expect(staleInferredFlowIds(txs, null)).toEqual([])
  })
})

// FASE GJ: the Cash Flows bar magnitude and the lifetime-net global constraint.
import { applyLifetimeNetConstraint } from '../inferredFlows'

describe('flowAmount from the screenshot (FASE GJ)', () => {
  it('a marked quarter with a legible Cash Flows bar uses that magnitude as the amount', () => {
    const pts = [
      { date: '2024-03-31', value: 1000 },
      { date: '2024-06-30', value: 1400, marker: 'deposit', flowAmount: 850 },
    ]
    const [c] = detectInferredFlows(pts, { annualizedVolatilityPct: 20 })
    expect(c.type).toBe('DEPOSIT')
    expect(c.amount).toBe(850)
    expect(c.amountFromPhoto).toBe(true)
    expect(c.source).toBe('photo')
  })

  it('without a flowAmount the marked quarter keeps the delta-based estimate', () => {
    const pts = [
      { date: '2024-03-31', value: 1000 },
      { date: '2024-06-30', value: 1400, marker: 'deposit' },
    ]
    const [c] = detectInferredFlows(pts, { annualizedVolatilityPct: 20 })
    expect(c.amount).toBe(400)
    expect(c.amountFromPhoto).toBeUndefined()
  })

  it('a flowAmount WITHOUT a marker never creates a candidate on its own', () => {
    // Direction is the marker's job; a bare magnitude with an in-band delta
    // stays silent exactly like before.
    const pts = [
      { date: '2024-03-31', value: 1000 },
      { date: '2024-06-30', value: 1010, flowAmount: 850 },
    ]
    expect(detectInferredFlows(pts, { annualizedVolatilityPct: 20 })).toHaveLength(0)
  })

  it('quarterlyOnlyPoints exposes _flowAmount', () => {
    const pts = quarterlyOnlyPoints([
      { date: '2024-06-30', _source: 'ibkr_quarterly', netWorthUSD: 1400, _flowMarker: 'deposit', _flowAmount: 850 },
    ], Infinity)
    expect(pts[0].flowAmount).toBe(850)
    expect(pts[0].marker).toBe('deposit')
  })
})

describe('applyLifetimeNetConstraint (FASE GJ)', () => {
  const dep = (amount, extra = {}) => ({ id: `d${amount}`, type: 'DEPOSIT', amount, source: 'estimate', ...extra })
  const wd = (amount, extra = {}) => ({ id: `w${amount}`, type: 'WITHDRAWAL', amount, source: 'estimate', ...extra })

  it('null reconciliation without a lifetime figure or without candidates', () => {
    expect(applyLifetimeNetConstraint([dep(100)], {}).reconciliation).toBeNull()
    expect(applyLifetimeNetConstraint([], { lifetimeNetUSD: 1000, knownNetUSD: 0 }).reconciliation).toBeNull()
  })

  it('already closing within tolerance: untouched, mismatch 0', () => {
    const cands = [dep(1000), dep(500)]
    const { candidates, reconciliation } = applyLifetimeNetConstraint(cands, { lifetimeNetUSD: 5500, knownNetUSD: 4010 })
    // residual 1490, candidates net 1500, diff 10 <= tol (29.8)
    expect(candidates).toBe(cands)
    expect(reconciliation.mismatchUSD).toBe(0)
    expect(reconciliation.scaledBy).toBeNull()
  })

  it('scales estimate candidates by one factor so the net closes (the user real case)', () => {
    // Lifetime net 7909.99, exact window flows 4063.19 -> residual 3846.80.
    // Two estimated deposits netting 3000 must scale by ~1.2823.
    const { candidates, reconciliation } = applyLifetimeNetConstraint(
      [dep(2000), dep(1000)],
      { lifetimeNetUSD: 7909.99, knownNetUSD: 4063.19 }
    )
    const net = candidates.reduce((s, c) => s + (c.type === 'DEPOSIT' ? c.amount : -c.amount), 0)
    expect(net).toBeCloseTo(3846.8, 1)
    expect(candidates.every((c) => c.adjustedToLifetimeNet)).toBe(true)
    expect(reconciliation.scaledBy).toBeCloseTo(1.2823, 3)
    expect(reconciliation.residualUSD).toBeCloseTo(3846.8, 2)
  })

  it('photo-read amounts are never rescaled; only the estimates absorb the residual', () => {
    const { candidates } = applyLifetimeNetConstraint(
      [dep(1000, { amountFromPhoto: true, source: 'photo' }), dep(1000)],
      { lifetimeNetUSD: 2500, knownNetUSD: 0 }
    )
    expect(candidates[0].amount).toBe(1000)
    expect(candidates[0].adjustedToLifetimeNet).toBeUndefined()
    expect(candidates[1].amount).toBe(1500)
    expect(candidates[1].adjustedToLifetimeNet).toBe(true)
  })

  it('mixed deposits and withdrawals scale linearly as a NET', () => {
    // Net = 900 - 300 = 600; residual 1200 -> factor 2 -> 1800 - 600 = 1200.
    const { candidates } = applyLifetimeNetConstraint(
      [dep(900), wd(300)],
      { lifetimeNetUSD: 1200, knownNetUSD: 0 }
    )
    expect(candidates[0].amount).toBe(1800)
    expect(candidates[1].amount).toBe(600)
  })

  it('a factor that would flip directions refuses to scale and reports the mismatch', () => {
    const cands = [dep(1000)]
    const { candidates, reconciliation } = applyLifetimeNetConstraint(cands, { lifetimeNetUSD: -500, knownNetUSD: 0 })
    expect(candidates).toBe(cands)
    expect(reconciliation.scaledBy).toBeNull()
    expect(reconciliation.mismatchUSD).toBeCloseTo(1500, 2)
  })
})
