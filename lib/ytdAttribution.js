// FASE GR. "Where your YTD comes from", rebuilt per ACCOUNT.
//
// The previous attempt decomposed the year position by position, straight from
// the historical reconstruction, and produced three separate species of wrong
// on real data in a single evening: broker deposits counted as profit (a $10K
// account credited with +$13,207 of "gain"), whole accounts silently missing,
// and per-account figures contradicting those accounts' own charts. It was the
// wrong foundation, not a set of bugs to keep patching.
//
// This version starts from the identity the headline itself is built on
// (computeModifiedDietz, components/dashboard/utils.js):
//
//     gain = endValue - startValue - sumFlows
//
// Partition each of those three terms across accounts and the per-account gains
// sum to the headline gain BY CONSTRUCTION, not by luck:
//
//   - endVal per account is exact. It is today's holdings, the same numbers the
//     account chips on the chart show.
//   - flow per account is exact. Account attribution is the rule already proven
//     by the calibration flow: a broker's own ledger by _source, manual money by
//     the item it is linked to.
//   - start per account is the ONLY estimated term, so it is the only place
//     error can enter -- and the residual of the whole panel is therefore
//     exactly (sum of account starts - portfolio start). Nothing else can drift.
//
// Because the residual has that single, known origin, it can be closed honestly
// instead of hidden: starts we actually KNOW (a broker's real year-start NAV, a
// calibration the user typed off their broker) are never touched, and only the
// estimated ones are scaled so the split adds up to the portfolio anchor the
// headline used. If the estimates are so far off that pinning them would be
// fiction, or if money could not be attributed at all, the panel refuses to
// render rather than show a number nobody can stand behind.

import { breakdownReconciles } from './ytdBreakdownGate'

// How far the estimated starts may be stretched to meet the portfolio anchor.
// Inside this band the estimates broadly agree with the anchor and only need
// pinning; outside it they are telling a different story altogether and the
// honest answer is to show nothing.
export const MAX_START_SCALE = 2
export const MIN_START_SCALE = 0.5

// Unattributed external money breaks the partition the whole method rests on,
// so it is capped rather than quietly absorbed. Proportional with a floor, for
// the same reason the reconciliation tolerance is.
export const UNATTRIBUTED_FLOOR = 5
export const UNATTRIBUTED_RATIO = 0.05

/**
 * @param {Object}   input
 * @param {Array}    input.accounts        [{ key, name, endVal, flow, start, startIsReal }]
 * @param {number}   input.portfolioStart  the anchor value the headline measured from
 * @param {number}   input.headlineGain    the headline's gain in currency (ytdChange)
 * @param {number}  [input.unattributedFlow=0] external money that matched no account
 * @returns {{ groups: Array, totalGain: number, scaledEstimates: boolean } | null}
 *          null whenever the split cannot be stood behind.
 */
export function attributeYtd({ accounts, portfolioStart, headlineGain, unattributedFlow = 0 }) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null
  if (!isFinite(portfolioStart) || portfolioStart <= 0) return null
  if (headlineGain == null || !isFinite(headlineGain)) return null

  // Money we could not place would silently land nowhere, and the sum would be
  // wrong by exactly that amount. Refuse instead.
  const unattributedCap = Math.max(UNATTRIBUTED_FLOOR, Math.abs(headlineGain) * UNATTRIBUTED_RATIO)
  if (!isFinite(unattributedFlow) || Math.abs(unattributedFlow) > unattributedCap) return null

  for (const a of accounts) {
    if (!a || !isFinite(a.endVal) || !isFinite(a.flow) || !isFinite(a.start)) return null
  }

  const realStartSum = accounts.filter((a) => a.startIsReal).reduce((s, a) => s + a.start, 0)
  const estimated = accounts.filter((a) => !a.startIsReal)
  const estStartSum = estimated.reduce((s, a) => s + a.start, 0)

  // What the estimated accounts must add up to for the split to match the
  // anchor, once the starts we actually know are taken as given.
  const estTarget = portfolioStart - realStartSum

  let scale = 1
  let scaledEstimates = false
  if (estimated.length > 0) {
    // Every account's start is known: the split has to already agree with the
    // anchor on its own, there is nothing left to stretch.
    if (estStartSum === 0) {
      if (Math.abs(estTarget) > Math.max(UNATTRIBUTED_FLOOR, Math.abs(portfolioStart) * 0.01)) return null
    } else {
      if (estTarget <= 0) return null // real starts alone already exceed the anchor
      scale = estTarget / estStartSum
      if (!isFinite(scale) || scale < MIN_START_SCALE || scale > MAX_START_SCALE) return null
      scaledEstimates = Math.abs(scale - 1) > 1e-9
    }
  } else if (Math.abs(realStartSum - portfolioStart) > Math.max(UNATTRIBUTED_FLOOR, Math.abs(portfolioStart) * 0.01)) {
    return null
  }

  const rows = accounts.map((a) => {
    const start = a.startIsReal ? a.start : a.start * scale
    return {
      key: a.key,
      name: a.name,
      endVal: a.endVal,
      flow: a.flow,
      start,
      startIsReal: !!a.startIsReal,
      gain: a.endVal - start - a.flow,
    }
  })

  // PER-ACCOUNT sanity, not just the total (FASE GR5). Matching the headline is
  // a weaker guarantee than it sounds: rows whose errors cancel each other add
  // up perfectly while individually claiming the impossible. That is exactly
  // what shipped -- a clean $815.05 total with OSMO reporting -$407.63 on an
  // account holding $117. A total-only check is a lock on the wrong door.
  //
  // Two things no real account can do, both cheap to test:
  //   - start below zero. An account cannot have been worth negative money, and
  //     this is precisely the shape of the original blow-up (a broker whose
  //     reconstructed January value came out around -$3,195, turning its whole
  //     balance into "gain").
  //   - start larger than the entire portfolio it belongs to.
  const startCeiling = portfolioStart * 1.05
  for (const r of rows) {
    if (r.start < -0.005) return null
    if (r.start > startCeiling) return null
  }

  const totalGain = rows.reduce((s, r) => s + r.gain, 0)
  // Belt and braces: the construction above makes this hold, so a failure here
  // means an input did not partition the way the caller promised.
  if (!breakdownReconciles(totalGain, headlineGain)) return null

  // EVERY account is listed, including ones that contributed nothing. The old
  // panel dropped near-zero rows and the user reported two accounts simply
  // "missing" -- from the outside, an omitted row and a broken row look
  // identical, and the reader cannot tell "this account did nothing" from
  // "this account was lost". A row reading $0.00 answers the question; a
  // missing row raises a new one.
  const groups = rows
    .map((r) => ({ ...r, share: totalGain !== 0 ? (r.gain / totalGain) * 100 : null }))
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))

  if (groups.length === 0) return null
  return { groups, totalGain, scaledEstimates }
}
