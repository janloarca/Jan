// FASE OG: qué significa "ver UN portafolio" (o una entidad) para las medidas
// de rendimiento.
//
// El archivo de snapshots (`users/{uid}/snapshots`) es ÚNICO por usuario y cada
// doc 'daily'/'backfill' guarda el patrimonio COMPLETO: el escritor diario y el
// backfill recorren `enrichedItems` (todo lo que el usuario tiene), a
// propósito, para que cambiar de portafolio nunca contamine la serie. La otra
// cara de esa decisión es que, con un portafolio seleccionado, NINGÚN snapshot
// describe lo que la pantalla está mostrando: `totalAssets` mide el subconjunto
// y el ancla del año mide el todo.
//
// Reproducido con el hook real (hooks/__tests__/scopedView.test.js): dos
// portafolios de 20K y 10K que ganaron +10% cada uno; con "A" seleccionado el
// YTD imprimía -26.67% (22,000 hoy contra un ancla de 30,000) y con "B"
// -63.33%. El número sale del universo equivocado, no de una fórmula mala.
//
// La regla (la misma de FASE MI, "comparar lo mismo con lo mismo"): con vista
// escopada el archivo de snapshots NO aplica. El YTD se mide contra la
// reconstrucción por ítem (que sí se escopa), los flujos se escopan por VÍNCULO
// al ítem, y lo que solo puede medirse contra el archivo (mes, riesgo,
// historial anual) se declara no disponible en vez de inventarse. Y a Amigos
// no se publica NUNCA desde una vista escopada: ese número lo leen otras
// personas como "tu retorno".

export function isScopedView({ activePortfolio, activeEntity } = {}) {
  const p = activePortfolio == null ? '__all__' : activePortfolio
  const e = activeEntity == null ? '__all__' : activeEntity
  return p !== '__all__' || e !== '__all__'
}

// Los movimientos que pertenecen a un subconjunto de ítems. Es la MISMA regla
// con la que la gráfica escopa por institución (PortfolioGrowthChart, FASES
// IT/GF), escrita acá aparte porque aquella vive dentro de una superficie
// congelada (D) y escopa por INSTITUCIÓN, no por portafolio; se conserva la
// forma para que las dos no puedan decir cosas distintas sobre el mismo
// movimiento:
//   1. un vínculo VIVO a un ítem decide solo: adentro si el ítem está en el
//      scope, afuera si está en cualquier otro;
//   2. un vínculo MUERTO (el ítem ya no existe) cae a la regla del símbolo;
//   3. una fila de cuenta del broker (símbolo CASH, `_source` ibkr o
//      inferred_flow, sin vínculo) pertenece al scope si el scope tiene ítems
//      de IBKR, y a ningún otro;
//   4. sin vínculo, manda el símbolo (o un holding CASH-* para los flujos CASH).
export function transactionsForItems(transactions, scopedItems, allItems) {
  const txs = Array.isArray(transactions) ? transactions : []
  const scoped = Array.isArray(scopedItems) ? scopedItems : []
  const all = Array.isArray(allItems) ? allItems : scoped
  const scopedIds = new Set(scoped.map((it) => it?.id).filter(Boolean))
  const allIds = new Set(all.map((it) => it?.id).filter(Boolean))
  const scopedSyms = new Set(scoped.map((it) => (it?.symbol || '').toUpperCase()).filter(Boolean))
  const scopedHasCash = scoped.some((it) => /^CASH/i.test(it?.symbol || ''))
  const scopedHasIbkr = scoped.some((it) => it?._source === 'ibkr')
  const LINKS = ['_linkedItemId', '_originItemId', '_destinationItemId', '_debtItemId', '_loanItemId', '_paidFromItemId']
  return txs.filter((tx) => {
    if (!tx) return false
    // Cualquier vínculo vivo a un ítem del scope lo trae adentro: una
    // transferencia nombra origen Y destino, y basta con que uno esté acá.
    let sawLiveLink = false
    for (const k of LINKS) {
      const id = tx[k]
      if (!id) continue
      if (scopedIds.has(id)) return true
      if (allIds.has(id)) sawLiveLink = true
    }
    if (sawLiveLink) return false
    const sym = (tx.symbol || '').toUpperCase()
    if ((tx._source === 'ibkr' || tx._source === 'inferred_flow') && sym.startsWith('CASH')) return scopedHasIbkr
    return (!!tx.symbol && scopedSyms.has(sym)) || (scopedHasCash && sym.startsWith('CASH'))
  })
}
