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
const CREDIT_HINTS = /\b(reverso|reversa|anulaci[oó]n|anulad[ao]|devoluci[oó]n|reintegro|abono|cr[eé]dito aplicado|refund|credited|dep[oó]sito recibido)\b/i

// Un cobro que NO ocurrió. Los bancos mandan estas alertas con la MISMA
// plantilla que un cobro aprobado, así que sin esto se guardaban como gasto
// real e inflaban el mes con dinero que nunca salió; y a diferencia de un
// reverso, acá no hay un movimiento posterior que lo netee.
//
// DOS guards, y los dos existen porque el error de skipear de más es el que NO
// se recupera: guardar un cobro rechazado infla el mes con algo visible que el
// usuario puede borrar, mientras que descartar un cobro real lo hace
// desaparecer sin dejar rastro. Ante la duda, no se descarta.
//
//   1. Solo sustantivo y participio, nunca el infinitivo: un pie que dice "si
//      desea ANULAR esta transacción" describe un cobro que SÍ pasó.
//   2. Solo el ENCABEZADO (asunto + las dos primeras líneas del cuerpo), que es
//      donde vive el verbo de la alerta. Un pie que explica que "una transacción
//      rechazada no genera cargo" no puede descartar el cobro de arriba.
//
// El límite es estructural y no un conteo de caracteres: con una alerta corta,
// un tope por longitud alcanza el pie igual (lo cazó el test de este guard).
const DECLINED_HINTS = /\b(rechazad[ao]|declinad[ao]|denegad[ao]|no aprobad[ao]|rejected|declined)\b/i
const HEAD_BODY_LINES = 2

function alertHead(subject, body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean)
  return [String(subject || ''), ...lines.slice(0, HEAD_BODY_LINES)].join('\n')
}

// Boilerplate lines that must never be mistaken for a merchant name.
const NOISE = /\b(estimado|apreciable|cliente|banco|notificaci[oó]n|alerta|aviso|si no reconoce|no responda|este correo|confidencial|derechos reservados|unsubscribe|comunicarse|tel[eé]fono|servicio al cliente|atentamente|saludos)\b/i

// Labeled merchant fields, most explicit first.
const MERCHANT_LABELS = [
  /(?:comercio|establecimiento|afiliado|negocio|merchant|lugar de compra|punto de venta)\s*[:\-]\s*(.+)/i,
  /\ben\s+(?:el\s+comercio\s+)?["“]?([^"”\n]{3,80}?)["”]?\s+(?:el|por|con|the)\b/i,
  /\bat\s+([^\n]{3,80}?)\s+(?:on|for)\b/i,
  // "Compra Q75.00 en POLLO CAMPERO ZONA 10": el comercio al FINAL, sin ninguna
  // palabra detrás. Las dos formas de arriba exigen una ("el", "por", "con",
  // "on", "for") y el respaldo por líneas descarta toda línea que tenga un
  // monto, así que el formato de push más corto se quedaba sin comercio: la
  // fila no se podía clasificar y su llave de documento colapsaba más fácil.
  // Va al final para que las etiquetas explícitas sigan ganando.
  /\ben\s+(?:el\s+comercio\s+)?["“]?([^"”\n]{3,80}?)["”]?\s*$/im,
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
function detectCurrency(text, matchedToken, span = null) {
  // Un código ISO explícito le gana a un símbolo, porque los bancos escriben
  // "$ 100.00 USD" y "Q 100.00 GTQ" por igual. Pero tiene que estar PEGADO al
  // monto, no en cualquier parte del cuerpo.
  //
  // Buscándolo en todo el texto, la lista de 20 códigos con match
  // case-insensitive convertía cualquier palabra en una declaración de moneda:
  // "Compra por Q75.00 en BOB ESPONJA STORE" se guardaba en bolivianos, y
  // "Q1,540.00 (USD 200.00)" en dólares, casi ocho veces de más. El equivalente
  // en otra moneda y el pie de página son lugares normales donde aparece un
  // código, y ninguno describe el cobro.
  if (span) {
    const after = text.slice(span.end)
    const m1 = after.match(new RegExp(`^\\s{0,2}(${ISO_ALT})\\b`, 'i'))
    if (m1) return { code: m1[1].toUpperCase(), ambiguous: false }
    const before = text.slice(0, span.start)
    const m2 = before.match(new RegExp(`\\b(${ISO_ALT})\\s{0,2}$`, 'i'))
    if (m2) return { code: m2[1].toUpperCase(), ambiguous: false }
  }
  const token = String(matchedToken || '')
  // El token que capturó el monto PUEDE ser el código ("USD 49.99", "88.50 GTQ"):
  // es el caso adyacente por definición y hasta ahora lo cubría de rebote la
  // búsqueda sobre todo el texto. Lo cazó un test que ya existía.
  if (new RegExp(`^(?:${ISO_ALT})$`, 'i').test(token)) {
    return { code: token.toUpperCase(), ambiguous: false }
  }
  for (const [sym, code] of Object.entries(SYMBOL_TO_CODE)) {
    if (token.toUpperCase() === sym.toUpperCase()) return { code, ambiguous: false }
  }
  if (token.includes('$')) return { code: 'USD', ambiguous: true }
  return null
}

// Una alerta trae varios números con forma de dinero: el cobro, el saldo
// disponible, el límite, a veces una referencia. Tomar el PRIMERO hacía que el
// monto dependiera del orden en que el banco imprime esas líneas: "Saldo
// disponible Q5,000.00 / Compra Q50.00" guardaba 5,000, cien veces de más.
//
// Se elige por línea y en tres pasadas, de más específica a más general, y la
// última es el comportamiento de siempre sobre el texto completo, así que una
// alerta que hoy se lee bien no puede empeorar.
const AMOUNT_NEGATIVE_LINE = /\b(saldo|disponible|l[ií]mite|limite|cupo|autorizaci[oó]n|autorizacion|referencia|n[uú]mero de|acumulad[ao]|puntos)\b/i
const AMOUNT_POSITIVE_LINE = /\b(compra|consumo|cargo|monto|importe|transacci[oó]n|transaccion|d[eé]bito|debito|retiro|pago|purchase|charge|amount|withdrawal)\b/i

function amountIn(text) {
  const before = text.match(AMOUNT_BEFORE)
  if (before) {
    const amount = parseAmount(before[2])
    if (amount > 0) {
      return { amount, token: before[1], start: before.index, end: before.index + before[0].length }
    }
  }
  const after = text.match(AMOUNT_AFTER)
  if (after) {
    const amount = parseAmount(after[1])
    if (amount > 0) {
      return { amount, token: after[2], start: after.index, end: after.index + after[0].length }
    }
  }
  return null
}

// El span se devuelve relativo al texto COMPLETO: `detectCurrency` lo usa para
// mirar lo que está pegado al monto, y un offset de línea lo mandaría a leer
// otra parte del cuerpo.
function amountInLine(full, line) {
  const hit = amountIn(line)
  if (!hit) return null
  const at = full.indexOf(line)
  if (at < 0) return { amount: hit.amount, token: hit.token }
  return { amount: hit.amount, token: hit.token, start: at + hit.start, end: at + hit.end }
}

function extractAmount(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean)
  const usable = lines.filter((l) => !AMOUNT_NEGATIVE_LINE.test(l))

  for (const l of usable.filter((x) => AMOUNT_POSITIVE_LINE.test(x))) {
    const hit = amountInLine(text, l)
    if (hit) return hit
  }
  for (const l of usable) {
    const hit = amountInLine(text, l)
    if (hit) return hit
  }
  // Sin ninguna línea utilizable, el texto entero: es lo que hacía siempre.
  return amountIn(text)
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
    currency: resolveCurrency(defaultCurrency, detectCurrency(full, found.token, found.start != null ? { start: found.start, end: found.end } : null)),
    merchant: merchant || null,
    location,
    date,
    // Local wall time as the alert printed it; the caller pairs it with `date`
    // to build the instant. Null is normal — many alerts print no hour, and
    // then the message's own Date header is the honest approximation.
    time: extractTime(full),
    last4: extractLast4(full),
    kind: CREDIT_HINTS.test(full) ? 'credit'
      : DECLINED_HINTS.test(alertHead(subject, body)) ? 'declined'
      : 'debit',
  }
}
