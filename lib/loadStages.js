// Pure helper behind the header refresh ring's progress percentage
// (components/ui/ChispudoRefreshButton.jsx via app/dashboard/page.jsx).
//
// `dataLoading` (useFirestoreItems' own `loading`) is a one-way latch: it's
// true only for the very first load of a session (no in-memory cache yet)
// and NEVER flips back to true afterward — not on manual refresh, not on an
// IBKR sync, not on tab refocus. Counting it as "1 of N stages" forever after
// that first load gives the ring a permanent, meaningless floor on every
// later refresh (33% with 3 stages) — exactly the class of fake progress the
// ring otherwise refuses to show, just smaller. The fix isn't to re-arm it
// (it correctly reflects that a live Firestore listener has nothing left to
// reload) — it's to stop counting a stage once it's no longer real. Because
// `dataLoading` only ever goes true → false, "count it only while it's still
// true" is exactly equivalent to "count it only during the first load," and
// removing an already-resolved stage from the denominator can only raise or
// hold the percentage, never lower it (see loadStages.test.js).
export function computeLoadStages({ dataLoading, ratesLoading, pricesLoading, benchmarkLoading } = {}) {
  const flags = [ratesLoading, pricesLoading]
  if (benchmarkLoading != null) flags.push(benchmarkLoading)
  if (dataLoading) flags.unshift(true)
  const total = flags.length
  const done = flags.filter((loading) => !loading).length
  return { done, total }
}
