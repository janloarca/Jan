// FASE SL. Serie y TWR de UNA cuenta de broker conciliada, para TODOS los
// rangos de su gráfica. Extensión de la superficie D aprobada por el usuario
// (17 nov 2026): solo esa cuenta. Sin ledger, este módulo no se llama.
//
// Por qué no se usan los snapshots diarios. Una cuenta cargada a mano archivó
// depósitos y retiros duplicados; esos docs dibujan un pico de decenas de
// miles que el broker nunca tuvo, y un cierre de hace un año que no es el NAV.
// El archivo del broker (PortfolioAnalyst) es la medición: un NAV por cierre
// de mes, el del mes en curso fechado en el fin del estado de cuenta, y el
// retorno mensual que IBKR ya calculó con su TWR diario.
//
// Cómo se arma la serie
//   1. Anclas: los NAV del broker, más el valor vivo de hoy. Por esas fechas
//      el valor es el del broker, nunca un snapshot.
//   2. Entre anclas, fuera de los últimos ~100 días, no se inventan días: el
//      punto es el cierre de mes. Ahí la cantidad de acciones de hoy, tenida
//      plana, no describe la cuenta.
//   3. Dentro de los últimos ~100 días (1S, MES, 1M, 3M y el tramo reciente
//      de 1A/AÑO/TODO) se rellena con el cierre diario que la app ya pide
//      (posiciones conocidas × precio histórico + efectivo). Esa reconstrucción
//      acierta la FORMA y no el NIVEL: se recalibra para pasar EXACTO por las
//      dos anclas.
//        · Al camino reconstruido se le quita un salto que coincida con un
//          depósito o retiro (si el efectivo ya venía en la reconstrucción).
//        · El componente de mercado se escala en logaritmo para salir de la
//          ancla izquierda y llegar a (ancla derecha − flujos del tramo).
//        · Los flujos externos se SUMAN el día en que ocurrieron, así el valor
//          salta por el depósito y el TWR se lo puede restar.
//      Sin cierres diarios, el mercado se reparte lineal en el tiempo (la
//      misma hipótesis del Dietz modificado) y el flujo igual salta su día.
//   4. Un día suelto que queda a más de 1.8× o menos de 0.55× de sus dos
//      vecinos se tira. Un ancla no se tira nunca. Un depósito que deja el
//      valor nuevo tampoco: el nivel nuevo se queda, así que no es un pico
//      contra los dos vecinos.
//
// Cómo se mide el %
//   TWR encadenado, cortando en cada flujo externo.
//   · AÑO, MES y TODO delegan en computeLedgerTWR: el retorno mensual que
//     publicó el broker, más el tramo vivo desde el último cierre. Con esos
//     retornos el número es el de IBKR; sin ellos, Dietz entre cierres.
//   · 1S, 1M, 3M, 1A y el resto: el retorno mensual del broker se usa SOLO
//     cuando el tramo que mide cae ENTERO dentro de la ventana (si no, ese
//     retorno incluye días anteriores al "desde"). El pedazo inicial y el
//     tramo vivo se encadenan día a día con la serie calibrada; un flujo sin
//     punto propio se valúa con el puente entre las anclas que lo rodean.
//   · FASE SM. Con un reporte DIARIO de PortfolioAnalyst cada día de mercado
//     es un ancla con su retorno (f: 'd'): cualquier rango encadena el TWR
//     diario de IBKR desde el cierre de su primer día, sin estimar el inicio.
//   El monto en $ no se calcula aquí: sigue siendo el de computeWindowGrowth
//   (cambio de valor menos los flujos netos de la ventana).

import { computeLedgerTWR } from './ledgerTwr'

const DAY_MS = 86400000
export const LEDGER_DAILY_LOOKBACK_DAYS = 100

const tsOf = (d) => Date.parse(`${d}T00:00:00Z`)
const isoOf = (t) => new Date(t).toISOString().slice(0, 10)

export function addIsoDays(d, n) {
  return isoOf(tsOf(d) + n * DAY_MS)
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function cleanFlows(flows) {
  return (flows || [])
    .map((f) => ({ date: String(f?.date || '').slice(0, 10), amount: num(f?.amount) }))
    .filter((f) => f.date && f.amount)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function sumAmt(list) {
  return (list || []).reduce((s, f) => s + f.amount, 0)
}

function flowsBetween(flows, a, b) {
  // (a, b]: el flujo del día b pertenece al tramo que TERMINA ese día.
  return (flows || []).filter((f) => f.date > a && f.date <= b)
}

// La ventana que ya usa la gráfica: 7/30/90/365 días, MES = día 1, AÑO = 1 ene.
// `pin: 'anchor'` deja el primer punto en el NAV anterior (31 dic, fin de mes):
// es el "Beginning NAV" del broker. `pin: 'exact'` fecha el primer punto en el
// propio "desde", para que 1S no arranque en el cierre del mes previo.
export function reconciledPeriodWindow(period, today, custom) {
  if (!today) return { from: null, pin: 'anchor' }
  if (period === 'ALL') return { from: null, pin: 'anchor' }
  if (period === 'YTD') return { from: `${today.slice(0, 4)}-01-01`, pin: 'anchor' }
  if (period === 'MTD') return { from: `${today.slice(0, 7)}-01`, pin: 'anchor' }
  if (period === 'CUSTOM') return { from: custom?.from ? String(custom.from).slice(0, 10) : null, pin: 'exact' }
  if (period === 'DAY') return { from: addIsoDays(today, -1), pin: 'exact' }
  const days = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[period]
  if (!days) return { from: null, pin: 'anchor' }
  return { from: addIsoDays(today, -days), pin: 'exact' }
}

// Mercado lineal entre dos valores ya netos de flujos, y el flujo se suma el
// día que cae. En los extremos devuelve el valor del extremo.
function bridgeValue(left, right, date, flows) {
  if (date <= left.d) return left.v
  if (date >= right.d) return right.v
  const seg = flowsBetween(flows, left.d, right.d)
  const F = sumAmt(seg)
  const span = tsOf(right.d) - tsOf(left.d)
  const u = span > 0 ? (tsOf(date) - tsOf(left.d)) / span : 1
  const market = left.v + ((right.v - F) - left.v) * u
  const soFar = sumAmt(seg.filter((f) => f.date <= date))
  return market + soFar
}

// Valor de la serie en una fecha: el punto si existe, si no el puente entre
// los dos puntos que la rodean (los flujos de ese hueco saltan su día).
export function valueOnSeries(series, flows, date) {
  if (!date || !series?.length) return null
  const exact = series.find((p) => p.d === date)
  if (exact && exact.v > 0) return exact.v
  let left = null
  let right = null
  for (const p of series) {
    if (p.d < date) left = p
    else if (p.d > date) { right = p; break }
  }
  if (!left || !right || !(left.v > 0)) return null
  const v = bridgeValue(left, right, date, flows)
  return v > 0 && Number.isFinite(v) ? v : null
}

function nearestDaily(daily, date, slackDays) {
  let best = null
  let bestDist = Infinity
  const t = tsOf(date)
  for (const p of daily) {
    const dist = Math.abs(tsOf(p.d) - t) / DAY_MS
    if (dist < bestDist) { bestDist = dist; best = p }
  }
  if (!best || bestDist > slackDays) return null
  return best.v
}

// Si la reconstrucción ya trae el efectivo, el día del depósito salta ~el
// monto. Se le resta ese salto (y a los días siguientes) para que la forma
// que se escala sea la del mercado, y el flujo se vuelva a sumar aparte.
function stripFlowJumps(daily, flows) {
  const byDate = new Map()
  for (const f of flows) byDate.set(f.date, (byDate.get(f.date) || 0) + f.amount)
  let removed = 0
  let prevRaw = null
  const out = []
  for (const p of daily) {
    const f = byDate.get(p.d) || 0
    if (prevRaw != null && f) {
      const jump = p.v - prevRaw
      const tol = Math.max(1, Math.abs(f) * 0.35)
      if (Math.sign(jump) === Math.sign(f) && Math.abs(jump - f) <= tol) removed += f
    }
    out.push({ d: p.d, v: p.v - removed })
    prevRaw = p.v
  }
  return out
}

function normalizeDaily(daily, flows) {
  const byDate = new Map()
  for (const p of daily || []) {
    const d = String(p?.d || p?.date || '').slice(0, 10)
    const v = num(p?.v ?? p?.total ?? p?.value)
    if (!d || !(v > 0)) continue
    byDate.set(d, { d, v })
  }
  const sorted = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d))
  return stripFlowJumps(sorted, flows)
}

function dropIsolatedSpikes(interior, left, right, flows) {
  if (interior.length === 0) return interior
  const flowDates = new Set(flows.map((f) => f.date))
  const all = [left, ...interior, right]
  const drop = new Set()
  for (let i = 1; i < all.length - 1; i++) {
    if (flowDates.has(all[i].d)) continue
    const prev = all[i - 1].v
    const next = all[i + 1].v
    const v = all[i].v
    if (!(prev > 0) || !(next > 0) || !(v > 0)) continue
    const up = v > prev * 1.8 && v > next * 1.8
    const down = v < prev * 0.55 && v < next * 0.55
    if (up || down) drop.add(all[i].d)
  }
  return drop.size ? interior.filter((p) => !drop.has(p.d)) : interior
}

// Puntos ESTRICTAMENTE entre dos anclas. El mercado queda clavado a los
// extremos; el flujo del tramo se suma el día que cae.
// Cuánto puede alejarse el mercado de un día de la banda [min, max] de las
// dos anclas que lo rodean (en factor) antes de que la forma se descarte.
// Un mes de mercado real cabe holgado; una cantidad duplicada no.
export const SHAPE_BAND = 1.3

function calibrateSegment(left, right, daily, flows, linearDays = null) {
  const inside = linearDays
    || daily.filter((p) => p.d > left.d && p.d < right.d && p.v > 0)
  if (inside.length === 0) return []
  const seg = flowsBetween(flows, left.d, right.d)
  const F = sumAmt(seg)
  const market0 = left.v
  const market1 = right.v - F
  const r0 = nearestDaily(daily, left.d, 7)
  const r1 = nearestDaily(daily, right.d, 7)
  const useShape = !linearDays && r0 > 0 && r1 > 0 && market0 > 0 && market1 > 0
  const span = tsOf(right.d) - tsOf(left.d)
  const pts = []
  for (const p of inside) {
    const u = span > 0 ? (tsOf(p.d) - tsOf(left.d)) / span : 1
    let market
    if (useShape) {
      const logS = (1 - u) * Math.log(market0 / r0) + u * Math.log(market1 / r1)
      market = p.v * Math.exp(logS)
    } else {
      market = market0 + (market1 - market0) * u
    }
    const soFar = sumAmt(seg.filter((f) => f.date <= p.d))
    const v = market + soFar
    if (v > 0 && Number.isFinite(v)) pts.push({ d: p.d, v, src: 'daily', market })
  }
  // FASE SL2. Escalar por las dos puntas no arregla un NIVEL equivocado en
  // medio del tramo: si la reconstrucción duplicó acciones solo en algunos
  // días (lotes cerrados por la conciliación que siguen vivos hasta el fin
  // del estado de cuenta, una fecha de compra dentro del tramo), las dos
  // puntas cuadran y el centro dibuja un pico de miles que el broker no
  // tuvo. Si el componente de mercado se sale de la banda de las anclas por
  // más de SHAPE_BAND, la forma no describe esta cuenta y el tramo queda
  // lineal (la misma hipótesis que sin cierres diarios).
  // Primero se tira el día suelto (regla de abajo); la banda mira lo que queda.
  const kept = dropIsolatedSpikes(pts, left, right, flows)
  if (useShape && kept.length > 0) {
    const lo = Math.min(market0, market1) / SHAPE_BAND
    const hi = Math.max(market0, market1) * SHAPE_BAND
    if (kept.some((p) => p.market < lo || p.market > hi)) {
      const keptDays = new Set(kept.map((p) => p.d))
      return calibrateSegment(left, right, [], flows, inside.filter((p) => keptDays.has(p.d)))
    }
  }
  return kept.map(({ market: _m, ...p }) => p)
}

function dedupe(points) {
  const by = new Map()
  for (const p of points) by.set(p.d, p)
  return [...by.values()].sort((a, b) => a.d.localeCompare(b.d))
}

function buildSpine({ nav, flows, daily, to, endValue, lookbackDays }) {
  const anchors = []
  const seen = new Set()
  for (const p of nav || []) {
    const d = String(p?.d || '').slice(0, 10)
    const v = num(p?.v)
    if (!d || !(v > 0) || seen.has(d)) continue
    seen.add(d)
    const r = p.r == null || p.r === '' ? null : num(p.r)
    anchors.push({ d, v, r, src: 'nav' })
  }
  anchors.sort((a, b) => a.d.localeCompare(b.d))
  if (to && num(endValue) > 0) {
    const live = { d: to, v: num(endValue), r: null, src: 'live' }
    const idx = anchors.findIndex((a) => a.d === to)
    if (idx >= 0) anchors[idx] = { ...anchors[idx], v: live.v, src: 'live' }
    else anchors.push(live)
    anchors.sort((a, b) => a.d.localeCompare(b.d))
  }
  const dailyClean = normalizeDaily(daily, flows)
  const lookback = to ? addIsoDays(to, -lookbackDays) : null
  const out = []
  for (let i = 0; i < anchors.length; i++) {
    const right = anchors[i]
    const left = i > 0 ? anchors[i - 1] : null
    if (left && lookback && right.d > lookback) {
      out.push(...calibrateSegment(left, right, dailyClean, flows))
    }
    out.push(right)
  }
  return dedupe(out)
}

function withLive(points, to, endValue) {
  if (!to || !(num(endValue) > 0)) return points
  const live = { d: to, v: num(endValue), src: 'live' }
  if (points.length === 0) return [live]
  const last = points[points.length - 1]
  if (last.d === to) {
    points[points.length - 1] = { ...last, v: live.v, src: 'live' }
    return points
  }
  if (last.d < to) points.push(live)
  return points
}

function sliceWindow({ spine, flows, from, pin, to, endValue }) {
  if (!spine.length) return []
  if (!from) {
    let pts = spine.filter((p) => !to || p.d <= to)
    const first = pts[0]
    const opening = flows.find((f) => f.amount > 0 && (!first || f.date < first.d))
    if (opening) pts = [{ d: opening.date, v: opening.amount, src: 'flow' }, ...pts.filter((p) => p.d !== opening.date)]
    return withLive(pts, to, endValue)
  }
  if (pin === 'anchor') {
    let anchor = null
    for (const p of spine) if (p.d <= from) anchor = p
    const pts = []
    if (anchor) pts.push(anchor)
    else {
      const v = valueOnSeries(spine, flows, from)
      if (v > 0) pts.push({ d: from, v, src: 'window' })
    }
    const after = anchor ? anchor.d : from
    for (const p of spine) {
      if (p.d <= after) continue
      if (to && p.d > to) break
      pts.push(p)
    }
    return withLive(pts, to, endValue)
  }
  const startV = valueOnSeries(spine, flows, from)
  const pts = []
  if (startV > 0) pts.push({ d: from, v: startV, src: 'window' })
  for (const p of spine) {
    if (p.d <= from) continue
    if (to && p.d >= to) break
    pts.push(p)
  }
  if (to && to !== from) return withLive(pts, to, endValue)
  return pts
}

// Encadena (V1 − flujos del tramo) / V0 − 1. Un flujo sin punto se valúa con
// el puente de la serie, así el corte queda en el día del flujo y no se
// reparte el depósito a lo largo del mes.
function chainBetween(series, flows, d0, v0, d1, v1) {
  if (!(v0 > 0) || !d0 || !d1 || d1 < d0) return null
  if (d0 === d1) return v1 > 0 ? (v1 / v0) - 1 : null
  const seen = new Set([d0, d1])
  const mids = []
  for (const p of series || []) {
    if (p.d > d0 && p.d < d1 && p.v > 0 && !seen.has(p.d)) {
      mids.push({ d: p.d, v: p.v })
      seen.add(p.d)
    }
  }
  for (const f of flows) {
    if (f.date > d0 && f.date < d1 && !seen.has(f.date)) {
      const v = valueOnSeries(series, flows, f.date)
      if (v > 0) {
        mids.push({ d: f.date, v })
        seen.add(f.date)
      }
    }
  }
  mids.sort((a, b) => a.d.localeCompare(b.d))
  const pts = [{ d: d0, v: v0 }, ...mids, { d: d1, v: v1 }]
  let growth = 1
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d === pts[i - 1].d) continue
    if (!(pts[i - 1].v > 0)) return null
    const F = sumAmt(flowsBetween(flows, pts[i - 1].d, pts[i].d))
    const step = (pts[i].v - F) / pts[i - 1].v
    if (!Number.isFinite(step)) return null
    growth *= step
  }
  return growth - 1
}

function sortedNav(nav) {
  return (nav || [])
    .map((p) => ({
      d: String(p?.d || '').slice(0, 10),
      v: num(p?.v),
      r: p.r == null || p.r === '' ? null : num(p.r),
      ...(p?.f === 'd' ? { f: 'd' } : {}),
    }))
    .filter((p) => p.d && p.v > 0)
    .sort((a, b) => a.d.localeCompare(b.d))
}

// TWR de la ventana. `series` es la espina (anclas + días calibrados + hoy).
export function reconciledWindowTwr({ nav, flows = [], series = [], from = null, pin = 'anchor', to = null, endValue = null } = {}) {
  const flowList = cleanFlows(flows)
  const end = num(endValue)
  // undefined, no null: Number(null) es 0 y computeLedgerTWR lo tomaría como
  // un cierre en cero (un −100% que nadie midió).
  const live = end > 0 ? end : undefined
  const navs = sortedNav(nav)
  if (!to || navs.length === 0) return null

  if (!from || pin === 'anchor') {
    const base = computeLedgerTWR({
      nav: navs.map((p) => ({ d: p.d, v: p.v, r: p.r })),
      flows: flowList,
      from,
      to,
      endValue: live,
    })
    if (!base) return null
    const last = [...navs].reverse().find((p) => p.d <= to)
    // Mismo día que el cierre: el retorno publicado llega hasta ESE nav. El
    // valor vivo, si ya se movió, es un tramo más (sin restar de nuevo un
    // flujo que el cierre ya trae).
    if (last && last.d === to && last.v > 0 && live > 0 && Math.abs(live - last.v) / last.v > 1e-6) {
      const moved = ((1 + base.pct / 100) * (live / last.v) - 1) * 100
      return { ...base, pct: moved }
    }
    return base
  }

  const v0 = valueOnSeries(series, flowList, from)
  if (!(v0 > 0)) return null
  if (to <= from) return { pct: 0, anchor: { d: from, v: v0 } }

  let growth = 1
  let cursorDate = from
  let cursorVal = v0
  for (let i = 0; i < navs.length; i++) {
    const p = navs[i]
    if (p.d <= from || p.d > to) continue
    const prev = i > 0 ? navs[i - 1] : null
    const spanInside = !!(prev && prev.d >= from && p.r != null && Number.isFinite(p.r))
    if (!spanInside) continue
    if (cursorDate < prev.d) {
      const r = chainBetween(series, flowList, cursorDate, cursorVal, prev.d, prev.v)
      if (r == null || !Number.isFinite(r)) return null
      growth *= 1 + r
    }
    growth *= 1 + p.r / 100
    cursorDate = p.d
    cursorVal = p.v
  }
  if (cursorDate < to) {
    if (!(end > 0)) return null
    const r = chainBetween(series, flowList, cursorDate, cursorVal, to, end)
    if (r == null || !Number.isFinite(r)) return null
    growth *= 1 + r
  } else if (cursorDate === to && cursorVal > 0 && end > 0 && Math.abs(end - cursorVal) / cursorVal > 1e-6) {
    growth *= end / cursorVal
  }
  if (!Number.isFinite(growth)) return null
  return { pct: (growth - 1) * 100, anchor: { d: from, v: v0 } }
}

// FASE SL2. Lo que la gráfica de una cuenta conciliada le pide al historial:
// SOLO la forma del mercado, cantidad de HOY × cierre histórico. Sin lotes,
// sin rebobinar BUY/SELL, sin flujos de caja ni ingresos: el nivel y los
// flujos ya los ponen los NAV y el ledger del broker. Los lotes de una cuenta
// conciliada mezclan los manuales viejos (cerrados en el fin del estado de
// cuenta, así que siguen "vivos" en el pasado) con el lote nuevo fechado en
// la compra original: rebobinar con ellos cuenta las acciones dos veces.
export function reconciledShapeItems(payloadItems) {
  return (payloadItems || []).map((it) => {
    const {
      txEvents: _tx, cashFlows: _cf, _flowIsAccountLevel: _fa, _flowClampZero: _fz,
      _dateUnreliable: _du, ...rest
    } = it || {}
    return { ...rest, _holdFlat: true }
  })
}

// Punto de entrada de la gráfica. `nav`, `flows`, `daily` y `endValue` en la
// MISMA moneda. Devuelve null si no hay anclas.
export function buildReconciledView({
  nav,
  flows = [],
  daily = [],
  period,
  today,
  custom = null,
  endValue = null,
  lookbackDays = LEDGER_DAILY_LOOKBACK_DAYS,
} = {}) {
  const flowList = cleanFlows(flows)
  const navs = sortedNav(nav)
  if (navs.length === 0 || !today) return null
  const win = reconciledPeriodWindow(period, today, custom)
  const pin = win.pin
  // FASE SM. Con cierres DIARIOS del broker, un rango que empieza en sábado
  // o feriado arranca en el último cierre real (lo que hace IBKR), no en un
  // valor puente entre el viernes y el lunes.
  const from = pin === 'exact' ? snapToDailyClose(navs, win.from) : win.from
  if (period === 'CUSTOM' && !from) return null
  const spine = buildSpine({
    nav: navs, flows: flowList, daily, to: today, endValue, lookbackDays,
  })
  const points = sliceWindow({ spine, flows: flowList, from, pin, to: today, endValue })
  if (points.length === 0) return null
  const twr = reconciledWindowTwr({
    nav: navs, flows: flowList, series: spine, from, pin, to: today, endValue,
  })
  const start = points[0]
  const netFlows = sumAmt(flowList.filter((f) => f.date > start.d && f.date <= today))
  const last = points[points.length - 1].v
  return {
    points,
    spine,
    twr,
    from,
    pin,
    nav: navs,
    flows: flowList,
    netFlows,
    // Cambio de valor menos flujos netos. Con aportes netos positivos es el
    // mismo monto que computeWindowGrowth; la gráfica sigue usando esa función.
    gain: last - start.v - netFlows,
  }
}

// FASE SM. Último cierre DIARIO (f: 'd') en o antes de `from`, si está a
// pocos días (fin de semana, feriado). Sin cierres diarios, `from` no cambia.
export const DAILY_SNAP_DAYS = 4
export function snapToDailyClose(nav, from) {
  if (!from) return from
  let best = null
  for (const p of nav || []) {
    if (!p || p.f !== 'd' || !p.d) continue
    if (p.d <= from) best = p.d
    else break
  }
  if (!best || best === from) return from
  const gapDays = (tsOf(from) - tsOf(best)) / DAY_MS
  return gapDays <= DAILY_SNAP_DAYS ? best : from
}

// FASE SL2. Índices de los puntos más cercanos a n+1 marcas parejas en el
// TIEMPO (no en el índice). Para el eje de una serie con densidad despareja:
// cierres de mes lejos, cierres diarios cerca.
export function timeTickIndices(tsList, n = 6) {
  const out = new Set()
  const ts = tsList || []
  if (ts.length === 0) return out
  const t0 = ts[0]
  const t1 = ts[ts.length - 1]
  let j = 0
  for (let k = 0; k <= n; k++) {
    const target = t0 + ((t1 - t0) * k) / n
    while (j < ts.length - 1 && Math.abs(ts[j + 1] - target) <= Math.abs(ts[j] - target)) j++
    out.add(j)
  }
  return out
}
