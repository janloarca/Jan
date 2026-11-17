// FASE SL. Serie y TWR de una cuenta conciliada, en todos los rangos.
// Montos sintéticos: el repo es público y el caso real no se fija aquí.
import fs from 'fs'
import path from 'path'
import { parseIBKRFile, formatIBKRFileResult } from '../parsers/ibkrFileParser'
import { computeLedgerTWR } from '../ledgerTwr'
import {
  buildReconciledView,
  reconciledPeriodWindow,
  reconciledWindowTwr,
} from '../ledgerSeries'

const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'ibkr-portfolio-analyst-ledger.csv'), 'utf8')
const parsed = formatIBKRFileResult(parseIBKRFile(csv))
const fixtureNav = parsed.equityHistory
  .filter((e) => !e._type)
  .map((e) => ({ d: e.date, v: e.netWorthUSD, r: e._brokerMonthlyReturn }))
const fixtureFlows = parsed.transactions
  .filter((t) => t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL')
  .map((t) => ({ date: t.date, amount: (t.type === 'WITHDRAWAL' ? -1 : 1) * Math.abs(t.totalAmount) }))

describe('rangos que ya medían con el retorno mensual del broker', () => {
  const today = '2026-11-17'
  const end = fixtureNav[fixtureNav.length - 1].v * 0.99

  it('AÑO sigue siendo el TWR encadenado, anclado en el cierre del 31 dic', () => {
    const view = buildReconciledView({ nav: fixtureNav, flows: fixtureFlows, period: 'YTD', today, endValue: end })
    const legacy = computeLedgerTWR({ nav: fixtureNav, flows: fixtureFlows, from: '2026-01-01', to: today, endValue: end })
    expect(view.points[0].d).toBe('2025-12-31')
    expect(view.twr.pct).toBeCloseTo(legacy.pct, 6)
  })

  it('TODO sigue siendo el TWR desde el inicio', () => {
    const view = buildReconciledView({ nav: fixtureNav, flows: fixtureFlows, period: 'ALL', today, endValue: end })
    const legacy = computeLedgerTWR({ nav: fixtureNav, flows: fixtureFlows, from: null, to: today, endValue: end })
    expect(view.twr.pct).toBeCloseTo(legacy.pct, 6)
    expect(view.points[0].d < view.points[1].d).toBe(true)
  })

  it('MES ancla en el cierre del mes anterior y suma el día vivo', () => {
    const nav = [
      { d: '2026-10-31', v: 1000, r: 0 },
      { d: '2026-11-16', v: 980, r: -2 },
    ]
    const view = buildReconciledView({ nav, flows: [], period: 'MTD', today: '2026-11-17', endValue: 970 })
    expect(view.points[0].d).toBe('2026-10-31')
    expect(view.points[0].v).toBe(1000)
    // 0.98 × (970/980) − 1 = −3%
    expect(view.twr.pct).toBeCloseTo(-3, 4)
    expect(view.twr.anchor.d).toBe('2026-10-31')
  })
})

describe('la forma diaria se calibra a las anclas y no hereda su nivel', () => {
  const nav = [
    { d: '2026-10-31', v: 1000 },
    { d: '2026-11-16', v: 900 },
  ]
  // La reconstrucción vale ~20× el NAV (posiciones de hoy hacia atrás) y
  // el recorte está concentrado después del 10 nov, no repartido en el mes.
  const daily = []
  for (let day = 1; day <= 16; day++) {
    const v = day <= 10 ? 20000 : 20000 - (day - 10) * (2000 / 6)
    daily.push({ d: `2026-11-${String(day).padStart(2, '0')}`, v })
  }

  it('1S arranca el día de la ventana, en el nivel del ancla, sin el pico', () => {
    const view = buildReconciledView({
      nav, flows: [], daily, period: '1W', today: '2026-11-17', endValue: 880,
    })
    expect(reconciledPeriodWindow('1W', '2026-11-17').from).toBe('2026-11-10')
    expect(view.points[0].d).toBe('2026-11-10')
    expect(view.points[0].v).toBeCloseTo(1000, 4)
    expect(view.points.every((p) => p.v < 1200)).toBe(true)
    expect(view.points.some((p) => p.d === '2026-11-16' && Math.abs(p.v - 900) < 1e-6)).toBe(true)
    // Sin flujos el TWR es el cambio desde el primer punto: 880/1000 − 1.
    expect(view.twr.pct).toBeCloseTo(-12, 4)
    expect(view.twr.anchor.v).toBeCloseTo(view.points[0].v, 6)
  })

  it('sin cierres diarios el mismo 1S reparte el mes en línea y da otro %', () => {
    const view = buildReconciledView({
      nav, flows: [], daily: [], period: '1W', today: '2026-11-17', endValue: 880,
    })
    // 10/16 del camino 1000 → 900 = 937.5; 880/937.5 − 1 = −6.13%
    expect(view.points[0].v).toBeCloseTo(937.5, 4)
    expect(view.twr.pct).toBeCloseTo((880 / 937.5 - 1) * 100, 4)
  })

  it('un día suelto a 100× no sobrevive entre dos vecinos sanos', () => {
    const flat = daily.map((p) => ({ ...p, v: 100 }))
    flat.find((p) => p.d === '2026-11-12').v = 10000
    const view = buildReconciledView({
      nav: [{ d: '2026-10-31', v: 1000 }, { d: '2026-11-16', v: 1000 }],
      flows: [],
      daily: flat,
      period: '1M',
      today: '2026-11-17',
      endValue: 1000,
    })
    expect(view.points.some((p) => p.d === '2026-11-12')).toBe(false)
    expect(view.points.every((p) => p.v < 1500)).toBe(true)
  })
})

describe('el TWR corta en los flujos y no usa un retorno mensual a medias', () => {
  it('un depósito a mitad del tramo no cuenta como rendimiento', () => {
    const nav = [
      { d: '2026-01-31', v: 1000 },
      { d: '2026-02-28', v: 1600 },
    ]
    const flows = [{ date: '2026-02-10', amount: 500 }]
    const view = buildReconciledView({
      nav, flows, period: 'CUSTOM', today: '2026-02-28', endValue: 1600,
      custom: { from: '2026-01-31' },
    })
    expect(view.points[0].d).toBe('2026-01-31')
    expect(view.points[0].v).toBe(1000)
    // Mercado 1000 → 1100 lineal; el depósito del día 10 salta. No es 60%
    // (1600/1000) ni 10% (flujo al final del mes).
    expect(view.twr.pct).toBeCloseTo(7.907, 2)
    expect(view.twr.pct).not.toBeCloseTo(60, 0)
    expect(view.netFlows).toBe(500)
    expect(view.gain).toBeCloseTo(1600 - 1000 - 500, 6)
  })

  it('el valor salta el día del depósito y las anclas quedan clavadas', () => {
    const nav = [
      { d: '2026-01-31', v: 1000 },
      { d: '2026-02-28', v: 1600 },
    ]
    const flows = [{ date: '2026-02-10', amount: 500 }]
    const daily = []
    for (let day = 1; day <= 28; day++) daily.push({ d: `2026-02-${String(day).padStart(2, '0')}`, v: 1000 })
    const view = buildReconciledView({
      nav, flows, daily, period: 'CUSTOM', today: '2026-02-28', endValue: 1600,
      custom: { from: '2026-01-31' },
    })
    const before = view.points.find((p) => p.d === '2026-02-09')
    const on = view.points.find((p) => p.d === '2026-02-10')
    expect(on.v - before.v).toBeGreaterThan(490)
    expect(on.v - before.v).toBeLessThan(520)
    expect(view.points.find((p) => p.d === '2026-02-28').v).toBe(1600)
  })

  it('3M usa el retorno del mes completo y no el del mes que la ventana parte', () => {
    const nav = [
      { d: '2026-07-31', v: 1000 },
      { d: '2026-08-31', v: 1100, r: 10 },
      { d: '2026-09-30', v: 1045, r: -5 },
      { d: '2026-10-31', v: 1045, r: 0 },
    ]
    const view = buildReconciledView({
      nav, flows: [], period: '3M', today: '2026-11-17', endValue: 1045,
    })
    // 90 días antes del 17 nov es el 19 ago. Agosto no entra entero (su
    // retorno mide desde el 31 jul), septiembre y octubre sí.
    expect(view.points[0].d).toBe('2026-08-19')
    const u = 19 / 31
    const vStart = 1000 + 100 * u
    expect(view.points[0].v).toBeCloseTo(vStart, 4)
    const partial = 1100 / vStart - 1
    const expected = ((1 + partial) * 0.95 * 1 - 1) * 100
    expect(view.twr.pct).toBeCloseTo(expected, 4)
    // Usar el +10% de agosto entero daría otro número.
    expect(view.twr.pct).not.toBeCloseTo(((1.1 * 0.95) - 1) * 100, 1)
  })

  it('HOY es el cambio desde el cierre de ayer, no el retorno del mes', () => {
    const nav = [
      { d: '2026-10-31', v: 1000, r: 0 },
      { d: '2026-11-16', v: 980, r: -2 },
    ]
    const view = buildReconciledView({ nav, flows: [], period: 'DAY', today: '2026-11-17', endValue: 970 })
    expect(view.points[0].d).toBe('2026-11-16')
    expect(view.points[0].v).toBe(980)
    expect(view.twr.pct).toBeCloseTo((970 / 980 - 1) * 100, 4)
  })
})

describe('sin anclas no hay vista de ledger', () => {
  it('devuelve null', () => {
    expect(buildReconciledView({ nav: [], period: '1W', today: '2026-11-17', endValue: 10 })).toBeNull()
  })

  it('un endValue vacío no convierte el TWR en −100', () => {
    const nav = [{ d: '2026-10-31', v: 1000, r: 1 }, { d: '2026-11-16', v: 1010, r: 1 }]
    const twr = reconciledWindowTwr({ nav, flows: [], from: '2026-01-01', pin: 'anchor', to: '2026-11-17', endValue: null })
    expect(twr.pct).toBeCloseTo((1.01 * 1.01 - 1) * 100, 4)
  })
})
