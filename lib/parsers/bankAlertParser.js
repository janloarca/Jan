// Parser for bank card alerts arriving as forwarded email (ingest path C).
//
// Banks write these alerts freely and change the wording without notice, so this
// is deliberately a heuristic extractor rather than a per-bank template: find the
// amount + currency, then the merchant, then the date, and bail out returning
// null when the amount is missing (that's how we tell a real alert apart from a
// statement, a promo, or an out-of-office reply that got forwarded along).
//
// Pure module + tests. The caller decides what to do with a null.

import { parseAmount, parseImportDate } from '../numberParse'

// Currency tokens as banks write them, mapped to ISO codes. 'Q' is Guatemala's
// quetzal; '$' is treated as USD, which is right for a GT cardholder (local
// charges come as Q) and is re-checked against an explicit ISO code when present.
const CURRENCY_TOKENS = [
  { re: /\bGTQ\b/i, code: 'GTQ' },
  { re: /\bUSD\b/i, code: 'USD' },
  { re: /\bEUR\b/i, code: 'EUR' },
  { re: /\bMXN\b/i, code: 'MXN' },
  { re: /\bCRC\b/i, code: 'CRC' },
  { re: /\bHNL\b/i, code: 'HNL' },
  { re: /\bNIO\b/i, code: 'NIO' },
]

const SYMBOL_TO_CODE = { Q: 'GTQ', $: 'USD', '€': 'EUR', '£': 'GBP', '¢': 'CRC' }

// Amount with the currency BEFORE it ("GTQ 17.00", "Q17.00", "$1,234.56") or
// AFTER it ("17.00 GTQ"). Digits allow LatAm grouping; parseAmount sorts out
// which separator is decimal.
const AMOUNT_BEFORE = /(GTQ|USD|EUR|MXN|CRC|HNL|NIO|Q|\$|€|£)\s*(\d[\d.,]*\d|\d)/i
const AMOUNT_AFTER = /(\d[\d.,]*\d|\d)\s*(GTQ|USD|EUR|MXN|CRC|HNL|NIO)\b/i

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

function detectCurrency(text, matchedToken) {
  // An explicit ISO code anywhere in the alert beats a bare symbol: banks write
  // "$ 100.00 USD" and "Q 100.00 GTQ" alike, and the symbol is the weaker signal.
  for (const { re, code } of CURRENCY_TOKENS) if (re.test(text)) return code
  const sym = String(matchedToken || '').toUpperCase()
  return SYMBOL_TO_CODE[sym] || SYMBOL_TO_CODE[matchedToken] || null
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
export function parseBankAlert({ subject = '', text = '', html = '', receivedAt } = {}) {
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
    currency: detectCurrency(full, found.token) || 'GTQ',
    merchant: merchant || null,
    location,
    date,
    last4: extractLast4(full),
    kind: CREDIT_HINTS.test(full) ? 'credit' : 'debit',
  }
}
