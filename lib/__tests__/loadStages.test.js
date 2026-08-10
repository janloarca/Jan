import { computeLoadStages } from '@/lib/loadStages'

// Reload-animation-improvements plan, Fase 2. Pins the fix for the header
// refresh ring's permanent 33% floor on every refresh after the very first
// page load (dataLoading never re-arms once it resolves, so counting it as
// "1 of 3 stages" forever was fake progress).
describe('computeLoadStages', () => {
  it('counts every stage during the very first load, nothing resolved yet', () => {
    expect(computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true }))
      .toEqual({ done: 0, total: 3 })
  })

  it('with a benchmark stage, the very first load is 4 stages wide', () => {
    expect(computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }))
      .toEqual({ done: 0, total: 4 })
  })

  it('the first load resolves stage by stage without ever going backward', () => {
    const steps = [
      computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: false }),
    ]
    const pct = ({ done, total }) => Math.round((done / total) * 100)
    expect(steps.map(pct)).toEqual([0, 0, 33, 67, 100])
  })

  it('after the first load, a resolved dataLoading is never counted again — no artificial floor', () => {
    // Old inline expression ([!dataLoading, !ratesLoading, !pricesLoading].filter(Boolean).length / 3)
    // would report 1/3 (33%) here purely because dataLoading is permanently
    // false post-mount, even though nothing real has resolved yet.
    expect(computeLoadStages({ dataLoading: false, ratesLoading: true, pricesLoading: true }))
      .toEqual({ done: 0, total: 2 })
  })

  it('a later refresh still reaches a genuine 100%', () => {
    expect(computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false }))
      .toEqual({ done: 2, total: 2 })
  })

  it('benchmarkLoading omitted entirely does not count as a stage (pre-Fase-3 callers)', () => {
    expect(computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: true }))
      .toEqual({ done: 1, total: 2 })
  })

  // The core correctness claim: dropping an already-resolved stage from the
  // denominator can only raise or hold the percentage, never lower it —
  // checked across every combination of what else is still in flight at the
  // exact moment dataLoading flips from true to false.
  it('the dataLoading true→false transition is monotonic non-decreasing for any state of the other stages', () => {
    const others = [
      { ratesLoading: true, pricesLoading: true, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: true, benchmarkLoading: true },
      { ratesLoading: true, pricesLoading: false, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: false, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: false, benchmarkLoading: false },
      { ratesLoading: true, pricesLoading: true },
    ]
    for (const rest of others) {
      const before = computeLoadStages({ dataLoading: true, ...rest })
      const after = computeLoadStages({ dataLoading: false, ...rest })
      const pct = ({ done, total }) => done / total
      expect(pct(after)).toBeGreaterThanOrEqual(pct(before))
    }
  })

  it('called with nothing, defaults to "nothing loading" rather than throwing', () => {
    expect(computeLoadStages()).toEqual({ done: 2, total: 2 })
  })
})
