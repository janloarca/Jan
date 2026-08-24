// Qué campos cambian en cada lado de una transferencia, en UN solo lugar.
//
// Las dos pantallas que mueven dinero entre cuentas propias (TransferModal y
// CashFlowModal) tenían esta lógica escrita a mano, idéntica y por duplicado,
// con DOS defectos que el usuario encontró con una transferencia real:
//
// 1. UNA COPIA ANGOSTA DE UNA REGLA QUE YA ESTABA COMPARTIDA.
//    Las dos usaban `/bank|banco|cash/i` mientras `isBankLike` (utils.js) es
//    `/bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i`, que es la que
//    FASE JA extrajo justamente para que las tres superficies que corrigen un
//    saldo no divergieran. `SellModal` sí usa la completa, así que ni entre
//    ellas coincidían.
//
//    No es cosmético: una "Cuenta Monetaria" caía del lado NO-banco, o sea la
//    resta se hacía por CANTIDAD y `purchasePrice` quedaba en el valor viejo.
//    Ese es exactamente el bug de FASE JA ("el dashboard creía que el usuario
//    GANÓ la diferencia en una cuenta de ahorro"), en una superficie que
//    aquella pasada no tocó.
//
// 2. VACIAR UNA CUENTA CASI NUNCA LA DEJABA EN CERO.
//    Para un ítem no-banco la resta es `quantity - monto/precio`, y con punto
//    flotante eso deja polvo (0.0000001) en vez de 0. Y peor: el botón "Todo"
//    solo se ofrecía para cuentas tipo banco, así que en un fondo había que
//    teclear el monto a mano; si el número que uno tiene en la cabeza no
//    coincide al centavo con el guardado, queda un residuo real. El usuario
//    transfirió lo que él creía tener ($242) de un fondo que la app tenía en
//    $482 y quedaron $240 colgados.
//
// El umbral es medio centavo: por debajo de eso no queda dinero, queda ruido de
// redondeo, y una cuenta que dice "0.00" tiene que estar de verdad en cero.

import { isBankLike } from '@/components/dashboard/utils'

export const DUST = 0.005

// El valor de una cuenta con la MISMA regla con la que se le va a restar.
export function accountValue(item) {
  if (!item) return 0
  const price = item.currentPrice || item.purchasePrice || 0
  return isBankLike(item) ? price : (item.quantity || 0) * price
}

// Lo que sale del ORIGEN. `amount` va en la moneda del propio ítem.
export function debitFields(item, amount) {
  const amt = Number(amount)
  if (!item || !isFinite(amt) || amt <= 0) return null
  const remaining = accountValue(item) - amt
  const empty = remaining <= DUST

  if (isBankLike(item)) {
    const newBal = empty ? 0 : remaining
    // Los DOS campos, siempre: escribir solo `currentPrice` deja el costo en el
    // valor viejo y el tablero lee la diferencia como ganancia (FASE JA).
    return { currentPrice: newBal, purchasePrice: newBal }
  }
  const price = item.currentPrice || item.purchasePrice || 1
  return { quantity: empty ? 0 : (item.quantity || 0) - amt / price }
}

// Lo que entra al DESTINO. `amount` va en la moneda del ítem DESTINO, que en
// una transferencia entre monedas NO es la misma que la del origen (ver
// lib/transferTx.js: ahí está el bug de acreditar quetzales como dólares).
export function creditFields(item, amount) {
  const amt = Number(amount)
  if (!item || !isFinite(amt) || amt <= 0) return null

  if (isBankLike(item)) {
    const newBal = (item.currentPrice || item.purchasePrice || 0) + amt
    return { currentPrice: newBal, purchasePrice: newBal }
  }
  const price = item.currentPrice || item.purchasePrice || 1
  return { quantity: (item.quantity || 0) + amt / price }
}
