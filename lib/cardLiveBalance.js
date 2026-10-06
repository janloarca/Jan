// Saldo VIVO de una tarjeta entre dos estados de cuenta.
//
// La deuda que escribe `lib/cardDebt.js` queda fija en el saldo del corte
// (`balanceAsOf` = fecha de corte) hasta que se sube el estado siguiente, así
// que durante el periodo la tarjeta se ve como si no hubieras comprado nada.
// Este módulo calcula, SIN escribir, cuánto se ha gastado desde ese corte, para
// mostrarlo encima del saldo guardado.
//
// ⛔ Decisiones del usuario:
//   - La fuente son los gastos CAPTURADOS (`_source: 'auto_*'`: atajo, correo,
//     Android). Un estado importado nunca suma acá: ya vive dentro del saldo.
//   - Una compra solo se asigna a una tarjeta cuando su alerta trae los últimos
//     cuatro dígitos (`last4`) y exactamente UNA deuda de tarjeta los tiene.
//     Lo demás NO se asigna a ninguna y se reporta como "sin asignar": inventar
//     deuda en la tarjeta equivocada es peor que no mostrarla.
//   - Misma moneda o nada: convertir necesita una tasa, y sin tasa `convert`
//     devuelve el monto crudo en silencio.
//
// Límite conocido: los PAGOS a la tarjeta hechos después del corte no se ven
// hasta el siguiente estado (no hay fuente viva de ellos), así que tras pagar,
// el saldo vivo queda por encima hasta importar el estado nuevo.

const itemCurrency = (it) => it?.currency || 'USD'
const last4OfKey = (cardKey) => {
  const m = /:(\d{4})$/.exec(String(cardKey || ''))
  return m ? m[1] : null
}

/**
 * @param {Array} items items del portafolio (crudos, en su moneda)
 * @param {Array} financeTransactions filas de Flujo
 * @returns {{ byItemId: Record<string, {amount: number, count: number}>,
 *            unassigned: Record<string, {amount: number, count: number}> }}
 */
export function liveCardAdditions(items, financeTransactions) {
  const byItemId = {}
  const unassigned = {}
  const cards = (items || []).filter((it) => it && it.isDebt && it.cardKey && typeof it.balanceAsOf === 'string')
  if (cards.length === 0) return { byItemId, unassigned }

  // last4 -> deudas con ese número, por moneda. Más de una = ambiguo.
  const byLast4 = new Map()
  for (const it of cards) {
    const l4 = last4OfKey(it.cardKey)
    if (!l4) continue
    if (!byLast4.has(l4)) byLast4.set(l4, [])
    byLast4.get(l4).push(it)
  }
  // Solo cuentan los cortes MÁS NUEVOS por tarjeta+moneda ya están en el item.
  const earliestCut = cards.reduce((m, it) => (it.balanceAsOf < m ? it.balanceAsOf : m), cards[0].balanceAsOf)

  for (const tx of financeTransactions || []) {
    if (!tx || tx.type !== 'EXPENSE') continue
    if (!String(tx._source || '').startsWith('auto_')) continue
    if (tx._nettedTransfer) continue
    const date = typeof tx.date === 'string' ? tx.date.slice(0, 10) : null
    if (!date || date <= earliestCut) continue
    const cur = tx._originalCurrency || tx.currency || 'GTQ'
    const raw = Number(tx._originalAmount ?? tx.amount)
    if (!Number.isFinite(raw) || raw <= 0) continue

    const candidates = tx.last4 ? (byLast4.get(String(tx.last4)) || []) : []
    const matches = candidates.filter((it) => itemCurrency(it) === cur && date > it.balanceAsOf)
    // Una sola deuda con esos dígitos Y esa moneda; si no, nadie la reclama.
    const owner = candidates.filter((it) => itemCurrency(it) === cur).length === 1 ? matches[0] : null
    if (owner) {
      const slot = byItemId[owner.id] || (byItemId[owner.id] = { amount: 0, count: 0 })
      slot.amount = Math.round((slot.amount + raw) * 100) / 100
      slot.count += 1
    } else if (!candidates.length || candidates.filter((it) => itemCurrency(it) === cur).length !== 1) {
      const slot = unassigned[cur] || (unassigned[cur] = { amount: 0, count: 0 })
      slot.amount = Math.round((slot.amount + raw) * 100) / 100
      slot.count += 1
    }
  }
  return { byItemId, unassigned }
}
