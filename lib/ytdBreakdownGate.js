// FASE GQ5. The YTD breakdown panel ("where your YTD comes from") exists for a
// single purpose: to explain the YTD figure printed directly above it. So the
// one invariant that matters is that its parts add up to that figure.
//
// They are computed by two different engines on purpose: the headline runs
// Modified Dietz over portfolio totals, the breakdown rebuilds the same
// quantity position by position from the historical reconstruction. Both
// produce "dollars of gain, net of external flows", so they are directly
// comparable — and when they disagree by a lot, the breakdown is not an
// explanation, it is a second, contradictory claim.
//
// That is not hypothetical. Shipped without this gate, a $10K broker account
// was credited with +$13,207.59 of YTD "gain" under a headline that read
// +$835.36 for the entire portfolio: account-level broker deposits matched no
// position key, so every deposit was counted as profit. A user reading that
// would conclude they made money they never made.
//
// The rule: show nothing rather than something untrue. The card degrades to
// the plain, non-expandable YTD number, which is still correct.

// Proportional, because both sides come from different reconstruction paths and
// never agree to the cent; with an absolute floor so a portfolio whose YTD gain
// is near zero does not get an impossibly tight window.
export const BREAKDOWN_TOLERANCE_FLOOR = 5
export const BREAKDOWN_TOLERANCE_RATIO = 0.10

/**
 * Whether a breakdown totalling `totalGain` may be shown as the explanation of
 * a headline gain of `headlineGain`.
 *
 * A headline that is missing or not a finite number means there is nothing to
 * contradict, so the breakdown is allowed through unchanged (the caller has its
 * own emptiness checks).
 */
export function breakdownReconciles(totalGain, headlineGain) {
  if (headlineGain == null || !isFinite(headlineGain)) return true
  if (totalGain == null || !isFinite(totalGain)) return false
  const tolerance = Math.max(
    BREAKDOWN_TOLERANCE_FLOOR,
    Math.abs(headlineGain) * BREAKDOWN_TOLERANCE_RATIO
  )
  return Math.abs(totalGain - headlineGain) <= tolerance
}
