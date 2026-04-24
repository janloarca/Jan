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
