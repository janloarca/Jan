// Re-sellado de los trades de IBKR que quedaron guardados con la fecha CRUDA
// del Flex ("20260115" en vez de "2026-01-15").
//
// El defecto: `parseTrades` devolvía `tradeDate` sin normalizar y el sync por
// API la usaba tal cual (el adaptador del archivo sí llamaba a formatDate). Como
// `new Date("20260115")` es Invalid Date, `buildTxEvents` descartaba la fila en
// silencio: el ledger real de compras y ventas del broker era invisible para la
// reconstrucción histórica, que caía a mantener la cantidad de hoy plana hacia
// atrás. Arreglado en el parser; esto limpia lo que ya está en Firestore.
//
// POR QUE HACE FALTA MIGRAR Y NO ALCANZA CON ARREGLAR EL PARSER: el id del
// documento se deriva de la fecha (`${date}-${symbol}-${type}-${centavos}` en
// bulkImport), así que el primer sync con el parser arreglado escribiría un doc
// NUEVO al lado del viejo y el usuario vería cada operación DOS veces.
//
// Por qué re-sellar en vez de borrar: el Flex solo re-entrega ~365 días, así que
// borrar un trade viejo lo perdería para siempre. Se escribe el corregido y
// recién después se borra el viejo (mismo orden que el re-sellado de snapshots
// de badDataCleanup clase 6: un alta que falla no puede dejar el dato huérfano).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Misma normalización que lib/parsers/ibkrFlex.js formatDate, repetida aquí a
// propósito: este módulo tiene que poder leer una fecha que el parser de HOY ya
// no produce, y atarlo a esa función lo dejaría sin nada que reparar el día que
// aquella cambie.
function normalize(raw) {
  if (!raw) return undefined
  const clean = String(raw).trim().split(/[;\s]/)[0].replace(/,/g, '')
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return undefined
}

// Devuelve [{ oldId, tx }] donde `tx` es la transacción con la fecha corregida y
// SIN id (bulkImport le deriva el suyo con el esquema de siempre, así que el id
// nuevo no se calcula acá: no hay dos copias de esa regla que puedan divergir).
//
// Alcance deliberadamente angosto:
//   - solo `_source:'ibkr'` (un movimiento manual nunca tuvo este formato),
//   - solo BUY/SELL (las cash transactions ya pasaban por formatDate),
//   - solo si la fecha guardada NO es ya ISO,
//   - solo si la normalización tiene éxito: una fecha que no entendemos se deja
//     como está, porque borrarla sin poder reescribirla sería perder el dato.
export function staleTradeDateFixes(transactions) {
  const out = []
  for (const tx of transactions || []) {
    if (!tx || tx._source !== 'ibkr' || !tx.id) continue
    const type = String(tx.type || '').toUpperCase()
    if (type !== 'BUY' && type !== 'SELL') continue
    const date = tx.date
    if (!date || ISO_DATE.test(String(date))) continue
    const fixed = normalize(date)
    if (!fixed || fixed === date) continue
    const { id, ...rest } = tx
    out.push({ oldId: id, tx: { ...rest, date: fixed } })
  }
  return out
}
