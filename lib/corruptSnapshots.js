// FASE FR. Detección de rachas de snapshots diarios corruptos.
//
// El caso real que motiva esto: durante ~2 semanas (24 jul - 6 ago 2026), el
// efecto de snapshot diario escribió el patrimonio inflado (~$35K sobre ~$23K
// reales) porque un refresco de precios en curso podía colarse en la escritura
// (el hueco que FASE FE cerró con pricesFetching). El fix paró las escrituras
// malas HACIA ADELANTE, pero los docs ya escritos se quedaron: con broker
// conectado un snapshot del día nunca se autocorrige (FASE EI), el guard de la
// gráfica solo tumba rachas de 1-3 puntos, y el TWR encadenado atraviesa el
// salto falso y arrastra el error (el MWR de una sola ventana no lo ve: esa
// asimetría es la firma del bug).
//
// Qué es una racha corrupta, en términos operativos:
//   - puntos CONSECUTIVOS de fuente borrable ('daily'/'backfill': datos
//     DERIVADOS, recalculables; jamás un NAV de broker ni un snapshot manual),
//   - todos fuera de banda respecto al nivel ANTERIOR a la racha,
//   - el nivel REGRESA al terminar (round-trip): un depósito real cambia el
//     nivel para siempre y por eso nunca matchea,
//   - y el salto de entrada NO está explicado por un flujo real (un depósito
//     puede subir el patrimonio 50% de un día a otro legítimamente; un salto
//     sin flujo que además se revierte solo, no).
//
// Borrar es seguro porque estas fuentes son reconstruibles: el backfill de 30
// días rellena los días borrados con precios históricos reales, y más atrás la
// gráfica cae a la reconstrucción por API. Un falso positivo (un rally real
// borrado) se re-deriva solo con los precios reales; un verdadero positivo
// queda reconstruido al nivel correcto. En ambos casos el archivo termina
// diciendo la verdad.

const DAY_MS = 86400000

export const DELETABLE_SNAPSHOT_SOURCES = ['daily', 'backfill']

// snapshots: los docs crudos de Firestore (date, netWorthUSD/totalActivosUSD,
//   _source, _calibrated, id = fecha).
// flowsUSD: [{ ts, amount, type }] con amount POSITIVO ya convertido a USD y
//   type 'DEPOSIT' | 'WITHDRAWAL'. Solo se usan para NO borrar una racha cuyo
//   salto de entrada un flujo real explica.
export function corruptSnapshotRunIds(snapshots, flowsUSD = [], opts = {}) {
  const {
    offHi = 1.35,        // fuera de banda: > 135% del nivel ancla
    offLo = 0.7,         //                 o < 70% del nivel ancla
    returnTol = 0.25,    // el nivel post-racha debe volver a ±25% del ancla
    maxRunPoints = 25,
    maxRunDays = 35,
    flowEdgeDays = 3,    // ventana alrededor del inicio para buscar el flujo
    flowCoverage = 0.5,  // un flujo >= 50% del salto lo explica
  } = opts

  const rows = (snapshots || [])
    .filter((s) => s && s.date && !s._calibrated && !s._account)
    .map((s) => {
      const ts = new Date(s.date).getTime()
      const value = Number(s.netWorthUSD ?? s.totalActivosUSD ?? NaN)
      return { id: s.id || s.date, ts, value, source: s._source || null }
    })
    .filter((r) => isFinite(r.ts) && isFinite(r.value) && r.value > 0)
    .sort((a, b) => a.ts - b.ts)

  if (rows.length < 3) return []

  const isDeletable = (r) => DELETABLE_SNAPSHOT_SOURCES.includes(r.source)
  const isOff = (v, anchor) => v > anchor * offHi || v < anchor * offLo

  const flows = (flowsUSD || []).filter((f) => f && isFinite(f.ts) && isFinite(f.amount) && f.amount > 0)

  // ¿Hay un flujo real que explique un salto de `jump` USD alrededor de ts?
  // Salto hacia arriba => depósitos; hacia abajo => retiros. Se suman todos
  // los del tipo correcto dentro de la ventana.
  const jumpExplained = (ts, jump) => {
    const type = jump > 0 ? 'DEPOSIT' : 'WITHDRAWAL'
    let sum = 0
    for (const f of flows) {
      if (f.type !== type) continue
      if (Math.abs(f.ts - ts) > flowEdgeDays * DAY_MS) continue
      sum += f.amount
    }
    return sum >= Math.abs(jump) * flowCoverage
  }

  const ids = []
  let i = 1
  while (i < rows.length - 1) {
    const anchor = rows[i - 1].value
    if (!(anchor > 0) || !isOff(rows[i].value, anchor)) { i++; continue }

    // Racha candidata: consecutivos fuera de banda. Un punto fuera de banda de
    // fuente NO borrable (un NAV real de broker, un snapshot manual) es una
    // observación real contradiciendo el ancla: el nivel se movió de verdad,
    // se aborta la racha entera sin borrar nada.
    let j = i
    let realObservation = false
    while (j < rows.length && isOff(rows[j].value, anchor)) {
      if (!isDeletable(rows[j])) { realObservation = true; break }
      j++
    }
    if (realObservation) { i = j + 1; continue }
    if (j >= rows.length) break // la racha llega al final: sin round-trip no hay veredicto

    const next = rows[j]
    const runPoints = j - i
    const runDays = (rows[j - 1].ts - rows[i].ts) / DAY_MS
    const roundTrips = Math.abs(next.value / anchor - 1) <= returnTol
    const jump = rows[i].value - anchor

    if (
      runPoints <= maxRunPoints &&
      runDays <= maxRunDays &&
      roundTrips &&
      !jumpExplained(rows[i].ts, jump)
    ) {
      for (let k = i; k < j; k++) ids.push(rows[k].id)
    }
    i = j
  }
  return ids
}
