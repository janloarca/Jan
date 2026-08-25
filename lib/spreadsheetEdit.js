// Qué significa corregir un número en la Hoja.
//
// El usuario lo planteó así: "cuando uno cambia el spreadsheet el cambio no es
// por pérdida, solo mal número, y no se tiene que tomar en cuenta en pérdida o
// ganancia". Tenía razón, y el problema era peor de lo que parece: la Hoja YA
// decidía por él, distinto según el tipo de activo, y sin decírselo nunca.
//
//   - Cuenta bancaria (isBankLike): escribía valor Y costo, así que TODA
//     corrección se leía como "dato equivocado". Si de verdad ganó intereses,
//     el rendimiento desaparecía.
//   - Bono, alternativo, inmueble: escribía SOLO el valor, así que TODA
//     corrección se leía como ganancia o pérdida. Un número mal tecleado se
//     leía como pérdida, que es exactamente lo que él vio.
//   - Acción o cripto: deriva la CANTIDAD del valor, o sea ni una cosa ni la
//     otra.
//
// La app no puede saber cuál de las dos es: solo lo sabe quien teclea. Así que
// se pregunta.
//
// ⛔ EXTIENDE LÓGICA CONGELADA (lib/assetLogic/corporateBondWithEntryFee.js y
// lib/assetLogic/liquidFundYield.js), con OK explícito del usuario (25 ago
// 2026). No cambia NINGUNA fórmula: cambia qué campos escribe una edición, que
// son entradas que esas fórmulas ya leían.

import { isBankLike } from '@/components/dashboard/utils'

// Por debajo de esto no hay nada que preguntar: es redondeo.
export const EDIT_EPSILON = 0.005

export const ANSWER_CORRECTION = 'correction'
export const ANSWER_RETURN = 'return'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Un activo de MERCADO nunca entra a esta pregunta, y no es un olvido: su
// precio lo pone el mercado, así que "el valor está mal" solo puede significar
// "tengo otra cantidad", que es justo lo que la Hoja ya hace con él. Preguntarle
// a alguien si la bolsa se equivocó sería ruido.
export function editNeedsAnswer({ item, oldValue, newValue, isMarket }) {
  if (isMarket) return false
  if (!item || !item.id) return false
  return Math.abs(num(newValue) - num(oldValue)) > EDIT_EPSILON
}

// Una cuenta líquida no tiene "ganancia no realizada": el interés se acreditó,
// el dinero ESTÁ ahí. Un bono o un inmueble sí se revalúan sin que entre un
// centavo. Esa diferencia es la que decide cómo se registra el rendimiento.
// A propósito NO se usa `isBankLikeItem` (lib/contributions.js), que es mucho
// más ancha: devuelve true para CUALQUIER estático con cantidad 1, o sea
// incluye a los bonos. Un bono que sube de precio no acreditó efectivo, se
// revaluó, y registrarle un ingreso sería inventar dinero que no llegó.
export function accruesInBalance(item) {
  return isBankLike(item)
}

/**
 * Qué escribir para una edición de celda ya resuelta a la moneda del ítem.
 *
 * Devuelve `{ patch, income }`, donde `income` es un movimiento REAL a
 * registrar (o null). El caller escribe los dos; este módulo no toca Firestore.
 *
 * ⛔ EL INVARIANTE, y es literalmente lo que el usuario pidió:
 *    con `correction`, la ganancia/pérdida de la cuenta NO se mueve.
 *
 * Por eso el costo se DESPLAZA por la diferencia en vez de sobreescribirse con
 * el valor nuevo. Sobreescribir solo conserva la ganancia cuando costo y valor
 * ya coincidían (una cuenta de banco); en un bono comprado a 6,000 que hoy vale
 * 6,200, corregir el 6,200 a 6,100 con sobreescritura borraría los 200 de
 * apreciación real que sí existían. Desplazando, la apreciación sobrevive
 * intacta y solo se corrige el número que estaba mal.
 */
export function planCellEdit({ item, oldValue, newValue, answer, currency }) {
  if (!item) return null
  const qty = num(item.quantity) || 1
  const oldV = num(oldValue)
  const newV = num(newValue)
  const delta = newV - oldV
  const cur = currency || item._originalCurrency || item.currency || 'USD'
  const price = newV / qty

  if (answer === ANSWER_CORRECTION) {
    const oldCost = num(item.purchasePrice)
    // El costo se mueve lo MISMO que el valor, así la diferencia se cancela.
    // Nunca por debajo de cero: un costo negativo no significa nada y haría que
    // toda la ganancia futura saliera inflada.
    // Es el mismo principio que `lib/contributions.js` ya aplica al aportar o
    // retirar sobre un estático: cada campo conserva su propio nivel, "so an
    // asset whose market value drifted from cost doesn't lose the gain".
    const nextCost = Math.max(0, oldCost + delta / qty)
    return { patch: { currentPrice: price, purchasePrice: nextCost }, income: null }
  }

  // "El activo cambió de valor".
  if (accruesInBalance(item) && delta > 0) {
    // El costo SIGUE al saldo y el rendimiento se registra como movimiento.
    // Dejar el costo quieto acá sería contarlo dos veces: `acceptLiquidYield`
    // escribe el ingreso sin tocar el costo, así que la cuenta terminaría con
    // la diferencia contada como ganancia no realizada Y como ingreso.
    return {
      patch: { currentPrice: price, purchasePrice: price },
      income: {
        type: 'DIVIDEND',
        amount: delta,
        currency: cur,
        // MISMA forma que escribe `acceptLiquidYield`, para que todo consumidor
        // ya existente lo trate igual. Lo único distinto es el origen: este lo
        // declaró el usuario, no lo dedujo el motor.
        source: 'manual_yield',
        reinvested: true,
      },
    }
  }

  // Todo lo demás se revalúa: el costo se queda donde está y la diferencia ES
  // la ganancia o la pérdida.
  return { patch: { currentPrice: price }, income: null }
}
