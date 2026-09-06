// FASE OH. Qué documentos se quedan HUÉRFANOS al borrar un portafolio.
//
// Un portafolio es una ETIQUETA (`portfolioId`) sobre ítems y lotes, no un
// contenedor: borrar su doc no borra nada de adentro. `deleteEntity`
// (hooks/useEntities.js) ya lo sabía y re-ubica a "Personal" ANTES de borrar
// el doc, con la razón escrita: "otherwise those docs keep a dead entityId and
// vanish from every per-entity view". `deletePortfolio` no lo hacía, y el
// efecto es el mismo: los ítems siguen existiendo (nada se pierde), pero con un
// `portfolioId` que no resuelve a ningún portafolio quedan invisibles en TODO
// portafolio seleccionable y solo aparecen en "Todos". Y si el borrado era el
// portafolio ACTIVO, el tablero se quedaba mirando un subconjunto fantasma
// mientras el selector, que no encuentra el id, imprime "Todos".
//
// Este módulo solo DECIDE; quien escribe es el hook. Se lee de las colecciones
// que el listener ya tiene en memoria y no de una consulta `where` (cero
// lecturas de Firestore: la misma razón que lib/financeWipe.js).
export const PORTFOLIO_ALL = '__all__'
export const PORTFOLIO_DEFAULT = '__default__'

function tagged(list, portfolioId) {
  return (list || [])
    .filter((d) => d && typeof d.id === 'string' && d.portfolioId === portfolioId)
    .map((d) => d.id)
}

/**
 * @returns {{ itemIds: string[], lotIds: string[], transactionIds: string[], refused: string|null }}
 *  `refused` nombra por qué no hay plan: el pseudo-portafolio "Todos" y el
 *  default implícito no son documentos y no se pueden borrar.
 */
export function planPortfolioDelete(portfolioId, { items, lots, transactions } = {}) {
  const empty = { itemIds: [], lotIds: [], transactionIds: [] }
  if (!portfolioId || typeof portfolioId !== 'string') return { ...empty, refused: 'no-id' }
  if (portfolioId === PORTFOLIO_ALL || portfolioId === PORTFOLIO_DEFAULT) return { ...empty, refused: 'pseudo-portfolio' }
  return {
    itemIds: tagged(items, portfolioId),
    lotIds: tagged(lots, portfolioId),
    transactionIds: tagged(transactions, portfolioId),
    refused: null,
  }
}

/** El portafolio activo después de borrar `deletedId`: el mismo si sobrevive, "Todos" si era el borrado. */
export function activePortfolioAfterDelete(activePortfolio, deletedId) {
  return activePortfolio === deletedId ? PORTFOLIO_ALL : activePortfolio
}
