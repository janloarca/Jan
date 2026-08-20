// ¿Este pago llegó al bolsillo del usuario, o se quedó adentro del activo?
//
// ⛔ POR QUÉ ESTO EXISTE (FASE JV). La respuesta NO es `tx._reinvested`. Esa
// bandera se estampa AL ESCRIBIR, así que un pago escrito cuando la cuenta
// estaba en "recibo el efectivo" no la lleva, y sin embargo todos los motores
// de reconstrucción lo tratan hoy como reinvertido si la cuenta AHORA
// reinvierte (`indexBalanceEvents` mira `linked.dividendAction`). El caso es
// real y está documentado en lib/liquidYield.js: el fondo del usuario tenía 19
// pagos escritos así antes de cambiarlo a reinvertir.
//
// Consecuencia de usar solo la bandera: esos pagos se cuentan como efectivo
// cobrado aunque nunca salieron del activo. `lib/serverPortfolio.js` llegó a
// tener las DOS reglas en el mismo archivo alimentando el MISMO correo, así
// que el documento podía decir dos cosas distintas sobre el mismo dinero.
//
// La regla canónica ya vivía escrita a mano en media docena de sitios; esto es
// UNA sola definición para los que responden esta pregunta exacta:
// "¿cuánto ingreso llegó de verdad como efectivo?".
//
// NO refactorizado a propósito, y hay que dejarlo así:
//  · `getDividendIncomeByItem` y `getIncomeReceivedByItem`
//    (components/dashboard/utils.js) aplican esta MISMA regla, pero la primera
//    es ⛔ LÓGICA CONGELADA (lib/assetLogic/corporateBondWithEntryFee.js): no
//    se toca sin preguntar, aunque el predicado coincida.
//  · `indexBalanceEvents` (lib/historicalValues.js, superficie congelada F) y
//    `buildIncomeEvents` (utils.js) usan una versión MÁS ANCHA (suman
//    `manual_contribution` y "sin activo vinculado") porque contestan otra
//    pregunta: dónde vive el valor, no cuánto se cobró.
//  · `dividendCreditTarget` (lib/autoDividends.js) usa la bandera SOLA a
//    propósito: pregunta "¿este pago movió el saldo de otra cuenta cuando se
//    escribió?", que es un hecho del pasado. Si la cuenta cambió a reinvertir
//    después, el crédito igual se hizo y borrar el pago tiene que revertirlo.
//  · `buildCashFlows` (lib/portfolioRewind.js) rebobina la caja de un BROKER y
//    ni siquiera recibe los items, así que no puede consultar la cuenta; un
//    ítem importado de IBKR nunca lleva `dividendAction`.

// Índice por id, tolerante: acepta un arreglo de items o un Map ya armado.
function indexById(itemsOrIndex) {
  if (!itemsOrIndex) return null
  if (typeof itemsOrIndex.get === 'function') return itemsOrIndex
  return new Map(itemsOrIndex.map((it) => [it?.id, it]))
}

export function reinvestIndex(items) {
  return indexById(items)
}

// true = se quedó adentro del activo (más cantidad/valor), NO es efectivo.
// Sin items no hay forma de consultar la cuenta y solo queda la bandera, que
// es exactamente el comportamiento viejo: un caller que todavía no pasa items
// no cambia de resultado.
export function isReinvestedDividend(tx, itemsOrIndex) {
  if (!tx) return false
  if (tx._reinvested === true) return true
  const byId = indexById(itemsOrIndex)
  if (!byId || !tx._linkedItemId) return false
  const linked = byId.get(tx._linkedItemId)
  return !!(linked && linked.dividendAction === 'reinvest')
}

// El complemento, para que un filtro se lea como lo que quiere decir.
export function isCashDividend(tx, itemsOrIndex) {
  return !isReinvestedDividend(tx, itemsOrIndex)
}
