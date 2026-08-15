// FASE FQ. GIPS metrics for Venture/PE assets: since-inception IRR (XIRR) +
// the TVPI/DPI/RVPI multiples (and PIC when committed capital is known).
//
// Per the GIPS 2020 standards (CFA Institute), closed-end / fixed-commitment /
// illiquid vehicles are THE case where a money-weighted return replaces TWR as
// the primary metric: the GP controls when capital is called and returned, so
// the timing of flows is part of the skill being measured. The required
// presentation is the since-inception IRR, annualized when the span is one
// year or more, DE-annualized (the plain period return, never annualized) when
// it is shorter, plus the multiples: TVPI = (distributed + residual) / paidIn,
// DPI = distributed / paidIn, RVPI = residual / paidIn (TVPI = DPI + RVPI
// always), and PIC = paidIn / committed.
//
// Pure module: no React, no Firestore, no currency knowledge. Callers convert
// every amount to ONE currency before building flows (same contract as
// lib/portfolioRewind.js).
//
// Sign convention (the investor/LP's pocket): capital calls NEGATIVE (money
// out of your pocket into the fund), distributions POSITIVE (money back),
// residual value POSITIVE at the end. This is the standard XIRR layout.

const YEAR_MS = 365.25 * 86400000

// Net present value of dated flows at an annual rate, discounting from the
// FIRST flow's date. flows: [{ ts, amount }], ts in epoch ms.
export function xnpv(rate, flows) {
  if (!flows || flows.length === 0) return 0
  const t0 = flows[0].ts
  let npv = 0
  for (const f of flows) {
    const years = (f.ts - t0) / YEAR_MS
    npv += f.amount / Math.pow(1 + rate, years)
  }
  return npv
}

// Annualized internal rate of return for irregular dated flows (Excel's XIRR).
// Newton-Raphson first (fast when it converges), deterministic bisection as
// the fallback (never returns a wild number from a bad Newton step). Returns
// null when there is no sign change in the flows (an IRR does not exist) or
// no bracket can be found.
export function xirr(flowsInput) {
  const flows = (flowsInput || [])
    .filter((f) => f && Number.isFinite(f.ts) && Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.ts - b.ts)
  if (flows.length < 2) return null
  const hasNeg = flows.some((f) => f.amount < 0)
  const hasPos = flows.some((f) => f.amount > 0)
  if (!hasNeg || !hasPos) return null
  // All flows on the same instant: no time elapsed, no rate to solve.
  if (flows[flows.length - 1].ts === flows[0].ts) return null

  const f = (r) => xnpv(r, flows)

  // Newton-Raphson with a numerical derivative, from a few standard guesses.
  for (const guess of [0.1, 0.05, 0.25, -0.25, 0.5]) {
    let rate = guess
    let ok = true
    for (let i = 0; i < 60; i++) {
      const v = f(rate)
      if (!Number.isFinite(v)) { ok = false; break }
      if (Math.abs(v) < 1e-9) break
      const h = 1e-6
      const dv = (f(rate + h) - v) / h
      if (!Number.isFinite(dv) || Math.abs(dv) < 1e-12) { ok = false; break }
      const next = rate - v / dv
      if (!Number.isFinite(next) || next <= -0.999999) { ok = false; break }
      if (Math.abs(next - rate) < 1e-10) { rate = next; break }
      rate = next
    }
    if (ok && Number.isFinite(rate) && rate > -0.999999 && Math.abs(f(rate)) < 1e-6) {
      return rate
    }
  }

  // Bisection fallback: scan for a sign-change bracket, then halve.
  const grid = [-0.9999, -0.99, -0.9, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 5, 10, 50, 100]
  let lo = null, hi = null
  for (let i = 0; i < grid.length - 1; i++) {
    const a = f(grid[i])
    const b = f(grid[i + 1])
    if (Number.isFinite(a) && Number.isFinite(b) && a * b <= 0) { lo = grid[i]; hi = grid[i + 1]; break }
  }
  if (lo == null) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const v = f(mid)
    if (!Number.isFinite(v)) return null
    if (Math.abs(v) < 1e-9) return mid
    if (f(lo) * v <= 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// The full GIPS card for one venture/PE position.
//
//   capitalCalls:  [{ ts, amount }] amounts POSITIVE (cash the user sent)
//   distributions: [{ ts, amount }] amounts POSITIVE (cash the user got back)
//   residualValue: what the position is worth today
//   nowTs:         "today" for the residual flow and the span
//   committedCapital: optional, for PIC
//
// Returns null when there is nothing to measure (no capital ever called).
export function computeVentureMetrics({ capitalCalls, distributions, residualValue, nowTs, committedCapital }) {
  const calls = (capitalCalls || []).filter((f) => f && Number.isFinite(f.ts) && f.amount > 0)
  const dists = (distributions || []).filter((f) => f && Number.isFinite(f.ts) && f.amount > 0)
  const paidIn = calls.reduce((s, f) => s + f.amount, 0)
  if (!(paidIn > 0)) return null

  const distributed = dists.reduce((s, f) => s + f.amount, 0)
  const residual = Number.isFinite(residualValue) && residualValue > 0 ? residualValue : 0

  const tvpi = (distributed + residual) / paidIn
  const dpi = distributed / paidIn
  const rvpi = residual / paidIn
  const pic = Number.isFinite(committedCapital) && committedCapital > 0 ? paidIn / committedCapital : null

  // Since-inception XIRR: calls negative, distributions positive, residual as
  // a final positive flow at nowTs (the GIPS "terminal value" convention).
  const now = Number.isFinite(nowTs) ? nowTs : Date.now()
  const flows = [
    ...calls.map((f) => ({ ts: f.ts, amount: -f.amount })),
    ...dists.map((f) => ({ ts: f.ts, amount: f.amount })),
  ]
  if (residual > 0) flows.push({ ts: now, amount: residual })
  const irrAnnual = xirr(flows)

  const firstCallTs = calls.reduce((min, f) => Math.min(min, f.ts), Infinity)
  const spanYears = Number.isFinite(firstCallTs) && now > firstCallTs ? (now - firstCallTs) / YEAR_MS : 0
  // GIPS: annualized when the span is >= 1 year; for shorter spans the return
  // must NOT be annualized, so the presentable figure is the de-annualized
  // period return (1+irr)^years - 1.
  const annualized = spanYears >= 1
  const irrDisplay = irrAnnual == null
    ? null
    : annualized ? irrAnnual : Math.pow(1 + irrAnnual, spanYears) - 1

  return {
    paidIn, distributed, residual,
    tvpi, dpi, rvpi, pic,
    irrAnnual, irrDisplay, annualized, spanYears,
  }
}
