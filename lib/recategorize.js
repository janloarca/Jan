// Re-running the classifier over transactions that are already stored.
//
// Why this has to exist: a transaction's category is decided once, at capture
// or import time, and then frozen on the document. So every improvement to the
// classifier is invisible on everything already recorded — the user keeps
// looking at a month where a quarter of the rows say "Otros Gastos" while the
// same file re-imported today would classify them. Asking them to delete and
// re-import to see a fix is not an answer.
//
// What it will and will not touch:
//   - ONLY rows a machine classified (a statement import, or the Shortcut /
//     forwarded-alert capture). A hand-typed transaction is the user's own
//     wording and their own choice; nothing here rewrites it.
//   - ONLY rows still sitting in the fallback bucket, which is the classifier
//     saying "I could not tell". A row in any real category is either a good
//     guess or the user's correction, and in both cases the stored answer is
//     at least as good as a fresh guess.
//   - NEVER a row the user set by hand, marked `_categorySetByUser`.
//
// Pure module + tests. The caller applies the returned changes.

import { categorizeExpense } from './expenseCategorize'
import { FINANCE_CATEGORIES } from './financeCategories'

const FALLBACK = { INCOME: 'Otros Ingresos', EXPENSE: 'Otros Gastos' }

// Statement rows carry the bank's own verdict about what the row IS, which
// beats reading the merchant text: "MEMBRESIA CLUB BI" is a card fee, not a
// night out, and "FIN/CT 0013 000001 27" names a contract, not a shop.
const KIND_CATEGORY = { fee: 'Comisiones' }

// Whether this row's description was written by a MACHINE: a bank statement, or
// the Shortcut / forwarded-alert capture. Exported because two things need the
// same answer and they disagreed once already — this module skipped hand-typed
// rows correctly while the edit handler only recognised the Shortcut, so
// correcting an imported statement row taught the classifier nothing.
//
// The two field names are historical: statement rows carry `source`, auto
// captures carry `_source`.
export function isMachineDescribed(tx) {
  if (String(tx?.source || '') === 'card_import') return true
  return String(tx?._source || '').startsWith('auto_')
}

function categoryFor(tx, rules) {
  const type = tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
  if (type === 'INCOME') return null // nothing to re-read: income has no merchant classifier
  if (KIND_CATEGORY[tx.kind]) return KIND_CATEGORY[tx.kind]
  const text = tx.merchant || tx.description || ''
  const { category, confidence } = categorizeExpense(text, { rules })
  if (tx.kind === 'installment') return confidence === 'unknown' ? 'Financiamiento' : category
  return confidence === 'unknown' ? null : category
}

// Returns [{ id, from, to, description }] — one entry per row that would
// actually change. An empty array is a real answer ("nothing left to fix"),
// not a failure.
export function planRecategorize(transactions, { rules = [] } = {}) {
  const out = []
  for (const tx of transactions || []) {
    if (!tx?.id) continue
    if (tx._categorySetByUser) continue
    if (!isMachineDescribed(tx)) continue

    const type = tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
    const current = tx.category
    const isFallback = current === FALLBACK[type]
    const isUnknownCategory = !FINANCE_CATEGORIES[type].includes(current)
    if (!isFallback && !isUnknownCategory) continue

    const next = categoryFor(tx, rules)
    if (!next || next === current) continue
    if (!FINANCE_CATEGORIES[type].includes(next)) continue
    out.push({ id: tx.id, from: current, to: next, description: tx.description || tx.merchant || '' })
  }
  return out
}
