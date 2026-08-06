import { hasDividendInMonth, redundantAutoDividendIds, creditableBackfills } from '../autoDividends'

const vitali = { id: 'vitali', symbol: 'VITALI', name: 'Vitali' }
const MAY = [4, 11] // May + December, 0-indexed like incomeMonths

describe('hasDividendInMonth', () => {
  it('matches a payment recorded on a different day of the same month', () => {
    // The exact bug: schedule pays on the 1st, the user recorded the 15th.
    const txs = [{ type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, _linkedItemId: 'vitali' }]
    expect(hasDividendInMonth(txs, vitali, '2026-05-01')).toBe(true)
  })

  it('does not match a different month or year', () => {
    const txs = [{ type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, _linkedItemId: 'vitali' }]
    expect(hasDividendInMonth(txs, vitali, '2026-12-01')).toBe(false)
    expect(hasDividendInMonth(txs, vitali, '2027-05-01')).toBe(false)
  })

  it('falls back to the symbol when the transaction has no link', () => {
    const txs = [{ type: 'DIVIDEND', date: '2026-05-15', symbol: 'VITALI' }]
    expect(hasDividendInMonth(txs, vitali, '2026-05-01')).toBe(true)
  })

  it('ignores another item\'s dividend', () => {
    const txs = [{ type: 'DIVIDEND', date: '2026-05-15', _linkedItemId: 'other' }]
    expect(hasDividendInMonth(txs, vitali, '2026-05-01')).toBe(false)
  })
})

describe('redundantAutoDividendIds', () => {
  it('drops the fabricated payment when the real one is already recorded', () => {
    const txs = [
      { id: 'manual', type: 'DIVIDEND', date: '2026-05-15', _linkedItemId: 'vitali' },
      { id: 'auto', type: 'DIVIDEND', date: '2026-05-01', _linkedItemId: 'vitali', _source: 'auto' },
    ]
    expect(redundantAutoDividendIds(txs, vitali, MAY, true)).toEqual(['auto'])
  })

  it('keeps a lone auto payment in a scheduled month', () => {
    const txs = [{ id: 'auto', type: 'DIVIDEND', date: '2026-05-01', _linkedItemId: 'vitali', _source: 'auto' }]
    expect(redundantAutoDividendIds(txs, vitali, MAY, true)).toEqual([])
  })

  it('drops a payment in a month the schedule no longer pays', () => {
    const txs = [{ id: 'auto', type: 'DIVIDEND', date: '2026-07-01', _linkedItemId: 'vitali', _source: 'auto' }]
    expect(redundantAutoDividendIds(txs, vitali, MAY, true)).toEqual(['auto'])
  })

  it('keeps one auto payment per scheduled month', () => {
    const txs = [
      { id: 'a1', type: 'DIVIDEND', date: '2026-05-01', _linkedItemId: 'vitali', _source: 'auto' },
      { id: 'a2', type: 'DIVIDEND', date: '2026-05-20', _linkedItemId: 'vitali', _source: 'auto' },
      { id: 'a3', type: 'DIVIDEND', date: '2026-12-01', _linkedItemId: 'vitali', _source: 'auto' },
    ]
    expect(redundantAutoDividendIds(txs, vitali, MAY, true)).toEqual(['a2'])
  })

  it('without an explicit schedule keeps only the newest auto payment', () => {
    const txs = [
      { id: 'a1', type: 'DIVIDEND', date: '2026-03-01', _linkedItemId: 'vitali', _source: 'auto' },
      { id: 'a2', type: 'DIVIDEND', date: '2026-06-01', _linkedItemId: 'vitali', _source: 'auto' },
    ]
    expect(redundantAutoDividendIds(txs, vitali, null, false)).toEqual(['a1'])
  })

  it('never deletes a payment the user recorded', () => {
    const txs = [
      { id: 'm1', type: 'DIVIDEND', date: '2026-07-15', _linkedItemId: 'vitali' },
      { id: 'm2', type: 'DIVIDEND', date: '2026-07-20', _linkedItemId: 'vitali' },
    ]
    expect(redundantAutoDividendIds(txs, vitali, MAY, true)).toEqual([])
  })
})

// FASE DV: a backfilled coupon deliberately skips crediting its destination
// (the typed balance is a photo of today and is assumed to already contain it).
// An EMPTY destination cannot contain anything, which is how a real $240 coupon
// ended up on file while Fondo Líquido stayed at 0 and the spreadsheet showed
// nothing in May.
describe('creditableBackfills', () => {
  const withDest = { ...vitali, incomeDestination: 'fondo' }
  const backfill = { id: 'b1', type: 'DIVIDEND', date: '2026-05-15', _linkedItemId: 'vitali', _source: 'auto', totalAmount: 240, currency: 'USD', _destinationCredited: false }

  it('credits an uncredited backfill when the destination sits at zero', () => {
    expect(creditableBackfills([backfill], withDest, 0).map((t) => t.id)).toEqual(['b1'])
  })

  it('leaves it alone once the destination holds anything at all', () => {
    // The FASE DI case: a real typed balance genuinely may already contain it,
    // and guessing there is what double-credited the account in the first place.
    expect(creditableBackfills([backfill], withDest, 240)).toEqual([])
    expect(creditableBackfills([backfill], withDest, 0.01)).toEqual([])
  })

  it('is idempotent: nothing left to credit once the flag flipped', () => {
    const credited = { ...backfill, _destinationCredited: true }
    expect(creditableBackfills([credited], withDest, 0)).toEqual([])
  })

  it('ignores payments that were never marked uncredited', () => {
    // No flag at all = an older payment that WAS credited (see queueReversal).
    const { _destinationCredited, ...noFlag } = backfill
    expect(creditableBackfills([noFlag], withDest, 0)).toEqual([])
  })

  it('does nothing for an item with no income destination', () => {
    expect(creditableBackfills([backfill], vitali, 0)).toEqual([])
  })

  it('only picks up this item\'s own payments', () => {
    const other = { ...backfill, id: 'b2', _linkedItemId: 'otro' }
    expect(creditableBackfills([backfill, other], withDest, 0).map((t) => t.id)).toEqual(['b1'])
  })

  it('skips a zero or negative amount', () => {
    const zero = { ...backfill, totalAmount: 0 }
    expect(creditableBackfills([zero], withDest, 0)).toEqual([])
  })
})
