// One number parser for every import path. This app is LatAm-first, so a decimal
// COMMA ("1.234,56", "0,25") is as common as the US form and must never be guessed
// wrong: the old per-file implementations turned "150,25" into 15025 (100x) and
// "1.234,56" into 1.23456 (1000x), and those numbers passed validation and landed
// in Firestore as the user's real money.
//
// Heuristic: whichever of "." or "," appears LAST is the decimal separator; the other
// one is a thousands separator. With only one kind present, a group of exactly 3
// digits after a single separator is treated as thousands ("12.345" -> 12345), which
// matches how bank exports write round amounts.

const CURRENCY = /[$€£¥₡₿Q₱₨]/g
// An ISO 4217 code where a symbol would go: "GTQ 17.00", "17.00 USD". Stripping
// only the symbol turned "GTQ 17.00" into "GT17.00" and then into 0 — and 0 is
// rejected as INVALID_AMOUNT, so an iPhone Shortcut sending Wallet's formatted
// amount would fail every charge. Bounded to the ends and to exactly three
// letters so it can never eat part of a number.
//
// Written without a lookbehind on purpose: this module runs in the browser too,
// and Safari only learned lookbehind in 16.4 — an unsupported one is a parse
// error, so it would take the whole bundle down rather than just this call.
const ISO_LEAD = /^[A-Za-z]{3}(?=[\s\d])/
const ISO_TRAIL = /([\s\d])[A-Za-z]{3}$/

export function parseAmount(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return isFinite(val) ? val : 0

  let s = String(val).trim()
    .replace(ISO_LEAD, '')
    .replace(ISO_TRAIL, '$1')
    .replace(CURRENCY, '')
    .replace(/\s/g, '')
  // Accounting negatives: (1.234,56)
  const paren = s.match(/^\((.*)\)$/)
  if (paren) s = '-' + paren[1]
  s = s.replace(/%$/, '')

  // K/M/B shorthand
  const shorthand = s.match(/^(-?[\d.,]+)\s*([KkMmBb])$/)
  if (shorthand) {
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[shorthand[2].toLowerCase()] || 1
    const base = parseAmount(shorthand[1])
    return isFinite(base * mult) ? base * mult : 0
  }

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma > -1 && lastDot > -1) {
    // Both present: the LAST one is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Only commas. "1,234,567" -> thousands. "1,234" is ambiguous: a lone separator
    // followed by exactly 3 digits reads as thousands, anything else as a decimal.
    const parts = s.split(',')
    const lastPart = parts[parts.length - 1]
    if (parts.length > 2 || (lastPart.length === 3 && parts.length === 2 && /^\d+$/.test(lastPart) && !/^0/.test(lastPart))) {
      s = s.replace(/,/g, '')
    } else {
      s = s.replace(',', '.')
    }
  } else if (lastDot > -1) {
    // Only dots — same ambiguity mirrored.
    const parts = s.split('.')
    const lastPart = parts[parts.length - 1]
    if (parts.length > 2 || (lastPart.length === 3 && parts.length === 2 && /^\d+$/.test(lastPart) && !/^0/.test(lastPart))) {
      s = s.replace(/\./g, '')
    }
  }

  const num = parseFloat(s)
  return isFinite(num) ? num : 0
}

// Dates arrive as Excel serials (a date cell read without cellDates), ISO strings,
// or LatAm dd/mm/yyyy. Returning undefined for junk lets callers report the row
// instead of writing a year-45000 date that validation then rejects with no reason.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

export function parseImportDate(val) {
  if (val == null || val === '') return undefined
  if (val instanceof Date && !isNaN(val)) return val.toISOString().slice(0, 10)

  // Excel serial: days since 1899-12-30. Bounded to a sane window (1970..2100) so a
  // plain number like a price never gets mistaken for a date.
  const asNum = typeof val === 'number' ? val : (/^\d{4,5}(\.\d+)?$/.test(String(val).trim()) ? Number(val) : NaN)
  if (isFinite(asNum) && asNum > 25569 && asNum < 73415) {
    return new Date(EXCEL_EPOCH_MS + Math.round(asNum) * 86400000).toISOString().slice(0, 10)
  }

  const s = String(val).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`

  // dd/mm/yyyy or dd-mm-yyyy (LatAm default). Day-first unless the first group is
  // clearly a month-only value and the second cannot be a month.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, a, b, y] = m
    let day = Number(a), month = Number(b)
    if (day > 12 && month <= 12) { /* dd/mm */ }
    else if (month > 12 && day <= 12) { day = Number(b); month = Number(a) } // mm/dd
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
    const year = Number(y.length === 2 ? `20${y}` : y)
    const dt = new Date(Date.UTC(year, month - 1, day))
    return isNaN(dt) ? undefined : dt.toISOString().slice(0, 10)
  }

  const parsed = new Date(s)
  if (!isNaN(parsed) && parsed.getUTCFullYear() > 1900 && parsed.getUTCFullYear() < 2200) {
    return parsed.toISOString().slice(0, 10)
  }
  return undefined
}
