/**
 * Tests for formatAxisTick — the range-aware chart Y-axis label formatter.
 *
 * The bug it fixes: a small value range (e.g. $6,000–$6,300) used to collapse
 * every tick to the same rounded "$6.0K" because formatCompact always uses one
 * decimal of "K". formatAxisTick adapts decimals to the gap between ticks so
 * adjacent labels stay distinct.
 */

import { formatAxisTick, setBaseCurrency } from '@/components/dashboard/utils'

beforeAll(() => setBaseCurrency('USD'))

describe('formatAxisTick', () => {
  it('keeps a wide-range K axis at one decimal', () => {
    // 6.7K → 11.6K, step ~1.6K
    expect(formatAxisTick(6700, 1633, 'USD')).toBe('$6.7K')
    expect(formatAxisTick(11600, 1633, 'USD')).toBe('$11.6K')
  })

  it('adds precision so a small range does NOT collapse to identical labels', () => {
    // range 6000..6300, 4 ticks → step 100. One decimal would give 6.0/6.1/6.2/6.3
    const step = 100
    const labels = [6000, 6100, 6200, 6300].map((v) => formatAxisTick(v, step, 'USD'))
    expect(new Set(labels).size).toBe(4) // all distinct
  })

  it('handles a very small range with extra decimals, still distinct', () => {
    // 6000..6051, 4 ticks → step 17
    const step = 17
    const labels = [6000, 6017, 6034, 6051].map((v) => formatAxisTick(v, step, 'USD'))
    expect(new Set(labels).size).toBe(4)
  })

  it('formats millions with adaptive precision', () => {
    expect(formatAxisTick(2_000_000, 500_000, 'USD')).toBe('$2.0M')
    const labels = [2_000_000, 2_100_000, 2_200_000].map((v) => formatAxisTick(v, 100_000, 'USD'))
    expect(new Set(labels).size).toBe(3)
  })

  it('formats sub-thousand values without a K suffix', () => {
    expect(formatAxisTick(500, 100, 'USD')).toBe('$500')
    // A whole-number step keeps integer labels (distinct enough for an axis)
    expect(formatAxisTick(12, 3, 'USD')).toBe('$12')
    // A sub-unit step earns a decimal so ticks stay distinct
    expect(formatAxisTick(12.5, 0.5, 'USD')).toBe('$12.5')
  })

  it('caps decimals at 3 to avoid runaway precision', () => {
    const label = formatAxisTick(6000.123, 0.001, 'USD')
    // 6000 / 1000 = 6.000 → 3 decimals max
    expect(label).toBe('$6.000K')
  })

  it('returns $0 for non-finite input', () => {
    expect(formatAxisTick(NaN, 100, 'USD')).toBe('$0')
    expect(formatAxisTick(null, 100, 'USD')).toBe('$0')
  })
})
