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
export function formatAxisTick(value, step, currency) {
  if (value == null || !isFinite(value)) return '$0'
  const sym = CURRENCY_SYMBOLS[currency || _baseCurrency] || '$'
  const abs = Math.abs(value)
  // Decimals needed at a given scale so one step changes a shown digit.
  const decimalsFor = (scaledStep, min) => {
    if (!isFinite(scaledStep) || scaledStep <= 0) return min
    return Math.min(3, Math.max(min, Math.ceil(-Math.log10(scaledStep))))
  }
  if (abs >= 1000000) {
    return sym + (value / 1e6).toFixed(decimalsFor((step || 0) / 1e6, 1)) + 'M'
  }
  if (abs >= 1000) {
    return sym + (value / 1e3).toFixed(decimalsFor((step || 0) / 1e3, 1)) + 'K'
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
  if (NON_MARKET_TYPE_RE.test(t)) return false
  if (MARKET_TYPE_RE.test(t)) return true
  const cat = getTypeCategory(item)
  return cat === 'stocks' || cat === 'crypto' || cat === 'funds'
}

export function getTypeCategory(itemOrType) {
  if (!itemOrType) return 'other'
  const type = typeof itemOrType === 'string' ? itemOrType : itemOrType.type || ''
  if (typeof itemOrType === 'object' && itemOrType.isReceivable) return 'receivables'
  if (typeof itemOrType === 'object' && itemOrType.isDebt) return 'debts'
  const t = type.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase()
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
export const SNAPSHOT_SRC_PRIORITY = { ibkr: 4, manual: 3, daily: 2, backfill: 1 }

// IBKR equityHistory snapshots (_source:'ibkr') store only the broker NAV and omit
// manually-added assets (bonds, crypto, cash). For consumers that want the FULL
// portfolio NAV (returns, drawdown, sparkline…), augment ONLY those entries with the
// held-flat USD value of non-IBKR items that already existed at the snapshot date.
// Daily/backfill snapshots already include everything, so they are left untouched
// (no double-counting). Returns a new array; the originals are never mutated.
export function augmentSnapshots(snapshots, items, convert) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return snapshots
  const nonIbkr = (items || [])
    .filter(it => it._source !== 'ibkr' && !isExcludedFromNetWorth(it))
    .map(it => ({ usd: itemValueUSD(it, convert), acqTs: effectiveAcqTs(it) }))
    .filter(x => x.usd)
  if (nonIbkr.length === 0) return snapshots
  const manualAt = (ts) => {
    let sum = 0
    for (const x of nonIbkr) if (x.acqTs == null || x.acqTs <= ts) sum += x.usd
    return sum
  }
  return snapshots.map(s => {
    if (!s || s._source !== 'ibkr' || !s.date) return s
    const ts = new Date(s.date).getTime()
    if (isNaN(ts)) return s
    const add = manualAt(ts)
    if (!add) return s
    const nav = s.netWorthUSD ?? s.totalActivosUSD ?? 0
    return { ...s, netWorthUSD: nav + add, totalActivosUSD: (s.totalActivosUSD ?? nav) + add }
  })
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

  // Daily change: value now vs the last snapshot strictly before today. Net out
  // deposits/withdrawals since baseline (same bug as an un-netted dailyChange:
  // a same-day import reads as market gain otherwise) — mirrors the Dietz
  // treatment ytd/mtd already get above.
  const todayStr = now.toISOString().slice(0, 10)
  const prior = snaps.filter((s) => s.date < todayStr).sort((a, b) => new Date(a.date) - new Date(b.date))
  let day = null
  const baseline = prior[prior.length - 1]
  if (baseline) {
    const prevVal = cv(baseline.netWorthUSD ?? baseline.totalActivosUSD ?? 0)
    if (prevVal > 0) {
      let netFlow = 0
      flows.forEach((tx) => {
        if (!tx.date || tx.date <= baseline.date) return
        const type = (tx.type || '').toUpperCase()
        if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') return
        const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
        const converted = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
        netFlow += type === 'DEPOSIT' ? converted : -converted
      })
      day = Math.max(-200, Math.min(200, ((endValue - prevVal - netFlow) / prevVal) * 100))
    }
  }
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
// history). Mirrors the `dateUnreliable` logic in lib/historicalValues.js so the chart
// API and the spreadsheet agree on which positions are date-unreliable.
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
  if (!isFinite(pct)) return { pct: 0, abs: gain }
  return { pct, abs: gain }
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
    return item.incomeAmount * payCount
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
