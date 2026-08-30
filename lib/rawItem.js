// El ítem tal como está GUARDADO, a partir del ítem enriquecido que ve la UI.
//
// `useDashboardData` convierte `currentPrice`/`purchasePrice` a la moneda BASE
// para mostrarlos y deja el valor guardado en `_originalPrice` /
// `_originalPurchasePrice` / `_originalCurrency`. Todo lo que vaya a ESCRIBIR
// (o a calcular un parche que se va a escribir) tiene que trabajar sobre los
// campos crudos: `lib/contributions.js` lo dice en su primera línea, "operates
// on RAW item fields (item's own currency), never on enriched/base-converted
// values".
//
// El defecto que obligó a compartir esto: la celda de la Hoja le pasaba el ítem
// ENRIQUECIDO a `planCellEdit`, que suma un delta en moneda ORIGINAL sobre un
// costo ya convertido a base. Con base USD y una cuenta en quetzales, teclear
// Q5,200 sobre un saldo de Q5,000 escribía Q849.35: la cuenta perdía Q4,350 con
// el banner verde de "guardado" encima. `EditAccountModal` ya tenía esta
// función y la Hoja no la conocía, que es exactamente cómo una copia se queda
// atrás (`InfoTip`, `lib/transferTx.js`, la lista de códigos ISO).
export function toRawItem(item) {
  if (!item) return item
  const {
    _originalPrice, _originalPurchasePrice, _originalCurrency, _displayCurrency,
    totalValue, percentOfPortfolio, change1d, change7d, change30d, pnlPercent,
    marketCurrency, _category, ...rawItem
  } = item
  if (_originalPrice != null) rawItem.currentPrice = _originalPrice
  if (_originalPurchasePrice != null) rawItem.purchasePrice = _originalPurchasePrice
  if (_originalCurrency != null) rawItem.currency = _originalCurrency
  return rawItem
}
