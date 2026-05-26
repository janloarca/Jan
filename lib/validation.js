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

  if (item.quantity != null && item.quantity < 0 && !item.isDebt) {
    errors.push('Negative quantity on non-debt item')
  }

  if (Math.abs(item.quantity || 0) > MAX_QUANTITY) {
    errors.push(`Quantity exceeds ${MAX_QUANTITY}`)
  }

  if ((item.purchasePrice || 0) < 0) {
    errors.push('Negative purchase price')
  }

  if ((item.purchasePrice || 0) > MAX_PRICE) {
    errors.push(`Purchase price exceeds ${MAX_PRICE}`)
  }

  if ((item.currentPrice || 0) < 0) {
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

  item.quantity = Math.min(Math.abs(Number(item.quantity) || 0), MAX_QUANTITY)
  if (raw.isDebt || (Number(raw.quantity) < 0 && !raw.isDebt)) {
    item.isDebt = true
  }

  item.purchasePrice = Math.max(0, Math.min(Number(item.purchasePrice) || 0, MAX_PRICE))

  if (item.currentPrice != null) {
    item.currentPrice = Math.max(0, Number(item.currentPrice) || 0)
  }

  return item
}
