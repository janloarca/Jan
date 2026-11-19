// FASE SL2. La forma diaria de una cuenta conciliada no puede inventar un
// pico. Montos y símbolos sintéticos: el repo es público.
import { planLedgerReconcile } from '../ledgerReconcile'
import { lotsReconcile } from '../portfolioRewind'
import { buildReconciledView, reconciledShapeItems, SHAPE_BAND } from '../ledgerSeries'

const DAY = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const days = (a, b) => {
  const out = []
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += DAY) out.push(iso(t))
  return out
}
const PX = { AAA: 500, BBB: 100 }

const items = [
  { id: 'a', symbol: 'AAA', type: 'stock', quantity: 10, purchasePrice: 450, currentPrice: 500, institution: 'IBKR', acquisitionDate: '2026-03-01' },
  { id: 'b', symbol: 'BBB', type: 'stock', quantity: 50, purchasePrice: 90, currentPrice: 100, institution: 'IBKR', acquisitionDate: '2026-03-01' },
]
// Lotes manuales viejos, abiertos, fechados el día en que se cargaron a mano.
const oldLots = [
  { id: 'l1', itemId: 'a', symbol: 'AAA', quantity: 10, acquisitionDate: '2026-11-05', institution: 'IBKR', status: 'open' },
  { id: 'l2', itemId: 'b', symbol: 'BBB', quantity: 48, acquisitionDate: '2026-11-10', institution: 'IBKR', status: 'open' },
]
const nav = [
  { d: '2026-07-31', v: 9800, r: 0.5 }, { d: '2026-08-31', v: 9790, r: -0.1 },
  { d: '2026-09-30', v: 9900, r: 1.1 }, { d: '2026-10-31', v: 10000, r: 1.0 },
  { d: '2026-11-16', v: 10000, r: 0 },
]
const today = '2026-11-19'
const live = 9800

function reconciledLots() {
  const plan = planLedgerReconcile({
    parsed: {
      items: [
        { symbol: 'AAA', type: 'stock', quantity: 10, purchasePrice: 450 },
        { symbol: 'BBB', type: 'stock', quantity: 50, purchasePrice: 90 },
      ],
      periodEnd: '2026-11-16', equityHistory: [], transactions: [],
    },
    accountKey: 'ibkr', items, lots: oldLots, transactions: [],
  })
  const closed = new Map(plan.bulk.updateLots.map((u) => [u.id, u.fields]))
  return { plan, lots: [...oldLots.map((l) => (closed.has(l.id) ? { ...l, ...closed.get(l.id) } : l)), ...plan.bulk.lots] }
}

// Espejo de la rama de lotes de app/api/prices/portfolio-history (lotsReconcile
// + cantidad viva en ts): así reconstruía el servidor la forma antes de SL2.
function rawByLots(lots, dates) {
  return dates.map((d) => {
    const ts = Date.parse(`${d}T14:30:00Z`)
    let total = 0
    for (const it of items) {
      const ls = lots.filter((l) => l.symbol === it.symbol && l.quantity > 0).map((l) => ({
        qty: l.quantity,
        acquiredTs: Date.parse(l.acquisitionDate),
        closedTs: l.closedDate ? Date.parse(l.closedDate) : null,
      }))
      let q = it.quantity
      if (lotsReconcile(ls, it.quantity, Date.parse(`${today}T18:00:00Z`))) {
        q = 0
        for (const l of ls) if (ts >= l.acquiredTs && (!l.closedTs || ts < l.closedTs)) q += l.qty
      }
      total += q * PX[it.symbol]
    }
    return { d, v: total }
  })
}
const rawFlat = (dates, px = () => 1) => dates.map((d) => ({ d, v: items.reduce((s, it) => s + it.quantity * PX[it.symbol] * px(d), 0) }))

describe('causa: lotes cerrados por la conciliación + lote nuevo retrofechado', () => {
  it('la rama de lotes cuenta las acciones dos veces hasta el fin del estado de cuenta', () => {
    const { lots } = reconciledLots()
    const raw = rawByLots(lots, days('2026-08-01', '2026-11-18'))
    const at = (d) => raw.find((p) => p.d === d).v
    expect(at('2026-10-31')).toBe(10000)
    expect(at('2026-11-13')).toBe(19800)
    expect(at('2026-11-16')).toBe(10000)
  })

  it('la conciliación marca esos lotes como reemplazados, no vendidos', () => {
    const { plan } = reconciledLots()
    expect(plan.bulk.updateLots.length).toBe(2)
    for (const u of plan.bulk.updateLots) {
      expect(u.fields).toMatchObject({ status: 'closed', closedDate: '2026-11-16', _ledgerSuperseded: true })
    }
  })
})

describe('defensa: una forma que se sale de la banda de las anclas no se usa', () => {
  const { lots } = reconciledLots()
  const bad = rawByLots(lots, days('2026-08-01', '2026-11-18'))

  it('1S ya no arranca en el pico ni marca −50%', () => {
    const v = buildReconciledView({ nav, flows: [], daily: bad, period: '1W', today, endValue: live })
    const max = Math.max(...v.points.map((p) => p.v))
    expect(max).toBeLessThanOrEqual(10000 * SHAPE_BAND)
    expect(v.points[0].v).toBeCloseTo(10000, -1)
    expect(v.twr.pct).toBeGreaterThan(-3)
    expect(v.twr.pct).toBeLessThan(-1.9)
  })

  it('MES dibuja el tramo dentro de las anclas', () => {
    const v = buildReconciledView({ nav, flows: [], daily: bad, period: 'MTD', today, endValue: live })
    expect(Math.max(...v.points.map((p) => p.v))).toBeLessThanOrEqual(10000.01)
    expect(v.twr.pct).toBeCloseTo(-2, 6)
  })

  it('una caída real de mercado dentro del mes (−12%) conserva su forma', () => {
    const dip = (d) => (d >= '2026-11-05' && d <= '2026-11-12' ? 0.88 : 1)
    const v = buildReconciledView({ nav, flows: [], daily: rawFlat(days('2026-08-01', '2026-11-18'), dip), period: 'MTD', today, endValue: live })
    const mid = v.points.find((p) => p.d === '2026-11-08')
    expect(mid.v).toBeLessThan(9000)
    expect(mid.v).toBeGreaterThan(8500)
  })
})

describe('arreglo: la forma de una cuenta conciliada es cantidad de hoy × cierre', () => {
  it('reconciledShapeItems quita rebobinado, flujos e ingresos y fija hold-flat', () => {
    const out = reconciledShapeItems([
      { id: 'a', symbol: 'AAA', quantity: 10, _holdFlat: false, _dateUnreliable: true, txEvents: [{ ts: 1, qtyDelta: 1 }] },
      { id: 'c', symbol: 'CASH-USD', quantity: 7, cashFlows: [{ ts: 1, amount: 5 }], _flowIsAccountLevel: true, _flowClampZero: true },
    ])
    expect(out).toEqual([
      { id: 'a', symbol: 'AAA', quantity: 10, _holdFlat: true },
      { id: 'c', symbol: 'CASH-USD', quantity: 7, _holdFlat: true },
    ])
  })

  it('con la forma plana, 1S y MES siguen al NAV sin pico', () => {
    const daily = rawFlat(days('2026-08-01', '2026-11-18'))
    for (const period of ['1W', 'MTD', '1M', '3M', 'YTD']) {
      const v = buildReconciledView({ nav, flows: [], daily, period, today, endValue: live })
      expect(Math.max(...v.points.map((p) => p.v))).toBeLessThanOrEqual(10000.01)
    }
    const w = buildReconciledView({ nav, flows: [], daily, period: '1W', today, endValue: live })
    expect(w.twr.pct).toBeGreaterThan(-3)
  })
})
