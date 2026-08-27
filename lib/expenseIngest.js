// Shared core for auto-captured expenses. Both ingest paths land here:
//   A) iPhone Shortcut (Wallet "Transaction" automation) → POST /api/ingest/expense
//   C) forwarded bank alert email → the /api/cron/email-ingest sweep
//
// Server-only: writes with the Admin SDK, because financeTransactions is written
// on behalf of a token holder, not a signed-in browser session.
//
// The two paths overlap ON PURPOSE (Wallet only sees Apple Pay, email sees
// everything), so the SAME purchase routinely arrives twice. Deduplication is
// therefore the heart of this module, in two layers:
//   1. Deterministic doc id — replaying the identical event is a no-op write.
//   2. The HOUR, when both rows carry one: same instant is one charge, different
//      instants are two. It is the only thing that can tell those apart.
//   3. Failing that, a matching merchant on the SAME DAY.

import crypto from 'crypto'
import { normalizeDesc, descSimilarity } from './statementMatcher'
import { resolveOccurredAt, sameChargeByTime } from './sameCharge'
import { parseAmount, parseImportDate, detectCurrencyMarker, resolveCurrency } from './numberParse'
import { categorizeExpense } from './expenseCategorize'
import { FINANCE_CATEGORIES } from './financeCategories'

// De dónde vino la captura. 'android' es el push del banco leído por una app de
// automatización: mismo texto que el correo, pero en tiempo real.
export const INGEST_SOURCES = ['shortcut', 'email', 'android']

// Guards against a fat-fingered or malformed amount becoming the user's money.
const MAX_AMOUNT = 10_000_000

function hash(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20)
}

function cents(n) {
  return Math.round((Number(n) || 0) * 100)
}

function dayOffset(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Raw input (untrusted: it comes from a Shortcut the user edits, or from an email
// body) → the normalized shape we are willing to store, or an error.
export function normalizeExpenseInput(raw = {}) {
  // Que NO venga monto y que venga uno malo son dos fallas distintas y hasta
  // ahora salían con el mismo código, que es el que le llega al usuario como
  // notificación en el teléfono. Sin distinguirlas, "INVALID_AMOUNT" no dice si
  // el atajo mandó basura o si no mandó nada, y "no mandó nada" tiene una causa
  // concreta y muy común: correr la automatización a MANO desde Atajos. Ahí no
  // hay ninguna transacción de Wallet, así que la variable Monto resuelve vacía
  // y el intento no podía funcionar por construcción.
  const rawAmount = raw.amount
  const missing = rawAmount == null || String(rawAmount).trim() === ''
  if (missing) return { error: 'MISSING_AMOUNT' }

  const amount = parseAmount(rawAmount)
  if (!isFinite(amount) || amount <= 0) return { error: 'INVALID_AMOUNT' }
  if (amount > MAX_AMOUNT) return { error: 'AMOUNT_TOO_LARGE' }

  const date = parseImportDate(raw.date || raw.occurredAt) || new Date().toISOString().slice(0, 10)
  // A future date is almost always a timezone artifact of the Shortcut, not a
  // real charge — clamp instead of rejecting so the expense still lands.
  const today = new Date().toISOString().slice(0, 10)
  const safeDate = date > today ? today : date

  // The declared currency is a constant in the Shortcut, typed once when the
  // automation was built, so a charge in another currency would be stored under
  // the wrong one — off by the exchange rate, and silently. When the amount
  // string itself names a currency, that came from Wallet or the bank and wins.
  const declared = String(raw.currency || 'GTQ').trim().toUpperCase().slice(0, 3) || 'GTQ'
  const currency = resolveCurrency(declared, detectCurrencyMarker(raw.amount))
  const merchant = String(raw.merchant || raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const location = raw.location ? String(raw.location).replace(/\s+/g, ' ').trim().slice(0, 120) : null
  const source = INGEST_SOURCES.includes(raw.source) ? raw.source : 'shortcut'
  const last4 = /^\d{4}$/.test(String(raw.last4 || '')) ? String(raw.last4) : null

  // Coordinates come from the Shortcut's "Current Location" action. They are the
  // reliable location signal; the merchant string's tail is the fallback.
  const lat = isFinite(Number(raw.lat)) && raw.lat !== null && raw.lat !== '' ? Number(raw.lat) : null
  const lon = isFinite(Number(raw.lon)) && raw.lon !== null && raw.lon !== '' ? Number(raw.lon) : null
  const coords = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null

  // The instant of the purchase, which is what decides whether two captures of
  // the same amount are one charge or two (lib/sameCharge.js). Reported wins:
  // the Shortcut can send the Wallet transaction's own time, and a bank alert
  // often prints it. `receivedAt` is the caller's honest fallback — for the
  // Shortcut that is now (it fires at the register), and for the email sweep it
  // must be the message's Date header, never the sweep's clock.
  const time = resolveOccurredAt({
    reported: raw.occurredAt || raw.time || null,
    received: raw.receivedAt || null,
  })

  return {
    amount,
    currency,
    merchant,
    location,
    date: safeDate,
    occurredAt: time?.occurredAt || null,
    timeSource: time?.timeSource || null,
    source,
    last4,
    coords,
    externalId: raw.externalId || raw.clientId ? String(raw.externalId || raw.clientId).slice(0, 80) : null,
    entityId: raw.entityId ? String(raw.entityId).slice(0, 60) : null,
    // Callers may pre-classify (the email path knows a reversal is income); the
    // default is what the whole feature exists for: a card purchase.
    type: raw.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
  }
}

// Deterministic id: the same event replayed (Shortcut retried, mailbox swept
// twice) always resolves to the same document, so the write is idempotent.
//
// La HORA entra a la llave, y sin eso este id se tragaba un cobro real. Sin
// ella, dos compras del mismo monto en el mismo comercio el mismo día por el
// mismo transporte (dos parqueos de Q20, dos cafés) resolvían al MISMO
// documento y la segunda se descartaba como 'same-event' — ANTES de que
// `findNearDuplicate`, que existe justamente para separarlas por hora, llegara
// a correr. Su propio comentario ya fijaba la regla contraria: "dos parqueos de
// Q20 son dos cobros cuando ocurrieron a horas distintas", y "un duplicado que
// el usuario ve y borra se recupera; un cobro tragado no".
//
// FASE LO: entra CUALQUIER instante, reportado o de llegada, y no solo el
// reportado. Esa condición dejaba media función sin arreglar: Android nunca
// reporta hora (la ruta pasa `offsetMinutes = null` a propósito, porque un push
// no trae zona) y el correo tampoco cuando la alerta no imprime hora, así que
// ahí la llave volvía a la forma vieja y dos compras reales del mismo monto y
// comercio el mismo día seguían colapsando.
//
// El costo, dicho de frente: la hora de llegada CAMBIA entre reintentos, así
// que un reintento del cliente ya no da el mismo id. Lo cubre la segunda red,
// `findNearDuplicate`, que con dos instantes de llegada usa una ventana de
// cinco minutos: un reintento normal cae adentro y se detecta como duplicado.
// Un reintento a más de cinco minutos escribiría una segunda fila, y ese es el
// lado correcto del error por la regla que este módulo ya fija: "un duplicado
// que el usuario ve y borra se recupera; un cobro tragado no". Además ningún
// transporte documentado reintenta solo, y el reintento del SERVIDOR
// (`withFirestoreRetry`) reusa el mismo `input`, así que da el mismo id.
//
// Para el CORREO esto además es gratis: su `receivedAt` es la cabecera Date del
// mensaje, estable entre barridos, así que re-barrer el mismo correo sigue
// resolviendo al mismo documento.
export function expenseDocId(input) {
  const reported = input.occurredAt ? `|${input.occurredAt}` : ''
  const key = input.externalId
    ? `ext:${input.externalId}`
    : `${input.date}|${cents(input.amount)}|${input.currency}|${normalizeDesc(input.merchant)}|${input.source}${reported}`
  return `ftx-auto-${hash([key])}`
}

// Cross-source near-duplicate: the same purchase captured by the OTHER transport
// (or already typed by hand).
//
// The HOUR decides whenever both rows have one, because it is the only thing
// that separates "the same charge seen twice" from "two identical charges".
// Two Q20 parkings at the same lot are two charges when they happened at
// different times and one charge when they happened at the same one — and no
// amount of merchant-name matching can tell those apart.
//
// Without an hour on both sides it falls back to the merchant echo, and then
// only on the SAME DAY. The old ±1 day window quietly dropped a real repeat
// purchase the next day at the same place for the same amount; a duplicate the
// user can see and delete is recoverable, a swallowed charge is not.
export function findNearDuplicate(input, candidates) {
  const target = cents(input.amount)
  for (const tx of candidates || []) {
    if (cents(tx.amount) !== target) continue
    if ((tx.currency || 'GTQ') !== input.currency) continue
    if ((tx.type || 'EXPENSE') !== input.type) continue

    const verdict = sameChargeByTime(input, tx)
    // Deliberately ignores the date label here: a 7pm purchase in UTC-6 rolls
    // into the next UTC day, so one charge can carry two different day labels.
    // Instants seconds apart outrank that.
    if (verdict === 'same') return tx
    if (verdict === 'different') continue

    if (String(tx.date || '').slice(0, 10) !== input.date) continue
    // Merchant names differ across transports (push truncates, email spells it
    // out), so a token echo is enough. With no merchant on either side, amount +
    // day is all we have, and matching on that alone is the safer error.
    const a = input.merchant
    const b = tx.merchant || tx.description
    if (a && b && descSimilarity(a, b) < 0.5) continue
    return tx
  }
  return null
}

function validCategory(category, type) {
  const list = type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE
  return list.includes(category) ? category : (type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos')
}

// Writes one auto-captured expense for `uid`.
// Returns { status: 'created' | 'duplicate', id, transaction, duplicateOf? }.
export async function ingestExpense({ db, uid, input, rules = [] }) {
  if (!db) throw new Error('Admin DB not configured')
  if (!uid) throw new Error('Missing uid')

  const col = db.collection(`users/${uid}/financeTransactions`)
  const id = expenseDocId(input)

  const existing = await col.doc(id).get()
  if (existing.exists) {
    return { status: 'duplicate', id, duplicateOf: { id, ...existing.data() }, reason: 'same-event' }
  }

  // The QUERY still spans ±1 day even though the merchant fallback only accepts
  // the same day: a 7pm purchase in UTC-6 rolls into the next UTC day, so the
  // two captures of one charge can carry different date labels and the
  // instant-based check has to be able to see across that boundary.
  const nearby = await col
    .where('date', '>=', dayOffset(input.date, -1))
    .where('date', '<=', dayOffset(input.date, 1))
    .get()
  const dup = findNearDuplicate(input, nearby.docs.map((d) => ({ id: d.id, ...d.data() })))
  if (dup) {
    return { status: 'duplicate', id: dup.id, duplicateOf: dup, reason: 'cross-source' }
  }

  const { category, confidence } = input.type === 'INCOME'
    ? { category: 'Otros Ingresos', confidence: 'unknown' }
    : categorizeExpense(input.merchant, { rules })

  const transaction = {
    type: input.type,
    amount: input.amount,
    currency: input.currency,
    category: validCategory(category, input.type),
    description: input.merchant || (input.type === 'INCOME' ? 'Ingreso automático' : 'Gasto automático'),
    date: input.date,
    occurredAt: input.occurredAt,
    timeSource: input.timeSource,
    merchant: input.merchant || null,
    location: input.location,
    coords: input.coords,
    last4: input.last4,
    entityId: input.entityId,
    _source: `auto_${input.source}`,
    _autoCategory: confidence,
    // Anything the classifier had to guess is surfaced in the UI for a quick fix,
    // and fixing it is what teaches the user rule for next time.
    _needsReview: confidence === 'unknown',
    createdAt: new Date().toISOString(),
  }

  const clean = Object.fromEntries(Object.entries(transaction).filter(([, v]) => v !== undefined))
  await col.doc(id).set(clean)
  return { status: 'created', id, transaction: clean }
}

// La frase que ve el usuario en la notificación del teléfono cuando algo falla.
//
// No es cosmética: es el ÚNICO canal de diagnóstico que tiene el camino del
// atajo. No hay consola ni logs a mano, así que un código suelto convierte cada
// fallo en una ronda de preguntas. Cada frase nombra la causa MÁS PROBABLE y qué
// hacer, no solo qué salió mal.
export function explainIngestError(code) {
  switch (code) {
    case 'MISSING_AMOUNT':
      // La causa dominante, con diferencia: correr la automatización a mano
      // desde Atajos. Ahí no existe ninguna transacción de Wallet, así que la
      // variable Monto llega vacía y el intento no podía funcionar.
      return 'El atajo no mandó ningún monto. Pasa siempre que lo corrés a mano desde Atajos: ahí no hay ninguna compra de Wallet de la cual sacarlo. Probalo con una compra real de Apple Pay. Si también falla ahí, revisá que el campo Monto del cuerpo use la variable Transacción → Monto y no texto escrito.'
    case 'INVALID_AMOUNT':
      return 'El atajo mandó un monto que no se puede leer como número. Revisá que el campo Monto use la variable Transacción → Monto.'
    case 'AMOUNT_TOO_LARGE':
      return 'El monto supera el máximo permitido. Si el cobro es real, agregalo a mano.'
    // Los dos de abajo NO son fallos: son resultados legítimos del camino de
    // texto crudo, y decirlos como error haría que alguien persiguiera un
    // problema que no existe.
    case 'not-an-alert':
      return 'Esa notificación no parecía un cobro (no traía monto), así que no se registró nada. Es normal si la regla deja pasar avisos que no son de compra.'
    case 'credit':
      return 'Era un reverso o una devolución, no un gasto, así que no se registró. Va a aparecer cuando importes el estado de cuenta.'
    case 'declined':
      return 'El cobro fue rechazado, así que no salió dinero y no se registró nada.'
    default:
      return 'No se pudo registrar el gasto.'
  }
}
