// Verificación cruzada del ingreso declarado contra el ledger del BROKER.
//
// El pedido del usuario era "verificar en dos sitios para seguridad total": que
// cada dato que entra al archivo se le pregunte a dos fuentes independientes y,
// cuando no coincidan, lo decida él en vez de que la app elija en silencio.
//
// La investigación de proveedores (2 sep 2026) descartó el camino obvio: ningún
// plan gratuito cubre a la vez Londres, Shanghái y Tokio CON datos de dividendo
// (Twelve Data lo cobra aparte y su gratis es solo US; FMP restringe lo
// internacional; Alpha Vantage da 25 llamadas al DÍA). Y ninguno se pudo
// comprobar desde el entorno de desarrollo, que bloquea sus dominios.
//
// Pero la segunda fuente ya está en el archivo y es más fuerte que cualquier
// API gratuita: el Flex de IBKR trae los dividendos que DE VERDAD se cobraron
// (lib/parsers/ibkrFlex.js los captura como `kind:'dividend'` y lib/ibkrSync.js
// los escribe como transacciones DIVIDEND reales). Eso no es otra estimación de
// un proveedor: es el ledger de caja del broker, y cubre justo los mercados
// donde todo proveedor gratuito falla, porque no depende del mercado sino de la
// cuenta.
//
// Así que la comparación es:
//
//     lo que la app PROYECTA que rinde este activo al año
//                        contra
//     lo que el broker de verdad PAGÓ en los últimos 12 meses
//
// Las dos cifras son EFECTIVO y son del mismo activo, así que no hace falta
// ninguna conversión por acción: `projectItemAnnualIncome` ya devuelve el monto
// anual en la moneda del ítem.
//
// ⛔ QUÉ CAZA Y QUÉ NO. Esto existe para atrapar un número equivocado por un
// FACTOR (un decimal corrido, un rendimiento viejo de antes de un recorte, una
// moneda mezclada), nunca para auditar centavos. La banda es ancha a propósito
// y la razón es aritmética, no pereza: un pagador TRIMESTRAL cuyas fechas ex
// caen cerca del borde de la ventana muestra 3 o 5 pagos en 365 días, y eso
// solo ya es ±25% sin que nada esté mal. Una banda angosta gritaría lobo cada
// trimestre y el usuario dejaría de leer el aviso, que es peor que no tenerlo.
//
// REHÚSA ANTES QUE INVENTAR. Cada caso en que la comparación no puede ser
// justa devuelve su propia razón en vez de un "mismatch" que culparía al dato
// del usuario por una limitación nuestra. La lista está abajo, en REASONS.

import { dividendBelongsToItem } from '@/lib/autoDividends'

const DAY_MS = 86400000
const WINDOW_DAYS = 365.25

// El pago más viejo de la ventana tiene que tener al menos esta antigüedad para
// que comparar contra una proyección ANUAL sea justo. Es evidencia, no un
// supuesto: si el primer pago que vemos es de hace dos meses, o la posición es
// nueva o el pagador acaba de empezar, y en los dos casos el año proyectado no
// tiene contra qué medirse. Cubre además el caso en que el reporte del broker
// no alcanza hacia atrás (el Flex tope ~365 días).
const MIN_HISTORY_DAYS = 300

// Banda de acuerdo. Ver la nota de arriba sobre el 3-vs-5 pagos.
const RATIO_LOW = 0.65
const RATIO_HIGH = 1.45

// Piso absoluto en moneda BASE: sin esto una posición de $20 con $4 de
// diferencia dispararía un aviso que no vale el espacio que ocupa.
const MIN_DIFF_BASE = 25

export const REASONS = {
  NO_PROJECTION: 'no-projection',       // el activo no declara ningún ingreso
  REINVESTED: 'reinvested',             // compone: el rendimiento vive DENTRO del saldo, no hay efectivo que comparar
  NO_PAYMENTS: 'no-payments',           // no hay ni un pago en el archivo: no hay segunda fuente
  SHORT_HISTORY: 'short-history',       // el historial no cubre el año
  QUANTITY_CHANGED: 'quantity-changed', // compró o vendió dentro de la ventana
  AMBIGUOUS_SYMBOL: 'ambiguous-symbol', // dos activos comparten símbolo: el pago no se puede atribuir
}

const isIncomeTx = (tx) => {
  const ty = (tx?.type || '').toUpperCase()
  return ty === 'DIVIDEND' || ty === 'INTEREST'
}

const isTradeTx = (tx) => {
  const ty = (tx?.type || '').toUpperCase()
  return ty === 'BUY' || ty === 'SELL'
}

const dayTs = (d) => {
  if (!d) return NaN
  const t = Date.parse(String(d).slice(0, 10))
  return isFinite(t) ? t : NaN
}

// Un INTEREST del broker puede ser interés PAGADO (margen), que llega con
// `_signedAmount` negativo. Eso es un costo, no un ingreso, y sumarlo aquí
// diría que el activo rindió cuando lo que hizo fue cobrarte.
const receivedAmount = (tx) => {
  const signed = Number(tx?._signedAmount)
  if (isFinite(signed) && signed < 0) return 0
  const amt = Number(tx?.totalAmount ?? tx?.amount)
  return isFinite(amt) && amt > 0 ? amt : 0
}

/**
 * Compara la proyección de ingreso anual de UN activo contra lo que su ledger
 * dice que pagó en los últimos 12 meses.
 *
 * @param item             el activo (crudo o enriquecido)
 * @param transactions     TODAS las transacciones (se filtran acá)
 * @param projectedAnnual  el ingreso anual proyectado, EN LA MONEDA DEL ÍTEM
 *                         (o sea, lo que devuelve projectItemAnnualIncome)
 * @param itemCurrency     moneda del ítem
 * @param baseCurrency     moneda base, solo para el piso absoluto
 * @param convert          (amount, from, to) => amount
 * @param sharedSymbol     true si otro activo del portafolio comparte símbolo
 * @param nowMs            inyectable para tests
 *
 * @returns {{status:'verified'|'mismatch'|'unverifiable', reason:string|null,
 *            projected:number, actual:number, ratio:number|null, payments:number}}
 */
export function verifyItemIncome({
  item,
  transactions = [],
  projectedAnnual = 0,
  itemCurrency = 'USD',
  baseCurrency = 'USD',
  convert,
  sharedSymbol = false,
  nowMs = Date.now(),
} = {}) {
  const cv = (amount, from, to) => {
    if (!amount || !from || !to || from === to || typeof convert !== 'function') return amount || 0
    const out = convert(amount, from, to)
    return isFinite(out) ? out : amount
  }
  const refuse = (reason) => ({ status: 'unverifiable', reason, projected: 0, actual: 0, ratio: null, payments: 0 })

  if (!item) return refuse(REASONS.NO_PROJECTION)

  const projected = Number(projectedAnnual) || 0
  if (!(projected > 0)) return refuse(REASONS.NO_PROJECTION)

  // Una cuenta que REINVIERTE no paga efectivo: el rendimiento se queda dentro
  // del saldo por diseño, así que no hay ledger contra el cual contrastar. Es
  // el mismo gate que `income-no-dest` e `income-never-received` ya aplican.
  if (item.dividendAction === 'reinvest') return refuse(REASONS.REINVESTED)

  // Dos activos con el mismo símbolo (dos posiciones de Bitcoin, el caso real
  // de FASE HV11): un pago sin `_linkedItemId` empareja con los DOS por
  // símbolo, así que atribuirlo sería adivinar. Se rehúsa, igual que
  // `unlinkedOpeningDeposits` rehúsa cuando el símbolo no resuelve a uno solo.
  if (sharedSymbol && !transactions.some((tx) => tx._linkedItemId === item.id)) {
    return refuse(REASONS.AMBIGUOUS_SYMBOL)
  }

  const from = nowMs - WINDOW_DAYS * DAY_MS
  let actual = 0
  let payments = 0
  let earliestTs = Infinity
  let tradedInWindow = false

  for (const tx of transactions) {
    if (!dividendBelongsToItem(tx, item)) continue
    const ts = dayTs(tx.date)
    if (!isFinite(ts) || ts < from || ts > nowMs) continue
    if (isTradeTx(tx)) { tradedInWindow = true; continue }
    if (!isIncomeTx(tx)) continue
    const amt = receivedAmount(tx)
    if (!(amt > 0)) continue
    actual += cv(amt, tx.currency || itemCurrency, itemCurrency)
    payments += 1
    if (ts < earliestTs) earliestTs = ts
  }

  if (payments === 0) return refuse(REASONS.NO_PAYMENTS)

  // El orden importa: la cantidad cambiada se reporta antes que el historial
  // corto porque es la causa más accionable de las dos (comprar más a mitad de
  // año explica el hueco sin que nada esté mal en el dato declarado).
  if (tradedInWindow) return refuse(REASONS.QUANTITY_CHANGED)
  if ((nowMs - earliestTs) / DAY_MS < MIN_HISTORY_DAYS) return refuse(REASONS.SHORT_HISTORY)

  const ratio = actual / projected
  const diffBase = Math.abs(cv(actual - projected, itemCurrency, baseCurrency))
  const withinBand = ratio >= RATIO_LOW && ratio <= RATIO_HIGH
  const status = withinBand || diffBase < MIN_DIFF_BASE ? 'verified' : 'mismatch'
  return { status, reason: null, projected, actual, ratio, payments }
}

/**
 * Corre la verificación sobre una lista de activos.
 *
 * `projections` es un Map itemId -> ingreso anual proyectado EN LA MONEDA DEL
 * ÍTEM. Lo calcula el caller porque el rendimiento de un activo de mercado NO
 * se persiste: `useMarketPrices` lo resuelve en vivo desde Yahoo en cada render
 * y solo vive en el ítem ENRIQUECIDO. Pasarlo como mapa es el mismo patrón que
 * `resolvedPrices` en dataCompleteness, y es lo que deja este módulo puro.
 */
export function verifyIncomeForItems({
  items = [],
  transactions = [],
  projections,
  baseCurrency = 'USD',
  convert,
  nowMs = Date.now(),
} = {}) {
  const out = new Map()
  if (!projections || typeof projections.get !== 'function') return out

  const symbolCount = new Map()
  for (const it of items) {
    const sym = String(it.symbol || it.name || '').toUpperCase()
    if (sym) symbolCount.set(sym, (symbolCount.get(sym) || 0) + 1)
  }

  for (const it of items) {
    if (!it?.id || it.isDebt) continue
    const sym = String(it.symbol || it.name || '').toUpperCase()
    const res = verifyItemIncome({
      item: it,
      transactions,
      projectedAnnual: projections.get(it.id) || 0,
      itemCurrency: it.currency || it._originalCurrency || 'USD',
      baseCurrency,
      convert,
      sharedSymbol: sym ? (symbolCount.get(sym) || 0) > 1 : false,
      nowMs,
    })
    out.set(it.id, res)
  }
  return out
}
