// Deshacer un aporte, un retiro o un gasto que MOVIÓ un saldo al escribirse.
//
// EL BUG QUE LO OBLIGA (FASE OB). `deleteTransactionWithReversal` revertía
// transferencias (`transferReversalPlan`) y dividendos (`dividendCreditTarget`),
// y TODO lo demás caía a `deleteTransaction(txId)` a secas. Pero un DEPOSIT
// registrado desde "Registrar movimiento" o desde el editor de la cuenta SÍ
// sube el saldo de esa cuenta al escribirse (`executeContribution`, con
// `buildContributionFields`): borrarlo quitaba la fila y dejaba los 500 en la
// cuenta, en silencio. Un aporte tecleado por error quedaba como dinero real
// para siempre, y la única forma de sacarlo era editar el saldo a mano.
//
// ⛔ SOLO SE REVIERTE LO QUE LA FILA DICE QUE MOVIÓ. Un DEPOSIT con la MISMA
// forma puede no haber tocado ningún saldo: "Capturar historia" (el usuario
// dice que ese dinero YA está dentro del saldo tecleado) escribe la fila sin
// pasar por `executeContribution`, y el ajuste de EditAccountModal registra un
// delta que el usuario ya escribió a mano en el campo del saldo. Revertir esos
// le restaría a la cuenta un dinero que la fila nunca le sumó. Por eso la
// regla no es el `_source` sino la marca `_balanceMoved: true`, que estampan
// exactamente los dos escritores que mueven el saldo en la misma operación
// (CashFlowModal con `willTouchBalance`, y el aporte del editor). Una fila sin
// la marca (todo lo escrito antes de esta fase) se borra como siempre.
//
// Mismas tres reglas de lib/transferReversal.js: apuntar a un VALOR y no
// restar de un campo (`debitFields`/`creditFields`), delta contra el saldo de
// HOY, y rehusar antes que escribir un `{}` que Firestore acepta sin quejarse.
//
// Un activo de MERCADO queda fuera a propósito: su aporte creó un LOTE y subió
// la cantidad, y deshacerlo bien exige reabrir ese lote (o cerrar el que la
// venta abrió), que es trabajo del flujo de Movimiento; el plan lo DICE en vez
// de mover la cantidad a medias. La deuda tampoco entra: un pago de deuda es
// un TRANSFER con `_debtItemId` y ya lo cubre `transferReversalPlan`.

import { debitFields, creditFields, accountValue, DUST } from './transferFields'
import { isMarketPriced } from '@/components/dashboard/utils'

const byId = (items, id) => (id ? (items || []).find((it) => it.id === id) : null)

/**
 * @returns {null | {
 *   kind: 'cashflow',
 *   side: { id, name, fields, amount, currency, before, after, direction: 'debit'|'credit' } | null,
 *   missing: boolean,   // la cuenta ya no existe
 *   refused: boolean,   // existe pero no se puede expresar
 *   marketNote: boolean // activo de mercado: las unidades se quedan
 * }}
 */
export function cashflowReversalPlan(tx, items) {
  if (!tx || tx._balanceMoved !== true) return null
  const type = String(tx.type || '').toUpperCase()
  const amount = Number(tx.totalAmount ?? tx.amount ?? 0)
  if (!isFinite(amount) || amount <= 0) return null

  // Qué cuenta se movió, y en qué dirección, según el tipo de fila.
  let accountId = null
  let direction = null
  if (type === 'DEPOSIT') { accountId = tx._linkedItemId; direction = 'debit' }
  else if (type === 'WITHDRAWAL') { accountId = tx._linkedItemId; direction = 'credit' }
  else if (type === 'FEE') { accountId = tx._paidFromItemId; direction = 'credit' }
  else return null
  if (!accountId) return null

  const item = byId(items, accountId)
  if (!item) return { kind: 'cashflow', side: null, missing: true, refused: false, marketNote: false }
  if (isMarketPriced(item)) return { kind: 'cashflow', side: null, missing: false, refused: false, marketNote: true }

  const before = accountValue(item)
  // Misma regla que transferReversalPlan (FASE OB): si la cuenta tiene hoy
  // menos de lo que este aporte le puso, `debitFields` la recortaria a CERO y
  // la diferencia se perderia sin decirlo. Se rehusa y se dice.
  const fields = direction === 'debit'
    ? (amount > before + DUST ? null : debitFields(item, amount))
    : creditFields(item, amount)
  if (!fields) return { kind: 'cashflow', side: null, missing: false, refused: true, marketNote: false }
  return {
    kind: 'cashflow',
    side: {
      id: item.id,
      name: item.name || item.symbol || '',
      fields,
      amount,
      currency: tx.currency || item.currency || null,
      before,
      after: direction === 'debit' ? Math.max(0, before - amount) : before + amount,
      direction,
    },
    missing: false,
    refused: false,
    marketNote: false,
  }
}

export function cashflowReversalLines(plan, lang, fmt) {
  if (!plan) return []
  const es = lang !== 'en'
  const money = (amount, currency) => (typeof fmt === 'function' ? fmt(amount, currency) : `${currency || ''} ${amount}`)
  const lines = []
  if (plan.side) {
    lines.push(plan.side.direction === 'debit'
      ? `${es ? 'Quita' : 'Removes'} ${money(plan.side.amount, plan.side.currency)} ${es ? 'de' : 'from'} ${plan.side.name}`
      : `${es ? 'Devuelve' : 'Returns'} ${money(plan.side.amount, plan.side.currency)} ${es ? 'a' : 'to'} ${plan.side.name}`)
  }
  if (plan.marketNote) {
    lines.push(es
      ? 'Las unidades que este movimiento compro o vendio se quedan: corrigelas desde Editar cuenta.'
      : 'The units this movement bought or sold stay: fix them from Edit account.')
  }
  if (plan.refused) {
    lines.push(es
      ? 'La cuenta no tiene un valor con el que trabajar, asi que no se puede deshacer.'
      : 'The account has no usable value, so this cannot be undone.')
  }
  return lines
}
