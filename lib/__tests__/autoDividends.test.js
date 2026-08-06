import { hasDividendInMonth, redundantAutoDividendIds, creditableBackfills, creditDestinationBalance, dividendCreditTarget } from '../autoDividends'

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

// FASE EL: a real bug where a SECOND bond sharing one destination erased the
// first bond's credit. addToDestination used to recompute "old balance" from
// the destination object it was handed, which is a snapshot taken once before
// processDividends starts writing — so a second call for the SAME destination,
// from a DIFFERENT source item, didn't know about the first call's write and
// overwrote it instead of adding to it.
describe('creditDestinationBalance', () => {
  const fondoQ = { id: 'fondoQ', currency: 'USD', quantity: 1, purchasePrice: 236.09, currentPrice: 236.09 }

  it('seeds from the destination\'s own balance on the first call', () => {
    const running = {}
    const { newBalance, newPrice } = creditDestinationBalance(running, fondoQ, 78.70, 'USD', null)
    expect(newBalance).toBeCloseTo(314.79, 2)
    expect(newPrice).toBeCloseTo(314.79, 2)
    expect(running.fondoQ).toBeCloseTo(314.79, 2)
  })

  // The exact XOCHI + CrediCorp regression: two DIFFERENT items credit the
  // SAME destination, each passing their OWN (stale, pre-run) copy of `dest`.
  // The second call must build on the first call's result, not the stale
  // dest.purchasePrice baked into the object either item was handed.
  it('a second item crediting the SAME destination builds on the first credit, never overwrites it', () => {
    const running = {}
    // XOCHI's payment lands first.
    creditDestinationBalance(running, fondoQ, 78.70, 'USD', null)
    // CrediCorp's own `dest` reference is the SAME stale snapshot (purchasePrice
    // still reads 236.09, as it did before XOCHI's credit landed in Firestore).
    const staleDestSeenByCredicorp = { ...fondoQ }
    const { newBalance } = creditDestinationBalance(running, staleDestSeenByCredicorp, 41.67, 'USD', null)
    // Must be 236.09 + 78.70 + 41.67, NOT 236.09 + 41.67 (which is what the old
    // per-call "oldBalance = dest.purchasePrice" bug produced — it silently
    // erased XOCHI's 78.70).
    expect(newBalance).toBeCloseTo(356.46, 2)
  })

  it('a reversal (negative amount) also builds on the running total, not a stale seed', () => {
    const running = {}
    creditDestinationBalance(running, fondoQ, 78.70, 'USD', null) // XOCHI credits
    creditDestinationBalance(running, fondoQ, 41.67, 'USD', null) // CrediCorp credits
    const { newBalance } = creditDestinationBalance(running, fondoQ, -41.67, 'USD', null) // reverse CrediCorp's bad one
    expect(newBalance).toBeCloseTo(314.79, 2) // back to exactly XOCHI's total
  })

  it('converts through the destination\'s own currency', () => {
    const fondoGTQ = { id: 'fondoQ2', currency: 'GTQ', quantity: 1, purchasePrice: 0 }
    const convert = (amt, from, to) => (from === 'USD' && to === 'GTQ' ? amt * 7.6 : amt)
    const running = {}
    const { newBalance } = creditDestinationBalance(running, fondoGTQ, 10, 'USD', convert)
    expect(newBalance).toBeCloseTo(76, 5)
  })

  it('different destinations never share a running balance', () => {
    const other = { id: 'fondoUSD', currency: 'USD', quantity: 1, purchasePrice: 0 }
    const running = {}
    creditDestinationBalance(running, fondoQ, 78.70, 'USD', null)
    creditDestinationBalance(running, other, 240, 'USD', null)
    expect(running.fondoQ).toBeCloseTo(314.79, 2)
    expect(running.fondoUSD).toBeCloseTo(240, 2)
  })
})

// FASE EP. A coupon the user wrongly marked as paid (or one whose amount was
// off) used to be un-deletable/un-editable without corrupting the destination
// account's balance: EditAccountModal's per-row delete/edit just touched the
// transaction doc, with no idea the payment had already moved money into
// another account. dividendCreditTarget is the lookup the manual delete/edit
// paths use to find out whether — and where — to reverse that credit.
describe('dividendCreditTarget', () => {
  const credicorp = { id: 'credicorp', symbol: 'CREDICORP', incomeDestination: 'fondo' }
  const fondo = { id: 'fondo', symbol: 'IDC-CASH', type: 'bank', currency: 'USD', quantity: 1, purchasePrice: 240, currentPrice: 240 }
  const items = [credicorp, fondo]

  it('a normal cash-destined coupon has a reversal target', () => {
    const tx = { type: 'DIVIDEND', totalAmount: 45, currency: 'USD', _linkedItemId: 'credicorp' }
    const target = dividendCreditTarget(tx, items)
    expect(target.dest.id).toBe('fondo')
    expect(target.currency).toBe('USD')
  })

  it('not a DIVIDEND: nothing to reverse', () => {
    const tx = { type: 'DEPOSIT', totalAmount: 45, _linkedItemId: 'credicorp' }
    expect(dividendCreditTarget(tx, items)).toBeNull()
  })

  it('reinvested: never touched a destination balance, touched quantity/lots instead', () => {
    const tx = { type: 'DIVIDEND', totalAmount: 45, _linkedItemId: 'credicorp', _reinvested: true }
    expect(dividendCreditTarget(tx, items)).toBeNull()
  })

  // The exact case CLAUDE.md documents (FASE DV/DI): a backfilled coupon on a
  // non-empty destination is written as history WITHOUT crediting the balance
  // (the balance the user typed already contains it) — _destinationCredited
  // says so explicitly, and there is nothing to reverse.
  it('backfilled and never credited: nothing to reverse', () => {
    const tx = { type: 'DIVIDEND', totalAmount: 45, _linkedItemId: 'credicorp', _destinationCredited: false }
    expect(dividendCreditTarget(tx, items)).toBeNull()
  })

  it('no incomeDestination on the source item: nothing to reverse', () => {
    const lonely = { id: 'lonely' }
    const tx = { type: 'DIVIDEND', totalAmount: 45, _linkedItemId: 'lonely' }
    expect(dividendCreditTarget(tx, [lonely])).toBeNull()
  })

  it('a destination with its own market price (stock/crypto/fund) is skipped, same as the engine itself', () => {
    const bro = { id: 'bro2', incomeDestination: 'brokerage' }
    const brokerage = { id: 'brokerage', type: 'Stock', currency: 'USD', quantity: 1, purchasePrice: 100 }
    const tx = { type: 'DIVIDEND', totalAmount: 45, _linkedItemId: 'bro2' }
    expect(dividendCreditTarget(tx, [bro, brokerage])).toBeNull()
  })

  // The end-to-end shape: delete the transaction AND reverse the credit, using
  // the SAME creditDestinationBalance math the automatic engine uses.
  it('composes with creditDestinationBalance to reverse the exact amount credited', () => {
    const tx = { type: 'DIVIDEND', totalAmount: 45, currency: 'USD', _linkedItemId: 'credicorp' }
    const target = dividendCreditTarget(tx, items)
    const { newPrice } = creditDestinationBalance({}, target.dest, -tx.totalAmount, target.currency, null)
    expect(newPrice).toBeCloseTo(195, 2) // 240 - 45, back to before the mistaken coupon
  })
})
