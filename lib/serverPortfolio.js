// FASE HZ. Valorar el portafolio de un usuario DESDE EL SERVIDOR, para los
// correos periódicos.
//
// El problema que resuelve: los items en Firestore no guardan el precio de
// mercado (por diseño, ver CLAUDE.md FASE EZ4). El navegador lo resuelve en
// vivo en cada render, así que un cron que lea Firestore directo vería cada
// acción en cero. Este módulo reproduce EXACTAMENTE el mismo pipeline de
// enriquecimiento que corre en el cliente, en el mismo orden:
//
//   1. useMarketPrices: aplica la cotización al item (solo si isMarketPriced),
//      guardando currentPrice / marketCurrency / change7d.
//   2. useDashboardData.enrichedItems: convierte precio y precio de compra a
//      la moneda base, guardando los originales en _original*.
//
// Si esos dos pasos divergen del cliente, el correo contradice al dashboard,
// que es la clase de bug que costó media sesión en los reportes. Por eso la
// función de enriquecimiento es PURA y está testeada contra la forma real.
//
// Las tasas de cambio salen del ÚLTIMO SNAPSHOT del usuario, que las archiva
// (`rates`) justo para esto: son las mismas tasas con las que la app calculó,
// y evita una llamada extra a un proveedor de FX desde el cron.

import { isMarketPriced } from '../components/dashboard/utils'
import { convertWithRates } from './penceCurrency'

/// Espejo exacto de convert() en useExchangeRates: sin tasa para alguna de las
// dos monedas devuelve el monto CRUDO, nunca cero. Un cero silencioso borra
// una cuenta entera del patrimonio; el monto crudo, en el peor caso, la deja
// en la moneda equivocada y eso se nota.
// FASE ID: "espejo exacto" dejó de ser una promesa de copia y pasó a ser el
// MISMO código: la aritmética (incluida la normalización de peniques GBp/GBX)
// vive en lib/penceCurrency.js y ambos la llaman.
export function makeConvert(rates, baseCurrency = 'USD') {
  return (amount, fromCurrency, toCurrency) =>
    convertWithRates(amount, fromCurrency || 'USD', toCurrency || baseCurrency || 'USD', rates)
}

/**
 * Aplica cotizaciones y conversión de moneda a los items crudos de Firestore,
 * en el MISMO orden que el cliente.
 * @param {Array} items    items crudos de Firestore
 * @param {object} prices  mapa por símbolo: { price, change7d, change1d, currency }
 * @param {Function} convert
 * @param {string} baseCurrency
 */
export function enrichItemsServerSide(items, prices = {}, convert, baseCurrency = 'USD') {
  return (items || []).map((it) => {
    const sym = (it.symbol || '').toUpperCase()
    const priceData = prices[sym] || prices[it.symbol]
    const enriched = { ...it }

    // Defensa en profundidad, igual que el cliente: una cotización que se cuele
    // (caché viejo, símbolo compartido) NUNCA pisa el saldo guardado de un
    // item que no cotiza.
    if (priceData && isMarketPriced(it)) {
      enriched.currentPrice = priceData.price
      enriched.change7d = priceData.change7d
      enriched.change1d = priceData.change1d
      enriched.marketCurrency = priceData.currency
    }

    const itemCurrency = enriched.marketCurrency || enriched.currency || 'USD'
    const price = enriched.currentPrice || enriched.purchasePrice || enriched.price || enriched.cost || 0
    const convertedPrice = convert(price, itemCurrency, baseCurrency)
    const purchaseConverted = enriched.purchasePrice
      ? convert(enriched.purchasePrice, enriched.currency || 'USD', baseCurrency)
      : 0

    return {
      ...enriched,
      currentPrice: convertedPrice,
      purchasePrice: purchaseConverted != null ? purchaseConverted : enriched.purchasePrice,
      _originalPrice: price,
      _originalPurchasePrice: enriched.purchasePrice || 0,
      _originalCurrency: itemCurrency,
      _displayCurrency: baseCurrency,
    }
  })
}

// Los mayores movimientos de la semana, por impacto en el portafolio y no por
// el % del papel: una posición de $50 que sube 30% no es la noticia de la
// semana de nadie. Requiere change7d, que solo traen los activos cotizados.
export function weeklyMovers(enrichedItems, { limit = 3 } = {}) {
  const scored = (enrichedItems || [])
    .filter((it) => it.symbol && isFinite(it.change7d) && it.change7d !== 0)
    .map((it) => {
      const value = (Number(it.quantity) || 0) * (Number(it.currentPrice) || 0)
      return { symbol: String(it.symbol).toUpperCase(), pct: it.change7d, impact: Math.abs(value * (it.change7d / 100)) }
    })
    .filter((m) => m.impact > 0)
    .sort((a, b) => b.impact - a.impact)
  return scored.slice(0, limit).map(({ symbol, pct }) => ({ symbol, pct }))
}

// Ingreso COBRADO en una ventana: dividendos e intereses que de verdad
// movieron efectivo. Lo reinvertido se excluye (nunca salió del activo), misma
// regla que el resto de la app.
export function incomeInWindow(transactions, { fromTs, toTs, convert, baseCurrency = 'USD', items = [] }) {
  const byId = new Map((items || []).map((it) => [it.id, it]))
  let total = 0
  let count = 0
  for (const tx of transactions || []) {
    const ty = (tx.type || '').toUpperCase()
    if (ty !== 'DIVIDEND' && ty !== 'INTEREST') continue
    if (!tx.date) continue
    const ts = new Date(tx.date).getTime()
    if (isNaN(ts) || ts < fromTs || ts > toTs) continue
    const raw = Number(tx.totalAmount ?? tx.amount ?? 0)
    if (!(raw > 0)) continue
    const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
    if (tx._reinvested === true || (linked && linked.dividendAction === 'reinvest')) continue
    total += convert ? convert(raw, tx.currency || 'USD', baseCurrency) : raw
    count++
  }
  return { total, count }
}

// Patrimonio neto desde items ya enriquecidos: el MISMO bucle del que sale
// `netWorth` en el dashboard (deuda en negativo, por-cobrar excluido si el
// usuario lo sacó), para que el correo no pueda mostrar otro número.
export function netWorthFromItems(enrichedItems, { isExcluded, getValue }) {
  let assets = 0
  let debt = 0
  for (const it of enrichedItems || []) {
    if (isExcluded(it)) continue
    const val = getValue(it)
    if (it.isDebt) debt += Math.abs(val)
    else assets += val
  }
  return { netWorth: assets - debt, totalAssets: assets, totalDebt: debt }
}
