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

/**
 * Pagar una deuda: el dinero sale de una cuenta tuya y baja el saldo del
 * préstamo. Es un TRANSFER de verdad, no un retiro: tu patrimonio no cambia
 * (el efectivo baja y la deuda baja lo mismo), y por eso el Dietz de portafolio
 * lo ignora, que es exactamente lo correcto.
 *
 * ⛔ POR QUÉ NO LLEVA `_linkedItemId`, y hay que dejarlo así.
 * `indexBalanceEvents` (lógica congelada F) reparte un TRANSFER como
 * `-monto` al origen y `+monto` al destino, que es correcto entre dos ACTIVOS.
 * Una deuda se guarda en POSITIVO (getItemValue la niega al leer), así que un
 * `+monto` sobre ella la haría reconstruir el pasado como si se hubiera debido
 * MENOS antes de pagar, o sea al revés. Poner el id de la deuda en un campo
 * propio (`_debtItemId`) deja ese reparto intacto: el pasado de la cuenta que
 * paga se rebobina bien y la deuda queda plana en su saldo de hoy, que es
 * EXACTAMENTE lo que ya pasaba antes de que se pudiera registrar un pago. Cero
 * regresión y cero número inventado.
 *
 * Pendiente honesto, anotado y no hecho: para que el pasado de la DEUDA también
 * se rebobine hace falta extender esa función congelada, y eso se pregunta
 * antes, nunca se hace de paso.
 */
export function buildDebtPaymentTransaction({
  fromItem,
  debtItem,
  amount,
  date,
  description = '',
  currency = null,
  source = 'manual_debt_payment',
}) {
  if (!fromItem || !debtItem) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null

  return {
    type: 'TRANSFER',
    symbol: fromItem.symbol || 'TRANSFER',
    description: description || `Pago: ${fromItem.name} → ${debtItem.name}`,
    date,
    totalAmount: amt,
    currency: fromItem.currency || currency || 'USD',
    _originItemId: fromItem.id,
    _debtItemId: debtItem.id,
    _source: source,
  }
}
