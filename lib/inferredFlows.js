// Inferring deposits/withdrawals inside the ONE gap real data can't reach:
// the quarterly-transcribed history (Portfolio Analyst screenshot → ~4 numbers
// a year, no cash-transaction detail). Everywhere else already has exact
// answers, on purpose:
//   - Last ~365 days (Flex Query API): real day-level NAV + real Cash
//     Transactions, imported as real DEPOSIT/WITHDRAWAL transactions already.
//   - Prior years uploaded as Flex XML: same, still exact.
// Only the quarterly stretch is two numbers a quarter with no way to know
// whether the gap between them is market return, a contribution, or both. This
// module estimates the flow half of that gap — never the exact day, never
// silently: every result here is a CANDIDATE for the user to accept, edit or
// dismiss (mirrors the screenshot-OCR and calibration flows), and every
// accepted candidate becomes an ordinary DEPOSIT/WITHDRAWAL transaction that
// the existing Modified Dietz math (computeModifiedDietz) already knows how
// to net out — no new return engine, just better-fed inputs to the old one.
//
// Gated entirely by the caller: this only runs once
// lib/brokerCompletion.js's hasCompleteBrokerData(brokerId, state) is true —
// an account that skipped a step (no quarterly transcription, no history
// upload) has nothing here to compute, and this module is never reached for
// it. See CLAUDE.md FASE DQ.

const DAY_MS = 86400000
const YEAR_MS = 365.25 * DAY_MS

// A gap's "this could plausibly be pure market movement" ceiling, scaled by
// time the way volatility always is (∝ √t): a quarter gets a quarter of the
// swing a full year could plausibly produce. Grounded in THIS account's own
// realized volatility (computed from its real, Flex-Query-covered window) —
// never a house constant, so a genuinely volatile account (crypto-heavy,
// small-cap) is held to its own bar, not a generic one.
export function plausibleReturnCeiling(startVal, annualizedVolatilityPct, periodYears) {
  if (!(startVal > 0) || !(periodYears > 0)) return 0
  const vol = isFinite(annualizedVolatilityPct) && annualizedVolatilityPct > 0 ? annualizedVolatilityPct : 25
  return startVal * (vol / 100) * Math.sqrt(periodYears)
}

// One gap between two consecutive quarterly-transcribed points → a flow
// candidate, or null if the change is within the plausible-return band (i.e.
// nothing needs explaining beyond ordinary market movement).
function detectGapFlow({ from, to, annualizedVolatilityPct }) {
  const periodYears = (to.ts - from.ts) / YEAR_MS
  if (!(periodYears > 0) || !(from.value > 0)) return null
  const ceiling = plausibleReturnCeiling(from.value, annualizedVolatilityPct, periodYears)
  const delta = to.value - from.value
  let excess = 0
  if (delta > ceiling) excess = delta - ceiling
  else if (delta < -ceiling) excess = delta + ceiling // negative
  if (excess === 0) return null
  const midTs = Math.round((from.ts + to.ts) / 2)
  return {
    id: `inferred~${from.date}~${to.date}`,
    fromDate: from.date, toDate: to.date,
    midDate: new Date(midTs).toISOString().slice(0, 10),
    startVal: from.value, endVal: to.value, delta, ceiling,
    type: excess > 0 ? 'DEPOSIT' : 'WITHDRAWAL',
    amount: Math.round(Math.abs(excess) * 100) / 100,
  }
}

// `points`: chronological [{ date: 'YYYY-MM-DD', value, reviewed? }] covering
// ONLY the quarterly-only stretch (caller slices to before real coverage
// starts — see quarterlyOnlyPoints below). Points already marked `reviewed`
// (the user answered "no, not a real flow" or accepted/dismissed it before)
// are skipped: a declined gap must not resurface on every render.
export function detectInferredFlows(points, { annualizedVolatilityPct } = {}) {
  if (!Array.isArray(points) || points.length < 2) return []
  const withTs = points
    .filter((p) => p && p.date && isFinite(p.value))
    .map((p) => ({ ...p, ts: new Date(`${p.date}T00:00:00Z`).getTime() }))
    .sort((a, b) => a.ts - b.ts)
  const out = []
  for (let i = 1; i < withTs.length; i++) {
    if (withTs[i].reviewed) continue
    const flow = detectGapFlow({ from: withTs[i - 1], to: withTs[i], annualizedVolatilityPct })
    if (flow) out.push(flow)
  }
  return out
}

// Slice a broker's snapshot history to the stretch real day-level data does
// NOT cover: strictly before the earliest real (`_source` in
// BROKER_NAV_SOURCES minus quarterly — i.e. an actual synced NAV day) point.
// Nothing past that boundary needs inference; it already has exact answers.
export function quarterlyOnlyPoints(snapshots, realEarliestTs) {
  const cutoff = isFinite(realEarliestTs) ? realEarliestTs : Infinity
  return (snapshots || [])
    .filter((s) => s && s._source === 'ibkr_quarterly' && s.date)
    .map((s) => ({
      date: s.date,
      value: s.netWorthUSD ?? s.totalActivosUSD ?? 0,
      reviewed: !!s._flowReviewed,
    }))
    .filter((p) => new Date(`${p.date}T00:00:00Z`).getTime() <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Reconciliation, run on every sync: once real Flex Query coverage reaches a
// date that used to be inference-only, whatever was guessed there is now
// either confirmed (the real Cash Transactions import already wrote the real
// transaction independently) or refuted — either way, the guess has nothing
// left to add and must not keep sitting next to the real answer. Real data
// always wins; an inferred flow never survives past the day the truth
// arrives. Returns the ids to delete.
export function staleInferredFlowIds(transactions, realCoverage) {
  const { earliestTs, latestTs } = realCoverage || {}
  if (!isFinite(earliestTs) || !isFinite(latestTs)) return []
  return (transactions || [])
    .filter((tx) => tx && tx.id && tx._source === 'inferred_flow' && tx.date)
    .filter((tx) => {
      const ts = new Date(`${tx.date}T00:00:00Z`).getTime()
      return isFinite(ts) && ts >= earliestTs && ts <= latestTs
    })
    .map((tx) => tx.id)
}
