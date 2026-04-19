export function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

export function formatCompact(value) {
  if (value == null || isNaN(value)) return '$0'
  if (Math.abs(value) >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M'
  if (Math.abs(value) >= 1000) return '$' + (value / 1000).toFixed(1) + 'K'
  return '$' + value.toFixed(0)
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
  if (/stock|accion/i.test(t)) return 'stocks'
  if (/crypto|cripto|blockchain/i.test(t)) return 'crypto'
  if (/bond|bono|instrumento|inversion|deuda|debt/i.test(t)) return 'bonds'
  if (/fund|fondo|etf/i.test(t)) return 'funds'
  if (/bank|banco|cash|saving/i.test(t)) return 'banks'
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
