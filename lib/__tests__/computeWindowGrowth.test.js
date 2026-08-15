// FASE EH. Pins the XOCHI+VITALI regression: a portfolio that already held
// value at the window's start (XOCHI, bought 2024) and then received a NEW
// deposit during the window (VITALI, bought this January) must net the new
// deposit out of both the gain and the return %, not just when the window
// happened to start at exactly $0.
import { computeWindowGrowth } from '@/components/dashboard/utils'

describe('computeWindowGrowth', () => {
  it('the XOCHI+VITALI case: nonzero start, new deposit lands mid-window', () => {
    // firstVal = XOCHI + Fondo Q on Jan 1 ($1,967.45 + $236.09)
    const firstVal = 2203.54
    // lastVal = today's total (VITALI 6,000 + XOCHI 1,967.45 + Fondo Q 314.79 + Fondo $ 240)
    const lastVal = 8522.24
    // contributionLine seeds at firstVal, then adds VITALI's $6,098 opening deposit
    const investedBase = firstVal + 6098
    const entryFeesInScope = 98 // VITALI's entry fee, acquired inside the window
    const { growthPct, displayAbs } = computeWindowGrowth({ firstVal, lastVal, investedBase, entryFeesInScope })
    // Real gain: XOCHI's Feb coupon (78.70) + VITALI's May coupon (240) = 318.70,
    // NOT the raw diff of 6,318.70 (which is what the bug displayed).
    expect(displayAbs).toBeCloseTo(318.70, 1)
    expect(growthPct).toBeCloseTo(3.839, 1)
  })

  it('brand-new account funded partway through the window (old firstVal===0 case unchanged)', () => {
    const firstVal = 0
    const lastVal = 6240
    const investedBase = 6098 // the opening deposit is the only contribution
    const entryFeesInScope = 98
    const { growthPct, displayAbs } = computeWindowGrowth({ firstVal, lastVal, investedBase, entryFeesInScope })
    expect(displayAbs).toBe(240) // 6240 - 6000 principal
    expect(growthPct).toBeCloseTo((240 / 6098) * 100, 9) // the frozen 3.94%
  })

  it('no new capital during the window: raw diff IS the gain (old firstVal>0 case unchanged)', () => {
    const firstVal = 6000
    const lastVal = 6240
    const investedBase = 6000 // contributionLine never moved past its seed
    const { growthPct, displayAbs } = computeWindowGrowth({ firstVal, lastVal, investedBase, entryFeesInScope: 0 })
    expect(displayAbs).toBe(240)
    expect(growthPct).toBeCloseTo(4, 9) // 240 / 6000
  })

  it('no contribution history at all (investedBase null): still just the raw diff', () => {
    const { growthPct, displayAbs } = computeWindowGrowth({ firstVal: 6000, lastVal: 6240, investedBase: null })
    expect(displayAbs).toBe(240)
    expect(growthPct).toBeCloseTo(4, 9)
  })

  it('nothing to divide by: percentage hides instead of lying with 0%', () => {
    const { growthPct } = computeWindowGrowth({ firstVal: 0, lastVal: 0, investedBase: null })
    expect(growthPct).toBeNull()
  })

  it('a same-day deposit with zero gain reads as 0%, never +100%', () => {
    const { growthPct, displayAbs } = computeWindowGrowth({ firstVal: 0, lastVal: 1000, investedBase: 1000, entryFeesInScope: 0 })
    expect(displayAbs).toBe(0)
    expect(growthPct).toBe(0)
  })
})
