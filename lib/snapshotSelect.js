// FASE FU. Resolución por día entre las DOS clases de snapshot que ahora
// pueden coexistir en la misma fecha:
//
//   - observación de PORTAFOLIO COMPLETO ('daily'/'manual'/'backfill'/sin
//     _source): mide todo lo que el usuario tenía ese día,
//   - NAV de BROKER ('ibkr'/'ibkr_quarterly'): mide UNA cuenta, guardado en su
//     propio doc (`fecha~nav~ibkr`) desde que el import dejó de descartarlo
//     cuando la fecha ya tenía el snapshot diario (antes de FASE FU, el NAV
//     real del broker se tiraba casi siempre: cada día que el usuario abría la
//     app, el doc 'daily' ocupaba la fecha y la regla "solo si es mayor" nunca
//     se cumplía con una cuenta menor al portafolio).
//
// Para cualquier consumidor que mide el PORTAFOLIO ENTERO (la vista "Todas" de
// la gráfica, el ancla YTD, la limpieza de snapshots corruptos), un día con
// ambas clases debe usar la observación completa: eso deja la vista "Todas"
// EXACTAMENTE como antes de que los docs paralelos existieran. Un día que solo
// tiene NAV de broker se queda tal cual (el overlay de activos manuales de la
// gráfica ya sabe completarlo, comportamiento de siempre).
//
// La vista escopada a UNA institución hace lo contrario (solo
// BROKER_NAV_SOURCES) y no usa esta función.
//
// Módulo puro sin imports (jest-safe); la lista de fuentes de broker llega por
// argumento con el default espejado de utils.BROKER_NAV_SOURCES.

export function preferFullPortfolioPerDay(snapshots, brokerNavSources = ['ibkr', 'ibkr_quarterly']) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return snapshots
  const brokers = new Set(brokerNavSources)
  const fullDates = new Set()
  for (const s of snapshots) {
    if (!s || !s.date || s._calibrated || s._account) continue
    if (!brokers.has(s._source)) fullDates.add(s.date)
  }
  if (fullDates.size === 0) return snapshots
  const out = snapshots.filter((s) => {
    if (!s || !s.date) return true
    // Las anclas de calibración tienen su propio manejo en cada consumidor.
    if (s._calibrated || s._account) return true
    if (!brokers.has(s._source)) return true
    return !fullDates.has(s.date)
  })
  return out.length === snapshots.length ? snapshots : out
}
