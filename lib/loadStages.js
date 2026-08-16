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
// Una bandera AUSENTE tampoco es una etapa. Ya era así para `benchmarkLoading`
// (el `!= null` de siempre); ahora vale para todas, que es lo que hace al
// helper servible en una pantalla con menos etapas que el tablero.
//
// Sin esto, Finanzas calculaba las suyas a mano sobre un total FIJO de 2
// (`[!dataLoading, !ratesLoading]`) aunque ahí no hay precios de mercado que
// cargar, así que caía en el mismo piso permanente que el párrafo de arriba
// describe: 50% en cada refresco, por una etapa que ya nunca vuelve a correr.
// Pasarle `pricesLoading: undefined` al helper viejo no lo arreglaba, lo movía
// de lugar: `undefined` es falsy, así que contaba como una etapa YA RESUELTA.
//
// El tablero pasa las cuatro banderas como booleanos reales, así que su
// resultado es byte-idéntico (fijado en los tests de abajo).
export function computeLoadStages({ dataLoading, ratesLoading, pricesLoading, benchmarkLoading } = {}) {
  const flags = []
  // `dataLoading` solo cuenta MIENTRAS es true (ver el párrafo de arriba).
  if (dataLoading) flags.push(true)
  for (const flag of [ratesLoading, pricesLoading, benchmarkLoading]) {
    if (flag != null) flags.push(flag)
  }
  const total = flags.length
  const done = flags.filter((loading) => !loading).length
  return { done, total }
}
