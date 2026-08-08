// FASE FT. Sanitización del caché de itemSnapshots contra el doble conteo de
// IBKR que el usuario detectó en el Spreadsheet ("Bolsa de Valores" marcando
// ~$20K en meses pasados sobre una cuenta real de ~$10K).
//
// La mecánica del doble: FASE FH cambió los meses históricos de IBKR de "un
// valor por cada acción" a "un solo bucket sintético por institución+categoría"
// (IBKR_UNKNOWN_KEY_PREFIX), pero NO subió SNAPSHOT_VERSION. Como
// saveItemSnapshots hace merge ({...existingItems, ...itemsData}) y nunca
// invalida nada por su cuenta (lección de FASE DS), el recompute escribió el
// bucket nuevo AL LADO de las 18 acciones cacheadas bajo la lógica vieja: el
// doc del mes quedó con ambos y la fila de categoría sumaba los dos. El bump a
// v23 mata los docs ya envenenados; esta función es el cinturón y tirantes
// para que la MISMA colisión (bucket + entradas por-item del mismo broker en
// el mismo mes) no pueda volver a sumar doble aunque un merge futuro la
// recree (ej. una cuenta manual que después se conecta a IBKR, con meses
// cacheados bajo su id de item).
//
// Módulo SIN imports a propósito (mismo criterio que lib/yearOverYear.js):
// PortfolioSpreadsheet lo importa estático y no puede arrastrar
// authFetch/Firebase a Jest. El prefijo llega como argumento para no duplicar
// el string una tercera vez.

// entries: el mapa de un mes del caché ({ [itemIdOBucketKey]: {value, ...} }).
// ibkrItemIds: ids de los items ACTUALES con _source:'ibkr' (Set o array).
// bucketPrefix: IBKR_UNKNOWN_KEY_PREFIX del caller.
//
// Si el mes trae al menos un bucket sintético, las entradas por-item de esos
// mismos ids son residuo de la lógica vieja (FASE FH decidió que un item IBKR
// nunca vuelve a escribir bajo su propio id en un mes pasado) y se quitan.
// Sin bucket, el mes se deja EXACTO como estaba: un doc puramente pre-FH
// renderiza igual que siempre, sin doble, y no hay nada que sanear.
export function stripStaleIbkrEntries(entries, ibkrItemIds, bucketPrefix) {
  if (!entries || !bucketPrefix) return entries
  let hasBucket = false
  for (const k of Object.keys(entries)) {
    if (k.startsWith(bucketPrefix)) { hasBucket = true; break }
  }
  if (!hasBucket) return entries
  const ids = ibkrItemIds instanceof Set ? ibkrItemIds : new Set(ibkrItemIds || [])
  if (ids.size === 0) return entries
  let changed = false
  const out = {}
  for (const [k, v] of Object.entries(entries)) {
    if (ids.has(k)) { changed = true; continue }
    out[k] = v
  }
  return changed ? out : entries
}
