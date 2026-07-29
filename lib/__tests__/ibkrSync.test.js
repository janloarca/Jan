// authFetch pulls in the firebase client SDK; stub it so we can import the pure
// cashTxToTransaction helper without a browser/firebase environment.
jest.mock('../authFetch', () => ({ authFetch: jest.fn(), safeJson: jest.fn() }))

import { cashTxToTransaction } from '../ibkrSync'

describe('cashTxToTransaction', () => {
  it('maps a positive amount to a DEPOSIT with the canonical shape', () => {
    const tx = cashTxToTransaction({ amount: 1500, currency: 'USD', date: '2026-03-01', txnId: 'T1', description: 'Wire in', accountId: 'U123' })
    expect(tx).toMatchObject({
      type: 'DEPOSIT',
      symbol: 'CASH',
      date: '2026-03-01',
      quantity: 1,
      pricePerUnit: 1500,
      totalAmount: 1500,
      commission: 0,
      currency: 'USD',
      _ibkrAccountId: 'U123',
      _ibkrTxnId: 'T1',
      _source: 'ibkr',
      description: 'Wire in',
    })
  })

  it('maps a negative amount to a WITHDRAWAL with a positive totalAmount', () => {
    const tx = cashTxToTransaction({ amount: -800, currency: 'EUR', date: '2026-03-05', txnId: 'T2' })
    expect(tx.type).toBe('WITHDRAWAL')
    expect(tx.totalAmount).toBe(800)
    expect(tx.pricePerUnit).toBe(800)
    expect(tx.currency).toBe('EUR')
  })

  it('preserves the real currency (not hardcoded USD) and defaults sensibly', () => {
    expect(cashTxToTransaction({ amount: 10, currency: 'GBP', date: '2026-01-01' }).currency).toBe('GBP')
    const bare = cashTxToTransaction({ amount: 10, date: '2026-01-01' })
    expect(bare.currency).toBe('USD')
    expect(bare.description).toBe('Deposit')
    expect(bare._ibkrTxnId).toBe('')
  })

  it('produces a Dietz-consumable flow shape (type + totalAmount + currency + date)', () => {
    const tx = cashTxToTransaction({ amount: 250.5, currency: 'USD', date: '2026-02-14' })
    expect(['DEPOSIT', 'WITHDRAWAL']).toContain(tx.type)
    expect(typeof tx.totalAmount).toBe('number')
    expect(tx.totalAmount).toBeGreaterThan(0)
    expect(tx.date).toBe('2026-02-14')
  })
})
