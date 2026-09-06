// FASE OD. Deshacer una VENTA al borrar su fila.
//
// Borrar una fila SELL caía de largo por todas las ramas de reversa de
// `deleteTransactionWithReversal` hasta `deleteTransaction(txId)`: la fila
// desaparecía, pero la posición seguía reducida, los lotes seguían cerrados y
// la cuenta destino conservaba el crédito. Reproducido con el hook real: cero
// escrituras además del borrado. O sea la venta seguía HECHA en el archivo y
// solo se perdía su registro, que es la peor forma de "deshacer": el usuario
// que vendió por error no recupera nada y encima ya no puede ni ver qué pasó.
// Y la confirmación no decía una palabra (ninguna línea de reversa).
//
// El plan devuelve las escrituras EXACTAS para volver al estado previo, y
// REHÚSA antes que adivinar. Cada rehúse tiene su razón, porque las cuatro se
// arreglan distinto:
//   - 'unmarked'       la fila es anterior a esta versión: no dice qué movió.
//                      Se puede borrar igual, PERO la confirmación lo dice
//                      (solo quita el registro; nada vuelve).
//   - 'later-activity' hubo otra venta, compra o movimiento del mismo activo
//                      DESPUÉS: revertir esta sobre un estado que ya cambió
//                      escribiría cantidades que no describen nada. Se
//                      deshace primero la más reciente.
//   - 'lot-missing'    un lote que esta venta cerró ya no existe.
//   - 'dest-cannot'    la cuenta que recibió el dinero no lo puede devolver
//                      (lo gastó, o no tiene un valor con el que trabajar).
//
// ⛔ Los saldos se ajustan por DELTA contra el valor de HOY, nunca restaurando
// el valor viejo: restaurar el saldo que la cuenta tenía el día de la venta se
// comería todo lo que le llegó después (la lección de FASE KY). La única
// excepción son los PRECIOS del ítem tras una venta TOTAL, que la venta puso
// en cero y nada más escribe: ahí sí se restauran los guardados en `_sale`.
//
// Los ítems que recibe tienen que traer los precios en SU moneda (raw), no
// convertidos a la base: ver `reversalItems` en hooks/useDashboardData.js.

import { accountValue, debitFields } from './transferFields'
import { roundQty } from './lotClose'

const byId = (items, id) => (id ? (items || []).find((it) => it && it.id === id) || null : null)
const isSell = (tx) => String(tx?.type || '').toUpperCase() === 'SELL'
const MOVES = new Set(['SELL', 'BUY', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER'])

// Ids de las filas que nacieron con esta venta (la WITHDRAWAL compañera).
export function saleCompanionIds(tx, transactions) {
  if (!tx?._saleId) return []
  return (transactions || [])
    .filter((t) => t && t.id !== tx.id && t._saleId === tx._saleId)
    .map((t) => t.id)
}

export function saleReversalPlan(tx, items, lots, transactions) {
  if (!isSell(tx)) return null
  const companions = saleCompanionIds(tx, transactions)
  const sale = tx._sale
  const base = { kind: 'sale', companions, item: null, lots: [], dest: null, destMissing: false, deleteLotIds: [], refused: null }
  if (!sale || typeof sale !== 'object') return { ...base, refused: 'unmarked' }

  const item = byId(items, tx._linkedItemId)
  // El activo vendido ya no existe: no queda posición a la que devolverle
  // nada, y la cascada de borrado ya se llevó lo suyo. Se borra a secas.
  if (!item) return { ...base, refused: 'item-missing' }

  // Un movimiento POSTERIOR del mismo activo (otra venta, una compra, un
  // aporte) hace que "volver al estado previo" ya no describa nada.
  const later = (transactions || []).some((t) => {
    if (!t || t.id === tx.id || (tx._saleId && t._saleId === tx._saleId)) return false
    if (t._linkedItemId !== item.id) return false
    if (!MOVES.has(String(t.type || '').toUpperCase())) return false
    const d = String(t.date || ''), d0 = String(tx.date || '')
    if (d > d0) return true
    return d === d0 && String(t.createdAt || '') > String(tx.createdAt || '')
  })
  if (later) return { ...base, refused: 'later-activity' }

  // Lotes: el escritor atómico estampó cada cierre en la fila.
  const lotWrites = []
  const deleteLotIds = []
  for (const c of (Array.isArray(tx._lotCloses) ? tx._lotCloses : [])) {
    const lot = byId(lots, c.lotId)
    if (!lot) return { ...base, refused: 'lot-missing' }
    if (c.whole) {
      lotWrites.push({ id: lot.id, fields: { status: 'open', closedDate: null, closedPrice: null, realizedGain: null } })
    } else {
      if (c.closedId && !byId(lots, c.closedId)) return { ...base, refused: 'lot-missing' }
      lotWrites.push({ id: lot.id, fields: { quantity: roundQty((Number(lot.quantity) || 0) + (Number(c.closable) || 0)) } })
      if (c.closedId) deleteLotIds.push(c.closedId)
    }
  }

  // El ítem vendido: la cantidad vuelve por delta. Tras una venta TOTAL los
  // precios se pusieron en cero y se restauran los guardados.
  const qty = Number(sale.qty) || 0
  const itemFields = { quantity: roundQty((Number(item.quantity) || 0) + qty) }
  if (sale.soldFully) {
    const p = sale.prevItemFields || {}
    itemFields.currentPrice = Number(p.currentPrice) || 0
    itemFields.purchasePrice = Number(p.purchasePrice) || 0
    itemFields.saleDate = null
    itemFields.salePrice = null
    itemFields.soldFully = null
  }

  // El destino: lo que recibió, en su moneda, se le quita por delta.
  let dest = null
  let destMissing = false
  if (sale.destId) {
    const d = byId(items, sale.destId)
    if (!d) destMissing = true
    else if (sale.destKind === 'market') {
      const have = Number(d.quantity) || 0
      const add = Number(sale.destAddQty) || 0
      if (add > have + 1e-8) return { ...base, refused: 'dest-cannot' }
      dest = { id: d.id, name: d.name || d.symbol || '', fields: { quantity: roundQty(have - add) }, amount: Number(sale.destAmount) || 0, currency: sale.destCurrency, kind: 'market' }
      if (tx._destLotId && byId(lots, tx._destLotId)) deleteLotIds.push(tx._destLotId)
    } else {
      const amount = Number(sale.destAmount) || 0
      const before = accountValue(d)
      const fields = amount > 0 ? (amount > before + 0.005 ? null : debitFields(d, amount)) : {}
      if (!fields) return { ...base, refused: 'dest-cannot' }
      dest = { id: d.id, name: d.name || d.symbol || '', fields, amount, currency: sale.destCurrency, kind: 'bank' }
    }
  }

  return {
    ...base,
    item: { id: item.id, name: item.name || item.symbol || '', fields: itemFields, qty, soldFully: !!sale.soldFully },
    lots: lotWrites,
    deleteLotIds,
    dest,
    destMissing,
  }
}

// Qué dice la confirmación. Una fila sin marcas también habla: que solo se
// quita el registro es justo lo que el usuario necesita saber antes de tocar.
export function saleReversalLines(plan, lang, fmt) {
  if (!plan) return []
  const es = lang !== 'en'
  const money = (amount, currency) => (typeof fmt === 'function' ? fmt(amount, currency) : `${currency || ''} ${amount}`)
  const lines = []
  if (plan.refused === 'unmarked' || plan.refused === 'item-missing') {
    lines.push(es
      ? 'Solo quita el registro: la posición, los lotes y el dinero que ya se movió se quedan como están.'
      : 'Only removes the record: the position, the lots and the money already moved stay as they are.')
    return lines
  }
  if (plan.refused) { lines.push(saleRefusalText(plan.refused, lang)); return lines }
  if (plan.item) {
    lines.push(es
      ? `Devuelve ${plan.item.qty} unidades a ${plan.item.name}${plan.lots.length ? ` y reabre ${plan.lots.length} lote${plan.lots.length === 1 ? '' : 's'}` : ''}`
      : `Returns ${plan.item.qty} units to ${plan.item.name}${plan.lots.length ? ` and reopens ${plan.lots.length} lot${plan.lots.length === 1 ? '' : 's'}` : ''}`)
  }
  if (plan.dest && plan.dest.amount > 0) {
    lines.push(es
      ? `Quita ${money(plan.dest.amount, plan.dest.currency)} de ${plan.dest.name}`
      : `Removes ${money(plan.dest.amount, plan.dest.currency)} from ${plan.dest.name}`)
  }
  if (plan.destMissing) {
    lines.push(es
      ? 'La cuenta que recibió el dinero ya no existe: solo se restaura la posición.'
      : 'The account that received the money no longer exists: only the position is restored.')
  }
  if (plan.companions.length) {
    lines.push(es ? 'También borra el retiro asociado a esta venta.' : 'Also removes the withdrawal tied to this sale.')
  }
  return lines
}

export function saleRefusalText(reason, lang) {
  const es = lang !== 'en'
  switch (reason) {
    case 'later-activity':
      return es
        ? 'No se deshizo: este activo tuvo otro movimiento después de esta venta. Deshacé primero el más reciente.'
        : 'Not undone: this asset had another movement after this sale. Undo the most recent one first.'
    case 'lot-missing':
      return es
        ? 'No se deshizo: un lote que esta venta cerró ya no existe.'
        : 'Not undone: a lot this sale closed no longer exists.'
    case 'dest-cannot':
      return es
        ? 'No se deshizo: la cuenta que recibió el dinero ya no lo tiene para devolverlo. Ajusta su saldo primero.'
        : 'Not undone: the account that received the money no longer holds it. Adjust its balance first.'
    default:
      return es ? 'No se pudo deshacer la venta.' : 'Could not undo the sale.'
  }
}
