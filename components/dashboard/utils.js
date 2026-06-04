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
  if (Math.abs(value) >= 1000000) return sym + (value / 1000000).toFixed(1) + 'M'
  if (Math.abs(value) >= 1000) return sym + (value / 1000).toFixed(1) + 'K'
  return sym + value.toFixed(0)
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
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
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
