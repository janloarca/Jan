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
