import { hasDividendInMonth, redundantAutoDividendIds } from '../autoDividends'

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
