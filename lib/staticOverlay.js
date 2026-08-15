// FASE GS. The left edge of the manual-asset overlay on the "Todas" chart.
//
// A broker NAV snapshot measures ONE account. On the whole-portfolio view the
// chart turns it into a portfolio figure by adding back the reconstructed value
// of everything held outside the broker (staticPoints, from the history API).
//
// That reconstruction only reaches as far back as the price history the API
// could fetch. Past the RIGHT edge the lookup already holds the last known
// value forward, which is the correct convention; past the LEFT edge it
// returned 0, which asserts something quite different and quite false: that
// none of those assets existed yet. A broker NAV from before that edge was then
// drawn as if it were the entire portfolio.
//
// Reproduced with the real chart: a portfolio holding a $13,000 bond since 2024
// plus a broker account around $4,000 drew its 2024-2025 stretch at the bare
// $4,000, and the ALL view headlined "+475.00%" measured off it. That is the
// shape of the "+472.47% from start" a user reported.
//
// So the left edge holds the earliest KNOWN reconstructed value backwards,
// symmetrically with the right edge -- but only as far back as the assets can
// be shown to have existed:
//
//   - the earliest known value must be > 0. If the reconstruction's own first
//     point is zero, then early on the broker really was the whole portfolio
//     and its bare NAV is the correct, complete figure.
//   - never earlier than the earliest acquisition among those assets. Before
//     the first one was bought, 0 is not a gap in our knowledge, it is the
//     answer.
//   - with no acquisition date to bound it, nothing is held back at all. An
//     unbounded guess is what this function exists to avoid.

export function staticValueAt(ts, staticPoints, { earliestAcqTs = null } = {}) {
  if (!Array.isArray(staticPoints) || staticPoints.length === 0) return 0
  const first = staticPoints[0]
  if (!first || !isFinite(first.ts)) return 0

  if (ts < first.ts) {
    if (!(first.value > 0)) return 0
    if (earliestAcqTs == null || !isFinite(earliestAcqTs)) return 0
    return ts >= earliestAcqTs ? first.value : 0
  }

  let v = 0
  for (const sp of staticPoints) {
    if (sp.ts <= ts) v = sp.value
    else break
  }
  return v
}
