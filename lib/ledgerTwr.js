// FASE SK. TWR de una cuenta con ledger, al estilo del broker.
//
// IBKR mide el rendimiento con TWR diario y lo publica por mes en
// PortfolioAnalyst ("Time Period Benchmark Comparison"). Encadenar esos
// retornos mensuales reproduce EXACTO su cifra (YTD y desde el inicio), cosa
// que ningún método sobre NAV mensual consigue: entre cierres de mes no hay
// datos para separar cada depósito del rendimiento.
//
//   nav:   [{ d: 'YYYY-MM-DD', v: NAV, r?: retorno del mes en % }]  (cierres)
//   flows: [{ date: 'YYYY-MM-DD', amount }]  (+ depósito, - retiro)
//   from:  inicio de la ventana ('YYYY-MM-DD', exclusivo; null = desde siempre).
//          Ancla = último NAV con d <= from (YTD: el cierre del 31 dic).
//   to / endValue: valor vivo de hoy para el tramo después del último NAV.
//
// Cada mes usa el retorno del broker; si falta, Dietz modificado con los
// flujos del mes. El tramo vivo (último cierre -> hoy) también es Dietz.
// Devuelve { pct, anchor, months, live } o null si no hay con qué medir.

const DAY = 86400000
const ts = (d) => Date.parse(`${d}T00:00:00Z`)

export function dietzReturn(v0, v1, flows, d0, d1) {
  const t0 = ts(d0)
  const t1 = ts(d1)
  const span = t1 - t0
  let net = 0
  let weighted = 0
  for (const f of flows || []) {
    const a = Number(f.amount) || 0
    if (!a) continue
    const w = span > 0 ? Math.min(1, Math.max(0, (t1 - ts(f.date)) / span)) : 0.5
    net += a
    weighted += a * w
  }
  const denom = v0 + weighted
  if (!(denom > 0)) return null
  return (v1 - v0 - net) / denom
}

export function computeLedgerTWR({ nav, flows = [], from = null, to = null, endValue = null } = {}) {
  const pts = (nav || [])
    .filter((p) => p && p.d && Number.isFinite(Number(p.v)))
    .map((p) => ({ d: p.d, v: Number(p.v), r: p.r == null || p.r === '' ? null : Number(p.r) }))
    .sort((a, b) => a.d.localeCompare(b.d))
  if (pts.length === 0) return null
  const flowsIn = (a, b) => (flows || []).filter((f) => f && f.date > a && f.date <= b)

  let anchor = null
  if (from) {
    for (const p of pts) if (p.d <= from) anchor = p
  }
  const startIdx = anchor ? pts.indexOf(anchor) + 1 : 0
  let growth = 1
  let months = 0
  let prev = anchor
  for (let i = startIdx; i < pts.length; i++) {
    const p = pts[i]
    if (to && p.d > to) break
    let r = Number.isFinite(p.r) ? p.r / 100 : null
    if (r == null && prev) r = dietzReturn(prev.v, p.v, flowsIn(prev.d, p.d), prev.d, p.d)
    if (r == null && !prev) {
      // Primer cierre sin retorno publicado: desde el primer depósito.
      const fs = flowsIn('0000-00-00', p.d)
      const first = fs.length ? fs.reduce((m, f) => (f.date < m ? f.date : m), fs[0].date) : null
      if (first) r = dietzReturn(0, p.v, fs, prevDay(first), p.d)
    }
    if (r != null && Number.isFinite(r)) {
      growth *= 1 + r
      months++
    }
    prev = p
  }

  let live = null
  const last = prev
  // null/undefined = "no hay valor vivo". Number(null) es 0, y usarlo como
  // cierre fabricaría un −100% encima de los meses ya medidos.
  if (last && endValue != null && Number.isFinite(Number(endValue)) && to && to > last.d) {
    const r = dietzReturn(last.v, Number(endValue), flowsIn(last.d, to), last.d, to)
    if (r != null && Number.isFinite(r)) {
      growth *= 1 + r
      live = { from: last.d, to, pct: r * 100 }
    }
  }
  if (months === 0 && !live) return null
  return { pct: (growth - 1) * 100, anchor, months, live }
}

function prevDay(d) {
  return new Date(ts(d) - DAY).toISOString().slice(0, 10)
}
