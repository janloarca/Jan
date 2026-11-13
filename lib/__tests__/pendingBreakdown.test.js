import { pendingBreakdown, countPending } from '../suggestionDismissals'

describe('pendingBreakdown (FASE RY)', () => {
  it('agrupa por tipo, ignora descartados y suma igual que countPending', () => {
    const findings = [
      { id: 'a', code: 'no-country' }, { id: 'b', code: 'no-country' },
      { id: 'c', code: 'no-acq-date' }, { id: 'd', code: 'no-country' },
    ]
    const dismissed = new Set(['d'])
    const g = pendingBreakdown(findings, dismissed, 'es')
    expect(g[0]).toEqual({ label: 'sin país', n: 2 })
    expect(g.reduce((s, x) => s + x.n, 0)).toBe(countPending(findings, dismissed))
  })
})
