// Deshacer una transferencia: qué le vuelve a cada una de las dos cuentas.
//
// EL BUG QUE LO OBLIGA. `deleteTransactionWithReversal` revertía SOLO
// dividendos, vía `dividendCreditTarget`, que devuelve null para cualquier cosa
// que no sea DIVIDEND. Un TRANSFER caía de largo hasta `deleteTransaction(txId)`:
// el documento se borraba y NINGUNO de los dos ítems se tocaba. Pero escribirla
// SÍ mueve los dos saldos (`transferFunds`, un writeBatch atómico), así que
// borrarla dejaba las dos cuentas permanentemente mal, sin decir nada. El
// usuario ya lo vive: CLAUDE.md (FASE JD2) anota que sus dos fondos "hay que
// ponerlos en cero a mano desde Editar cuenta".
//
// ⛔ POR QUÉ ESTO NO ES "SUMARLE EL MONTO DE VUELTA AL ORIGEN".
//
// 1. LOS DOS LADOS NO VALEN LO MISMO. Una transferencia entre monedas guarda lo
//    que SALIÓ (`totalAmount`/`currency`) y lo que ENTRÓ (`_toAmount`/
//    `_toCurrency`), que son números distintos. Devolver el mismo a los dos
//    lados es exactamente el bug que FASE JD arregló, al revés. El lado del
//    destino se lee SIEMPRE con `transferCredit`, que además trae el respaldo
//    para las filas escritas antes de que `_toAmount` existiera.
//
// 2. NUNCA RESTAR DE UN CAMPO: APUNTAR A UN VALOR. La lección de FASE JD3. Se
//    usan `creditFields`/`debitFields`, las MISMAS con las que se escribió el
//    movimiento, así que la cuenta queda expresada en los campos que
//    `getItemValue` de verdad lee, sin importar en cuál viva hoy su saldo.
//
// 3. EL DELTA VA CONTRA EL SALDO DE HOY, NO RESTAURA UN VALOR PASADO. Si la
//    cuenta recibió un cupón después de la transferencia, restaurar el valor
//    que tenía antes se lo comería. `creditFields`/`debitFields` ya son
//    delta-contra-hoy por construcción.
//
// 4. UN PAGO DE DEUDA NO SE ACREDITA, SE SUBE. Una deuda se guarda en POSITIVO
//    y `getItemValue` la niega al leer, así que pagarla es BAJAR su magnitud y
//    deshacer el pago es SUBIRLA. Por eso el lado de la deuda no pasa por
//    `creditFields` (que iría por la rama de cantidad para un ítem que no es
//    bank-like) sino que espeja la forma exacta que escribe `CashFlowModal`:
//    `{currentPrice, purchasePrice, quantity: 1}`.
//
// Esto es una función PURA que solo DECIDE. No escribe nada: quien la llama
// (`useDashboardData`) aplica el plan en un solo batch atómico, igual que la
// escritura. Es el espejo de `dividendCreditTarget`: una pregunta testeable.

import { transferCredit } from './transferTx'
import { debitFields, creditFields, accountValue, DUST } from './transferFields'
import { debtBalance } from './propertyEquity'

const byId = (items, id) => (id ? (items || []).find((it) => it.id === id) : null)

/**
 * @returns {null | {
 *   kind: 'transfer' | 'debt',
 *   from: { id, name, fields, amount, currency, before, after } | null,
 *   to:   { id, name, fields, amount, currency, before, after } | null,
 *   missing: string[],   // lados cuyo ítem ya no existe
 *   refused: string[],   // lados que existen pero no se pueden expresar
 * }}
 */
export function transferReversalPlan(tx, items) {
  if (String(tx?.type || '').toUpperCase() !== 'TRANSFER') return null

  const sent = Number(tx.totalAmount ?? tx.amount ?? 0)
  if (!isFinite(sent) || sent <= 0) return null

  const fromId = tx._originItemId || null
  const debtId = tx._debtItemId || null
  const toId = tx._linkedItemId || debtId || null

  // Sin ninguno de los dos ids no hay nada que revertir. Es el caso de las
  // filas escritas antes de que `lib/transferTx.js` fuera el constructor único
  // (FASE GT), que tampoco se rebobinan en el historial por la misma razón.
  if (!fromId && !toId) return null
  // Una transferencia a sí misma no movió nada: el mismo caso que
  // `indexBalanceEvents` ya se salta (`if (fromId === toId) continue`).
  if (fromId && fromId === toId) return null

  const credit = transferCredit(tx)
  const fromItem = byId(items, fromId)
  const toItem = byId(items, toId)

  const missing = []
  const refused = []

  // ORIGEN: el dinero salió de acá, así que revertir es devolvérselo.
  let from = null
  if (fromId && !fromItem) missing.push('from')
  else if (fromItem) {
    const fields = creditFields(fromItem, sent)
    if (!fields) refused.push('from')
    else {
      const before = accountValue(fromItem)
      from = {
        id: fromItem.id,
        name: fromItem.name || fromItem.symbol || '',
        fields,
        amount: sent,
        currency: tx.currency || fromItem.currency || null,
        before,
        after: before + sent,
      }
    }
  }

  // DESTINO: el dinero llegó acá, así que revertir es quitárselo. En su propia
  // moneda y por su propio monto, que en una transferencia cruzada no es el del
  // origen.
  let to = null
  const isDebt = !!debtId
  if (toId && !toItem) missing.push('to')
  else if (toItem) {
    const before = isDebt ? debtBalance(toItem) : accountValue(toItem)
    if (isDebt) {
      // Deshacer un pago SUBE la magnitud de la deuda. Misma forma que la
      // escritura, con el mismo umbral de polvo para que un préstamo que quedó
      // en cero no reviva con un residuo de redondeo.
      const raised = before + credit.amount
      const value = raised <= DUST ? 0 : raised
      to = {
        id: toItem.id,
        name: toItem.name || toItem.symbol || '',
        fields: { currentPrice: value, purchasePrice: value, quantity: 1 },
        amount: credit.amount,
        currency: credit.currency || toItem.currency || null,
        before,
        after: value,
      }
    } else {
      const fields = debitFields(toItem, credit.amount)
      if (!fields) refused.push('to')
      else {
        to = {
          id: toItem.id,
          name: toItem.name || toItem.symbol || '',
          fields,
          amount: credit.amount,
          currency: credit.currency || toItem.currency || null,
          before,
          after: Math.max(0, before - credit.amount),
        }
      }
    }
  }

  return { kind: isDebt ? 'debt' : 'transfer', from, to, missing, refused }
}

// ¿Este plan puede escribir algo? Un plan con los dos lados caídos no se aplica:
// borrar la fila dejaría los saldos exactamente como el bug que esto arregla.
export function reversalWritesSomething(plan) {
  return !!(plan && (plan.from || plan.to))
}
