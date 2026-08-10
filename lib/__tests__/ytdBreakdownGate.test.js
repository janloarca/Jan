import { breakdownReconciles } from '../ytdBreakdownGate'

describe('breakdownReconciles', () => {
  test('rejects the real case that shipped: parts claim 15x the headline', () => {
    // Exactly what the user was shown: the panel summed +$12,835.82 (IBKR alone
    // +$13,207.59) while the YTD headline above it read +$835.36.
    expect(breakdownReconciles(12835.82, 835.36)).toBe(false)
  })

  test('accepts an exact match', () => {
    expect(breakdownReconciles(835.36, 835.36)).toBe(true)
  })

  test('accepts normal drift between the two reconstruction paths', () => {
    // 5% off: the two engines rarely agree to the cent, and that is fine.
    expect(breakdownReconciles(877.13, 835.36)).toBe(true)
  })

  test('rejects once the drift stops being drift', () => {
    // 20% off on a $835 headline is $167 the panel cannot account for.
    expect(breakdownReconciles(1002.43, 835.36)).toBe(false)
  })

  test('near-zero headline still gets a workable absolute window', () => {
    // A proportional-only tolerance would be ~$0.12 here and would suppress the
    // panel over rounding noise.
    expect(breakdownReconciles(3.4, 1.2)).toBe(true)
    expect(breakdownReconciles(60, 1.2)).toBe(false)
  })

  test('works the same for losses', () => {
    expect(breakdownReconciles(-820, -835.36)).toBe(true)
    expect(breakdownReconciles(820, -835.36)).toBe(false)
  })

  test('no headline to contradict means nothing to gate', () => {
    expect(breakdownReconciles(1234, null)).toBe(true)
    expect(breakdownReconciles(1234, undefined)).toBe(true)
    expect(breakdownReconciles(1234, NaN)).toBe(true)
  })

  test('a non-finite total can never be shown', () => {
    expect(breakdownReconciles(NaN, 835.36)).toBe(false)
    expect(breakdownReconciles(Infinity, 835.36)).toBe(false)
    expect(breakdownReconciles(null, 835.36)).toBe(false)
  })
})
