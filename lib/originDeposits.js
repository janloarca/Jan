// "¿De dónde vino este dinero?" — asked once, answered once, recorded once.
//
// "Capturar historia" / "Resolver" writes a DEPOSIT the user says is ALREADY
// inside the account's balance: it adds no money, it only records where the
// money came from. That write has no dedupe of its own — a manual transaction
// gets a random nonce in its doc id precisely so two real same-day entries never
// overwrite each other — so pressing it on an account whose origin is already on
// file just files the same origin twice.
//
// It is reachable from three surfaces now (the dashboard card, the review
// wizard, the account editor), all of which show the finding whenever
// `_newMoneyConfirmed` is missing, which is a LIVE read of the transactions. So
// any account whose opening deposit was edited, deduped, or written before that
// flag existed can be asked again, and a well-meant click duplicates it (FASE DP
// called this out; the two extra surfaces made it easier to hit).
//
// The guard is not "never write a second deposit": paying into the same account
// every month is normal and must keep working. It is narrower — refuse only when
// the deposits ON FILE already account for the whole balance, because then there
// is no unexplained money left for this one to explain. That is the same test
// lib/dataCompleteness.js uses to decide whether to ask in the first place, so
// the question and the answer can never disagree.

const DEPOSIT = 'DEPOSIT'
const WITHDRAWAL = 'WITHDRAWAL'

// Balance in the item's OWN currency, matching how dataCompleteness reads it.
function itemBalance(item) {
  if (!item) return 0
  const price = Number(item.currentPrice ?? item.purchasePrice) || 0
  const qty = Number(item.quantity)
  return (Number.isFinite(qty) && qty !== 0 ? qty : 1) * price
}

/**
 * Net money already recorded as flowing INTO this account (deposits minus
 * withdrawals filed against it), in the item's own currency.
 *
 * `convert(amount, from, to)` is optional; without it amounts are taken as-is.
 */
export function recordedOriginTotal(transactions, item, convert) {
  if (!item || !item.id) return 0
  const itemCur = item.currency || item._originalCurrency || 'USD'
  let net = 0
  for (const tx of transactions || []) {
    const ty = (tx.type || '').toUpperCase()
    if (ty !== DEPOSIT && ty !== WITHDRAWAL) continue
    if (tx._linkedItemId !== item.id) continue
    const raw = Number(tx.totalAmount ?? tx.amount ?? 0)
    if (!(raw > 0)) continue
    const cur = tx.currency || itemCur
    const amt = (convert && cur !== itemCur) ? convert(raw, cur, itemCur) : raw
    if (!Number.isFinite(amt)) continue
    net += ty === DEPOSIT ? amt : -amt
  }
  return net
}

/**
 * True when the deposits on file already account for the account's whole
 * balance, so recording the origin again would file the same money twice.
 *
 * A 1% tolerance absorbs the ordinary gap between a deposit and the balance it
 * funded (an entry fee rides inside the opening deposit, interest has accrued
 * since), without swallowing a genuinely unexplained chunk.
 */
export function isOriginFullyRecorded(transactions, item, convert) {
  const balance = itemBalance(item)
  if (!(balance > 0)) return false
  const recorded = recordedOriginTotal(transactions, item, convert)
  return recorded >= balance * 0.99
}
