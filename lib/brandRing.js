// The Chispudo ring: the circle that says "Chispudo is working". Same
// framework-agnostic-constants idea as `lib/brandBolt.js`, and for the same
// reason — the geometry was already COPIED VERBATIM into
// `components/ui/ChispudoRefreshButton.jsx` and `components/ui/ChispudoLoader.jsx`
// (both had their own `R = 13.5` and their own `C * 0.22 / C * 0.78`), and
// `components/ui/BusyLabel.jsx` would have made a third copy. Two copies of the
// same number is how one of them quietly stops matching the others.
//
// Everything here is in the units of a 32x32 viewBox, so a consumer sets the
// rendered size on the <svg> and never has to recompute anything.

export const RING_VIEWBOX = '0 0 32 32'
export const RING_CX = 16
export const RING_CY = 16
export const RING_R = 13.5
export const RING_C = 2 * Math.PI * RING_R

// The indeterminate arc: 22% of the circumference drawn, 78% gap. Short enough
// to read as a moving arc rather than a ring that lost a bite, long enough to
// stay visible at the small end (a 14px button spinner).
export const SWEEP_FRACTION = 0.22

// `strokeDasharray` for that arc. A function, not a constant string, so the
// fraction lives in exactly one place.
export function sweepDash(fraction = SWEEP_FRACTION) {
  return `${RING_C * fraction} ${RING_C * (1 - fraction)}`
}

// `strokeDashoffset` for a determinate ring at `pct` (0-100). `floor` keeps the
// very first stage visible instead of drawing an empty ring; the two existing
// consumers use different floors (0.06 and 0.08) and keep them.
export function progressDashOffset(pct, floor = 0) {
  return RING_C * (1 - Math.max(floor, (pct ?? 0) / 100))
}
