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
// Lo que distingue DOS transferencias reales de UN reintento de la misma.
//
// El id del documento sale de fecha+símbolo+tipo+centavos, y eso no identifica
// una transferencia: dos movimientos legítimos del mismo día entre el mismo par
// de cuentas colapsaban en un solo doc y el segundo se perdía en silencio. Se
// estampa UNA vez por objeto construido, o sea una vez por submit: el mismo
// objeto reintentado conserva su id y dos submits distintos no se pisan.
const txNonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

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
    _txNonce: txNonce(),
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
 * paga se rebobina bien.
 *
 * RESUELTO el pendiente que vivía acá (FASE KZ3, OK explícito del usuario el
 * 26 ago 2026): `indexBalanceEvents` ganó su rama para `_debtItemId` y empuja
 * `-aplicado` a la deuda (el pago BAJÓ su magnitud ese día), así que el
 * rebobinado muestra los meses anteriores con lo que de verdad se debía, en
 * vez de la deuda plana en su saldo de hoy. El campo propio sigue siendo
 * obligatorio por la razón de arriba: el signo de una deuda es el CONTRARIO
 * al de un destino normal.
 *
 * DOS MONTOS, por la misma razón que su hermana de arriba: pagar una hipoteca
 * en dólares desde una cuenta en quetzales mueve Q de un lado y $ del otro, y
 * un registro de un solo monto no puede ni expresar el caso. La tasa la pone el
 * usuario (el banco le pone su propio spread); la app sugiere y jamás decide.
 */
export function buildDebtPaymentTransaction({
  fromItem,
  debtItem,
  amount,
  toAmount = null,
  date,
  description = '',
  currency = null,
  source = 'manual_debt_payment',
}) {
  if (!fromItem || !debtItem) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null

  const fromCurrency = fromItem.currency || currency || 'USD'
  const toCurrency = debtItem.currency || fromCurrency
  const sameCurrency = String(fromCurrency).toUpperCase() === String(toCurrency).toUpperCase()

  const rawTo = Number(toAmount)
  const applied = sameCurrency
    ? amt
    : (isFinite(rawTo) && rawTo > 0 ? rawTo : null)
  if (applied == null) return null

  return {
    type: 'TRANSFER',
    symbol: fromItem.symbol || 'TRANSFER',
    description: description || `Pago: ${fromItem.name} → ${debtItem.name}`,
    date,
    totalAmount: amt,
    currency: fromCurrency,
    _toAmount: applied,
    _toCurrency: toCurrency,
    ...(sameCurrency ? {} : { _fxRate: applied / amt }),
    _originItemId: fromItem.id,
    _debtItemId: debtItem.id,
    _source: source,
    _txNonce: txNonce(),
  }
}

/**
 * Un pago de deuda registrado desde la HOJA, donde no se sabe de qué cuenta
 * salió el dinero (FASE LT). MISMA forma que el pago completo de arriba
 * (`_debtItemId` + `_toAmount` en la moneda de la deuda), sin `_originItemId`:
 * todo consumidor ya sabe leer ese lado ausente (el rebobinado solo empuja el
 * evento de la deuda, y la reversa de un lado que no existe no bloquea al
 * otro, ver transferReversal). El monto es lo APLICADO al capital, que es
 * exactamente lo que la celda editada dice que bajó.
 *
 * NUNCA es el camino preferido para un pago desde una cuenta registrada: ahí
 * va `buildDebtPaymentTransaction`, que baja las dos puntas. La UI lo dice.
 */
export function buildSheetDebtPaymentTransaction({ debtItem, amount, date, description = '', source = 'manual_debt_payment' }) {
  if (!debtItem || !debtItem.id) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null
  const cur = debtItem.currency || 'USD'
  return {
    type: 'TRANSFER',
    symbol: debtItem.symbol || debtItem.name || 'DEBT',
    description: description || `Pago: ${debtItem.name || debtItem.symbol}`,
    date,
    totalAmount: amt,
    currency: cur,
    _toAmount: amt,
    _toCurrency: cur,
    _debtItemId: debtItem.id,
    _source: source,
    _txNonce: txNonce(),
  }
}

/**
 * El dinero de un préstamo NUEVO acaba de llegar a una cuenta registrada
 * (FASE LT, decisión del usuario del 28 ago 2026). Pedir prestado no cambia tu
 * patrimonio (la cuenta sube B y la deuda sube B), así que el registro es un
 * TRANSFER (invisible para el Dietz), con la deuda en un campo PROPIO
 * (`_loanItemId`) y no en `_originItemId`:
 *
 *   - `indexBalanceEvents` no conoce `_loanItemId`, y eso es lo correcto: el
 *     pasado de la deuda lo gobierna su fecha de alta (antes no existía), y un
 *     `-monto` de origen sobre ella la reconstruiría al revés (misma razón por
 *     la que el pago usa `_debtItemId`).
 *   - `transferReversalPlan` con origen ausente revierte solo el lado de la
 *     cuenta (le quita el crédito), que es exactamente la reversa correcta:
 *     el saldo de la deuda lo declaró el usuario y no lo movió este registro.
 */
export function buildLoanProceedsTransaction({ debtItem, toItem, amount, date, source = 'manual_loan_proceeds' }) {
  if (!debtItem || !debtItem.id || !toItem || !toItem.id) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null
  const cur = debtItem.currency || toItem.currency || 'USD'
  return {
    type: 'TRANSFER',
    symbol: toItem.symbol || toItem.name || 'LOAN',
    description: `Préstamo recibido: ${debtItem.name || debtItem.symbol} → ${toItem.name || toItem.symbol}`,
    date,
    totalAmount: amt,
    currency: cur,
    _toAmount: amt,
    _toCurrency: toItem.currency || cur,
    _linkedItemId: toItem.id,
    _loanItemId: debtItem.id,
    _source: source,
    _txNonce: txNonce(),
  }
}

/**
 * El dinero del préstamo NO está en ninguna cuenta registrada (se usó fuera de
 * la app, o ya está contado dentro de un activo, como la casa que la hipoteca
 * financió). El patrimonio RASTREADO sí baja al registrar la deuda, pero eso no
 * es una pérdida: es capital saliendo del perímetro, o sea EXACTAMENTE lo que
 * un WITHDRAWAL significa para el Dietz (gain = Δvalor − flujos: −B − (−B) = 0).
 *
 * Va vinculado a la DEUDA para que el reparto por cuenta del YTD lo atribuya a
 * su cuenta (fila en cero, no en −B) sin enseñarle nada nuevo al motor. El
 * evento que esto empuja en `indexBalanceEvents` es inerte: está fechado el día
 * del alta, y todo mes anterior al alta ya está fuera por la puerta de la fecha
 * de adquisición.
 */
export function buildLoanProceedsOutsideTransaction({ debtItem, amount, date, source = 'manual_loan_proceeds' }) {
  if (!debtItem || !debtItem.id) return null
  const amt = Number(amount)
  if (!isFinite(amt) || amt <= 0) return null
  return {
    type: 'WITHDRAWAL',
    symbol: debtItem.symbol || debtItem.name || 'LOAN',
    description: `Préstamo recibido (fuera de la app): ${debtItem.name || debtItem.symbol}`,
    date,
    totalAmount: amt,
    currency: debtItem.currency || 'USD',
    _linkedItemId: debtItem.id,
    _loanItemId: debtItem.id,
    _source: source,
    _txNonce: txNonce(),
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
