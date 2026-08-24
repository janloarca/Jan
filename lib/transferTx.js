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

// ⛔ UNA TRANSFERENCIA ENTRE MONEDAS TIENE DOS MONTOS, NO UNO.
//
// Bug reportado por el usuario (24 ago 2026) sobre una transferencia REAL:
// movió Q2,500 de un fondo líquido en quetzales a su cuenta monetaria en
// dólares, y la cuenta destino subió $2,500. Su saldo pasó de 5,350 a 8,092,
// que es exactamente 5,350 + 2,500 + 242 (los quetzales acreditados como
// dólares, más un segundo traslado de $242 que sí era en dólares).
//
// La causa: este registro guardaba UN monto y UNA moneda, y las dos pantallas
// que lo llaman hacían `destino += monto` con el monto del ORIGEN. Un registro
// así no puede ni expresar el caso, así que el defecto no se podía arreglar
// solo en la UI.
//
// LA TASA LA PONE EL USUARIO, y esto no es un detalle: el banco no usa la tasa
// de mercado que la app conoce, le pone su propio spread. La única fuente de
// verdad de cuánto llegó de verdad es el estado de cuenta de esa persona. La
// app puede SUGERIR con su tasa, jamás decidir.
//
// Forma del registro:
//   totalAmount / currency   lo que SALIÓ, en la moneda del origen (sin cambio,
//                            así que todo consumidor viejo sigue leyendo lo que
//                            leía y una transferencia de misma moneda queda
//                            byte-idéntica)
//   _toAmount / _toCurrency  lo que ENTRÓ, en la moneda del destino
//   _fxRate                  la tasa implícita (entró ÷ salió), como dato de
//                            lectura: se deriva, nunca es la fuente
//
// `_toAmount` se estampa SIEMPRE, también en una transferencia de misma moneda,
// para que todo consumidor tenga UNA sola regla ("el destino usa _toAmount")
// en vez de una rama por caso. Las filas escritas antes de este cambio no lo
// llevan y cada consumidor cae a `totalAmount`, que es lo correcto para ellas:
// se escribieron cuando las dos cuentas se asumían en la misma moneda.
export function buildTransferTransaction({
  fromItem,
  toItem,
  amount,
  toAmount = null,
  date,
  description = '',
  currency = null,
  source = 'manual_transfer',
}) {
  if (!fromItem || !toItem) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null

  const fromCurrency = fromItem.currency || currency || 'USD'
  const toCurrency = toItem.currency || fromCurrency
  const sameCurrency = String(fromCurrency).toUpperCase() === String(toCurrency).toUpperCase()

  // Con la misma moneda, lo que entra ES lo que sale: no hay nada que preguntar
  // ni margen para que un dato tecleado contradiga al otro.
  const rawTo = Number(toAmount)
  const received = sameCurrency
    ? amt
    : (isFinite(rawTo) && rawTo > 0 ? rawTo : null)
  if (received == null) return null

  return {
    type: 'TRANSFER',
    symbol: fromItem.symbol || 'TRANSFER',
    description: description || `Transfer: ${fromItem.name} → ${toItem.name}`,
    date,
    totalAmount: amt,
    currency: fromCurrency,
    _toAmount: received,
    _toCurrency: toCurrency,
    ...(sameCurrency ? {} : { _fxRate: received / amt }),
    _originItemId: fromItem.id,
    _linkedItemId: toItem.id,
    _source: source,
  }
}

// Lo que le llegó al DESTINO, con su moneda, para cualquier consumidor.
//
// Una sola definición: el lado del destino de un TRANSFER se lee SIEMPRE por
// acá. Sin esto, cada consumidor tendría que acordarse del respaldo para las
// filas viejas, y el primero que se olvide vuelve a acreditar quetzales como
// dólares.
export function transferCredit(tx) {
  const from = Number(tx?.totalAmount ?? tx?.amount ?? 0)
  const to = Number(tx?._toAmount)
  const amount = isFinite(to) && to > 0 ? to : from
  const currency = (isFinite(to) && to > 0 && tx?._toCurrency) ? tx._toCurrency : (tx?.currency || null)
  return { amount, currency }
}
