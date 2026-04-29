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
  if (value == null || isNaN(value)) return '$0.00'
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
  if (value == null || isNaN(value)) return '$0'
  const sym = CURRENCY_SYMBOLS[currency || _baseCurrency] || '$'
  if (Math.abs(value) >= 1000000) return sym + (value / 1000000).toFixed(1) + 'M'
  if (Math.abs(value) >= 1000) return sym + (value / 1000).toFixed(1) + 'K'
  return sym + value.toFixed(0)
}

export function formatDate(dateStr) {
  if (!dateStr) return '-'
  const locale = _lang === 'es' ? 'es' : 'en-US'
  try {
    return new Date(dateStr).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } catch { return dateStr }
}

export function getTypeCategory(type) {
  if (!type) return 'other'
  const t = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/stock|accion|equity|reit|share/i.test(t)) return 'stocks'
  if (/crypto|cripto|blockchain|bitcoin|btc|eth|token|coin/i.test(t)) return 'crypto'
  if (/bond|bono|instrumento|inversion|deuda|debt|cdt|plazo|treasury|letra|pagare|deposito|certificado/i.test(t)) return 'bonds'
  if (/fund|fondo|etf|index|mutual/i.test(t)) return 'funds'
  if (/bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(t)) return 'banks'
  return 'other'
}

export const TYPE_COLORS = {
  stocks: { bg: '#3b82f6', badge: 'bg-blue-500/20 text-blue-400' },
  crypto: { bg: '#f59e0b', badge: 'bg-amber-500/20 text-amber-400' },
  bonds: { bg: '#10b981', badge: 'bg-emerald-500/20 text-emerald-400' },
  funds: { bg: '#a855f7', badge: 'bg-purple-500/20 text-purple-400' },
  banks: { bg: '#6b7280', badge: 'bg-gray-500/20 text-gray-400' },
  other: { bg: '#ec4899', badge: 'bg-pink-500/20 text-pink-400' },
}

export function getItemPrice(item) {
  return item.currentPrice || item.purchasePrice || item.price || item.cost || item.averagePrice || 0
}

export function getItemValue(item) {
  return (item.quantity || 0) * getItemPrice(item)
}

export const TYPE_ICONS = {
  stocks: '📈',
  crypto: '₿',
  bonds: '🏛',
  funds: '💼',
  banks: '🏦',
  other: '📊',
}

export function formatPercent(value) {
  if (value == null || isNaN(value)) return '0.00%'
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

const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'XRP', 'DOGE', 'BNB', 'ATOM', 'NEAR', 'LTC', 'USDT', 'USDC', 'AAVE', 'SHIB'])

export function getGeographyFromSymbol(symbol) {
  if (!symbol) return 'Unknown'
  const upper = symbol.toUpperCase()
  if (CRYPTO_SYMBOLS.has(upper)) return 'Global'
  for (const [suffix, geo] of Object.entries(GEO_SUFFIXES)) {
    if (symbol.endsWith(suffix)) return geo
  }
  return 'US'
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
  const pct = weightedCapital > 0 ? (gain / weightedCapital) * 100 : 0
  return { pct, abs: gain }
}

export function getEffectiveYield(item) {
  if (item.dividendYield > 0) return item.dividendYield
  if (item.incomeMode === 'percent' && item.incomeRate > 0) return item.incomeRate
  if (item.incomeAmount > 0 && item.incomeMonths) {
    const payCount = Array.isArray(item.incomeMonths) ? item.incomeMonths.length : 12
    const cost = (item.purchasePrice || 0) * (item.quantity || 1)
    if (cost > 0) return (item.incomeAmount * payCount) / cost * 100
  }
  return null
}
