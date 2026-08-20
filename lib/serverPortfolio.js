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
import { isReinvestedDividend, reinvestIndex } from './dividendCash'

// Espejo exacto de convert() en useExchangeRates: sin tasa para alguna de las
// dos monedas devuelve el monto CRUDO, nunca cero. Un cero silencioso borra
// una cuenta entera del patrimonio; el monto crudo, en el peor caso, la deja
// en la moneda equivocada y eso se nota.
export function makeConvert(rates, baseCurrency = 'USD') {
  return (amount, fromCurrency, toCurrency) => {
    if (!amount || !rates) return amount || 0
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseCurrency || 'USD').toUpperCase()
    if (from === to) return amount
    const fromRate = rates[from]
    const toRate = rates[to]
    if (!fromRate || !toRate) return amount
    const result = (amount / fromRate) * toRate
    return isFinite(result) ? result : amount
  }
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

// FASE IE7. Las dos cifras de ingreso del reporte, replicadas EXACTAMENTE del
// hook del cliente (`annualDividends` / `estimatedAnnualIncome` en
// useDashboardData). Sin ellas, el reporte que viaja adjunto imprimía
// "Dividends, trailing 12 months $0.00" y "Projected annual income $0.00" en
// un documento que dos líneas más arriba decía "Income collected $579.06":
// un cero inventado que además se contradice a sí mismo (reporte real del
// usuario). La regla del repo es que un dato ausente se OMITE, nunca se
// imprime en cero, y aquí ni siquiera está ausente: es derivable.

// Dividendos de los ÚLTIMOS 12 MESES (nunca de por vida: la etiqueta dice
// "trailing 12 months" y una suma histórica la sobreestimaría más cada año).
// Los reinvertidos y los sin fecha quedan fuera, igual que en el cliente.
export function trailingDividends(transactions, { convert, baseCurrency = 'USD', now = new Date(), items = null } = {}) {
  const cutoff = now.getTime() - 365 * 86400000
  // FASE JV: la MISMA regla que periodIncome, unas líneas más abajo en este
  // mismo archivo. Tenían dos: esta miraba solo `tx._reinvested`, así que un
  // pago escrito antes de que la cuenta pasara a reinvertir se contaba como
  // efectivo cobrado y el correo podía decir dos cosas sobre el mismo dinero.
  const byId = reinvestIndex(items)
  return (transactions || []).reduce((sum, tx) => {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND') return sum
    if (isReinvestedDividend(tx, byId)) return sum
    const ts = tx.date ? new Date(tx.date).getTime() : NaN
    if (isNaN(ts) || ts < cutoff) return sum
    const amt = tx.totalAmount ?? 0
    return sum + (convert ? convert(amt, tx.currency || 'USD', baseCurrency) : amt)
  }, 0)
}

// Ingreso ANUAL PROYECTADO de las posiciones de hoy (tasas declaradas), con
// el mismo manejo de moneda original que el cliente.
export function projectedAnnualIncome(items, { convert, baseCurrency = 'USD', projectItemAnnualIncome } = {}) {
  if (!projectItemAnnualIncome) return 0
  let total = 0
  for (const it of items || []) {
    const qty = it.quantity || 1
    const origPrice = it._originalPrice ?? it._originalPurchasePrice ?? 0
    const itemCur = it._originalCurrency || it.currency || 'USD'
    const hasOriginal = origPrice > 0
    const price = hasOriginal ? origPrice : (it.currentPrice || it.purchasePrice || 0)
    const annual = projectItemAnnualIncome(it, qty * price)
    if (annual > 0) {
      const cur = hasOriginal ? itemCur : baseCurrency
      total += convert ? convert(annual, cur, baseCurrency) : annual
    }
  }
  return total
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
    if (isReinvestedDividend(tx, byId)) continue
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
