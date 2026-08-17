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

function dayDiff(a, b) {
  const ta = dayTs(a), tb = dayTs(b)
  if (ta == null || tb == null) return Infinity
  return Math.abs(ta - tb) / DAY_MS
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

function classify({ relation, days, sim }) {
  if (relation === 'exact') {
    if (days <= 3 && sim >= SIM_CONFIRM) return 'confirmed'
    if (days <= MAX_DAY_DIFF && sim >= SIM_CONFIRM_FAR) return 'confirmed'
    // Amount and date line up but the merchant text does not: often an auto
    // row whose description never resolved. Real enough to show, not to
    // decide unilaterally.
    if (days <= MAX_DAY_DIFF) return 'review'
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
      const days = dayDiff(row.date, cand.tx.date)
      if (days > MAX_DAY_DIFF) continue
      const relation = amountRelation(row.amount, cand.tx.amount)
      if (relation === 'none') continue
      const sim = descSimilarity(textOf(row), textOf(cand.tx))
      const verdict = classify({ relation, days, sim })
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
  // statement does not contain. Usually a charge from another card; when it
  // is not, it is the signature of the same purchase captured twice.
  const dates = rows.map((r) => dayTs(r.date)).filter((t) => t != null)
  let orphans = []
  if (dates.length) {
    const from = Math.min(...dates), to = Math.max(...dates)
    orphans = pool
      .filter((c) => !c.claimed)
      .filter((c) => {
        const t = dayTs(c.tx.date)
        return t != null && t >= from && t <= to
      })
      .map((c) => c.tx)
  }

  return { confirmed, newTxs, review, orphans }
}
