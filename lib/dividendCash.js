// ¿Este pago llegó al bolsillo del usuario, o se quedó adentro del activo?
//
// ⛔ POR QUÉ ESTO EXISTE (FASE JW). La respuesta NO es `tx._reinvested`. Esa
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
// ⛔ Y LA MITAD QUE FALTABA (FASE ON). La regla de arriba ("la cuenta AHORA
// reinvierte") es correcta para un pago que nunca salió del activo, y FALSA
// para uno que SÍ salió: cambiar el modo del activo hoy no puede hacer que el
// dinero que ya aterrizó en otra cuenta se haya quedado adentro. Reproducido
// con las funciones reales antes de tocar nada: un cupón de 240 acreditado al
// Fondo Líquido más un pago manual de 100 que NOMBRA su destino suman 340 de
// ingreso en efectivo; al cambiar VITALI a "reinvertir" (el editor limpia
// `incomeDestination`) las dos cifras del correo caen a **0**, y con ellas la
// card de Ingresos Pasivos y el `annualDividends` del tablero. Dinero real
// cobrado desaparece del reporte por un cambio de configuración posterior.
//
// La evidencia que lo separa vive en la propia FILA y no hay que adivinarla
// (`wentOutAsCash`), que es la misma regla que `dividendCreditTarget` ya aplica
// desde FASE OB: lo que la fila DICE manda sobre lo que el activo tiene
// configurado hoy. La bandera `_reinvested` se sigue chequeando PRIMERO, así
// que "la bandera manda aunque la cuenta ya no reinvierta" no se mueve.
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

// ¿La propia fila prueba que este pago SALIÓ del activo como efectivo hacia
// otra cuenta? Son hechos del pasado, así que ninguna configuración posterior
// los puede deshacer.
//
// Dos formas, las dos escritas por quien movió el dinero:
//  · `_destinationItemId`: la fila NOMBRA la cuenta que lo recibió (un pago
//    registrado a mano desde "Registrar movimiento", CashFlowModal). Se exige
//    que NO sea el propio activo: un rendimiento acreditado a la MISMA cuenta
//    que lo generó se quedó adentro, no salió.
//  · `_destinationCredited`: el motor automático lo estampa SOLO cuando escribe
//    un pago ruteado a un destino (`!isReinvest && incomeDestination`,
//    hooks/useDashboardData.js), así que su PRESENCIA ya prueba que se escribió
//    como efectivo. Su valor contesta otra pregunta (si el saldo se movió o si
//    el saldo tecleado ya lo contenía, FASE DI), y un `false` sigue siendo un
//    pago en efectivo: por eso se mira la presencia y nunca el valor.
export function wentOutAsCash(tx) {
  if (!tx) return false
  if (tx._destinationItemId && tx._destinationItemId !== tx._linkedItemId) return true
  return tx._destinationCredited !== undefined
}

// true = se quedó adentro del activo (más cantidad/valor), NO es efectivo.
// Sin items no hay forma de consultar la cuenta y solo queda la bandera, que
// es exactamente el comportamiento viejo: un caller que todavía no pasa items
// no cambia de resultado.
export function isReinvestedDividend(tx, itemsOrIndex) {
  if (!tx) return false
  if (tx._reinvested === true) return true
  // La evidencia de la fila le gana a la configuración de HOY (FASE ON).
  if (wentOutAsCash(tx)) return false
  const byId = indexById(itemsOrIndex)
  if (!byId || !tx._linkedItemId) return false
  const linked = byId.get(tx._linkedItemId)
  return !!(linked && linked.dividendAction === 'reinvest')
}

// El complemento, para que un filtro se lea como lo que quiere decir.
export function isCashDividend(tx, itemsOrIndex) {
  return !isReinvestedDividend(tx, itemsOrIndex)
}
