// Cross-method reconciliation: the credit-card STATEMENT against what is
// already recorded (auto-captured by the iPhone Shortcut or the forwarded
// email, or typed by hand).
//
// Why this is not `matchStatement` (lib/statementMatcher.js): that one was
// built for a savings-account CSV reconciled against manual entries, and three
// of its assumptions break the moment a card statement meets auto-captured
// rows. All three were confirmed against real statements:
//
//   1. It dedups WITHIN the file by date+amount+description. A card statement
//      legitimately repeats a row (two Q20 parkings at the same lot on the
//      same day, seen in a real G&T statement), and our parser has ALREADY
//      proven both are real by reconciling against the statement's printed
//      totals. Collapsing them silently drops a charge.
//   2. It ignores CURRENCY. These statements carry GTQ and USD in one
//      document, so a $200 charge matched a Q200 one.
//   3. It requires the amount to match to the cent. Apple Pay captures the
//      AUTHORIZATION; the statement carries the SETTLEMENT, and they differ
//      whenever there is a restaurant tip or a fuel pre-authorization. Exact
//      matching turns one purchase into two rows and inflates the month.
//
// The shape of the answer is also different. A statement row that matches an
// existing one is not "skip": the statement is the bank's own record, so it
// CONFIRMS and ENRICHES what is there (final amount, posting date, card,
// installment) while preserving what only the earlier capture has (GPS
// coordinates from the Shortcut, and any category the user fixed by hand).
//
// Pure module + tests.

import { descSimilarity } from './statementMatcher'
import { sameChargeByTime } from './sameCharge'

const DAY_MS = 86400000

// Posting lag seen in real statements is up to 2 days (consumo 08-07 →
// transacción 10-07); 4 gives margin for a hand-typed date being a day off
// without reaching across a different purchase.
const MAX_DAY_DIFF = 4
// Adjusted-amount band. A tip runs the charge UP, a fuel pre-auth runs it
// DOWN; beyond this it is a different purchase, not an adjustment.
const ADJUST_MIN_RATIO = 0.7
const ADJUST_MAX_RATIO = 1.35
// ...and never on a large absolute swing, so a big number cannot drift into a
// neighbouring charge just because the ratio happens to fit.
const ADJUST_MAX_ABS = 500

const SIM_CONFIRM = 0.5      // exact amount + close date: the usual case
const SIM_CONFIRM_FAR = 0.75 // 4 days apart needs the merchant to be convincing
const SIM_ADJUST = 0.6       // amount differs: the merchant carries the claim

const cents = (n) => Math.round((Number(n) || 0) * 100)
const dayTs = (d) => {
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime()
  return isNaN(t) ? null : t
}
const currencyOf = (tx) => String(tx?.currency || 'GTQ').toUpperCase()
const textOf = (tx) => tx?.merchant || tx?.description || ''

// Which card a row belongs to, as the two facts that can be compared
// SEPARATELY: the issuing bank and the last four digits. They come from three
// places and no source has both every time, which is exactly why this cannot
// collapse to one opaque string:
//
//   · a row parsed from a statement carries `cardKey` ("bi:9856") — both.
//   · a row imported before that field existed carries only the account label
//     the import stamped ("Bi (Contecnica) •9856") — the digits, and a bank
//     name that is free text rather than our id.
//   · a row captured by the Shortcut or a forwarded alert carries `last4` when
//     the alert named the card — the digits and nothing else.
//
// Comparing the opaque strings treated the same card as two whenever the two
// sides came from different places, which is how a re-import DUPLICATED every
// row that predates `cardKey`.
function cardOf(tx) {
  const key = tx?.cardKey ? String(tx.cardKey) : null
  if (key) {
    const [bank, last4] = key.split(':')
    return { bank: bank || null, last4: /^\d{4}$/.test(last4) ? last4 : null }
  }
  // `last4` is what the ingest stores when a bank alert names the card. It was
  // being written and never read, so an alert that said WHICH card it was
  // stayed eligible against all of them.
  if (/^\d{4}$/.test(String(tx?.last4 || ''))) return { bank: null, last4: String(tx.last4) }
  const m = String(tx?.account || '').match(/[•*]\s*(\d{4})/)
  return m ? { bank: null, last4: m[1] } : null
}

// Whether this row's description is the bank's own merchant string. It decides
// how to read "the amounts and dates line up but the merchants share nothing":
// from a bank the merchant name is authoritative, so disagreement means two
// different charges; from the Shortcut or a forwarded alert the description can
// simply have failed to resolve, and then it carries no evidence either way.
function isBankText(tx) {
  return !!tx?.cardKey || String(tx?.source || '') === 'card_import'
}

function dayDiff(a, b) {
  const ta = dayTs(a), tb = dayTs(b)
  if (ta == null || tb == null) return Infinity
  return Math.abs(ta - tb) / DAY_MS
}

// Two charges billed on DIFFERENT cards are always two charges, however alike
// they look. Real case that forced this: the same person paid Q22 at HOSTALES
// CA and Q50 at COMO LA FLOR on both their BI card and their G&T card within
// three days; each statement reconciles to its own bank's printed totals, so
// both charges are proven real, and merging them deleted Q72 and rewrote the
// surviving row's date.
//
// A row with no card (captured by the Shortcut or the email, or typed by hand)
// stays eligible against every card — that is the whole point of mix-and-match.
//
// Each fact is compared only when BOTH sides know it, so partial knowledge
// narrows the field without ever excluding a real pairing: an alert that names
// only the digits is pinned to that card, and a row that names nothing stays
// open to all of them.
function cardDescriptorsConflict(a, b) {
  if (a == null || b == null) return false
  if (a.last4 && b.last4 && a.last4 !== b.last4) return true
  if (a.bank && b.bank && a.bank !== b.bank) return true
  return false
}

function cardsConflict(row, tx) {
  return cardDescriptorsConflict(cardOf(row), cardOf(tx))
}

function amountRelation(rowAmount, existingAmount) {
  const a = cents(rowAmount), b = cents(existingAmount)
  if (a === b) return 'exact'
  if (b === 0) return 'none'
  const ratio = a / b
  const absDiff = Math.abs(a - b) / 100
  if (ratio >= ADJUST_MIN_RATIO && ratio <= ADJUST_MAX_RATIO && absDiff <= ADJUST_MAX_ABS) return 'adjusted'
  return 'none'
}

// How good a pairing is, so the greedy assignment below always hands the
// closest existing row to each statement row. Only the ORDER matters.
function score({ relation, days, sim }) {
  let s = relation === 'exact' ? 100 : 40
  s += days === 0 ? 30 : days === 1 ? 20 : days === 2 ? 12 : 5
  return s + sim * 40
}

function classify({ relation, days, sim, bankText, byTime }) {
  // The hour outranks everything when both rows have one. Same instant is a
  // duplicate and gets merged without asking; different instants are two
  // charges, however alike the merchant and the amount look. A statement never
  // carries an hour, so this is 'unknown' there and the rules below decide.
  if (byTime === 'different') return null
  if (byTime === 'same' && relation === 'exact') return 'confirmed'

  if (relation === 'exact') {
    if (days <= 3 && sim >= SIM_CONFIRM) return 'confirmed'
    if (days <= MAX_DAY_DIFF && sim >= SIM_CONFIRM_FAR) return 'confirmed'
    // Amount and date line up but the merchant text does not. Against a row
    // that already carries a bank's merchant string that disagreement is the
    // answer: PARK-CENTRO and CLUB ALEMAN GARITA 2, both Q30 a day apart, are
    // two charges (a real pair from the user's own statements), and offering
    // them as "the same charge?" is how one of them gets thrown away. Against
    // an auto-captured row, whose description may simply never have resolved,
    // it is worth asking.
    if (days <= MAX_DAY_DIFF && !bankText) return 'review'
    return null
  }
  // An adjusted amount is a judgement call by definition, so it always goes
  // to the user rather than being applied silently.
  if (relation === 'adjusted' && days <= 2 && sim >= SIM_ADJUST) return 'review'
  return null
}

// What the statement teaches about a row we already had. Returns only the
// fields that actually change, plus a human-readable list of what changed, so
// the preview can show it instead of applying edits invisibly.
export function enrichmentFor(row, existing) {
  const updates = {}
  const changes = []

  // The statement is the bank's own record: its amount is the settled one.
  if (cents(row.amount) !== cents(existing.amount)) {
    updates.amount = row.amount
    changes.push({ field: 'amount', from: existing.amount, to: row.amount })
  }
  // The consumption date is when the purchase actually happened; an auto
  // capture can carry the posting date instead. Surfaced because it can move
  // a transaction across a month boundary.
  if (row.date && existing.date && row.date !== existing.date) {
    updates.date = row.date
    changes.push({ field: 'date', from: existing.date, to: row.date })
  }
  // Facts only the statement has.
  if (row.postedDate && !existing.postedDate) updates.postedDate = row.postedDate
  if (row.installment && !existing.installment) updates.installment = row.installment
  if (row.location && !existing.location) updates.location = row.location

  // Category: only filled in when the user has never looked at it AND the
  // statement's guess is better than the fallback. A category the user fixed
  // by hand is never overwritten by an import.
  const fallback = row.type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos'
  if (existing._needsReview === true && row.category && row.category !== fallback && row.category !== existing.category) {
    updates.category = row.category
    updates._needsReview = false
    changes.push({ field: 'category', from: existing.category, to: row.category })
  }

  // The description is deliberately left alone: Wallet's "Rally Padel
  // Guatemala" reads better than the bank's truncated "RALLY PADEL", and the
  // user may have edited it.
  updates._confirmedBy = 'statement'
  return { updates, changes }
}

// statementRows: parsed card rows (already reconciled against the statement's
//   own totals by lib/parsers/guateCardStatements.js).
// existing: the user's financeTransactions.
//
// Returns:
//   confirmed  [{ row, match, updates, changes }] — already recorded; the
//              import applies `updates` to `match` instead of adding a row.
//   newTxs     [row]                              — not recorded yet.
//   review     [{ row, match, relation, days, sim, defaultSame }] — the user
//              decides whether it is the same charge.
//   orphans    [tx] — recorded inside the statement's own date range but
//              absent from it, which is how a double-capture shows up.
export function reconcileStatement(statementRows, existing = []) {
  const rows = Array.isArray(statementRows) ? statementRows : []
  const pool = (Array.isArray(existing) ? existing : []).map((tx, i) => ({ tx, i, claimed: false }))

  // Rank every plausible pairing, then assign greedily. One statement row
  // claims at most one existing row and vice versa, which is what keeps two
  // identical charges as two charges.
  const pairs = []
  rows.forEach((row, ri) => {
    for (const cand of pool) {
      if (currencyOf(row) !== currencyOf(cand.tx)) continue
      if ((row.type || 'EXPENSE') !== (cand.tx.type || 'EXPENSE')) continue
      if (cardsConflict(row, cand.tx)) continue
      const days = dayDiff(row.date, cand.tx.date)
      if (days > MAX_DAY_DIFF) continue
      const relation = amountRelation(row.amount, cand.tx.amount)
      if (relation === 'none') continue
      const sim = descSimilarity(textOf(row), textOf(cand.tx))
      const verdict = classify({
        relation, days, sim,
        bankText: isBankText(cand.tx),
        byTime: sameChargeByTime(row, cand.tx),
      })
      if (!verdict) continue
      pairs.push({ ri, cand, relation, days, sim, verdict, s: score({ relation, days, sim }) })
    }
  })
  pairs.sort((a, b) => b.s - a.s)

  const takenRows = new Set()
  const assigned = new Map() // statement row index → pair
  for (const p of pairs) {
    if (takenRows.has(p.ri) || p.cand.claimed) continue
    takenRows.add(p.ri)
    p.cand.claimed = true
    assigned.set(p.ri, p)
  }

  const confirmed = []
  const review = []
  const newTxs = []
  rows.forEach((row, ri) => {
    const p = assigned.get(ri)
    if (!p) { newTxs.push(row); return }
    const match = p.cand.tx
    if (p.verdict === 'confirmed') {
      const { updates, changes } = enrichmentFor(row, match)
      confirmed.push({ row, match, updates, changes })
    } else {
      review.push({
        row,
        match,
        relation: p.relation,
        days: p.days,
        sim: p.sim,
        // Strong merchant evidence on an adjusted amount is the classic
        // tip/pre-auth case, so "same charge" is the better default there.
        defaultSame: p.relation === 'adjusted' ? p.sim >= 0.75 : true,
      })
    }
  })

  // Anything already recorded inside the statement's own window that the
  // statement does not contain — the signature of the same purchase captured
  // twice. A row that demonstrably belongs to a DIFFERENT card is left out:
  // this statement was never supposed to contain it, so listing it is noise
  // (23 such rows on the user's own second import), and noise in a list whose
  // whole job is to flag the one line that looks wrong defeats it.
  const statementCard = rows.map(cardOf).find((k) => k != null) || null
  const dates = rows.map((r) => dayTs(r.date)).filter((t) => t != null)
  let orphans = []
  if (dates.length) {
    const from = Math.min(...dates), to = Math.max(...dates)
    orphans = pool
      .filter((c) => !c.claimed)
      .filter((c) => !cardDescriptorsConflict(cardOf(c.tx), statementCard))
      .filter((c) => {
        const t = dayTs(c.tx.date)
        return t != null && t >= from && t <= to
      })
      .map((c) => c.tx)
  }

  return { confirmed, newTxs, review, orphans }
}
