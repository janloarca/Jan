import { recordedOriginTotal, isOriginFullyRecorded } from '../originDeposits'

const bond = { id: 'vitali', name: 'Vitali', currency: 'USD', quantity: 1, currentPrice: 6000 }
const opening = { id: 'd1', type: 'DEPOSIT', date: '2026-01-06', totalAmount: 6098, currency: 'USD', _linkedItemId: 'vitali' }

describe('recordedOriginTotal', () => {
  it('adds up the deposits filed against the account', () => {
    expect(recordedOriginTotal([opening], bond, null)).toBe(6098)
  })

  it('nets withdrawals back out', () => {
    const out = { id: 'w1', type: 'WITHDRAWAL', date: '2026-02-01', totalAmount: 98, currency: 'USD', _linkedItemId: 'vitali' }
    expect(recordedOriginTotal([opening, out], bond, null)).toBe(6000)
  })

  it('ignores movements of a different account', () => {
    const other = { ...opening, id: 'd2', _linkedItemId: 'otra' }
    expect(recordedOriginTotal([other], bond, null)).toBe(0)
  })

  it('ignores dividends and transfers (not origin capital)', () => {
    const div = { id: 'v1', type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD', _linkedItemId: 'vitali' }
    const tr = { id: 'v2', type: 'TRANSFER', date: '2026-05-15', totalAmount: 500, currency: 'USD', _linkedItemId: 'vitali' }
    expect(recordedOriginTotal([div, tr], bond, null)).toBe(0)
  })

  it('converts a deposit booked in another currency', () => {
    const gtq = { ...opening, totalAmount: 46000, currency: 'GTQ' }
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD' ? amt / 7.7 : amt)
    expect(recordedOriginTotal([gtq], bond, convert)).toBeCloseTo(5974, 0)
  })
})

// FASE DZ: this is the guard that stops "Capturar historia" / "Resolver" from
// filing the same origin twice. It must never block a REAL second contribution.
describe('isOriginFullyRecorded', () => {
  it('is true when the deposits on file already cover the balance', () => {
    expect(isOriginFullyRecorded([opening], bond, null)).toBe(true)
  })

  it('is false when part of the balance has no deposit explaining it', () => {
    const partial = { ...opening, totalAmount: 3000 }
    expect(isOriginFullyRecorded([partial], bond, null)).toBe(false)
  })

  it('is false with no movements at all (the case the question exists for)', () => {
    expect(isOriginFullyRecorded([], bond, null)).toBe(false)
  })

  it('tolerates the entry fee riding inside the opening deposit', () => {
    // 6,098 deposited, 6,000 of asset: still fully explained.
    expect(isOriginFullyRecorded([opening], bond, null)).toBe(true)
    // And the mirror case, a deposit a hair under the balance (accrued interest).
    const nearly = { ...opening, totalAmount: 5995 }
    expect(isOriginFullyRecorded([nearly], bond, null)).toBe(true)
  })

  it('still asks when a monthly contribution left real unexplained balance', () => {
    const savings = { id: 'acc', currency: 'USD', quantity: 1, currentPrice: 10000 }
    const one = { id: 'd', type: 'DEPOSIT', date: '2026-03-01', totalAmount: 3000, currency: 'USD', _linkedItemId: 'acc' }
    expect(isOriginFullyRecorded([one], savings, null)).toBe(false)
  })

  it('is false for an empty account (nothing to double-file)', () => {
    const empty = { id: 'e', currency: 'USD', quantity: 1, currentPrice: 0 }
    expect(isOriginFullyRecorded([], empty, null)).toBe(false)
  })
})
