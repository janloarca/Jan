const VALID_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'CLP', 'ARS', 'BRL',
  'PEN', 'CAD', 'CHF', 'JPY', 'CNY', 'HKD', 'KRW', 'AUD', 'NZD',
  'SGD', 'INR', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY',
  'ZAR', 'ILS', 'THB', 'TWD', 'PHP', 'IDR', 'MYR', 'VND', 'CRC',
  'UYU', 'PYG', 'BOB', 'DOP', 'HNL', 'NIO', 'PAB', 'BTC', 'ETH',
])

const MAX_PRICE = 10_000_000
const MAX_QUANTITY = 1_000_000_000

export function validateItem(item) {
  const errors = []

  if (item.quantity != null && !isFinite(Number(item.quantity))) {
    errors.push('Invalid quantity (NaN or Infinity)')
  } else if (item.quantity != null && item.quantity < 0 && !item.isDebt) {
    errors.push('Negative quantity on non-debt item')
  } else if (Math.abs(item.quantity || 0) > MAX_QUANTITY) {
    errors.push(`Quantity exceeds ${MAX_QUANTITY}`)
  }

  if (item.purchasePrice != null && !isFinite(Number(item.purchasePrice))) {
    errors.push('Invalid purchase price (NaN or Infinity)')
  } else {
    if ((item.purchasePrice || 0) < 0) errors.push('Negative purchase price')
    if ((item.purchasePrice || 0) > MAX_PRICE) errors.push(`Purchase price exceeds ${MAX_PRICE}`)
  }

  if (item.currentPrice != null && !isFinite(Number(item.currentPrice))) {
    errors.push('Invalid current price (NaN or Infinity)')
  } else if ((item.currentPrice || 0) < 0) {
    errors.push('Negative current price')
  }

  if (item.acquisitionDate) {
    const acq = new Date(item.acquisitionDate)
    if (isNaN(acq.getTime())) {
      errors.push('Invalid acquisition date')
    } else if (acq.getTime() > Date.now() + 86400000) {
      errors.push('Acquisition date is in the future')
    }
  }

  if (item.currency && !VALID_CURRENCIES.has(item.currency.toUpperCase())) {
    errors.push(`Unknown currency: ${item.currency}`)
  }

  if (item.incomeRate != null && (item.incomeRate < 0 || item.incomeRate > 100)) {
    errors.push('Income rate must be 0-100%')
  }
  if (item.rateMin != null && item.rateMax != null && item.rateMin > item.rateMax) {
    errors.push('Rate min cannot exceed rate max')
  }
  if (item.payDay != null && (item.payDay < 1 || item.payDay > 31)) {
    errors.push('Pay day must be 1-31')
  }

  return errors
}

export function sanitizeImportItem(raw) {
  const item = { ...raw }

  if (typeof item.symbol === 'string') {
    item.symbol = item.symbol.trim().toUpperCase().slice(0, 20)
  }

  if (typeof item.name === 'string') {
    item.name = item.name.trim().slice(0, 200)
  }

  if (typeof item.institution === 'string') {
    item.institution = item.institution.trim().slice(0, 100)
  }

  if (typeof item.currency === 'string') {
    item.currency = item.currency.trim().toUpperCase()
  }

  const rawQty = Number(item.quantity) || 0
  item.quantity = isFinite(rawQty) ? Math.min(Math.abs(rawQty), MAX_QUANTITY) : 0
  if (raw.isDebt || (Number(raw.quantity) < 0 && !raw.isDebt)) {
    item.isDebt = true
  }

  const rawPP = Number(item.purchasePrice) || 0
  item.purchasePrice = isFinite(rawPP) ? Math.max(0, Math.min(rawPP, MAX_PRICE)) : 0

  if (item.currentPrice != null) {
    const rawCP = Number(item.currentPrice) || 0
    item.currentPrice = isFinite(rawCP) ? Math.max(0, rawCP) : 0
  }

  return item
}
