import { getScheduledPayDates, estimateIncomeAmount } from '../incomeSchedule'

describe('getScheduledPayDates', () => {
  it('returns past pay dates that already fell due since acquisition', () => {
    // Bought in January, pays May + December, "today" is August: only May
    // has fallen due.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-15', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-05-15'])
  })

  it('excludes the current month if the pay day has not arrived yet', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 20, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('includes the current month once the pay day has passed', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-08-01'])
  })

  it('never returns dates before acquisition', () => {
    // Bought in June; the only configured months (Jan-Apr) are all before
    // acquisition, so none of them ever fell due for this holder.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-06-01', incomeMonths: [0, 1, 2, 3], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing for continuous compounding (no discrete pay dates)', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [], incomePayDay: 1, rateType: 'continuous' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing when the acquisition date is in the future', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2027-01-01', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('handles a missing/invalid acquisition date without throwing', () => {
    expect(() => getScheduledPayDates(
      { acquisitionDate: '', incomeMonths: [4], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )).not.toThrow()
  })
})

describe('estimateIncomeAmount', () => {
  it('computes a percent-of-balance payment split across pay months', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'percent', incomeRate: 8 }, 2)
    expect(amt).toBeCloseTo(400) // 10000 * 8% / 2 payments
  })

  it('computes a fixed per-payment amount regardless of balance', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'fixed', incomeAmount: 50 })
    expect(amt).toBe(50)
  })

  it('multiplies fixed amount by quantity for per-share assets', () => {
    const amt = estimateIncomeAmount({ incomeMode: 'fixed', incomeAmount: 2, isPerShare: true, qty: 10 })
    expect(amt).toBe(20)
  })

  it('averages a variable rate range', () => {
    const amt = estimateIncomeAmount({ balance: 10000, rateType: 'variable', rateMin: 4, rateMax: 6 }, 12)
    expect(amt).toBeCloseTo((10000 * 0.05) / 12)
  })

  it('returns 0 when nothing is configured', () => {
    expect(estimateIncomeAmount({ balance: 10000 })).toBe(0)
  })
})
