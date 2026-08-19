const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', MXN: '$', GTQ: 'Q', COP: '$',
  CLP: '$', ARS: '$', BRL: 'R$', PEN: 'S/', CAD: '$', CHF: 'CHF',
  JPY: '¥', CNY: '¥',
}

let _baseCurrency = 'USD'
export function setBaseCurrency(code) { _baseCurrency = code || 'USD' }
export function getBaseCurrency() { return _baseCurrency }

let _lang = 'en'
export function setLang(code) { _lang = code || 'en' }

export function formatCurrency(value, currency) {
  if (value == null || !isFinite(value)) return '$0.00'
  const cur = currency || _baseCurrency
  const locale = _lang === 'es' ? 'es-US' : 'en-US'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(value)
  } catch {
    const sym = CURRENCY_SYMBOLS[cur] || '$'
    return `${sym}${value.toFixed(2)}`
  }
}

export function formatCompact(value, currency) {
  if (value == null || !isFinite(value)) return '$0'
  const sym = CURRENCY_SYMBOLS[currency || _baseCurrency] || '$'
  if (Math.abs(value) >= 1000000000) return sym + (value / 1000000000).toFixed(1) + 'B'
  if (Math.abs(value) >= 1000000) return sym + (value / 1000000).toFixed(1) + 'M'
  if (Math.abs(value) >= 1000) return sym + (value / 1000).toFixed(1) + 'K'
  return sym + value.toFixed(0)
}

// Compact axis-tick label whose decimal precision adapts to the gap between
// ticks, so a small value range (e.g. $6,000–$6,300) doesn't collapse every
// tick to the same rounded "$6.0K". `step` is the value distance between ticks.
// `opts` es puramente aditivo: sin él el resultado es idéntico al de siempre.
//   symbol:false     -> sin símbolo de moneda, porque la unidad ya se dice UNA
//                       vez en el rótulo del eje en vez de en cada marca.
//   exactSteps:true  -> las marcas caen en múltiplos exactos del paso (ejes
//                       "nice"), así que redondear al paso no miente y no hace
//                       falta el decimal de más. El piso de 1 decimal existe
//                       para un paso arbitrario, donde $6,700 impreso como "$7K"
//                       sí sería una mentira del 4.5%; con marcas redondas ese
//                       caso no puede darse y "10.0K" solo es ruido.
export function formatAxisTick(value, step, currency, opts) {
  if (value == null || !isFinite(value)) return opts?.symbol === false ? '0' : '$0'
  const sym = opts?.symbol === false ? '' : (CURRENCY_SYMBOLS[currency || _baseCurrency] || '$')
  const minDec = opts?.exactSteps ? 0 : 1
  const abs = Math.abs(value)
  // Decimals needed at a given scale so one step changes a shown digit.
  const decimalsFor = (scaledStep, min) => {
    if (!isFinite(scaledStep) || scaledStep <= 0) return min
    return Math.min(3, Math.max(min, Math.ceil(-Math.log10(scaledStep))))
  }
  if (abs >= 1000000) {
    return sym + (value / 1e6).toFixed(decimalsFor((step || 0) / 1e6, minDec)) + 'M'
  }
  if (abs >= 1000) {
    return sym + (value / 1e3).toFixed(decimalsFor((step || 0) / 1e3, minDec)) + 'K'
  }
  return sym + value.toFixed(decimalsFor(step || 0, 0))
}

function coerceDate(v) {
  if (!v) return null
  if (typeof v === 'string' || typeof v === 'number') return new Date(v)
  if (typeof v.toDate === 'function') return v.toDate()
  if (v.seconds != null) return new Date(v.seconds * 1000)
  return new Date(String(v))
}

export function formatDate(dateStr) {
  if (!dateStr) return '-'
  const locale = _lang === 'es' ? 'es' : 'en-US'
  try {
    const d = coerceDate(dateStr)
    if (!d || isNaN(d.getTime())) return typeof dateStr === 'string' ? dateStr : '-'
    // Date-only strings ("2026-06-26") parse as UTC midnight; formatting them in
    // the local timezone shifts the shown day back one for any user behind UTC
    // (all of LatAm). Format calendar dates in UTC so Jun 26 stays Jun 26.
    const isUtcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', ...(isUtcMidnight ? { timeZone: 'UTC' } : {}) })
  } catch { return typeof dateStr === 'string' ? dateStr : '-' }
}

export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = coerceDate(dateStr)
    if (!d || isNaN(d.getTime())) return typeof dateStr === 'string' ? dateStr : ''
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } catch { return typeof dateStr === 'string' ? dateStr : '' }
}

// Human-readable month label from a "YYYY-MM" key, e.g. "2026-06" -> "Jun 26".
// Localized via the module `_lang`. Never render the raw key to users.
export function formatMonth(monthKey) {
  if (!monthKey || typeof monthKey !== 'string') return monthKey || ''
  const [y, m] = monthKey.split('-')
  if (!y || !m) return monthKey
  const locale = _lang === 'es' ? 'es' : 'en'
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
  if (isNaN(d.getTime())) return monthKey
  const label = d.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Single source of truth for "should this item get live market quotes?".
// This MUST be a default-deny whitelist: the old per-consumer blacklists let
// cash/bond items with short symbols ("USD", "TE", "BOT") fetch UNRELATED Yahoo
// tickers ("USD" is a real 2× leveraged ETF), silently replacing the stored
// balance with an equity price — corrupting net worth, movers and snapshots.
// Worst case under default-deny is a legit asset showing its manual price.
const NON_MARKET_TYPE_RE = /inmueble|bank|banco|real.?estate|property|alternative|bond|bono|debt|deuda|pasivo|cash|saving|checking|cuenta|ahorro|efectivo|deposito|depósito|certificado|cdt|plazo|letra|pagar|tesoro|treasury|renta.?fija|fixed.?income|receivable|inversion|inversión/i
const MARKET_TYPE_RE = /stock|accion|acción|equity|share|reit|etf|fund|crypto|cripto|blockchain|token|index|mutual/i
export function isMarketPriced(item) {
  if (!item || !item.symbol) return false
  if (item.isIlliquid || item.isDebt || item.isReceivable) return false
  const t = item.type || ''
  // Acción común/preferente de empresa PRIVADA: item.type sigue siendo
  // 'Stock' (matchea MARKET_TYPE_RE), pero subtype la distingue de una acción
  // de mercado real. Sin esto, el symbol sintético que AddAccountModal arma
  // del nombre (ej. "ACME-INC") dispararía un fetch a Yahoo Finance que
  // puede COINCIDIR con un ticker real no relacionado — el mismo riesgo por
  // el que este archivo ya es default-deny (ver comentario de arriba).
  if (t === 'Stock' && (item.subtype === 'private_common' || item.subtype === 'private_preferred' || item.subtype === 'private')) return false
  if (NON_MARKET_TYPE_RE.test(t)) return false
  if (MARKET_TYPE_RE.test(t)) return true
  const cat = getTypeCategory(item)
  return cat === 'stocks' || cat === 'crypto' || cat === 'funds'
}

// Un pasivo (isDebt) es una obligación propia o de una empresa, no un
// instrumento de inversión: no tiene retorno propio que medir (por eso todo
// cálculo de ganancia/rendimiento de esta app lo excluye desde el filtro más
// externo — AssetAllocation, InstitutionPerformance, NetWorthCard), solo resta
// del patrimonio. Copy compartido para que cualquier superficie que lo
// muestre junto a categorías de inversión (la fila "Pasivos" del Spreadsheet,
// el selector de tipo de AddAccountModal) lo aclare con el MISMO texto.
export const DEBT_CLARIFICATION = {
  es: 'Pasivo propio o de empresa: no es un instrumento de inversión, no genera retorno, solo resta del patrimonio.',
  en: 'A personal or company liability: not an investment instrument, it earns no return, it only subtracts from net worth.',
}

export function getTypeCategory(itemOrType) {
  if (!itemOrType) return 'other'
  const type = typeof itemOrType === 'string' ? itemOrType : itemOrType.type || ''
  if (typeof itemOrType === 'object' && itemOrType.isReceivable) return 'receivables'
  if (typeof itemOrType === 'object' && itemOrType.isDebt) return 'debts'
  const t = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/receivable|cobrar|por.cobrar/i.test(t)) return 'receivables'
  if (/^debt$/i.test(t) || /pasivo|liability|mortgage|hipoteca|loan|prestamo|credit.?card|tarjeta/i.test(t)) return 'debts'
  if (/crypto|cripto|blockchain|bitcoin|btc|eth|token|coin/i.test(t)) return 'crypto'
  if (/realestate|real.?estate|inmueble|property|crowdfund/i.test(t)) return 'realestate'
  if (/alternative|alternativ|safe.?note|vc.?fund|private.?equity|club.?deal|collectible/i.test(t)) return 'alternatives'
  if (/stock|accion|equity|reit|share/i.test(t)) return 'stocks'
  if (/bond|bono|instrumento|inversion|cdt|plazo|treasury|letra|pagare|deposito|certificado/i.test(t)) return 'bonds'
  if (/fund|fondo|etf|index|mutual/i.test(t)) return 'funds'
  if (/bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(t)) return 'banks'
  return 'other'
}

export { CATEGORY as TYPE_COLORS, CHART_PALETTE } from '@/lib/colors'

// Etiquetas visibles de las categorías de getTypeCategory. Ya existían CUATRO
// copias locales de este mapa (NetWorthCard, AccountReviewModal,
// PatrimonioSpreadsheet, PortfolioSpreadsheet); esta es la compartida para
// consumidores nuevos (los reportes, FASE HT). Las copias viejas quedan donde
// están a propósito (alguna diverge adrede, ej. "Bonos Corporativo" en el
// Spreadsheet), pero nada nuevo debe crear una quinta.
export const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos', en: 'Funds' },
  stocks: { es: 'Acciones', en: 'Stocks' },
  crypto: { es: 'Cripto', en: 'Crypto' },
  alternatives: { es: 'Alternativos', en: 'Alternatives' },
  bonds: { es: 'Bonos', en: 'Bonds' },
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  receivables: { es: 'Por Cobrar', en: 'Receivables' },
  debts: { es: 'Pasivos', en: 'Liabilities' },
  other: { es: 'Otros', en: 'Other' },
}

export function categoryLabel(cat, lang) {
  return CATEGORY_LABELS[cat]?.[lang === 'es' ? 'es' : 'en'] || cat
}

// Orden de presentación de esas categorías (el del Spreadsheet). Compartido
// entre PortfolioSpreadsheet y el spreadsheet adjunto del correo mensual
// (lib/monthlySpreadsheet.js): dos órdenes distintos harían que "el mismo
// archivo" no se lea igual en pantalla que en el correo.
export const CATEGORY_ORDER = ['banks', 'funds', 'stocks', 'crypto', 'alternatives', 'bonds', 'realestate', 'other', 'receivables', 'debts']

export function getItemPrice(item) {
  if (item.isIlliquid && item.lastManualValuation > 0) return item.lastManualValuation
  const candidates = [item.currentPrice, item.purchasePrice, item.price, item.cost, item.averagePrice]
  for (const c of candidates) {
    if (c != null && isFinite(c) && c > 0) return c
  }
  return 0
}

export function getItemValue(item) {
  const qty = Number(item.quantity) || 0
  const val = qty * getItemPrice(item)
  if (!isFinite(val)) return 0
  if (item.isDebt) return -Math.abs(val)
  return val
}

export function isExcludedFromNetWorth(item) {
  return !!(item.isReceivable && !item.countInNetWorth)
}

// ⛔ LÓGICA CONGELADA. Estas dos funciones (getItemCostBasis y
// getItemPrincipalCost) son las dos de las tres cantidades sobre las que se
// apoya TODA la fórmula de retorno de un activo con costo de entrada. Antes de
// tocarlas, leer lib/assetLogic/corporateBondWithEntryFee.js y seguir el
// protocolo de su cabecera: hay que PREGUNTAR antes de cambiarlas.
// El invariante que no se puede romper: costBasis - principalCost === entryFee.
//
// What you actually put in: purchase cost PLUS the one-time entry/brokerage
// fee (Costos y comisiones). A fee is real money that left your pocket, so
// leaving it out of "cost" overstates return the same way ignoring the fee
// entirely does — every return-% calc that compares gain against cost must
// use THIS, not qty*purchasePrice alone, or the same $ of fee shows up in
// some numbers and not others.
// Total cash that left your pocket to own this. Which side of the entry fee
// the typed "Valor compra" sits on is the user's call (entryFeeMode):
//  - 'separate' (default, and how brokerage usually works): the fee was
//    charged ON TOP, so you sent purchase value + fee.
//  - 'deducted': the fee came OUT of the amount you sent, so the value you
//    typed already contains it and nothing is added on top.
// Either way costBasis - principalCost === the fee, which is what makes the
// gain formula in the cards work identically for both modes.
export function getItemCostBasis(item) {
  const principal = (Number(item.quantity) || 0) * (Number(item.purchasePrice) || 0)
  if (item.entryFeeMode === 'deducted') return principal
  return principal + (Number(item.entryFee) || 0)
}

// Just the principal: what the asset itself cost, with no fees. The gain
// numerator measures against THIS ("what did the asset do"), while the
// percentage divides by getItemCostBasis ("what I had to put in, all-in").
// Keeping them separate is what makes the entry fee behave like a real
// investor expects on an income asset: a $6,000 bond bought for $6,095.78
// that paid $240 yields 240/6095.78 = 3.94% — the fee drags the yield down
// (vs 4.00% with no fee) without also being double-charged as a capital loss
// against a single period. Over the whole hold the fee is still fully felt,
// because it stays in the denominator forever.
export function getItemPrincipalCost(item) {
  const principal = (Number(item.quantity) || 0) * (Number(item.purchasePrice) || 0)
  // 'deducted': of everything you sent, only (total - fee) actually bought the
  // asset, so THAT is what the gain gets measured against.
  if (item.entryFeeMode === 'deducted') return principal - (Number(item.entryFee) || 0)
  return principal
}

// Effective acquisition timestamp for an item: the real acquisitionDate, else the
// start of the year it was added to the app (createdAt), else null (no gate).
// Mirrors effectiveAcqDate in lib/historicalValues.js.
export function effectiveAcqTs(it) {
  if (it.acquisitionDate) {
    const t = Date.parse(it.acquisitionDate)
    if (!isNaN(t)) return t
  }
  if (it.createdAt) {
    const c = new Date(it.createdAt)
    if (!isNaN(c.getTime())) return Date.UTC(c.getUTCFullYear(), 0, 1)
  }
  return null
}

// Held-flat USD value of a single item (mirrors the daily-snapshot computation in
// useDashboardData): qty × original price in the item's original currency → USD.
function itemValueUSD(it, convert) {
  const origPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
  const origCur = it._originalCurrency || it.currency || 'USD'
  let v = (Number(it.quantity) || 0) * (origPrice || 0)
  if (!isFinite(v)) return 0
  if (convert && origCur !== 'USD') v = convert(v, origCur, 'USD')
  return it.isDebt ? -Math.abs(v) : v
}

// Single source of truth for "which snapshot source wins for the same date":
// real observations always outrank a reconstructed estimate. ibkr (broker's
// own Equity Summary) is absolute; manual and daily are both real NAV a human
// or the app itself observed; backfill is portfolioRewind's guess for a gap
// nothing else filled, so it must never beat an actual observation. Shared
// between the chart's same-day dedup and bulkImport's write-time precedence
// check — a divergence between the two IS the bug (one used to rank backfill
// above manual/daily).
// 'ibkr_quarterly' = a quarter-end NAV the user transcribed from IBKR's own
// Portfolio Analyst chart. It is a real broker observation, so it outranks our
// reconstructions, but a day-level NAV straight from a Flex Query is finer, so
// it stays below 'ibkr'.
export const SNAPSHOT_SRC_PRIORITY = { ibkr: 5, manual: 4, ibkr_quarterly: 3, daily: 2, backfill: 1 }

// Sources that hold the BROKER's NAV alone, with none of the manually-added
// assets in it. Those are the ones augmentSnapshots has to top up.
export const BROKER_NAV_SOURCES = ['ibkr', 'ibkr_quarterly']

// Broker-NAV snapshots store only what the broker holds and omit manually-added
// assets (bonds, crypto, cash). For consumers that want the FULL portfolio NAV
// (returns, drawdown, sparkline…), augment ONLY those entries with the
// held-flat USD value of non-IBKR items that already existed at the snapshot date.
// Daily/backfill snapshots already include everything, so they are left untouched
// (no double-counting). Returns a new array; the originals are never mutated.
export function augmentSnapshots(snapshots, items, convert) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return snapshots
  const list = items || []
  // A SYNCED broker NAV is one account's balance. Once the portfolio holds no
  // position from that broker at all, that snapshot measures money netWorth does
  // not count, and topping it up with the manual assets invents a total that
  // never existed: a leftover IBKR NAV of 5,760 plus a manually typed 6,240 bond
  // produced a flat 12,000 line across the whole year, a fake -48% "drawdown"
  // into today's real value, and a chart contradicting the headline by 2x
  // (FASE DW). The series has to measure the SAME portfolio netWorth does.
  //
  // Scoped to `_source:'ibkr'` on purpose. A transcribed quarter
  // ('ibkr_quarterly') is history the user typed by hand and routinely lands
  // BEFORE any position is imported (that is the whole point of the Portfolio
  // Analyst flow, FASE DL) — dropping it would delete work they just did.
  // `list.length > 0` so a render before the items load never drops history.
  const orphanBrokerNav = list.length > 0 && !list.some(it => it && it._source === 'ibkr')
  const kept = orphanBrokerNav
    ? snapshots.filter(s => !(s && s._source === 'ibkr'))
    : snapshots
  if (kept.length === 0) return kept
  const nonIbkr = list
    .filter(it => it._source !== 'ibkr' && !isExcludedFromNetWorth(it))
    .map(it => ({ usd: itemValueUSD(it, convert), acqTs: effectiveAcqTs(it) }))
    .filter(x => x.usd)
  if (nonIbkr.length === 0) return kept
  const manualAt = (ts) => {
    let sum = 0
    for (const x of nonIbkr) if (x.acqTs == null || x.acqTs <= ts) sum += x.usd
    return sum
  }
  return kept.map(s => {
    if (!s || !BROKER_NAV_SOURCES.includes(s._source) || !s.date) return s
    const ts = new Date(s.date).getTime()
    if (isNaN(ts)) return s
    const add = manualAt(ts)
    if (!add) return s
    const nav = s.netWorthUSD ?? s.totalActivosUSD ?? 0
    return { ...s, netWorthUSD: nav + add, totalActivosUSD: (s.totalActivosUSD ?? nav) + add }
  })
}

// Per-account calibration: every broker app shows ITS OWN return, so "Calibrar"
// must anchor each account separately. Account keys: 'ibkr' for Interactive
// Brokers (imported positions carry institution variants, so match loosely),
// else the normalized institution name (same normalization as
// InstitutionPerformance). Items with no institution return null.
export function accountKeyOfItem(it) {
  if (!it) return null
  if (it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')) return 'ibkr'
  const name = (it.institution || '').trim().replace(/\s+/g, ' ').toLowerCase()
  return name || null
}

// Estimated USD share of ONE account at a past anchor date: the account's items
// at CURRENT prices, included only if they already existed then
// (effectiveAcqTs <= anchorTs). This is exactly the held-flat formula
// augmentSnapshots uses, so a calibrated start replaces the account's own
// estimate 1:1 instead of double-counting it.
export function heldFlatAccountValueUSD(items, accountKey, anchorTs, convert) {
  let sum = 0
  for (const it of items || []) {
    if (!it || isExcludedFromNetWorth(it)) continue
    if (accountKeyOfItem(it) !== accountKey) continue
    const acq = effectiveAcqTs(it)
    if (acq != null && anchorTs != null && acq > anchorTs) continue
    sum += itemValueUSD(it, convert)
  }
  return sum
}

// Combine per-account calibrated starts with the portfolio-level anchor:
//   start = base − Σ(estimated share of each calibrated account) + Σ(calibrated starts)
// One global % cannot represent accounts with different returns (mixing them is
// what clamped the badge at ±200%); this swaps each calibrated account's share
// for the value solved from the % THAT broker shows.
// For the IBKR account inside a FULL-portfolio anchor, the estimated share is
// base − heldFlat(everything non-IBKR): the exact inverse of augmentSnapshots.
// baseValueUSD may be null/<=0 (no portfolio anchor at all): the base is then
// rebuilt as the held-flat value of all UNCALIBRATED items at anchorTs.
// Returns { startValueUSD, applied } or null when there is nothing to apply.
export function combineAccountCalibrations({ baseValueUSD, anchorTs, calibrations, items, convert }) {
  const cals = (calibrations || []).filter(c => c && c._account && isFinite(c.netWorthUSD) && c.netWorthUSD > 0)
  if (cals.length === 0) return null
  const hasRealBase = baseValueUSD != null && isFinite(baseValueUSD) && baseValueUSD > 0
  const calKeys = new Set(cals.map(c => c._account))
  let start = hasRealBase ? baseValueUSD : 0
  if (!hasRealBase) {
    for (const it of items || []) {
      if (!it || isExcludedFromNetWorth(it)) continue
      const key = accountKeyOfItem(it)
      if (key && calKeys.has(key)) continue
      const acq = effectiveAcqTs(it)
      if (acq != null && anchorTs != null && acq > anchorTs) continue
      start += itemValueUSD(it, convert)
    }
  }
  const applied = []
  for (const cal of cals) {
    // With a rebuilt base the calibrated accounts were already left out of it,
    // so there is no estimated share to subtract; only a real portfolio anchor
    // contains one.
    let est = 0
    if (!hasRealBase) {
      // est stays 0
    } else if (cal._account === 'ibkr') {
      let nonIbkr = 0
      for (const it of items || []) {
        if (!it || isExcludedFromNetWorth(it) || accountKeyOfItem(it) === 'ibkr') continue
        const acq = effectiveAcqTs(it)
        if (acq != null && anchorTs != null && acq > anchorTs) continue
        nonIbkr += itemValueUSD(it, convert)
      }
      est = Math.max(0, baseValueUSD - nonIbkr)
    } else {
      est = heldFlatAccountValueUSD(items, cal._account, anchorTs, convert)
    }
    start = start - est + cal.netWorthUSD
    applied.push(cal._account)
  }
  return { startValueUSD: start, applied }
}

// The single source of truth for "what was the portfolio worth at year start":
// the snapshot dated in January of `year`, else late December of `year - 1`,
// accepted only within 15 days of Jan 1. Used by BOTH the YTD Dietz badge
// (useDashboardData) and the chart's YTD starting point so they never anchor
// on different values. Returns the snapshot doc or null.
export function findYearStartAnchor(snapshots, year) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null
  const sorted = snapshots.filter((s) => s && s.date).sort((a, b) => new Date(a.date) - new Date(b.date))
  // String-prefix compare, not new Date(...).getFullYear()/getMonth(): those
  // read in LOCAL time while the 'YYYY-MM-DD' string is UTC-midnight, so in
  // UTC-6 'YYYY-01-01' misreads as December and 'YYYY-02-01' as January —
  // the Jan-1 anchor silently resolves to the wrong month or null.
  const WINDOW = 15 * 86400000
  const jan1 = Date.UTC(year, 0, 1)
  // 1) A January snapshot of the target year, accepted only within 15 days of
  //    Jan 1. A month-END stamp ('2026-01-31' from a monthly PortfolioAnalyst
  //    NAV export) sits 30 days out and fails on purpose: that row already
  //    holds January's deposit and gain, so anchoring YTD there would make
  //    Modified Dietz subtract January's flows a second time.
  const jan = sorted.find((s) => s.date.slice(0, 7) === `${year}-01`)
  if (jan && Math.abs(new Date(jan.date).getTime() - jan1) <= WINDOW) return jan
  // 2) Otherwise (no January row, or it failed the window) anchor on the
  //    LATEST late-December snapshot of the prior year. |Dec 17 - Jan 1| is
  //    exactly 15 days, so the same window against Jan 1 accepts Dec 17-31
  //    and rejects anything earlier in December.
  const dec = [...sorted].reverse().find((s) => s.date.slice(0, 7) === `${year - 1}-12`)
  if (dec && Math.abs(new Date(dec.date).getTime() - jan1) <= WINDOW) return dec
  // 3) No trustworthy year-start observation: the caller hides YTD.
  return null
}

// Month-start anchor for a month-to-date (MTD) return: the snapshot closest to
// the 1st of the month (either just before — last day of prior month — or just
// after), within a ~5-day window. `month` is 0-indexed (0 = January).
export function findMonthStartAnchor(snapshots, year, month) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null
  const monthStart = Date.UTC(year, month, 1)
  const window = 5 * 86400000
  let best = null
  let bestDiff = Infinity
  for (const s of snapshots) {
    if (!s || !s.date) continue
    const diff = Math.abs(new Date(s.date).getTime() - monthStart)
    if (diff <= window && diff < bestDiff) { best = s; bestDiff = diff }
  }
  return best
}

// Modified-Dietz YTD / MTD / daily return for ONE source (e.g. 'ibkr') alone —
// broker-scoped NAV snapshots + broker-scoped current value + broker-scoped
// flows. Lets a "Solo IBKR" comparison reflect just that account, not the whole
// portfolio. Snapshots must be the RAW per-source series (not augmented with
// manual items). `nowTs` is injectable for deterministic tests.
export function computeScopedReturns({ snapshots, items, transactions, source, convert, baseCurrency, nowTs }) {
  const now = nowTs ? new Date(nowTs) : new Date()
  const endTs = now.getTime()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const cv = (usd) => (convert ? convert(usd, 'USD', baseCurrency || 'USD') : usd)

  const snaps = (snapshots || []).filter((s) => s && s._source === source && s.date)
  const scopedItems = (items || []).filter((it) => it._source === source && !isExcludedFromNetWorth(it))
  let endValue = 0
  scopedItems.forEach((it) => {
    const v = getItemValue(it)
    endValue += it.isDebt ? -Math.abs(v) : v
  })
  if (!(endValue > 0) || snaps.length === 0) return { ytd: null, mtd: null, day: null }

  const flows = (transactions || []).filter((tx) => tx._source === source)
  const at = (anchor, startTs) => {
    if (!anchor) return null
    const startVal = cv(anchor.netWorthUSD ?? anchor.totalActivosUSD ?? 0)
    if (!(startVal > 0)) return null
    const { pct } = computeModifiedDietz({ startValue: startVal, endValue, startTs, endTs, transactions: flows, convert, baseCurrency })
    return Math.max(-200, Math.min(200, pct))
  }
  const ytd = at(findYearStartAnchor(snaps, year), Date.UTC(year, 0, 1))
  const mtd = at(findMonthStartAnchor(snaps, year, month), Date.UTC(year, month, 1))

  // Daily change from today's OWN events, same rule as the headline "HOY"
  // (computeDayChange). It used to be a diff against the last snapshot before
  // today, which cannot tell a market move apart from a position that was only
  // entered today, and netting deposits by date does not save it when the
  // purchase is backfilled to an earlier date. This number is published to
  // friends, so it has to be the same number the card shows.
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const scopedDay = computeDayChange({
    items: scopedItems, transactions: flows, netWorth: endValue,
    convert, baseCurrency, today: todayKey,
  })
  const day = scopedDay ? Math.max(-200, Math.min(200, scopedDay.pct)) : null
  return { ytd, mtd, day }
}

// Build the income-event payload for /api/prices/portfolio-history from DIVIDEND
// transactions. Reinvested step-ups raise the linked asset's value; cash-destination
// payments are excluded (their value already lives in the destination account).
// Amounts are converted to `baseTo` (the chart pre-converts everything to USD).
export function buildIncomeEvents(transactions, items, convert, baseTo = 'USD') {
  if (!transactions || transactions.length === 0) return []
  const byId = new Map((items || []).map((it) => [it.id, it]))
  const bySym = new Map((items || []).map((it) => [(it.symbol || '').toUpperCase(), it]))
  const byName = new Map((items || []).filter((it) => it.name).map((it) => [it.name.toUpperCase(), it]))
  const out = []
  for (const tx of transactions) {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND') continue
    const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
    if (!(amtRaw > 0) || !tx.date) continue
    const cur = tx.currency || 'USD'
    const amount = convert ? convert(amtRaw, cur, baseTo) : amtRaw
    const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
    const reinvested = tx._reinvested === true
      || (linked && linked.dividendAction === 'reinvest')
      || tx._source === 'manual_contribution'
      || !tx._linkedItemId
    // A cash dividend routed to a destination account steps up THAT account's
    // historical balance from the payment date onward (its current value already
    // reflects it). Attribute it to the destination — not the source, which keeps
    // its principal flat — and mark it as a step-up so the API keeps it.
    const dest = (!reinvested && linked && linked.incomeDestination)
      ? (byId.get(linked.incomeDestination) || bySym.get(String(linked.incomeDestination).toUpperCase()) || byName.get(String(linked.incomeDestination).toUpperCase()))
      : null
    if (dest) {
      out.push({ itemId: dest.id || null, symbol: dest.symbol || dest.name || null, date: tx.date, amount, reinvested: true })
      continue
    }
    out.push({
      itemId: tx._linkedItemId || null,
      symbol: tx.symbol || (linked && (linked.symbol || linked.name)) || null,
      date: tx.date,
      amount,
      reinvested: !!reinvested,
    })
  }
  return out
}

// Sum of DIVIDEND income each item GENERATED (source perspective), converted to
// baseTo. Reinvested dividends are excluded — that gain already shows up as a
// higher quantity/value on the item itself, so counting it again here would
// double it. A bond/bank account that pays cash to a different destination
// otherwise looks like it earned nothing (its own currentPrice never moves) in
// any widget that computes gain as just currentPrice - purchasePrice — this is
// the piece those widgets (Asset Allocation's Retorno view, Institution
// Performance) are missing. Mirrors buildIncomeEvents' reinvest detection, but
// attributes to the SOURCE instead of redirecting to the destination — here we
// want "how much did this asset earn", not "where does the value now live".
export function getDividendIncomeByItem(transactions, items, convert, baseTo = 'USD') {
  const out = new Map()
  if (!transactions || transactions.length === 0) return out
  const byId = new Map((items || []).map((it) => [it.id, it]))
  for (const tx of transactions) {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND') continue
    const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
    if (!(amtRaw > 0) || !tx._linkedItemId) continue
    const linked = byId.get(tx._linkedItemId)
    const reinvested = tx._reinvested === true || (linked && linked.dividendAction === 'reinvest')
    if (reinvested) continue
    const cur = tx.currency || 'USD'
    const amount = convert ? convert(amtRaw, cur, baseTo) : amtRaw
    out.set(tx._linkedItemId, (out.get(tx._linkedItemId) || 0) + amount)
  }
  return out
}

// The mirror image of getDividendIncomeByItem: income keyed by the account that
// RECEIVED it, not the asset that produced it.
//
// It exists because that money is not invested capital. A cash account funded by
// a bond's coupon holds a balance the user never put in, yet a bank-like item
// stores its balance in purchasePrice (that IS its cost, by design), so the group
// return divided by a denominator that had grown with every payment. The same 240
// was then counted twice — once as income in the numerator, once as capital in
// the denominator — and the institution card drifted from the asset-class card
// that only ever saw the bond: 240/6,338 = 3.79% against 240/6,098 = 3.94%
// (FASE DY). Subtracting this from the cost basis makes the two agree by
// construction.
//
// Same resolution order the reconstruction engines use: an explicit
// _destinationItemId first, else the source's incomeDestination (by id, symbol or
// name). Reinvested income never lands here — it stays inside its own asset.
// ⛔ LÓGICA CONGELADA (E). Antes de tocar la fórmula de retorno de este
// archivo, leer lib/assetLogic/corporateBondWithEntryFee.js
// y seguir el protocolo de su cabecera: hay que PREGUNTAR antes de cambiarla.
// El ingreso recibido sale del capital invertido, nunca del numerador.
export function getIncomeReceivedByItem(transactions, items, convert, baseTo = 'USD') {
  const out = new Map()
  if (!transactions || transactions.length === 0) return out
  const list = items || []
  const byId = new Map(list.map((it) => [it.id, it]))
  const bySym = new Map(list.filter((it) => it.symbol).map((it) => [String(it.symbol).toUpperCase(), it]))
  const byName = new Map(list.filter((it) => it.name).map((it) => [String(it.name).toUpperCase(), it]))
  const resolve = (ref) => (ref
    ? (byId.get(ref) || bySym.get(String(ref).toUpperCase()) || byName.get(String(ref).toUpperCase()))
    : null)
  for (const tx of transactions) {
    const ty = (tx.type || '').toUpperCase()
    if (ty !== 'DIVIDEND' && ty !== 'INTEREST') continue
    const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
    if (!(amtRaw > 0)) continue
    const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
    if (tx._reinvested === true || (linked && linked.dividendAction === 'reinvest')) continue
    const dest = tx._destinationItemId ? byId.get(tx._destinationItemId) : resolve(linked?.incomeDestination)
    if (!dest || !dest.id) continue
    const amount = convert ? convert(amtRaw, tx.currency || 'USD', baseTo) : amtRaw
    out.set(dest.id, (out.get(dest.id) || 0) + amount)
  }
  return out
}

// What the user actually PUT IN for this item: its cost basis minus whatever
// arrived as income from elsewhere in the portfolio. Never negative — a balance
// smaller than the income it received (money was spent) still means zero capital
// invested, not negative capital.
export function getInvestedCapital(item, incomeReceived) {
  const base = getItemCostBasis(item)
  const received = Number(incomeReceived) || 0
  if (!(received > 0)) return base
  return Math.max(0, base - received)
}

// FASE EH. The value-chart headline's gain/%: how much of a window's raw
// value change is real gain vs. new capital that arrived DURING the window.
//
// Real bug: XOCHI (a bond bought 2024) already gave the YTD window a nonzero
// starting value ($2,203.54). VITALI (bought that January) then deposited
// $6,098 into the SAME scope. The chart's old logic branched on "did the
// window start at zero" and, since it didn't, took the raw value diff as pure
// gain: "+$6,318.70 (+286.75%) este año" on a portfolio that actually made
// $318.70. `investedBase - firstVal` is the fix's whole idea: contributionLine
// (the caller) seeds AT the window's own starting value when something
// predates it, so that subtraction is exactly the NEW capital, cleanly,
// whether firstVal is zero (a brand-new account funding its very first
// position) or not (an existing position that then received more). One
// formula, no branch — see the corporate-bond gain-vs-cost convention this
// mirrors in lib/assetLogic/corporateBondWithEntryFee.js.
//
// @param firstVal           value at the window's start
// @param lastVal            value at the window's end (today)
// @param investedBase       cumulative contributions line's last value, or
//                            null when there is no contribution history at all
// @param entryFeesInScope   entry fees paid for positions acquired DURING the
//                            window (never one that predates it — that fee is
//                            already inside firstVal, not newCapital)
export function computeWindowGrowth({ firstVal, lastVal, investedBase, entryFeesInScope = 0 }) {
  const start = Number(firstVal) || 0
  const end = Number(lastVal) || 0
  const growthAbs = end - start
  const newCapital = investedBase != null ? Math.max(0, investedBase - start) : 0
  const newCapitalPrincipal = Math.max(0, newCapital - (Number(entryFeesInScope) || 0))
  const growthDenom = start + newCapital
  const growthPct = growthDenom > 0 ? ((growthAbs - newCapitalPrincipal) / growthDenom) * 100 : null
  const displayAbs = growthAbs - newCapitalPrincipal
  return { growthAbs, newCapital, newCapitalPrincipal, growthDenom, growthPct, displayAbs }
}

export const TYPE_ICONS = {
  stocks: 'TrendingUp',
  crypto: 'Bitcoin',
  bonds: 'Landmark',
  funds: 'Briefcase',
  banks: 'Building2',
  realestate: 'Home',
  alternatives: 'Gem',
  receivables: 'ArrowDownLeft',
  debts: 'CreditCard',
  other: 'BarChart3',
}

export function getInvestmentClass(item) {
  const cat = getTypeCategory(item)
  if (cat === 'debts' || cat === 'receivables') return 'debts'
  if (cat === 'bonds' || cat === 'banks') return 'renta_fija'
  if (cat === 'stocks' || cat === 'crypto' || cat === 'funds') return 'renta_variable'
  if (cat === 'alternatives' || cat === 'realestate') return 'patrimonio_vc'
  const t = (item.type || '').toLowerCase()
  if (/safe.?note|vc|private|venture|startup|angel/i.test(t)) return 'patrimonio_vc'
  if (/plazo|deposito|cdt|pagare|letra|treasury|certificado/i.test(t)) return 'renta_fija'
  return 'renta_variable'
}

import { INVESTMENT_CLASS_COLORS } from '@/lib/colors'

export const INVESTMENT_CLASS_META = {
  renta_variable: { label: { es: 'Renta Variable', en: 'Variable Income' }, returnType: { es: 'Retorno variable', en: 'Variable return' }, color: INVESTMENT_CLASS_COLORS.renta_variable, icon: 'TrendingUp' },
  renta_fija: { label: { es: 'Renta Fija', en: 'Fixed Income' }, returnType: { es: 'Retorno predefinido', en: 'Predefined return' }, color: INVESTMENT_CLASS_COLORS.renta_fija, icon: 'Landmark' },
  patrimonio_vc: { label: { es: 'Patrimonio / VC', en: 'Equity / VC' }, returnType: { es: 'Largo plazo', en: 'Long-term' }, color: INVESTMENT_CLASS_COLORS.patrimonio_vc, icon: 'Gem' },
  debts: { label: { es: 'Deuda', en: 'Debt' }, returnType: { es: 'Pasivo', en: 'Liability' }, color: INVESTMENT_CLASS_COLORS.debts, icon: 'CreditCard' },
}

export function formatPercent(value) {
  if (value == null || !isFinite(value)) return '0.00%'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatHoldingPeriod(acquisitionDate, lang) {
  if (!acquisitionDate) return '---'
  const acq = new Date(acquisitionDate)
  if (isNaN(acq.getTime())) return '---'
  const diffMs = Date.now() - acq.getTime()
  if (diffMs < 0) return '---'
  const days = Math.floor(diffMs / 86400000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  if (years > 0) return lang === 'es' ? `${years}a ${months}m` : `${years}y ${months}m`
  if (months > 0) return `${months}m`
  return `${days}d`
}

const SECTOR_PATTERNS = [
  [/tech|software|saas|cloud|semi/i, 'Technology'],
  [/bank|financ|insurance|broker/i, 'Financials'],
  [/health|pharma|biotech|medic/i, 'Healthcare'],
  [/energy|oil|gas|petrol|solar|wind/i, 'Energy'],
  [/consumer|retail|food|beverage/i, 'Consumer'],
  [/industrial|manufactur|aerospace/i, 'Industrials'],
  [/real.?estate|reit|inmueble|property/i, 'Real Estate'],
  [/telecom|media|entertainment/i, 'Communication'],
  [/material|mining|metal|chemical/i, 'Materials'],
  [/util|electric|water/i, 'Utilities'],
  [/crypto|bitcoin|blockchain|token|defi/i, 'Crypto'],
]

export function getSectorFromType(type) {
  if (!type) return 'Unknown'
  for (const [pattern, sector] of SECTOR_PATTERNS) {
    if (pattern.test(type)) return sector
  }
  return 'Unknown'
}

const GEO_SUFFIXES = {
  '.L': 'UK', '.TO': 'Canada', '.V': 'Canada', '.MX': 'Mexico',
  '.SA': 'Brazil', '.BA': 'Argentina', '.SN': 'Chile',
  '.DE': 'Germany', '.PA': 'France', '.MI': 'Italy', '.MC': 'Spain',
  '.AS': 'Netherlands', '.SW': 'Switzerland', '.ST': 'Sweden',
  '.HK': 'Hong Kong', '.T': 'Japan', '.SS': 'China', '.SZ': 'China',
  '.KS': 'South Korea', '.AX': 'Australia', '.NS': 'India', '.BO': 'India',
}

const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'XRP', 'DOGE', 'BNB', 'ATOM', 'NEAR', 'LTC', 'USDT', 'USDC', 'AAVE', 'SHIB', 'FIL', 'ICP', 'CRO', 'VET', 'EOS', 'XTZ', 'THETA', 'FTM', 'ALGO', 'DAI', 'OSMO'])

const KNOWN_GEO = {
  NVO: 'Denmark', NOVO: 'Denmark', ASML: 'Netherlands', TSM: 'Taiwan', SAP: 'Germany',
  TM: 'Japan', SONY: 'Japan', HMC: 'Japan', MUFG: 'Japan', SMFG: 'Japan',
  BABA: 'China', JD: 'China', PDD: 'China', BIDU: 'China', NIO: 'China', LI: 'China', XPEV: 'China',
  SE: 'Singapore', GRAB: 'Singapore', SHOP: 'Canada', RY: 'Canada', TD: 'Canada', BNS: 'Canada',
  SAN: 'Spain', BBVA: 'Spain', TEF: 'Spain', IBE: 'Spain',
  AZN: 'UK', GSK: 'UK', BP: 'UK', SHEL: 'UK', HSBC: 'UK', RIO: 'UK', BHP: 'Australia',
  UL: 'UK', DEO: 'UK', BTI: 'UK', LIN: 'Ireland',
  TCEHY: 'China', NTES: 'China', WBD: 'US',
  VALE: 'Brazil', PBR: 'Brazil', ITUB: 'Brazil', BBD: 'Brazil', SID: 'Brazil',
  MELI: 'Argentina', GLOB: 'Argentina', YPF: 'Argentina', GGAL: 'Argentina',
  AMX: 'Mexico', FEMSA: 'Mexico', TV: 'Mexico', BSMX: 'Mexico',
  SQM: 'Chile', BSAC: 'Chile',
  XOCHI: 'Guatemala', BI: 'Guatemala',
  INFY: 'India', WIT: 'India', HDB: 'India', IBN: 'India',
  KB: 'South Korea', SHG: 'South Korea', PKX: 'South Korea',
  UMC: 'Taiwan', ASX: 'Taiwan', IMOS: 'Taiwan',
  ERIC: 'Sweden', SPOT: 'Sweden', VOLV: 'Sweden',
  RACE: 'Italy', STLA: 'Netherlands', ING: 'Netherlands',
  CS: 'Switzerland', UBS: 'Switzerland', NOVN: 'Switzerland',
}

export function getGeographyFromSymbol(symbol) {
  if (!symbol) return 'Unknown'
  const upper = symbol.toUpperCase()
  if (CRYPTO_SYMBOLS.has(upper)) return 'Global'
  for (const [suffix, geo] of Object.entries(GEO_SUFFIXES)) {
    if (symbol.endsWith(suffix)) return geo
  }
  if (KNOWN_GEO[upper]) return KNOWN_GEO[upper]
  return 'US'
}

export function getGeographyFromItem(item) {
  if (item.assetCountry) return item.assetCountry
  const cat = getTypeCategory(item)
  if (cat === 'crypto') return 'Global'
  return getGeographyFromSymbol(item.symbol)
}

export function getSectorFromItem(item) {
  if (item.sector) return item.sector
  const cat = getTypeCategory(item)
  if (cat === 'crypto') return 'Crypto'
  if (cat === 'realestate') return 'Real Estate'
  if (cat === 'banks') return 'Financials'
  if (cat === 'bonds') return 'Fixed Income'
  if (cat === 'alternatives') return 'Alternatives'
  if (cat === 'receivables') return 'Receivables'
  if (cat === 'debts') return 'Liabilities'
  return getSectorFromType(item.type) !== 'Unknown' ? getSectorFromType(item.type) : getSectorFromType(item.name || '')
}

// A position imported from IBKR carries an import-stamp acquisitionDate (the sync
// date), not the real purchase date. Historical reconstruction must NOT zero it out
// before that stamp — hold the current quantity flat back through the period instead.
// Returns true only for IBKR items with NO genuine trade/lot history to reconstruct
// from (a real recent buy would leave an in-window BUY trade or a multi-lot/closed
// "How much did TODAY move?" built from today's own events, never from a
// snapshot-to-snapshot difference.
//
// A diff against yesterday's snapshot cannot tell a market move apart from a
// position you simply typed in this afternoon: entering a bond you have held
// since January makes today's net worth jump by its whole balance while
// yesterday's snapshot knows nothing about it. Netting deposits by date does
// not save it either, because a backfilled purchase is DATED in January. That
// is how the card came to claim "+$6,119.62 today (+60.94%)" on a day the
// market had moved about $58.
//
// So today's change is only ever the two things that actually happened today:
//   1. price moves:  Σ value × change1d
//   2. income that LANDED today: a coupon or dividend credited today is a real
//      gain on its payment date and on no other day. A semiannual coupon
//      belongs to the two days it pays, not to the day it gets recorded.
// New capital appears in neither, so funding an account can never read as gain.
//
// Returns null when there is nothing to measure (no priced holding, no income):
// a confident "+0.00%" would be a claim the data does not support.
// ⛔ LÓGICA CONGELADA (H). El cupón de un activo con costo de entrada aparece
// aquí el día que PAGA, y la comisión ya se pagó al comprar: no vuelve a restar.
// Ver lib/assetLogic/corporateBondWithEntryFee.js: PREGUNTAR antes de cambiar.
export function computeDayChange({ items, transactions, netWorth, convert, baseCurrency = 'USD', today }) {
  if (!(netWorth > 0)) return null
  const todayKey = today || (() => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()

  let marketMove = 0
  let priced = 0
  ;(items || []).forEach((it) => {
    if (it.isDebt || isExcludedFromNetWorth(it)) return
    if (it.change1d == null || !isFinite(it.change1d)) return
    priced += 1
    marketMove += getItemValue(it) * (it.change1d / 100)
  })

  // String-prefix date compare per house rule: new Date('YYYY-MM-DD') runs the
  // day backwards in UTC-6.
  let incomeToday = 0
  ;(transactions || []).forEach((tx) => {
    const type = (tx.type || '').toUpperCase()
    if (type !== 'DIVIDEND' && type !== 'INTEREST') return
    if (!tx.date || String(tx.date).slice(0, 10) !== todayKey) return
    const amt = Math.abs(Number(tx.totalAmount ?? tx.amount ?? 0))
    if (!isFinite(amt) || amt === 0) return
    incomeToday += convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
  })

  if (priced === 0 && incomeToday === 0) return null

  const abs = marketMove + incomeToday
  const startOfDay = netWorth - abs
  return { abs, pct: startOfDay > 0 ? (abs / startOfDay) * 100 : 0 }
}

// history). Mirrors the `dateUnreliable` logic in lib/historicalValues.js so the chart
// API and the spreadsheet agree on which positions are date-unreliable.
// FASE HL. ¿La fecha de adquisición de este ítem es un SELLO DE SYNC en vez de
// una compra real? Para una posición importada de un broker siempre lo es (lo
// que este archivo ya documenta como dateUnreliable), y por lo tanto NUNCA
// puede usarse como puerta de existencia: gatear por ella borra la posición de
// todo el pasado anterior al sync. shouldHoldFlat (abajo) resolvía esto solo
// para el caso SIN historial de trades; esta pregunta es la más básica y vale
// aunque haya trades, porque el ledger del Flex llega ~365 días y los lots que
// crea heredan el mismo sello. Un solo lugar para los dos consumidores del API
// de historial (useDashboardData y PortfolioGrowthChart), para que no deriven.
export function hasUnreliableAcqDate(item) {
  return !!item && item._source === 'ibkr'
}

export function shouldHoldFlat(item, transactions, lots) {
  if (!item || item._source !== 'ibkr') return false
  const sym = (item.symbol || '').toUpperCase()
  if (!sym) return false
  const hasTrades = (transactions || []).some((tx) => {
    const t = (tx.type || '').toUpperCase()
    return (t === 'BUY' || t === 'SELL') && (tx.symbol || '').toUpperCase() === sym
  })
  if (hasTrades) return false
  const symLots = (lots || []).filter((l) => (l.symbol || '').toUpperCase() === sym)
  const hasRealLotHistory = symLots.length > 1 || symLots.some((l) => l.status === 'closed')
  if (hasRealLotHistory) return false
  return true
}

export function computeModifiedDietz({ startValue, endValue, startTs, endTs, transactions, convert, baseCurrency }) {
  const totalMs = endTs - startTs
  if (totalMs <= 0 || startValue <= 0) return { pct: 0, abs: 0 }

  const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
  const flows = (transactions || [])
    .filter((tx) => {
      if (!tx.date) return false
      const t = (tx.type || '').toUpperCase()
      if (flowTypes[t] == null) return false
      const txTs = new Date(tx.date).getTime()
      return txTs >= startTs && txTs <= endTs
    })
    .map((tx) => {
      const sign = flowTypes[(tx.type || '').toUpperCase()]
      const amt = convert
        ? convert((tx.totalAmount ?? 0) * sign, tx.currency || 'USD', baseCurrency || 'USD')
        : (tx.totalAmount ?? 0) * sign
      return { date: new Date(tx.date).getTime(), flow: amt }
    })

  const sumFlows = flows.reduce((s, f) => s + f.flow, 0)
  let weightedFlows = 0
  flows.forEach((f) => {
    const w = (endTs - f.date) / totalMs
    weightedFlows += f.flow * w
  })

  const weightedCapital = startValue + weightedFlows
  const gain = endValue - startValue - sumFlows
  const pct = Math.abs(weightedCapital) > 0.01 ? (gain / weightedCapital) * 100 : 0
  // FASE IA: weightedCapital se expone (campo ADITIVO, la fórmula queda
  // byte-idéntica) para que el caller pueda ajustar el numerador (comisiones
  // de entrada de compras dentro de la ventana, ver entryFeeAddbacks) sin
  // re-derivar el denominador de Dietz por su cuenta.
  if (!isFinite(pct)) return { pct: 0, abs: gain, weightedCapital }
  return { pct, abs: gain, weightedCapital }
}

// FASE IA. Comisiones de entrada pagadas por compras hechas DENTRO de una
// ventana de medición, por ítem. Existen porque el DEPOSIT de apertura que
// AddAccountModal archiva lleva la comisión ADENTRO (6,098 = 6,000 de bono +
// 98 de corretaje, modo 'separate'), así que cualquier medidor que netea ese
// flujo completo está restando la comisión del numerador: la comisión se lee
// como pérdida. La convención congelada (lib/assetLogic/corporateBondWithEntryFee.js)
// es la contraria: la ganancia se mide contra el PRINCIPAL y la comisión vive
// SOLO en el denominador. La gráfica ya lo hace (computeWindowGrowth resta el
// capital nuevo NETO de comisiones); este helper le da el mismo ajuste al YTD
// del encabezado y al desglose por cuenta, que son los que divergían de ella
// por exactamente $98 (la comisión de VITALI) en las capturas del usuario.
//
// El guard de `flows`: la comisión solo se devuelve si el DEPOSIT vinculado a
// ese ítem está EN LA LISTA de flujos que el caller de verdad neteó (la lista
// ya viene filtrada: en el caso congelado del ancla movida, los depósitos
// descartados no están y la comisión queda en cero aquí, porque ese camino ya
// la maneja ytdCostBase). Sumar una comisión cuyo depósito no se restó la
// contaría al revés.
export function entryFeeAddbacks(items, flows, { fromTs = null, toTs = null, convert = null, baseCurrency = 'USD' } = {}) {
  const out = new Map()
  if (!Array.isArray(items)) return out
  const linkedDeposit = new Set()
  ;(flows || []).forEach((tx) => {
    if ((tx?.type || '').toUpperCase() !== 'DEPOSIT' || !tx._linkedItemId) return
    const ts = tx.date ? new Date(tx.date).getTime() : NaN
    if (!isFinite(ts)) return
    if (fromTs != null && ts < fromTs) return
    if (toTs != null && ts > toTs) return
    linkedDeposit.add(tx._linkedItemId)
  })
  items.forEach((it) => {
    const fee = Number(it?.entryFee) || 0
    // 'deducted' salió del monto enviado: el depósito archivado es solo el
    // principal y no hay nada que devolver (mismo criterio que la gráfica).
    if (!(fee > 0) || it.entryFeeMode === 'deducted') return
    if (!it.acquisitionDate) return
    const acqTs = new Date(`${it.acquisitionDate}T00:00:00`).getTime()
    if (!isFinite(acqTs)) return
    // Estrictamente DESPUÉS del arranque: una compra anterior o exacta al
    // ancla ya vive dentro del valor de arranque (o del ytdCostBase), no del
    // capital nuevo de la ventana. Igual que entryFeesInScope en la gráfica.
    if (fromTs != null && acqTs <= fromTs) return
    if (toTs != null && acqTs > toTs) return
    if (!linkedDeposit.has(it.id)) return
    const cur = it._originalCurrency || it.currency || 'USD'
    const amt = convert ? convert(fee, cur, baseCurrency || 'USD') : fee
    if (isFinite(amt) && amt > 0) out.set(it.id, amt)
  })
  return out
}

// Inverse of computeModifiedDietz for the return-calibration flow: the user
// types the return their broker shows (e.g. IBKR PortfolioAnalyst YTD or since
// inception) and we solve for the start value that makes OUR Dietz reproduce
// that percentage exactly, given the same end value, window and flows. Dietz
// is linear-fractional in startValue: pct(V) = (A - V) / (V + W) with
// A = endValue - sumFlows and W = time-weighted flows, so two sample points
// pin down A and W without duplicating the flow math (which then can never
// drift from computeModifiedDietz, convert and baseCurrency included).
// Returns { startValue } or { error: 'endValue' | 'targetPct' | 'window' | 'unsolvable' }.
export function solveDietzStartValue({ endValue, startTs, endTs, transactions, convert, baseCurrency, targetPct }) {
  if (!isFinite(endValue) || endValue <= 0) return { error: 'endValue' }
  // Same display clamp as the YTD badge: outside (-100, 200] the card would
  // show a different number than the user typed, so refuse early.
  if (!isFinite(targetPct) || targetPct <= -100 || targetPct > 200) return { error: 'targetPct' }
  if (!(endTs > startTs)) return { error: 'window' }
  const evalAt = (V) => computeModifiedDietz({ startValue: V, endValue, startTs, endTs, transactions, convert, baseCurrency }).pct / 100
  const V1 = endValue * 0.5
  const V2 = endValue * 1.5
  const p1 = evalAt(V1)
  const p2 = evalAt(V2)
  // p1 == p2 only when A + W = 0, the degenerate case where every start value
  // yields the same constant return: no target-specific solution exists.
  if (!isFinite(p1) || !isFinite(p2) || Math.abs(p1 - p2) < 1e-12) return { error: 'unsolvable' }
  const W = (V2 - V1 - p1 * V1 + p2 * V2) / (p1 - p2)
  const A = p1 * (V1 + W) + V1
  const r = targetPct / 100
  const startValue = (A - r * W) / (1 + r)
  if (!isFinite(startValue) || startValue <= 0) return { error: 'unsolvable' }
  // Verify against the real implementation before trusting the anchor.
  const check = evalAt(startValue) * 100
  if (!isFinite(check) || Math.abs(check - targetPct) > 1e-6) return { error: 'unsolvable' }
  return { startValue }
}

// Single source of truth for an item's projected annual income, in the item's own
// currency. `balance` is qty × price (also in the item's currency). Both the
// Ingresos card and estimatedAnnualIncome (InsightCards/GoalTracker) must use this —
// they previously implemented different subsets and disagreed on rate-based items.
export function projectItemAnnualIncome(item, balance) {
  if (item.rateType === 'variable' && item.rateMin > 0 && item.rateMax > 0) {
    const midRate = (item.rateMin + item.rateMax) / 2
    return balance * (midRate / 100)
  }
  if (item.rateType === 'continuous' && item.incomeRate > 0) {
    return balance * (Math.exp(item.incomeRate / 100) - 1)
  }
  if (item.incomeAmount > 0 && item.incomeMonths) {
    const payCount = Array.isArray(item.incomeMonths) ? item.incomeMonths.length : 12
    return (item.incomeAmount * payCount)
  }
  if (item.incomeMode === 'percent' && item.incomeRate > 0) {
    return balance * (item.incomeRate / 100)
  }
  if (item.dividendYield > 0) {
    return balance * (item.dividendYield / 100)
  }
  return 0
}

export function getEffectiveYield(item) {
  if (item.dividendYield > 0) return item.dividendYield
  if (item.rateType === 'variable' && item.rateMin > 0 && item.rateMax > 0) {
    return (item.rateMin + item.rateMax) / 2
  }
  if (item.incomeMode === 'percent' && item.incomeRate > 0) return item.incomeRate
  if (item.incomeAmount > 0 && item.incomeMonths) {
    const payCount = Array.isArray(item.incomeMonths) ? item.incomeMonths.length : 12
    if (payCount === 0) return null
    const cost = (item.purchasePrice || 0) * (item.quantity || 1)
    if (cost > 0) return (item.incomeAmount * payCount) / cost * 100
  }
  return null
}

export function getMaturityInfo(item) {
  if (!item.maturityDate) return null
  const mat = coerceDate(item.maturityDate)
  if (!mat || isNaN(mat.getTime())) return null
  const now = new Date()
  const diffMs = mat.getTime() - now.getTime()
  if (diffMs <= 0) return { expired: true, days: 0, label: 'Vencido', color: 'red' }
  const days = Math.ceil(diffMs / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  let label, color
  if (days <= 90) { color = 'red'; label = `${days}d` }
  else if (days <= 365) { color = 'amber'; label = `${months}m` }
  else { color = 'emerald'; label = years > 0 ? `${years}a ${months % 12}m` : `${months}m` }
  return { expired: false, days, months, years, label, color }
}

// Weekdays elapsed since `since`. Broker staleness must be measured in BUSINESS
// days: markets are closed on weekends, so a sync that last succeeded Friday has
// nothing new to fetch on Sunday — counting calendar days raises the alarm a full
// weekend early. Returns Infinity when there is no valid `since` (never synced),
// and caps the walk so a garbage/ancient date can't spin the loop.
export function businessDaysSince(since, now = Date.now()) {
  if (!since) return Infinity
  const start = new Date(since).getTime()
  if (!isFinite(start)) return Infinity
  if (now <= start) return 0

  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)

  let count = 0
  let guard = 0
  while (cursor < end && guard < 400) {
    cursor.setDate(cursor.getDate() + 1)
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) count++
    guard++
  }
  return guard >= 400 ? Infinity : count
}

// FASE HX (regla explícita del usuario): NINGUNA falla de sync de IBKR alarma
// antes de 5 días HÁBILES (lunes a viernes) sin señal de conexión. Aplica a
// TODOS los códigos de error, incluidos los "fatales" (TOKEN_EXPIRED /
// INVALID_QUERY, que antes alarmaban desde el primer intento fallido) y a la
// conexión que nunca sincronizó (antes fusible corto de 2 días): la data tiene
// a lo sumo unos días y el auto-sync sigue reintentando solo. El reloj es la
// señal de salud MÁS RECIENTE de las tres marcas, no un `||` por orden:
// doAutoSync solo estampa _ibkrLastAutoSync, así que un `||` que empiece por
// _ibkrLastSync puede elegir un sync manual de hace meses por encima de un
// auto-sync exitoso de AYER y alarmar igual. `connectedAt` cuenta también:
// guardar credenciales es un intento fresco que reinicia el fusible. Sin
// ninguna marca, businessDaysSince(null) = Infinity y alarma de inmediato
// (conexión rota sin ninguna evidencia de haber funcionado jamás).
export function ibkrAttentionNeeded({ errorCode, lastSync, lastAutoSync, connectedAt } = {}, now = Date.now()) {
  if (!errorCode) return false
  const stamps = [lastSync, lastAutoSync, connectedAt]
    .map((s) => (s ? new Date(s).getTime() : NaN))
    .filter((t) => isFinite(t))
  const latest = stamps.length ? Math.max(...stamps) : null
  return businessDaysSince(latest, now) >= 5
}

// ── Quarterly NAV history (IBKR Portfolio Analyst) ──────────────────────────
// A Flex Query only reaches back 365 days, so anything older has to be read off
// the broker's own chart and typed in. These helpers turn a "Qn YYYY" label
// into the snapshot date it belongs to and back, so the entry grid and the
// chart agree on where each figure sits.

// Last calendar day of a quarter (1-4), as 'YYYY-MM-DD'. Never a Date object:
// new Date('YYYY-MM-DD') runs the day backwards in UTC-6 (house rule).
export function quarterEndDate(year, quarter) {
  const ends = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' }
  const end = ends[quarter]
  if (!end || !year) return null
  return `${year}-${end}`
}

export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`
}

// Every quarter from `from` (inclusive) to the quarter containing `to`,
// oldest first. Bounded so a mistyped year cannot generate thousands of rows.
export function quartersBetween(fromYear, fromQuarter, toDate = new Date(), maxRows = 80) {
  const out = []
  const toYear = toDate.getFullYear()
  const toQuarter = Math.floor(toDate.getMonth() / 3) + 1
  let y = Number(fromYear)
  let q = Number(fromQuarter)
  if (!isFinite(y) || !isFinite(q) || q < 1 || q > 4) return out
  while ((y < toYear || (y === toYear && q <= toQuarter)) && out.length < maxRows) {
    out.push({ year: y, quarter: q, label: quarterLabel(y, q), endDate: quarterEndDate(y, q) })
    q += 1
    if (q > 4) { q = 1; y += 1 }
  }
  return out
}

// The date a quarter's figure should be stamped with. A quarter that has not
// closed yet gets TODAY: the number the broker shows for it is the value right
// now, and dating it at the future quarter end would put the portfolio's
// current value in the future.
export function quarterSnapshotDate(year, quarter, today = new Date()) {
  const end = quarterEndDate(year, quarter)
  if (!end) return null
  const p = (n) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  return end > todayStr ? todayStr : end
}
