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
//   2. Near-duplicate scan — same amount ±1 day with a matching merchant, from a
//      DIFFERENT source, is treated as already captured.

import crypto from 'crypto'
import { normalizeDesc, descSimilarity } from './statementMatcher'
import { parseAmount, parseImportDate } from './numberParse'
import { categorizeExpense } from './expenseCategorize'
import { FINANCE_CATEGORIES } from './financeCategories'

export const INGEST_SOURCES = ['shortcut', 'email']

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
  const amount = parseAmount(raw.amount)
  if (!isFinite(amount) || amount <= 0) return { error: 'INVALID_AMOUNT' }
  if (amount > MAX_AMOUNT) return { error: 'AMOUNT_TOO_LARGE' }

  const date = parseImportDate(raw.date || raw.occurredAt) || new Date().toISOString().slice(0, 10)
  // A future date is almost always a timezone artifact of the Shortcut, not a
  // real charge — clamp instead of rejecting so the expense still lands.
  const today = new Date().toISOString().slice(0, 10)
  const safeDate = date > today ? today : date

  const currency = String(raw.currency || 'GTQ').trim().toUpperCase().slice(0, 3) || 'GTQ'
  const merchant = String(raw.merchant || raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const location = raw.location ? String(raw.location).replace(/\s+/g, ' ').trim().slice(0, 120) : null
  const source = INGEST_SOURCES.includes(raw.source) ? raw.source : 'shortcut'
  const last4 = /^\d{4}$/.test(String(raw.last4 || '')) ? String(raw.last4) : null

  // Coordinates come from the Shortcut's "Current Location" action. They are the
  // reliable location signal; the merchant string's tail is the fallback.
  const lat = isFinite(Number(raw.lat)) && raw.lat !== null && raw.lat !== '' ? Number(raw.lat) : null
  const lon = isFinite(Number(raw.lon)) && raw.lon !== null && raw.lon !== '' ? Number(raw.lon) : null
  const coords = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null

  return {
    amount,
    currency,
    merchant,
    location,
    date: safeDate,
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
export function expenseDocId(input) {
  const key = input.externalId
    ? `ext:${input.externalId}`
    : `${input.date}|${cents(input.amount)}|${input.currency}|${normalizeDesc(input.merchant)}|${input.source}`
  return `ftx-auto-${hash([key])}`
}

// Cross-source near-duplicate: same amount and currency within ±1 day, captured
// automatically by the OTHER path, with a merchant that echoes this one. Manual
// entries are included too — if you already typed the expense, the Shortcut
// should not add it again.
export function findNearDuplicate(input, candidates) {
  const target = cents(input.amount)
  for (const tx of candidates || []) {
    if (cents(tx.amount) !== target) continue
    if ((tx.currency || 'GTQ') !== input.currency) continue
    if ((tx.type || 'EXPENSE') !== input.type) continue
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

  // ±1 day window: the charge can post on the day after the purchase, so the
  // email alert and the Wallet event legitimately carry different dates.
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
