// Inferring deposits/withdrawals inside the ONE gap real data can't reach:
// the quarterly-transcribed history (Portfolio Analyst screenshot → ~4 numbers
// a year, no cash-transaction detail). Everywhere else already has exact
// answers, on purpose: the trailing ~365 days (Flex Query, API or file) bring
// real day-level NAV + real Cash Transactions, imported as real
// DEPOSIT/WITHDRAWAL transactions already. IBKR's 365-day cap is per ACCOUNT,
// not per file, so there is no "prior years uploaded as Flex XML" path — see
// FASE DR in CLAUDE.md. That is exactly why the quarterly stretch exists and
// why this module has to guess at it.
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
//
// `to.marker` ('deposit'|'withdrawal'|null) comes from a real "D"/"W" flag the
// user's own screenshot carried on that bar (QuarterlyHistoryModal's AI
// reader, _flowMarker on the snapshot) — that is direct evidence a flow
// happened, not a guess from the value jump. When present it OVERRIDES the
// plausible-return gate entirely (a marked quarter always produces a
// candidate, even if the jump alone would have looked like ordinary market
// movement) and picks the type deterministically instead of from the sign of
// the excess, which a marker can disagree with when the flow was partly
// offset by market movement in the same quarter.
function detectGapFlow({ from, to, annualizedVolatilityPct }) {
  const periodYears = (to.ts - from.ts) / YEAR_MS
  if (!(periodYears > 0) || !(from.value > 0)) return null
  const delta = to.value - from.value
  const marked = to.marker === 'deposit' || to.marker === 'withdrawal'
  // FASE GJ: the screenshot's own Cash Flows bar, when legible, gives the
  // flow's MAGNITUDE directly (the D/W marker still gives the direction).
  // That is one notch more evidence than the marker alone: the amount stops
  // being estimated from the NAV jump, which market movement in the same
  // quarter always contaminates.
  const photoAmount = marked && isFinite(to.flowAmount) && to.flowAmount > 0 ? to.flowAmount : null
  let excess = 0
  let ceiling = 0
  if (marked) {
    excess = to.marker === 'deposit' ? Math.max(delta, 0.01) : Math.min(delta, -0.01)
  } else {
    ceiling = plausibleReturnCeiling(from.value, annualizedVolatilityPct, periodYears)
    if (delta > ceiling) excess = delta - ceiling
    else if (delta < -ceiling) excess = delta + ceiling // negative
    if (excess === 0) return null
  }
  const midTs = Math.round((from.ts + to.ts) / 2)
  return {
    id: `inferred~${from.date}~${to.date}`,
    fromDate: from.date, toDate: to.date,
    midDate: new Date(midTs).toISOString().slice(0, 10),
    startVal: from.value, endVal: to.value, delta, ceiling,
    type: marked ? (to.marker === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL') : (excess > 0 ? 'DEPOSIT' : 'WITHDRAWAL'),
    amount: photoAmount != null ? Math.round(photoAmount * 100) / 100 : Math.round(Math.abs(excess) * 100) / 100,
    source: marked ? 'photo' : 'estimate',
    ...(photoAmount != null ? { amountFromPhoto: true } : {}),
  }
}

// `points`: chronological [{ date: 'YYYY-MM-DD', value, reviewed?, marker? }]
// covering ONLY the quarterly-only stretch (caller slices to before real
// coverage starts — see quarterlyOnlyPoints below). Points already marked `reviewed`
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
      // 'deposit' | 'withdrawal' | undefined — a real "D"/"W" marker read off
      // this quarter's screenshot (see detectGapFlow above).
      marker: s._flowMarker === 'deposit' || s._flowMarker === 'withdrawal' ? s._flowMarker : undefined,
      // Magnitude of that quarter's Cash Flows bar (FASE GJ), when the
      // screenshot carried the series and it was legible.
      flowAmount: isFinite(s._flowAmount) && s._flowAmount > 0 ? s._flowAmount : undefined,
    }))
    .filter((p) => new Date(`${p.date}T00:00:00Z`).getTime() <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// FASE GJ (Fase 3 del plan). The screenshot's summary table gives a GLOBAL
// constraint no single gap can see: lifetime Net Deposits & Withdrawals. Every
// flow the account ever had must reconcile with it:
//
//   Σ(inferred pre-window flows) = lifetime net − exact flows already on file
//
// This adjusts the per-gap candidates so their NET matches that residual.
// Rules, in order of evidence:
// - Candidates whose amount came off the Cash Flows bar itself
//   (amountFromPhoto) are direct readings and are NEVER rescaled.
// - The remaining (estimated) candidates are scaled by one common factor so
//   the total closes, each marked `adjustedToLifetimeNet` — the user still
//   reviews every one in InferredFlowsModal, nothing writes itself.
// - Scaling only happens when it PRESERVES every candidate's direction
//   (factor > 0). A factor that would flip a deposit into a withdrawal is
//   telling a different story, not reconciling this one: in that case the
//   candidates pass through untouched and the mismatch is reported for the
//   UI to show.
// Returns { candidates, reconciliation } where reconciliation is null when
// the constraint could not be evaluated (no lifetime figure, no candidates).
export function applyLifetimeNetConstraint(candidates, { lifetimeNetUSD, knownNetUSD } = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  if (!isFinite(lifetimeNetUSD) || !isFinite(knownNetUSD) || list.length === 0) {
    return { candidates: list, reconciliation: null }
  }
  const r2 = (v) => Math.round(v * 100) / 100
  const signed = (c) => (c.type === 'DEPOSIT' ? c.amount : -c.amount)
  const residual = lifetimeNetUSD - knownNetUSD
  const fixedNet = list.filter((c) => c.amountFromPhoto).reduce((s, c) => s + signed(c), 0)
  const candidatesNet = list.reduce((s, c) => s + signed(c), 0)
  const base = {
    lifetimeNetUSD: r2(lifetimeNetUSD),
    knownNetUSD: r2(knownNetUSD),
    residualUSD: r2(residual),
    candidatesNetUSD: r2(candidatesNet),
    scaledBy: null,
    mismatchUSD: r2(candidatesNet - residual),
  }
  // Already closes (within the larger of $1 or 2% of the residual): the photo
  // readings and estimates tell the same story, nothing to adjust.
  const tol = Math.max(Math.abs(residual) * 0.02, 1)
  if (Math.abs(candidatesNet - residual) <= tol) {
    return { candidates: list, reconciliation: { ...base, mismatchUSD: 0 } }
  }
  const flexNet = candidatesNet - fixedNet
  const targetFlex = residual - fixedNet
  const factor = flexNet !== 0 ? targetFlex / flexNet : NaN
  if (!isFinite(factor) || factor <= 0) {
    return { candidates: list, reconciliation: base }
  }
  const out = list.map((c) => c.amountFromPhoto
    ? c
    : { ...c, amount: r2(c.amount * factor), adjustedToLifetimeNet: true })
  const outNet = out.reduce((s, c) => s + signed(c), 0)
  return {
    candidates: out,
    reconciliation: {
      ...base,
      scaledBy: Math.round(factor * 10000) / 10000,
      candidatesNetUSD: r2(outNet),
      mismatchUSD: r2(outNet - residual),
    },
  }
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
