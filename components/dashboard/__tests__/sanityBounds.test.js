import {
  computeSharpeRatio,
  computeVolatility,
  computeBeta,
  computePeriodicReturns,
} from '../analytics'
import { computeModifiedDietz, getEffectiveYield } from '../utils'

describe('sanity bounds — volatility', () => {
  test('returns null when annualized vol exceeds 500%', () => {
    const extreme = [2, -1.5, 3, -2, 2.5, -1.8]
    const result = computeVolatility({ returns: extreme, periodsPerYear: 12 })
    expect(result).toBeNull()
  })

  test('normal volatility passes through', () => {
    const normal = [0.01, -0.005, 0.02, -0.01, 0.015]
    const result = computeVolatility({ returns: normal, periodsPerYear: 12 })
    expect(result).not.toBeNull()
    expect(result).toBeLessThan(500)
  })
})

describe('sanity bounds — beta', () => {
  test('returns null when |beta| > 10', () => {
    const portfolio = [0.5, -0.4, 0.6, -0.5, 0.7]
    const benchmark = [0.001, -0.001, 0.001, -0.001, 0.001]
    const result = computeBeta(portfolio, benchmark)
    expect(result).toBeNull()
  })

  test('reasonable beta passes through', () => {
    const p = [0.02, 0.01, -0.01, 0.03, -0.02, 0.01]
    const b = [0.01, 0.005, -0.005, 0.015, -0.01, 0.005]
    const result = computeBeta(p, b)
    expect(result).not.toBeNull()
    expect(Math.abs(result)).toBeLessThanOrEqual(10)
  })
})

describe('sanity bounds — sharpe', () => {
  test('clamps extreme sharpe to ±10', () => {
    const returns = [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.0011, 0.001, 0.001]
    const result = computeSharpeRatio({ returns, riskFreeRate: 0 })
    if (result.sharpe !== null) {
      expect(result.sharpe).toBeLessThanOrEqual(10)
      expect(result.sharpe).toBeGreaterThanOrEqual(-10)
    }
  })
})

describe('sanity bounds — computeModifiedDietz', () => {
  const day = 86400000

  test('returns 0 pct when result is Infinity', () => {
    const result = computeModifiedDietz({
      startValue: 100,
      endValue: 5000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(1 * day).toISOString(), type: 'WITHDRAWAL', totalAmount: 100, currency: 'USD' },
      ],
    })
    expect(isFinite(result.pct)).toBe(true)
  })

  test('handles near-zero weighted capital gracefully', () => {
    const result = computeModifiedDietz({
      startValue: 1000,
      endValue: 500,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(29 * day).toISOString(), type: 'WITHDRAWAL', totalAmount: 999, currency: 'USD' },
      ],
    })
    expect(isFinite(result.pct)).toBe(true)
  })
})

describe('sanity bounds — computePeriodicReturns', () => {
  test('filters out deposit-driven jumps > 100%', () => {
    const snapshots = [
      { date: '2026-01-01', netWorthUSD: 1000 },
      { date: '2026-02-01', netWorthUSD: 5000 },
      { date: '2026-03-01', netWorthUSD: 5200 },
    ]
    const returns = computePeriodicReturns(snapshots)
    expect(returns.length).toBeLessThanOrEqual(2)
    returns.forEach(r => {
      expect(Math.abs(r)).toBeLessThan(1)
    })
  })

  test('keeps normal returns', () => {
    const snapshots = [
      { date: '2026-01-01', netWorthUSD: 10000 },
      { date: '2026-02-01', netWorthUSD: 10500 },
      { date: '2026-03-01', netWorthUSD: 10300 },
      { date: '2026-04-01', netWorthUSD: 10800 },
    ]
    const returns = computePeriodicReturns(snapshots)
    expect(returns).toHaveLength(3)
  })
})

describe('sanity bounds — getEffectiveYield', () => {
  test('returns null for empty incomeMonths array', () => {
    const result = getEffectiveYield({
      incomeAmount: 100,
      incomeMonths: [],
      purchasePrice: 10000,
      quantity: 1,
    })
    expect(result).toBeNull()
  })

  test('returns null when cost is 0', () => {
    const result = getEffectiveYield({
      incomeAmount: 100,
      incomeMonths: [0, 6],
      purchasePrice: 0,
      quantity: 1,
    })
    expect(result).toBeNull()
  })
})
