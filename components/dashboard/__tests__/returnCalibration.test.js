import { computeModifiedDietz, solveDietzStartValue } from '../utils'

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
