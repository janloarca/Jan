// Lotes de compra ABIERTOS de una posición, para mostrarlos en su ficha.
//
// Misma regla de dueño que lib/lotClose.js (FASE RF): un lote con `itemId` es
// de esa posición y de ninguna otra. Un lote SIN dueño solo se le atribuye a
// esta posición cuando es la única con ese símbolo (y esa institución, si el
// lote la trae): con dos posiciones iguales no se sabe de cuál es, y decirlo
// sería adivinar. Esos se cuentan aparte (`sharedCount`) para poder avisar.
//
// Puro: sin React ni Firestore.

const up = (v) => String(v || '').trim().toUpperCase()
const isOpen = (l) => l && l.status !== 'closed' && Number(l.quantity) > 0

export function openLotsOfItem(item, lots = [], items = []) {
  const out = { lots: [], totalQty: 0, sharedCount: 0 }
  if (!item || !Array.isArray(lots)) return out
  const sym = up(item.symbol)
  const peers = (items || []).filter((it) => it && !it.isDebt && it.id !== item.id && sym && up(it.symbol) === sym)
  for (const l of lots) {
    if (!isOpen(l)) continue
    if (l.itemId) {
      if (item.id && l.itemId === item.id) out.lots.push(l)
      continue
    }
    if (!sym || up(l.symbol) !== sym) continue
    if (l.institution && item.institution && l.institution !== item.institution) continue
    const rivals = peers.filter((it) => !l.institution || !it.institution || it.institution === l.institution)
    if (rivals.length > 0) { out.sharedCount += 1; continue }
    out.lots.push(l)
  }
  out.lots.sort((a, b) => String(a.acquisitionDate || '').localeCompare(String(b.acquisitionDate || '')))
  out.totalQty = out.lots.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  return out
}
