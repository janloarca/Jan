// FASE OJ. La etiqueta de alcance de un documento NUEVO.
//
// Un portafolio y una entidad son ETIQUETAS (`portfolioId`, `entityId`) sobre
// ítems, lotes y movimientos, no contenedores (ver lib/portfolioDelete.js). El
// tablero filtra por ellas: con "A" seleccionado, `portfolioItems` es
// `(it.portfolioId || '__default__') === 'pA'` (hooks/useDashboardData.js), así
// que TODO documento que se escribe con un portafolio seleccionado tiene que
// nacer con esa etiqueta, o desaparece de la vista en el mismo instante en que
// se crea: el usuario ve "agregado" y no ve nada.
//
// La regla vivía copiada a mano en CUATRO sitios (el alta, el importador de
// archivo, el sync de IBKR en el hook y en el tablero) y ya habían divergido en
// el centinela de entidad; y tres escritores no la tenían en absoluto: la
// cuenta destino creada "en línea" (InlineCreateAccount, cableada como
// `addItem` crudo), Ledger y Blockchain.com. Esta es la única definición.
//
// Centinelas: `'__all__'` (sin filtro) y `'__default__'` (el pseudo-portafolio
// de lo no etiquetado) NO son etiquetas; `'default'` y `'__all__'` para entidad
// tampoco (el tablero traduce `'__all__'` a `'default'` antes de pasárselo a
// los modales, por eso los dos).

export const PORTFOLIO_ALL = '__all__'
export const PORTFOLIO_DEFAULT = '__default__'
export const ENTITY_ALL = '__all__'
export const ENTITY_DEFAULT = 'default'

export function scopeTagFor(activePortfolio, activeEntity) {
  const tag = {}
  if (activePortfolio && activePortfolio !== PORTFOLIO_ALL && activePortfolio !== PORTFOLIO_DEFAULT) {
    tag.portfolioId = activePortfolio
  }
  if (activeEntity && activeEntity !== ENTITY_ALL && activeEntity !== ENTITY_DEFAULT) {
    tag.entityId = activeEntity
  }
  return tag
}

// Devuelve el documento con la etiqueta del alcance activo. Una etiqueta que el
// documento YA trae gana: describe dónde vive (un lote copiado de su ítem, un
// movimiento que llega ya etiquetado); el alcance solo rellena lo que falta.
export function tagForScope(doc, activePortfolio, activeEntity) {
  return { ...scopeTagFor(activePortfolio, activeEntity), ...(doc || {}) }
}
