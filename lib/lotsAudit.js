// Vista de SOLO LECTURA: por posición de mercado, su cantidad guardada contra la
// suma de lotes abiertos del mismo símbolo. No escribe nada. La cobertura de
// lotes es por SÍMBOLO (igual que lib/dataCompleteness.js, aviso
// uncovered-shares), así que el 'gap' del grupo es lo que dispara el aviso.
import { isMarketPriced } from '../components/dashboard/utils'

// FASE RY: solo posiciones de MERCADO. Una cuenta de saldo (PRUEBA GTQ, un
// banco, un bono) guarda su valor en el precio con cantidad 1, o 0 al
// vaciarla, y su lote de apertura no describe unidades: compararlos daba
// "posiciones 0 · lotes abiertos 1 · diferencia -1", una diferencia que no
// significa nada y que el aviso de lotes (uncovered-shares) tampoco mira.
export function buildLotsAudit(items = [], lots = []) {
  const groups = new Map()
  for (const it of items) {
    if (!it || !it.symbol || it.isDebt || !isMarketPriced(it)) continue
    const sym = String(it.symbol).toUpperCase()
    const g = groups.get(sym) || { symbol: sym, positions: [], qty: 0, openLots: [], openQty: 0 }
    g.positions.push({ id: it.id, name: it.name || sym, institution: it.institution || '', quantity: Number(it.quantity) || 0, date: it.acquisitionDate || null })
    g.qty += Number(it.quantity) || 0
    groups.set(sym, g)
  }
  for (const lot of lots) {
    if ((lot.status || 'open') !== 'open') continue
    const g = groups.get(String(lot.symbol || '').toUpperCase())
    if (!g) continue
    const q = Number(lot.quantity) || 0
    g.openLots.push({ id: lot.id, quantity: q, date: lot.acquisitionDate || null, cost: lot.costBasis ?? lot.purchasePrice ?? null, itemId: lot.itemId || null, institution: lot.institution || '' })
    g.openQty += q
  }
  // Cómo DEBERÍA quedar cada lote: el de la posición (por dueño, o por la misma
  // fecha de compra si no tiene dueño). `lotQty` null = no se pudo emparejar.
  for (const g of groups.values()) {
    for (const p of g.positions) {
      const own = g.openLots.filter((l) => l.itemId && l.itemId === p.id)
      const byDate = own.length ? own : g.openLots.filter((l) => !l.itemId && p.date && l.date === p.date)
      p.lotId = byDate.length === 1 ? byDate[0].id : null
      p.lotQty = byDate.length ? byDate.reduce((a, l) => a + l.quantity, 0) : null
      p.lotGap = p.lotQty == null ? null : p.quantity - p.lotQty
    }
  }
  return [...groups.values()]
    .filter((g) => g.openLots.length > 0 || g.qty > 0)
    .map((g) => ({ ...g, gap: g.qty - g.openQty }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
}
