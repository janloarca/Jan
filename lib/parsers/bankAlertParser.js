// Parser for bank card alerts arriving as forwarded email (ingest path C).
//
// Banks write these alerts freely and change the wording without notice, so this
// is deliberately a heuristic extractor rather than a per-bank template: find the
// amount + currency, then the merchant, then the date, and bail out returning
// null when the amount is missing (that's how we tell a real alert apart from a
// statement, a promo, or an out-of-office reply that got forwarded along).
//
// Pure module + tests. The caller decides what to do with a null.

import { parseAmount, parseImportDate, resolveCurrency, CURRENCY_CODES } from '../numberParse'

// Los códigos ISO salen de lib/numberParse.js, la única lista del repo. Acá
// vivía una copia con SIETE monedas, así que una alerta colombiana o chilena que
// escribía su código al lado del monto no lo veía y caía al default.
const ISO_ALT = CURRENCY_CODES.join('|')

// Símbolos inequívocos. '$' NO está acá a propósito: ver detectCurrency.
const SYMBOL_TO_CODE = { Q: 'GTQ', '€': 'EUR', '£': 'GBP', '¢': 'CRC', 'R$': 'BRL', 'S/': 'PEN', 'Gs': 'PYG', 'Bs': 'BOB' }

// Amount with the currency BEFORE it ("GTQ 17.00", "Q17.00", "$1,234.56") or
// AFTER it ("17.00 GTQ"). Digits allow LatAm grouping; parseAmount sorts out
// which separator is decimal.
const AMOUNT_BEFORE = new RegExp(`(${ISO_ALT}|R\\$|S/|Gs|Bs|Q|\\$|€|£|¢)\\s*(\\d[\\d.,]*\\d|\\d)`, 'i')
const AMOUNT_AFTER = new RegExp(`(\\d[\\d.,]*\\d|\\d)\\s*(${ISO_ALT})\\b`, 'i')

// Alerts that are NOT a card purchase. Credits/reversals would otherwise land as
// expenses and quietly inflate the month.
const CREDIT_HINTS = /\b(reverso|reversa|devoluci[oó]n|reintegro|abono|cr[eé]dito aplicado|refund|credited|dep[oó]sito recibido)\b/i

// Boilerplate lines that must never be mistaken for a merchant name.
const NOISE = /\b(estimado|apreciable|cliente|banco|notificaci[oó]n|alerta|aviso|si no reconoce|no responda|este correo|confidencial|derechos reservados|unsubscribe|comunicarse|tel[eé]fono|servicio al cliente|atentamente|saludos)\b/i

// Labeled merchant fields, most explicit first.
const MERCHANT_LABELS = [
  /(?:comercio|establecimiento|afiliado|negocio|merchant|lugar de compra|punto de venta)\s*[:\-]\s*(.+)/i,
  /\ben\s+(?:el\s+comercio\s+)?["“]?([^"”\n]{3,80}?)["”]?\s+(?:el|por|con|the)\b/i,
  /\bat\s+([^\n]{3,80}?)\s+(?:on|for)\b/i,
]

const CARD_LABELS = [
  /(?:terminada|terminaci[oó]n|final(?:izada)?|ending)\s*(?:en|in|with)?\s*[:\-]?\s*\*{0,4}(\d{4})\b/i,
  /\*{2,}\s*(\d{4})\b/,
]

const DATE_LABELS = [
  /(?:fecha(?:\s+de\s+(?:transacci[oó]n|compra))?|date)\s*[:\-]\s*(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/i,
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
]

// The hour of the purchase, when the alert prints it. It is what tells one
// charge seen twice from two identical charges (lib/sameCharge.js), so it is
// worth reading rather than always falling back to when the mail arrived.
// Labelled forms first: a bare "14:32" also matches a time inside a reference
// number or a footer, and the label is what makes it the purchase's hour.
const TIME_LABELS = [
  /(?:hora(?:\s+de\s+(?:transacci[oó]n|compra))?|time)\s*[:\-]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/i,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/i,
  /\b\d{4}-\d{2}-\d{2}[T\s]+(\d{1,2}:\d{2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/i,
]

// 'HH:MM:SS' in 24h, or null. Meridiem is honoured when the alert uses it.
export function extractTime(text) {
  for (const re of TIME_LABELS) {
    const m = String(text || '').match(re)
    if (!m || !m[1]) continue
    const [hRaw, min, sec = '00'] = m[1].split(':')
    let h = Number(hRaw)
    if (!isFinite(h) || h > 23 || Number(min) > 59) continue
    const mer = (m[2] || '').toLowerCase().replace(/\./g, '')
    if (mer === 'pm' && h < 12) h += 12
    if (mer === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}:${String(sec).padStart(2, '0')}`
  }
  return null
}

// Minimal HTML → text: bank alerts are almost always table-based HTML, and we
// only need the visible words. Block tags become newlines so line-oriented
// heuristics below still see the original layout.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

// Qué moneda declara la alerta, y si esa declaración es firme.
//
// '$' es el punto delicado de toda LatAm: en México, Colombia, Chile, Argentina
// y Uruguay el peso local se escribe con '$', así que resolverlo a USD (lo que
// hacía este parser) convierte un cobro de $1,234 mexicanos en mil doscientos
// DÓLARES, unas dieciocho veces de más y en silencio. Correcto para una tarjeta
// guatemalteca, donde lo local viene en Q, y equivocado para casi todos los
// demás. Así que no se decide acá: se devuelve la ambigüedad y la resuelve quien
// sí sabe de qué país es el usuario.
function detectCurrency(text, matchedToken) {
  // Un código ISO explícito en cualquier parte de la alerta le gana a un
  // símbolo: los bancos escriben "$ 100.00 USD" y "Q 100.00 GTQ" por igual.
  const iso = text.match(new RegExp(`\\b(${ISO_ALT})\\b`, 'i'))
  if (iso) return { code: iso[1].toUpperCase(), ambiguous: false }
  const token = String(matchedToken || '')
  for (const [sym, code] of Object.entries(SYMBOL_TO_CODE)) {
    if (token.toUpperCase() === sym.toUpperCase()) return { code, ambiguous: false }
  }
  if (token.includes('$')) return { code: 'USD', ambiguous: true }
  return null
}

function extractAmount(text) {
  const before = text.match(AMOUNT_BEFORE)
  if (before) {
    const amount = parseAmount(before[2])
    if (amount > 0) return { amount, token: before[1] }
  }
  const after = text.match(AMOUNT_AFTER)
  if (after) {
    const amount = parseAmount(after[1])
    if (amount > 0) return { amount, token: after[2] }
  }
  return null
}

// Merchant strings carry their location: "Rally Padel Guatemala, Santa Catarina
// Pinula, GT". Splitting on commas gives us the name and the place separately,
// which is what the app shows and what the categorizer matches on.
export function splitMerchantLocation(raw) {
  const cleaned = String(raw || '')
    .replace(/\s*\.{3}$|\s*…$/, '') // push alerts truncate with an ellipsis
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return { merchant: '', location: null }
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) return { merchant: cleaned, location: null }
  return { merchant: parts[0], location: parts.slice(1).join(', ') }
}

function extractMerchant(text) {
  for (const re of MERCHANT_LABELS) {
    const m = text.match(re)
    if (m && m[1] && m[1].trim().length >= 3) return m[1].trim()
  }
  // Fallback: the longest line that is not boilerplate, not the amount line, and
  // reads like a name. Push-style alerts put the merchant on its own line.
  const candidates = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 90)
    .filter((l) => !NOISE.test(l))
    .filter((l) => !AMOUNT_BEFORE.test(l) && !AMOUNT_AFTER.test(l))
    .filter((l) => /[a-záéíóúñ]/i.test(l))
    .filter((l) => !/^\s*(https?:|www\.)/i.test(l))
  if (!candidates.length) return null
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

function extractDate(text, fallbackISO) {
  for (const re of DATE_LABELS) {
    const m = text.match(re)
    if (m && m[1]) {
      const iso = parseImportDate(m[1])
      if (iso) return iso
    }
  }
  return fallbackISO
}

function extractLast4(text) {
  for (const re of CARD_LABELS) {
    const m = text.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

// { subject, text, html, receivedAt } → normalized alert or null.
// receivedAt (ISO string or Date) is the fallback date when the body has none:
// forwarded alerts usually arrive the same day as the purchase.
// `defaultCurrency` es la del USUARIO (su moneda base), no una constante: es lo
// que decide qué significa un '$' suelto y qué se asume cuando la alerta no
// declara nada. GTQ sigue siendo el valor por omisión para no cambiarle el
// comportamiento a ningún caller viejo.
export function parseBankAlert({ subject = '', text = '', html = '', receivedAt, defaultCurrency = 'GTQ' } = {}) {
  const body = text && text.trim() ? text : htmlToText(html)
  const full = `${subject}\n${body}`.trim()
  if (!full) return null

  const found = extractAmount(full)
  if (!found) return null

  const receivedISO = receivedAt
    ? (parseImportDate(receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt) || undefined)
    : undefined
  const date = extractDate(full, receivedISO || new Date().toISOString().slice(0, 10))

  const rawMerchant = extractMerchant(body) || extractMerchant(full) || ''
  const { merchant, location } = splitMerchantLocation(rawMerchant)

  return {
    amount: found.amount,
    currency: resolveCurrency(defaultCurrency, detectCurrency(full, found.token)),
    merchant: merchant || null,
    location,
    date,
    // Local wall time as the alert printed it; the caller pairs it with `date`
    // to build the instant. Null is normal — many alerts print no hour, and
    // then the message's own Date header is the honest approximation.
    time: extractTime(full),
    last4: extractLast4(full),
    kind: CREDIT_HINTS.test(full) ? 'credit' : 'debit',
  }
}
