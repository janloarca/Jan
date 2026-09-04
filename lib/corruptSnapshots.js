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

import { preferFullPortfolioPerDay } from './snapshotSelect'

const DAY_MS = 86400000
const BROKER_NAV = ['ibkr', 'ibkr_quarterly']

export const DELETABLE_SNAPSHOT_SOURCES = ['daily', 'backfill']

// FASE GA. La ventana exacta en la que el hueco de escritura de FASE FE estuvo
// abierto en producción: docs 'daily' de esa era pudieron grabarse con un
// refresco de precios a medias. Es una era CERRADA (el fix de FE la terminó):
// nunca crece, y sus docs son datos derivados re-derivables por el backfill.
export const FE_CORRUPT_ERA = { from: '2026-07-15', to: '2026-08-06' }

// Purga guiada por era: un doc 'daily' DENTRO de la era sospechosa cuyo valor
// se desvía más de `tol` de la mediana de los primeros dailies POST-era (ya
// escritos con el hueco cerrado: evidencia limpia) se borra para que el
// backfill lo reconstruya con precios históricos reales. Esto atrapa el
// residuo que las bandas estadísticas no pueden: una racha cuyo salto de
// entrada está PARCIALMENTE explicado por un depósito real (XOCHI ~$1,966
// capturado el mismo día que abre la era) queda protegida por jumpExplained,
// aunque el nivel cargue ~$2K de corrupción encima. Aquí no se compara contra
// el salto sino contra el nivel real conocido de después.
export function feEraSuspectDailyIds(snapshots, opts = {}) {
  const {
    from = FE_CORRUPT_ERA.from,
    to = FE_CORRUPT_ERA.to,
    refCount = 5,
    tol = 0.05,
  } = opts

  const all = preferFullPortfolioPerDay(snapshots || [])
    .filter((s) => s && s.date && !s._calibrated && !s._account && !BROKER_NAV.includes(s._source || ''))
    .map((s) => ({ id: s.id || s.date, date: s.date, value: Number(s.netWorthUSD ?? s.totalActivosUSD ?? NaN), source: s._source || null }))
    .filter((r) => isFinite(r.value) && r.value > 0)

  // Referencia: la mediana de los primeros dailies posteriores a la era. Sin
  // evidencia post-era no hay veredicto (nunca se adivina).
  const post = all
    .filter((r) => r.date > to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, refCount)
    .map((r) => r.value)
    .sort((a, b) => a - b)
  if (post.length === 0) return []
  const ref = post[Math.floor(post.length / 2)]
  if (!(ref > 0)) return []

  return all
    .filter((r) => r.source === 'daily' && r.date >= from && r.date <= to)
    .filter((r) => r.value > ref * (1 + tol) || r.value < ref * (1 - tol))
    .map((r) => r.id)
}

// ⛔ FASE NP. La ÚNICA definición de la lista de flujos que consumen los
// juicios sobre snapshots (`corruptSnapshotRunIds` y
// `selfContradictedCalibrationDates`). Vivía escrita a mano dentro del efecto
// de limpieza; con un segundo consumidor, dos copias de "cuánto entró" es
// exactamente cómo una se queda atrás y los dos motores terminan protegiendo
// rachas distintas sobre los mismos depósitos.
//
// `amount` sale SIEMPRE positivo y la dirección vive en `type`, porque el signo
// de `totalAmount` no es confiable entre escritores (unos guardan la magnitud,
// otros el monto firmado).
export function usdFlowEvents(transactions, convert) {
  return (transactions || [])
    .filter((tx) => /^(DEPOSIT|WITHDRAWAL)$/i.test(tx?.type || ''))
    .map((tx) => {
      const ts = tx.date ? new Date(tx.date).getTime() : NaN
      const amt = Math.abs(Number(tx.totalAmount ?? tx.amount ?? 0))
      const usd = convert ? convert(amt, tx.currency || 'USD', 'USD') : amt
      return { ts, amount: usd, type: (tx.type || '').toUpperCase() }
    })
    .filter((f) => isFinite(f.ts) && isFinite(f.amount) && f.amount > 0)
}

// snapshots: los docs crudos de Firestore (date, netWorthUSD/totalActivosUSD,
//   _source, _calibrated, id = fecha).
// flowsUSD: [{ ts, amount, type }] con amount POSITIVO ya convertido a USD y
//   type 'DEPOSIT' | 'WITHDRAWAL'. Solo se usan para NO borrar una racha cuyo
//   salto de entrada un flujo real explica.
export function corruptSnapshotRunIds(snapshots, flowsUSD = [], opts = {}) {
  const {
    offHi = 1.35,        // banda GRUESA: > 135% del nivel ancla
    offLo = 0.7,         //               o < 70% del nivel ancla
    // FASE FW. Banda ESTRICTA, solo para rachas compuestas 100% de docs
    // 'daily': la meseta original (~1.6x) cayó con la banda gruesa, pero quedó
    // un residuo de la misma era en ~1.1x (~$25.8K sobre $23.4K reales, el
    // "drawdown de ~$1,500 sin explicación" del reporte) que 1.35 nunca va a
    // atrapar. Apretar la banda es seguro EXCLUSIVAMENTE para 'daily' porque
    // un doc 'daily' de fecha pasada no puede reescribirse jamás (el escritor
    // diario solo escribe HOY): borrado una vez, el backfill lo reconstruye
    // como 'backfill' con precios históricos reales y la limpieza no lo vuelve
    // a tocar nunca. Cero churn posible, y un falso positivo (un rally real)
    // se re-deriva a su valor verdadero. Para rachas que contienen docs
    // 'backfill' (ya re-derivados de precios reales) sigue rigiendo la banda
    // gruesa: si la reconstrucción reproduce el nivel, el nivel era real.
    dailyOffHi = 1.08,
    dailyOffLo = 0.92,
    dailyMinRunPoints = 4, // la banda estricta exige rachas SOSTENIDAS: 1-3
                           // días de volatilidad real nunca la disparan
    dailyFlatTol = 0.04,   // ...y PLANAS: la firma de una escritura corrupta
                           // repetida es una meseta (~mismo valor todos los
                           // días); el mercado real ondula dentro de la racha
    returnTol = 0.25,    // el nivel post-racha debe volver a ±25% del ancla
    maxRunPoints = 25,
    maxRunDays = 35,
    flowEdgeDays = 3,    // ventana alrededor del inicio para buscar el flujo
    flowCoverage = 0.5,  // un flujo >= 50% del salto lo explica
    // FASE FY. Un NAV de broker corrobora (y por lo tanto salva) una racha
    // solo si su valor coincide con el NIVEL de la racha dentro de esta
    // tolerancia. Ver el comentario del walk de abajo.
    corroborationTol = 0.2,
  } = opts

  // FASE FU: con los docs paralelos de NAV, una fecha puede traer la
  // observación de portafolio COMPLETO y el NAV de UNA cuenta del broker.
  // Esta limpieza juzga niveles del portafolio completo: mezclar un NAV de
  // ~10K en una serie de ~23K leería el doc del broker como "fuera de banda"
  // y abortaría toda racha. Se resuelve por día ANTES: la observación completa
  // gana; en un portafolio solo-broker (sin fechas completas) el NAV es la
  // única medición y se queda, conservando el rol de "observación real que
  // aborta la racha" que ya tenía.
  const all = preferFullPortfolioPerDay(snapshots || [])
    .filter((s) => s && s.date && !s._calibrated && !s._account)
    .map((s) => {
      const ts = new Date(s.date).getTime()
      const value = Number(s.netWorthUSD ?? s.totalActivosUSD ?? NaN)
      return { id: s.id || s.date, ts, value, source: s._source || null }
    })
    .filter((r) => isFinite(r.ts) && isFinite(r.value) && r.value > 0)
    .sort((a, b) => a.ts - b.ts)

  // FASE FY. El walk usa SOLO observaciones de PORTAFOLIO COMPLETO. El archivo
  // real es heterogéneo: entre los docs diarios (~portafolio entero) hay
  // fechas cuyo ÚNICO doc es NAV de broker (~una cuenta, mucho menor), de los
  // días en que el usuario no abrió la app y el sync ganó el doc. Caminar esa
  // mezcla rompía el detector en las dos direcciones: un doc de broker justo
  // antes de una meseta corrupta dejaba TODOS los docs completos posteriores
  // "fuera de banda" (la racha nunca regresaba al ancla y no había veredicto:
  // exactamente por qué la meseta real de ~$35K sobrevivió dos limpiezas), y
  // en el peor caso un tramo de dailies REALES entre dos docs de broker leía
  // como racha borrable contra un ancla de ~10K. Los docs de broker no
  // desaparecen: pasan a ser evidencia de CORROBORACIÓN: si dentro de la racha
  // hay un NAV de broker al MISMO nivel de la racha (±corroborationTol), el
  // broker está confirmando ese nivel y la racha se respeta entera (el rol que
  // el abort viejo cumplía en un portafolio solo-broker).
  const rows = all.filter((r) => !BROKER_NAV.includes(r.source))
  const brokerRows = all.filter((r) => BROKER_NAV.includes(r.source))

  if (rows.length < 3) return []

  const isDeletable = (r) => DELETABLE_SNAPSHOT_SOURCES.includes(r.source)
  // El escaneo usa la banda estricta (superset de candidatos); la decisión
  // final de borrar exige la banda gruesa cuando la racha trae algún doc que
  // no sea 'daily' (ver dailyOffHi arriba).
  const isOff = (v, anchor) => v > anchor * dailyOffHi || v < anchor * dailyOffLo
  const isOffGross = (v, anchor) => v > anchor * offHi || v < anchor * offLo

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
    // Racha 100% 'daily' Y sostenida (>= dailyMinRunPoints): la banda estricta
    // basta. Cualquier otra forma (docs backfill adentro, o una racha corta
    // que puede ser volatilidad real de 1-3 días) exige la banda gruesa en
    // TODOS los puntos, como antes de FASE FW.
    let allDaily = true
    let runMin = Infinity
    let runMax = -Infinity
    for (let k = i; k < j; k++) {
      if (rows[k].source !== 'daily') allDaily = false
      if (rows[k].value < runMin) runMin = rows[k].value
      if (rows[k].value > runMax) runMax = rows[k].value
    }
    const flat = runMin > 0 && runMax / runMin - 1 <= dailyFlatTol
    let bandOk = true
    if (!(allDaily && flat && runPoints >= dailyMinRunPoints)) {
      for (let k = i; k < j; k++) { if (!isOffGross(rows[k].value, anchor)) { bandOk = false; break } }
    }

    // FASE FY: un NAV de broker DENTRO del rango de fechas de la racha y al
    // MISMO nivel de la racha la corrobora: el broker midió ese nivel de
    // verdad, no se borra nada.
    const runLevel = (runMin + runMax) / 2
    const corroborated = runLevel > 0 && brokerRows.some((b) =>
      b.ts >= rows[i].ts - DAY_MS && b.ts <= rows[j - 1].ts + DAY_MS &&
      Math.abs(b.value / runLevel - 1) <= corroborationTol)

    if (
      bandOk &&
      !corroborated &&
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
