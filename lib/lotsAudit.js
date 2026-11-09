// Vista de SOLO LECTURA: por posición de mercado, su cantidad guardada contra la
// suma de lotes abiertos del mismo símbolo. No escribe nada. La cobertura de
// lotes es por SÍMBOLO (igual que lib/dataCompleteness.js, aviso
// uncovered-shares), así que el 'gap' del grupo es lo que dispara el aviso.
export function buildLotsAudit(items = [], lots = []) {
  const groups = new Map()
  for (const it of items) {
    if (!it || !it.symbol || it.isDebt) continue
    const sym = String(it.symbol).toUpperCase()
    const g = groups.get(sym) || { symbol: sym, positions: [], qty: 0, openLots: [], openQty: 0 }
    g.positions.push({ id: it.id, name: it.name || sym, institution: it.institution || '', quantity: Number(it.quantity) || 0 })
    g.qty += Number(it.quantity) || 0
    groups.set(sym, g)
  }
  for (const lot of lots) {
    if ((lot.status || 'open') !== 'open') continue
    const g = groups.get(String(lot.symbol || '').toUpperCase())
    if (!g) continue
    const q = Number(lot.quantity) || 0
    g.openLots.push({ id: lot.id, quantity: q, date: lot.acquisitionDate || null, cost: lot.costBasis ?? lot.purchasePrice ?? null, institution: lot.institution || '' })
    g.openQty += q
  }
  return [...groups.values()]
    .filter((g) => g.openLots.length > 0 || g.qty > 0)
    .map((g) => ({ ...g, gap: g.qty - g.openQty }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
}
