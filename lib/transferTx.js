// One builder for the TRANSFER record, shared by every screen that can move
// money between two of the user's own accounts (TransferModal, CashFlowModal).
//
// They used to build it independently and drifted: CashFlowModal stamped the two
// account ids, TransferModal stamped neither. Every consumer of a TRANSFER row
// keys on exactly those ids and nothing else --
//
//   · EditAccountModal's incoming/outgoing lists (`_linkedItemId === item.id`
//     and `_originItemId === item.id`; a row matching neither is dropped),
//   · dataCompleteness, deciding what explains each balance,
//   · the per-account YTD split, netting the movement out of both sides,
//
// -- so a transfer made from the Transfer screen was invisible in BOTH accounts
// (no row to see, none to delete), left both balances looking unexplained, and
// counted as a gain for the receiver and a loss for the sender. Stamping
// `_source` also matters beyond provenance: addTransaction only adds its
// uniqueness nonce to ids whose source starts with "manual", so without one, two
// identical same-day transfers between the same pair of accounts collapsed onto
// the same document id and the second silently overwrote the first.
//
// `source` stays a parameter because it records which screen wrote the row; it
// must keep the "manual" prefix for the nonce rule above.

export function buildTransferTransaction({
  fromItem,
  toItem,
  amount,
  date,
  description = '',
  currency = null,
  source = 'manual_transfer',
}) {
  if (!fromItem || !toItem) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null

  return {
    type: 'TRANSFER',
    symbol: fromItem.symbol || 'TRANSFER',
    description: description || `Transfer: ${fromItem.name} → ${toItem.name}`,
    date,
    totalAmount: amt,
    currency: fromItem.currency || currency || 'USD',
    _originItemId: fromItem.id,
    _linkedItemId: toItem.id,
    _source: source,
  }
}
