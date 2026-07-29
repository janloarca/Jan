import { computeCosts } from '../costsSummary'

// convert: pretend 1 USD = 8 GTQ so currency handling is observable.
const convert = (amount, from, to) => {
  if (from === to) return amount
  const rate = { USD: 1, GTQ: 1 / 8 } // to USD
  const inUsd = amount * (rate[from] ?? 1)
  const out = inUsd / (rate[to] ?? 1)
  return out
}

describe('computeCosts', () => {
  const txs = [
    { type: 'BUY', symbol: 'AAPL', date: '2026-01-10', commission: 1.5, currency: 'USD', totalAmount: 500 },
    { type: 'SELL', symbol: 'AAPL', date: '2026-02-10', commission: 2, currency: 'USD', totalAmount: 600 },
    { type: 'FEE', symbol: 'CASH', date: '2026-02-15', totalAmount: 10, currency: 'USD', _signedAmount: -10 },
    { type: 'TAX', symbol: 'MSFT', date: '2026-03-01', totalAmount: 3.75, currency: 'USD' },
    { type: 'INTEREST', symbol: 'CASH', date: '2026-03-05', totalAmount: 4, currency: 'USD', _signedAmount: -4 }, // paid
    { type: 'INTEREST', symbol: 'CASH', date: '2026-03-06', totalAmount: 9, currency: 'USD', _signedAmount: 9 }, // received
    { type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-01', totalAmount: 1000, currency: 'USD' }, // ignored
    { type: 'DIVIDEND', symbol: 'AAPL', date: '2026-02-20', totalAmount: 5, currency: 'USD' }, // ignored
  ]

  it('sums commissions, fees, taxes and interest paid into totalCost; interest received is separate', () => {
    const r = computeCosts({ transactions: txs, convert, baseCurrency: 'USD' })
    expect(r.commissions).toBeCloseTo(3.5) // 1.5 + 2
    expect(r.fees).toBeCloseTo(10)
    expect(r.taxes).toBeCloseTo(3.75)
    expect(r.interestPaid).toBeCloseTo(4)
    expect(r.interestReceived).toBeCloseTo(9)
    expect(r.totalCost).toBeCloseTo(3.5 + 10 + 3.75 + 4) // 21.25, received NOT netted
  })

  it('ignores deposits, withdrawals and dividends', () => {
    const r = computeCosts({ transactions: txs, convert, baseCurrency: 'USD' })
    // 2 commissions + 1 fee + 1 tax + 2 interest = 6 cost rows
    expect(r.count).toBe(6)
  })

  it('groups by month and by symbol', () => {
    const r = computeCosts({ transactions: txs, convert, baseCurrency: 'USD' })
    expect(r.byMonth['2026-01'].commissions).toBeCloseTo(1.5)
    expect(r.byMonth['2026-02'].total).toBeCloseTo(2 + 10) // SELL comm + fee
    expect(r.months[0]).toBe('2026-03') // sorted desc
    const aapl = r.bySymbol.find((s) => s.symbol === 'AAPL')
    expect(aapl.amount).toBeCloseTo(3.5)
  })

  it('converts foreign-currency costs to base with an isFinite fallback', () => {
    const gtq = [{ type: 'FEE', symbol: 'CASH', date: '2026-01-05', totalAmount: 80, currency: 'GTQ' }]
    const r = computeCosts({ transactions: gtq, convert, baseCurrency: 'USD' })
    expect(r.fees).toBeCloseTo(10) // 80 GTQ / 8 = 10 USD
    // No convert fn -> raw amount, never NaN
    const raw = computeCosts({ transactions: gtq, baseCurrency: 'USD' })
    expect(raw.fees).toBeCloseTo(80)
  })

  it('filters by year when requested', () => {
    const multi = [
      { type: 'BUY', symbol: 'A', date: '2025-06-01', commission: 5, currency: 'USD' },
      { type: 'BUY', symbol: 'A', date: '2026-06-01', commission: 7, currency: 'USD' },
    ]
    const r = computeCosts({ transactions: multi, convert, baseCurrency: 'USD', year: 2026 })
    expect(r.commissions).toBeCloseTo(7)
    expect(r.count).toBe(1)
  })

  it('returns empty state for no cost rows', () => {
    const r = computeCosts({ transactions: [{ type: 'DEPOSIT', date: '2026-01-01', totalAmount: 100 }], convert })
    expect(r.hasData).toBe(false)
    expect(r.totalCost).toBe(0)
  })
})
