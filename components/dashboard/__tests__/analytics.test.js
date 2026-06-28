import {
  computeSharpeRatio,
  computeVolatility,
  computeMaxDrawdown,
  computeHHI,
  computeTWRSeries,
  computeAssetAttribution,
  computeCAGR,
  computeBeta,
  computeNetContributions,
  inferPeriodsPerYear,
} from '../analytics'

describe('inferPeriodsPerYear', () => {
  const day = 86400000
  const series = (n, stepDays, start = Date.UTC(2025, 0, 1)) =>
    Array.from({ length: n }, (_, i) => ({ date: new Date(start + i * stepDays * day).toISOString() }))

  test('daily snapshots → near the high clamp', () => {
    const ppy = inferPeriodsPerYear(series(40, 1))
    expect(ppy).toBeGreaterThan(200)
    expect(ppy).toBeLessThanOrEqual(365)
  })

  test('monthly snapshots → ~12', () => {
    const monthly = Array.from({ length: 13 }, (_, i) => ({ date: new Date(Date.UTC(2024, i, 1)).toISOString() }))
    const ppy = inferPeriodsPerYear(monthly)
    expect(ppy).toBeGreaterThan(11)
    expect(ppy).toBeLessThan(13)
  })

  test('fewer than 2 points → default 12', () => {
    expect(inferPeriodsPerYear([])).toBe(12)
    expect(inferPeriodsPerYear([{ date: '2025-01-01' }])).toBe(12)
    expect(inferPeriodsPerYear(null)).toBe(12)
  })

  test('clamped to [4, 365]', () => {
    expect(inferPeriodsPerYear(series(2, 1))).toBeLessThanOrEqual(365)
    expect(inferPeriodsPerYear(series(2, 365 * 5))).toBe(4)
  })
})

describe('computeSharpeRatio cadence (periodsPerYear)', () => {
  const returns = [0.02, -0.01, 0.03, -0.02, 0.01, 0.02, -0.01, 0.03]

  test('higher cadence annualizes to higher volatility', () => {
    const daily = computeSharpeRatio({ returns, periodsPerYear: 252 })
    const monthly = computeSharpeRatio({ returns, periodsPerYear: 12 })
    expect(daily.annualizedVolatility).toBeGreaterThan(monthly.annualizedVolatility)
    // factor ~ sqrt(252/12)
    expect(daily.annualizedVolatility / monthly.annualizedVolatility).toBeCloseTo(Math.sqrt(252 / 12), 1)
  })

  test('default periodsPerYear (12) is backward-compatible', () => {
    const explicit = computeSharpeRatio({ returns, periodsPerYear: 12 })
    const defaulted = computeSharpeRatio({ returns })
    expect(defaulted.annualizedVolatility).toBe(explicit.annualizedVolatility)
    expect(defaulted.annualizedReturn).toBe(explicit.annualizedReturn)
    expect(defaulted.sharpe).toBe(explicit.sharpe)
  })
})

describe('computeAssetAttribution cost-basis guard', () => {
  test('item with purchasePrice → real gain', () => {
    const [a] = computeAssetAttribution([{ symbol: 'A', quantity: 10, currentPrice: 12, purchasePrice: 10 }])
    expect(a.gain).toBeCloseTo((12 - 10) * 10)
  })

  test('item without purchasePrice → gain 0, not faked from currentPrice', () => {
    const res = computeAssetAttribution([
      { symbol: 'A', quantity: 10, currentPrice: 12, purchasePrice: 10 },
      { symbol: 'NOCOST', quantity: 5, currentPrice: 100 },
    ])
    const nocost = res.find((r) => r.symbol === 'NOCOST')
    expect(nocost.gain).toBe(0)
    expect(nocost.value).toBeCloseTo(500)
    expect(typeof nocost.weight).toBe('number')
  })
})

describe('computeSharpeRatio', () => {
  test('normal returns', () => {
    const returns = [0.02, 0.03, -0.01, 0.04, 0.01, 0.02, -0.02, 0.03, 0.01, 0.02, 0.01, 0.03]
    const result = computeSharpeRatio({ returns })
    expect(result.sharpe).not.toBeNull()
    expect(typeof result.sharpe).toBe('number')
    expect(result.annualizedReturn).toBeGreaterThan(0)
    expect(result.annualizedVolatility).toBeGreaterThan(0)
  })

  test('zero volatility returns null sharpe', () => {
    const returns = [0.01, 0.01, 0.01, 0.01]
    const result = computeSharpeRatio({ returns })
    expect(result.sharpe).toBeNull()
    expect(result.annualizedVolatility).toBe(0)
  })

  test('insufficient returns', () => {
    const result = computeSharpeRatio({ returns: [0.01, 0.02] })
    expect(result.sharpe).toBeNull()
    expect(result.annualizedReturn).toBeNull()
  })

  test('empty/null returns', () => {
    expect(computeSharpeRatio({ returns: null }).sharpe).toBeNull()
    expect(computeSharpeRatio({ returns: [] }).sharpe).toBeNull()
  })

  test('custom risk-free rate', () => {
    const returns = [0.02, 0.03, 0.01, 0.04, 0.01, 0.02, -0.02, 0.03, 0.01, 0.02, 0.01, 0.03]
    const r1 = computeSharpeRatio({ returns, riskFreeRate: 0 })
    const r2 = computeSharpeRatio({ returns, riskFreeRate: 0.01 })
    expect(r1.sharpe).toBeGreaterThan(r2.sharpe)
  })
})

describe('computeVolatility', () => {
  test('normal returns', () => {
    const returns = [0.02, -0.01, 0.03, -0.02, 0.01]
    const result = computeVolatility({ returns, periodsPerYear: 12 })
    expect(result).toBeGreaterThan(0)
    expect(typeof result).toBe('number')
  })

  test('single return is null', () => {
    expect(computeVolatility({ returns: [0.05] })).toBeNull()
  })

  test('null/empty returns is null', () => {
    expect(computeVolatility({ returns: null })).toBeNull()
    expect(computeVolatility({ returns: [] })).toBeNull()
  })

  test('defaults periodsPerYear to 12', () => {
    const returns = [0.01, 0.02, -0.01, 0.03]
    const explicit = computeVolatility({ returns, periodsPerYear: 12 })
    const defaulted = computeVolatility({ returns })
    expect(explicit).toBe(defaulted)
  })
})

describe('computeMaxDrawdown', () => {
  test('drawdown scenario', () => {
    const series = [
      { ts: 1, value: 100 },
      { ts: 2, value: 120 },
      { ts: 3, value: 90 },
      { ts: 4, value: 110 },
    ]
    const result = computeMaxDrawdown(series)
    expect(result.maxDrawdownPct).toBeCloseTo(25, 0)
    expect(result.peakDate).toBe(2)
    expect(result.troughDate).toBe(3)
  })

  test('monotonic up has no drawdown', () => {
    const series = [
      { ts: 1, value: 100 },
      { ts: 2, value: 110 },
      { ts: 3, value: 120 },
    ]
    const result = computeMaxDrawdown(series)
    expect(result.maxDrawdownPct).toBe(0)
    expect(result.currentDrawdownPct).toBe(0)
  })

  test('flat series has no drawdown', () => {
    const series = [
      { ts: 1, value: 100 },
      { ts: 2, value: 100 },
      { ts: 3, value: 100 },
    ]
    const result = computeMaxDrawdown(series)
    expect(result.maxDrawdownPct).toBe(0)
  })

  test('insufficient data returns zeros', () => {
    expect(computeMaxDrawdown([{ ts: 1, value: 100 }]).maxDrawdownPct).toBe(0)
    expect(computeMaxDrawdown(null).maxDrawdownPct).toBe(0)
  })

  test('current drawdown when series ends below peak', () => {
    const series = [
      { ts: 1, value: 100 },
      { ts: 2, value: 200 },
      { ts: 3, value: 150 },
    ]
    const result = computeMaxDrawdown(series)
    expect(result.currentDrawdownPct).toBeCloseTo(25, 0)
  })
})

describe('computeHHI', () => {
  test('concentrated portfolio', () => {
    const positions = [{ value: 9000 }, { value: 500 }, { value: 500 }]
    const result = computeHHI(positions)
    expect(result.hhi).toBeGreaterThan(2500)
    expect(result.level).toBe('high')
  })

  test('diversified portfolio', () => {
    const positions = Array.from({ length: 20 }, () => ({ value: 500 }))
    const result = computeHHI(positions)
    expect(result.hhi).toBeLessThanOrEqual(1500)
    expect(result.level).toBe('low')
    expect(result.equivalentPositions).toBe(20)
  })

  test('empty portfolio', () => {
    expect(computeHHI([]).hhi).toBe(0)
    expect(computeHHI(null).hhi).toBe(0)
  })

  test('single position is maximally concentrated', () => {
    const result = computeHHI([{ value: 10000 }])
    expect(result.hhi).toBe(10000)
    expect(result.level).toBe('high')
    expect(result.equivalentPositions).toBe(1)
  })

  test('ignores debt items with negative values', () => {
    const positions = [{ value: 5000 }, { value: 3000 }, { value: 2000 }, { value: -4000 }]
    const result = computeHHI(positions)
    expect(result.hhi).toBeGreaterThan(0)
    expect(result.hhi).toBeLessThan(10000)
    const posOnly = computeHHI([{ value: 5000 }, { value: 3000 }, { value: 2000 }])
    expect(result.hhi).toBe(posOnly.hhi)
  })

  test('handles debt nearly equal to assets', () => {
    const positions = [{ value: 10000 }, { value: -9900 }]
    const result = computeHHI(positions)
    expect(result.hhi).toBe(10000)
    expect(result.level).toBe('high')
  })

  test('all negative values returns zero', () => {
    const positions = [{ value: -5000 }, { value: -3000 }]
    const result = computeHHI(positions)
    expect(result.hhi).toBe(0)
    expect(result.level).toBe('low')
  })
})

describe('computeTWRSeries', () => {
  test('multi-period with no flows', () => {
    const chartData = [
      { ts: 1000, value: 100 },
      { ts: 2000, value: 110 },
      { ts: 3000, value: 121 },
    ]
    const series = computeTWRSeries(chartData, [], null, 'USD')
    expect(series).toHaveLength(3)
    expect(series[0]).toBe(0)
    expect(series[1]).toBeCloseTo(10, 0)
    expect(series[2]).toBeCloseTo(21, 0)
  })

  test('adjusts for deposit flow', () => {
    const chartData = [
      { ts: 1000, value: 100 },
      { ts: 3000, value: 210 },
    ]
    const transactions = [
      { date: new Date(2000).toISOString(), type: 'DEPOSIT', totalAmount: 100, currency: 'USD' },
    ]
    const series = computeTWRSeries(chartData, transactions, null, 'USD')
    expect(series[1]).toBeCloseTo(5, 0)
  })

  test('single point returns empty-ish', () => {
    const series = computeTWRSeries([{ ts: 1, value: 100 }], [], null, 'USD')
    expect(series).toEqual([])
  })

  test('null chart data returns empty', () => {
    expect(computeTWRSeries(null, [], null, 'USD')).toEqual([])
  })
})

describe('computeAssetAttribution', () => {
  test('multi-asset attribution', () => {
    const items = [
      { symbol: 'AAPL', quantity: 10, currentPrice: 200, purchasePrice: 150 },
      { symbol: 'GOOG', quantity: 5, currentPrice: 100, purchasePrice: 120 },
    ]
    const result = computeAssetAttribution(items)
    expect(result).toHaveLength(2)
    const aapl = result.find((r) => r.symbol === 'AAPL')
    expect(aapl.gain).toBe(500)
    expect(aapl.value).toBe(2000)
    const goog = result.find((r) => r.symbol === 'GOOG')
    expect(goog.gain).toBe(-100)
  })

  test('weights sum to 100%', () => {
    const items = [
      { symbol: 'A', quantity: 10, currentPrice: 100, purchasePrice: 100 },
      { symbol: 'B', quantity: 20, currentPrice: 50, purchasePrice: 50 },
    ]
    const result = computeAssetAttribution(items)
    const totalWeight = result.reduce((s, r) => s + r.weight, 0)
    expect(totalWeight).toBeCloseTo(100)
  })

  test('empty items', () => {
    expect(computeAssetAttribution([])).toEqual([])
    expect(computeAssetAttribution(null)).toEqual([])
  })

  test('sorted by contribution descending', () => {
    const items = [
      { symbol: 'LOSER', quantity: 10, currentPrice: 50, purchasePrice: 100 },
      { symbol: 'WINNER', quantity: 10, currentPrice: 200, purchasePrice: 100 },
    ]
    const result = computeAssetAttribution(items)
    expect(result[0].symbol).toBe('WINNER')
    expect(result[1].symbol).toBe('LOSER')
  })
})

describe('computeCAGR', () => {
  test('normal growth', () => {
    const result = computeCAGR(10000, 20000, 5)
    expect(result).toBeCloseTo(14.87, 1)
  })

  test('returns 0 for invalid inputs', () => {
    expect(computeCAGR(0, 10000, 5)).toBe(0)
    expect(computeCAGR(10000, 0, 5)).toBe(0)
    expect(computeCAGR(10000, 20000, 0)).toBe(0)
  })

  test('1 year doubling is 100%', () => {
    expect(computeCAGR(1000, 2000, 1)).toBeCloseTo(100)
  })
})

describe('computeBeta', () => {
  test('perfect correlation gives beta ~1', () => {
    const returns = [0.01, 0.02, -0.01, 0.03, 0.01, -0.02]
    const result = computeBeta(returns, returns)
    expect(result).toBeCloseTo(1, 1)
  })

  test('insufficient data returns null', () => {
    expect(computeBeta([0.01, 0.02], [0.01, 0.02])).toBeNull()
    expect(computeBeta(null, [0.01, 0.02, 0.03])).toBeNull()
  })
})

describe('computeNetContributions', () => {
  test('sums deposits and withdrawals', () => {
    const txs = [
      { type: 'DEPOSIT', totalAmount: 1000, currency: 'USD' },
      { type: 'DEPOSIT', totalAmount: 500, currency: 'USD' },
      { type: 'WITHDRAWAL', totalAmount: 200, currency: 'USD' },
    ]
    const result = computeNetContributions(txs, null, 'USD')
    expect(result.totalContributed).toBe(1500)
    expect(result.totalWithdrawn).toBe(200)
    expect(result.netContributions).toBe(1300)
  })

  test('empty transactions', () => {
    const result = computeNetContributions([], null, 'USD')
    expect(result.netContributions).toBe(0)
  })

  test('uses convert function', () => {
    const convert = (amt, from, to) => (from === 'MXN' ? amt / 20 : amt)
    const txs = [
      { type: 'DEPOSIT', totalAmount: 20000, currency: 'MXN' },
    ]
    const result = computeNetContributions(txs, convert, 'USD')
    expect(result.totalContributed).toBe(1000)
  })
})
