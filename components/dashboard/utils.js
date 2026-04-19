const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', MXN: '$', GTQ: 'Q', COP: '$',
  CLP: '$', ARS: '$', BRL: 'R$', PEN: 'S/', CAD: '$', CHF: 'CHF',
  JPY: '¥', CNY: '¥',
}

let _baseCurrency = 'USD'
export function setBaseCurrency(code) { _baseCurrency = code || 'USD' }
export function getBaseCurrency() { return _baseCurrency }

export function formatCurrency(value, currency) {
  if (value == null || isNaN(value)) return '$0.00'
  const cur = currency || _baseCurrency
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(value)
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
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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
  const t = type.toLowerCase()
  if (/stock|accion|equity|reit/i.test(t)) return 'stocks'
  if (/crypto|cripto|blockchain|bitcoin|btc|eth/i.test(t)) return 'crypto'
  if (/bond|bono|instrumento|inversion|deuda|debt|cdt|plazo|treasury|letra|pagare/i.test(t)) return 'bonds'
  if (/fund|fondo|etf|index|mutual/i.test(t)) return 'funds'
  if (/bank|banco|cash|saving|checking|cuenta|ahorro/i.test(t)) return 'banks'
  if (/real.?estate|propiedad|inmueble|property/i.test(t)) return 'other'
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
  const qtyBased = (item.quantity || 0) * getItemPrice(item)
  if (qtyBased > 0) return qtyBased
  return item.value || item.balance || item.amount || item.totalValue || 0
}

export const TYPE_ICONS = {
  stocks: '📈',
  crypto: '₿',
  bonds: '🏛',
  funds: '💼',
  banks: '🏦',
  other: '📊',
}
