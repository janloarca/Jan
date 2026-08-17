// Statement reconciliation: given transactions parsed from an uploaded card or
// bank statement and the transactions already recorded, classify every parsed
// row so the import adds ONLY what's missing — never duplicates.
//
// Buckets:
//   'exact'  — already recorded beyond doubt (same reference, or same date +
//              same amount + same type + similar description). Skipped.
//   'likely' — probably recorded (same amount + type within ±3 days, or same
//              amount + weaker description signal). Needs the user's eye;
//              defaults to NOT importing.
//   'new'    — nothing similar exists. Imported.
//
// Also dedups WITHIN the uploaded file (banks repeat rows across page breaks)
// and against previously-imported statement rows (source *_import).
//
// Pure module + tests. Matching works in cents and normalized text so currency
// formatting and accents never defeat it.

const DAY_MS = 86400000

export function normalizeDesc(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // drop accents
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cents(amount) {
  return Math.round((Number(amount) || 0) * 100)
}

function dayTs(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d.getTime()
}

// Token-overlap similarity in [0, 1] — resilient to banks truncating or
// reordering merchant names.
export function descSimilarity(a, b) {
  const ta = new Set(normalizeDesc(a).split(' ').filter((w) => w.length >= 3))
  const tb = new Set(normalizeDesc(b).split(' ').filter((w) => w.length >= 3))
  if (ta.size === 0 || tb.size === 0) return 0
  let common = 0
  for (const w of ta) if (tb.has(w)) common += 1
  return common / Math.min(ta.size, tb.size)
}

function signatureKey(tx) {
  return `${String(tx.date).slice(0, 10)}|${cents(tx.amount)}|${tx.type}|${normalizeDesc(tx.description)}`
}

// parsedTxs: rows from the parser ({date, amount, type, description, reference?, ...})
// existingTxs: current financeTransactions ({date, amount, type, description, reference?, source})
// Returns { newTxs, exact, likely } — likely rows carry `match` (the existing tx).
export function matchStatement(parsedTxs, existingTxs) {
  const existing = (existingTxs || []).map((tx) => ({
    tx,
    ts: dayTs(tx.date),
    cents: cents(tx.amount),
    currency: String(tx.currency || 'GTQ').toUpperCase(),
    ref: tx.reference ? String(tx.reference).trim() : null,
  }))

  const newTxs = []
  const exact = []
  const likely = []
  const seenInFile = new Set()

  for (const parsed of parsedTxs || []) {
    // In-file dedup: identical date+amount+type+description appears once.
    const sig = signatureKey(parsed)
    if (seenInFile.has(sig)) {
      exact.push({ parsed, reason: 'in-file-duplicate' })
      continue
    }
    seenInFile.add(sig)

    const pTs = dayTs(parsed.date)
    const pCents = cents(parsed.amount)
    const pCurrency = String(parsed.currency || 'GTQ').toUpperCase()
    const pRef = parsed.reference ? String(parsed.reference).trim() : null

    let best = null // { kind: 'exact'|'likely', candidate }
    for (const cand of existing) {
      if (cand.cents !== pCents || cand.tx.type !== parsed.type) continue
      // Currency was missing from this comparison, so a $200 charge matched a
      // Q200 one. These statements carry both currencies in one document.
      if (cand.currency !== pCurrency) continue

      // Reference equality is the strongest signal banks give us.
      if (pRef && cand.ref && pRef === cand.ref) {
        best = { kind: 'exact', candidate: cand.tx }
        break
      }

      const dayDiff = pTs != null && cand.ts != null ? Math.abs(pTs - cand.ts) / DAY_MS : Infinity
      const sim = descSimilarity(parsed.description, cand.tx.description)

      if (dayDiff === 0 && sim >= 0.5) {
        best = { kind: 'exact', candidate: cand.tx }
        break
      }
      if (dayDiff <= 3 && (sim >= 0.5 || dayDiff === 0)) {
        // Same amount within 3 days with a description echo (or same-day with a
        // different description — manual entries often paraphrase the merchant).
        if (!best) best = { kind: 'likely', candidate: cand.tx }
      }
    }

    if (best?.kind === 'exact') exact.push({ parsed, match: best.candidate, reason: 'matched' })
    else if (best?.kind === 'likely') likely.push({ parsed, match: best.candidate })
    else newTxs.push(parsed)
  }

  return { newTxs, exact, likely }
}
