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
// Si el mes trae al menos un bucket sintético, las entradas por-item que ESE
// bucket ya explica son residuo y se quitan. Sin bucket, el mes se deja EXACTO
// como estaba: un doc puramente pre-FH renderiza igual que siempre, sin doble,
// y no hay nada que sanear.
//
// ⛔ Qué explica cada bucket, y por qué eso ya no se puede asumir (FASE NJ).
//
// Hasta FASE NJ la regla era "si hay bucket, ninguna fila por item de IBKR es
// válida", porque FASE FH había decidido que un item de IBKR nunca vuelve a
// escribir bajo su propio id en un mes pasado. Esa premisa dejó de ser cierta:
// una posición CON ledger de trades se reconstruye por posición (cantidad
// exacta del mes × precio del mes) y el bucket cubre solo lo que quedó sin
// reconstruir (cash, posiciones sin trades). O sea el bucket y las filas por
// item del MISMO broker conviven legítimamente, y la regla vieja borraba justo
// las reconstruidas.
//
// `_covers` es la lista de ids que ese bucket explica, escrita por
// getHistoricalItemValues. Un bucket viejo no la trae: ahí se conserva la regla
// de siempre (explica a TODOS los ids de IBKR), que es la correcta para un doc
// pre-NJ. Con los dos tipos en el mismo mes (un merge podría producirlo) manda
// la unión, que es el lado conservador: solo se quita lo que algún bucket dice
// estar contando.
export function stripStaleIbkrEntries(entries, ibkrItemIds, bucketPrefix) {
  if (!entries || !bucketPrefix) return entries
  const ids = ibkrItemIds instanceof Set ? ibkrItemIds : new Set(ibkrItemIds || [])
  if (ids.size === 0) return entries

  const covered = new Set()
  let hasBucket = false
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(bucketPrefix)) continue
    hasBucket = true
    if (Array.isArray(v?._covers)) {
      for (const id of v._covers) if (ids.has(id)) covered.add(id)
    } else {
      for (const id of ids) covered.add(id)
    }
  }
  if (!hasBucket || covered.size === 0) return entries

  let changed = false
  const out = {}
  for (const [k, v] of Object.entries(entries)) {
    if (covered.has(k)) { changed = true; continue }
    out[k] = v
  }
  return changed ? out : entries
}
