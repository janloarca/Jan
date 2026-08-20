// Which way the money went, in one place.
//
// A transaction's `type` alone stopped answering that question once a refund
// became an EXPENSE with a NEGATIVE amount (see buildTx in
// lib/parsers/guateCardStatements.js: a refund reverses a purchase, so it
// belongs to the merchant's category as negative spend rather than to income).
//
// Every surface that renders a row was doing `type === 'INCOME' ? '+' : '-'`
// and then printing the raw amount, which turns a Q488.07 refund into the
// nonsense "-Q-488.07". Three copies of that expression existed and they would
// have had to be fixed identically three times, so the rule lives here:
//
//   cashFlowOf  — signed against the wallet. Positive means money arrived.
//
// A negative INCOME is not something the app produces today, but the sign
// rules fall out of the arithmetic rather than being special-cased, so if one
// ever appears it reads correctly instead of inverting.

export function cashFlowOf(tx) {
  const amount = Number(tx?.amount) || 0
  return tx?.type === 'INCOME' ? amount : -amount
}

// The sign to print in front of the (absolute) amount.
export function flowSign(tx) {
  return cashFlowOf(tx) < 0 ? '-' : '+'
}

// The number to print, always non-negative — the sign is carried by flowSign
// so callers never end up printing it twice.
export function flowMagnitude(tx) {
  return Math.abs(cashFlowOf(tx))
}

// Does this row give money back rather than take it? Used to label a refund as
// what it is, since a negative expense with no explanation reads as a bug.
export function isReversal(tx) {
  return tx?.type !== 'INCOME' && (Number(tx?.amount) || 0) < 0
}
