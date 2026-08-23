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

// Símbolos de más de un carácter, que la clase de arriba no puede describir.
// Sin esto "R$ 1.234,56" perdía el $ y quedaba "R1.234,56", o sea 0 — y 0 se
// rechaza como INVALID_AMOUNT, así que un cobro brasileño fallaba entero.
// Anclado al principio para que no pueda morder dentro de un número.
const SYMBOL_PREFIX = /^(R\$|S\/\.?|Gs\.?|Bs\.?)\s*/i

// The currency a money STRING declares, if it declares one. Lives next to
// parseAmount because it answers the other half of the same question: that
// function throws the marker away, and something has to read it first.
//
// Why it matters: a caller can declare the wrong currency. The iPhone Shortcut
// hardcodes one (the user types it once when building the automation), so a
// charge in dollars would be stored as quetzales — off by ~7.7x, and silently,
// which is the worst way to be wrong about money.
//
// `ambiguous` is the honest flag on "$": it is the dollar, the peso, and half a
// dozen other currencies. The caller decides what to do with that.
// UNA lista de códigos para todo lo que lee dinero escrito por un banco. Vivía
// duplicada acá y en lib/parsers/bankAlertParser.js, y las dos copias no decían
// lo mismo: la del parser de alertas conocía siete monedas, así que una alerta
// colombiana o chilena con su código ISO escrito al lado del monto no lo veía y
// caía al default. Dos copias de la misma tabla es cómo una se queda atrás.
export const CURRENCY_CODES = [
  'GTQ', 'USD', 'EUR', 'MXN', 'CRC', 'HNL', 'NIO', 'GBP', 'JPY', 'CAD',
  'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'DOP', 'PAB', 'UYU', 'BOB', 'PYG',
]
const ISO_TOKEN = new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`, 'i')
const SYMBOL_TO_CODE = { Q: 'GTQ', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₡': 'CRC', '₱': 'PHP', '₨': 'PKR', 'R$': 'BRL', 'S/': 'PEN', 'Gs': 'PYG', 'Bs': 'BOB' }

export function detectCurrencyMarker(val) {
  if (val == null || typeof val === 'number') return null
  const s = String(val)
  // An ISO code beats a symbol: banks write "$ 100.00 USD" and the code is the
  // half that cannot mean two things.
  const iso = s.match(ISO_TOKEN)
  if (iso) return { code: iso[1].toUpperCase(), ambiguous: false }
  for (const [sym, code] of Object.entries(SYMBOL_TO_CODE)) {
    if (s.includes(sym)) return { code, ambiguous: false }
  }
  if (s.includes('$')) return { code: 'USD', ambiguous: true }
  return null
}

// Currencies that write themselves with "$", so a "$" next to one of them is
// agreement, not a contradiction.
const DOLLAR_CURRENCIES = new Set(['USD', 'MXN', 'ARS', 'CLP', 'COP', 'CAD', 'AUD', 'NZD', 'DOP', 'UYU', 'SGD', 'HKD', 'TWD', 'BRL'])

// What to store when the caller DECLARED one currency and the amount string
// CARRIES another. The string came from the bank or from Wallet; the declared
// one can be a constant someone typed months ago, so a real contradiction is
// resolved in favour of the string.
export function resolveCurrency(declared, marker) {
  const base = String(declared || 'GTQ').toUpperCase()
  if (!marker || marker.code === base) return base
  if (!marker.ambiguous) return marker.code
  // "$" only overrides a currency that does not use "$" itself.
  return DOLLAR_CURRENCIES.has(base) ? base : marker.code
}

export function parseAmount(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return isFinite(val) ? val : 0

  let s = String(val).trim()
    .replace(SYMBOL_PREFIX, '')
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

// Una CANTIDAD no es dinero, y por eso no puede usar `parseAmount`.
//
// La diferencia está en el separador solitario. Para dinero, "2.500" son dos mil
// quinientos: es la convención LatAm y `parseAmount` la respeta a propósito.
// Para una tenencia de cripto, "2.500 BTC" casi con seguridad son dos con medio,
// y leerlo como dos mil quinientos multiplica la posición por mil, en silencio,
// en el campo donde el usuario ya venía peleando con el teclado. Al revés no hay
// riesgo simétrico: quien de verdad tiene 2500 acciones escribe "2500", y si
// escribiera "2.500" el paso guiado le imprime el total en vivo justo debajo,
// así que la lectura equivocada se ve ANTES de guardar.
//
// Regla, entonces: un separador solitario es SIEMPRE decimal. Con dos o más
// ("1.234.567") vuelve a ser agrupación, que ahí no es ambiguo. Todo lo demás
// (símbolos de moneda, paréntesis contables, sufijos K/M/B) lo resuelve
// `parseAmount`, así que esta función solo desambigua y delega.
//
// Nace de un reporte real: "BTC no me dejaba poner 0.0001". La causa era el
// `type="number"` del input (con teclado en español el separador es coma, y un
// input numérico devuelve '' ante lo que no puede parsear, o sea se borra solo),
// pero cambiar el input a texto exige que el lado que LEE entienda las dos
// convenciones. Esta es esa mitad.
export function parseQuantity(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return isFinite(val) ? val : 0

  const s = String(val).trim()
  const dots = (s.match(/\./g) || []).length
  const commas = (s.match(/,/g) || []).length

  // Exactamente UN separador, y de un solo tipo: decimal, sin heurística.
  // Una cantidad negativa no existe (para eso está `isDebt` a nivel de ítem), y
  // dejarla pasar acá la multiplicaría por un precio y daría un valor negativo
  // sin que nada lo señale, así que el piso es cero en las dos ramas.
  const num = dots + commas === 1
    ? parseFloat(s.replace(',', '.').replace(/[^\d.\-]/g, ''))
    : parseAmount(s)
  return isFinite(num) && num > 0 ? num : 0
}
