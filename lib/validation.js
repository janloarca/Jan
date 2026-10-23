// FASE IG: derivada de la MISMA lista que alimenta los menús (lib/currencies.js).
// Antes era una copia a mano de 45 códigos mientras el menú ofrecía 14: la
// validación aceptaba monedas que el usuario no tenía forma de elegir, y
// agregar una al menú no la habilitaba aquí. Una sola fuente, imposible que
// vuelvan a divergir.
import { CURRENCIES, EXTRA_VALID_CURRENCIES } from './currencies'

const VALID_CURRENCIES = new Set([...CURRENCIES, ...EXTRA_VALID_CURRENCIES])

const MAX_PRICE = 10_000_000
// El tope se pensó en dólares. En monedas de nominal alto (COP, CLP, JPY...) un
// valor normal lo rebasa: COP 45M son ~$14K. Se escala por moneda.
const HIGH_NOMINAL = new Set(['COP', 'CLP', 'JPY', 'KRW', 'IDR', 'VND', 'PYG', 'HUF', 'UYU', 'CRC', 'ARS'])
export function maxPriceFor(currency) {
  return HIGH_NOMINAL.has(String(currency || '').toUpperCase()) ? MAX_PRICE * 1000 : MAX_PRICE
}
const MAX_QUANTITY = 1_000_000_000

export function sanitizeCell(val) {
  if (typeof val !== 'string') return val
  return val.replace(/^[\t\r\n=+\-@|]+/, '').trim()
}

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
    if ((item.purchasePrice || 0) > maxPriceFor(item.currency)) errors.push(`Purchase price exceeds ${maxPriceFor(item.currency)}`)
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
    item.symbol = sanitizeCell(item.symbol).toUpperCase().slice(0, 20)
  }

  if (typeof item.name === 'string') {
    item.name = sanitizeCell(item.name).slice(0, 200)
  }

  if (typeof item.institution === 'string') {
    item.institution = sanitizeCell(item.institution).slice(0, 100)
  }

  if (typeof item.currency === 'string') {
    item.currency = sanitizeCell(item.currency).toUpperCase()
  }

  for (const key of ['notes', 'description', 'subtype', 'taxJurisdiction']) {
    if (typeof item[key] === 'string') {
      item[key] = sanitizeCell(item[key]).slice(0, 500)
    }
  }

  const rawQty = Number(item.quantity) || 0
  item.quantity = isFinite(rawQty) ? Math.min(Math.abs(rawQty), MAX_QUANTITY) : 0
  if (raw.isDebt || (Number(raw.quantity) < 0 && !raw.isDebt)) {
    item.isDebt = true
  }

  const rawPP = Number(item.purchasePrice) || 0
  item.purchasePrice = isFinite(rawPP) ? Math.max(0, Math.min(rawPP, maxPriceFor(item.currency))) : 0

  if (item.currentPrice != null) {
    const rawCP = Number(item.currentPrice) || 0
    item.currentPrice = isFinite(rawCP) ? Math.max(0, rawCP) : 0
  }

  return item
}

// Los mensajes de validateItem están en inglés porque lo comparten los imports;
// el alta manual los muestra al usuario, así que se traducen aquí en un solo lugar.
export function translateValidationError(msg, lang = 'es') {
  if (lang !== 'es') return msg
  let m
  if ((m = /^Purchase price exceeds (\d+)/.exec(msg))) return `El monto supera el máximo permitido (${Number(m[1]).toLocaleString('es')} en esta moneda)`
  if (msg === 'Acquisition date is in the future') return 'La fecha de compra no puede ser futura'
  if (msg === 'Invalid acquisition date') return 'La fecha de compra no es válida'
  if (msg === 'Negative purchase price') return 'El monto no puede ser negativo'
  if (msg === 'Income rate must be 0-100%') return 'La tasa debe estar entre 0 y 100%'
  if ((m = /^Unknown currency: (.+)/.exec(msg))) return `Moneda desconocida: ${m[1]}`
  return msg
}
