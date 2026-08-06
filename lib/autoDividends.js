// Decisions for the automatic income engine (useDashboardData's processDividends),
// pulled out as pure functions because getting them wrong silently doubles money.
//
// The engine creates a DIVIDEND transaction for each scheduled payment and, when
// the income is routed to another account, credits that account's balance. So a
// payment written twice is not a cosmetic duplicate: the destination's stored
// balance goes up twice and STAYS up, and every past month reconstructed from it
// inherits the wrong figure. That is how a semiannual $240 coupon left a cash
// account sitting at $480 from July onward (FASE DH).
//
// The bug was that "did we already pay this?" compared the FULL date. The
// schedule pays on `incomePayDay`, but a coupon the user records by hand carries
// the day it actually landed (the 15th, say). Different strings, so the engine
// saw no payment and wrote its own on the 1st. Both then credited the
// destination. Matching by MONTH is the fix: a month either has been paid or it
// has not, whoever recorded it.

const monthKey = (dateStr) => (dateStr ? String(dateStr).slice(0, 7) : '')

const belongsTo = (tx, item) => {
  if (tx._linkedItemId) return tx._linkedItemId === item.id
  const sym = item.symbol || item.name
  return !!sym && tx.symbol === sym
}

const isDividend = (tx) => (tx.type || '').toUpperCase() === 'DIVIDEND'

/**
 * Has this item already been paid for the month of `dateStr`, by ANY route
 * (the engine, an import, or the user typing it in)? Compared by month, never
 * by exact date: the schedule's pay day and the day the money really landed
 * are routinely different, and treating those as two payments doubles them.
 */
export function hasDividendInMonth(transactions, item, dateStr) {
  const mk = monthKey(dateStr)
  if (!mk || !item) return false
  return (transactions || []).some(
    (tx) => isDividend(tx) && monthKey(tx.date) === mk && belongsTo(tx, item)
  )
}

/**
 * Auto-generated payments that should not exist any more, as transaction ids:
 *  - a month the schedule no longer pays,
 *  - a second auto payment in a month that already has one,
 *  - an auto payment in a month where a REAL (non-auto) dividend exists. The
 *    recorded one is the truth; the fabricated one is the duplicate, so it goes,
 *    never the other way around.
 *
 * `payMonths` is 0-indexed (UTC month numbers), matching the item's incomeMonths.
 * With no explicit schedule the engine cannot know which months pay, so it only
 * keeps the newest auto payment.
 */
export function redundantAutoDividendIds(transactions, item, payMonths, explicitSchedule) {
  const all = (transactions || []).filter((tx) => isDividend(tx) && belongsTo(tx, item))
  const autos = all
    .filter((tx) => tx._source === 'auto' && tx.id)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  if (autos.length === 0) return []

  if (!explicitSchedule) {
    // Unknown schedule: keep only the most recent auto payment.
    return autos.slice(0, -1).map((tx) => tx.id)
  }

  const manualMonths = new Set(
    all.filter((tx) => tx._source !== 'auto' && tx.date).map((tx) => monthKey(tx.date))
  )
  const months = Array.isArray(payMonths) ? payMonths : []
  const keptMonths = new Set()
  const drop = []
  for (const tx of autos) {
    if (!tx.date) { drop.push(tx.id); continue }
    const mk = monthKey(tx.date)
    const monthIndex = Number(mk.slice(5, 7)) - 1
    if (!months.includes(monthIndex) || manualMonths.has(mk) || keptMonths.has(mk)) {
      drop.push(tx.id)
    } else {
      keptMonths.add(mk)
    }
  }
  return drop
}

/**
 * Backfilled payments the destination's balance provably does NOT already
 * contain, so they can be credited after the fact.
 *
 * A backfilled coupon deliberately does not move the destination's balance: the
 * figure the user typed is a photo of TODAY, so a coupon from a month that
 * already closed is assumed to be inside it already. Crediting it again is what
 * left a cash account permanently $240 high (FASE DI), so the payment is written
 * as history and tagged `_destinationCredited:false`.
 *
 * That assumption has one case where it is certainly wrong: a balance of zero.
 * An empty account cannot "already contain" a $240 coupon. The destination
 * created alongside the asset that feeds it (VITALI → Fondo Líquido, opened at
 * 0) hit exactly that: the transaction was on file and visible in the account,
 * but the balance stayed 0, so the spreadsheet reconstructed every month from 0
 * and the coupon existed nowhere in the history (FASE DV).
 *
 * Deliberately narrow — only `balance <= 0`, never "the balance looks too small".
 * A typed balance of 100 against a 240 coupon is genuinely ambiguous (did 140
 * leave, or is the 100 stale?), and guessing there re-opens the double-credit
 * bug this flag exists to prevent. Zero is not ambiguous.
 *
 * Returns the matching transactions (not just ids): the caller needs each
 * amount and currency to credit, and each id to flip the flag afterwards so a
 * later cleanup reverses a credit that now really happened.
 */
export function creditableBackfills(transactions, item, destinationBalance) {
  if (!item || !item.incomeDestination) return []
  if (!(Number(destinationBalance) <= 0)) return []
  return (transactions || []).filter(
    (tx) => tx && tx.id && isDividend(tx) && belongsTo(tx, item)
      && tx._destinationCredited === false
      && Number(tx.totalAmount ?? tx.amount ?? 0) > 0
  )
}
