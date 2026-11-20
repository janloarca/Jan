// FASE SN-b. Regresión del camino REAL: PortfolioAnalyst diario (fechas
// YYYYMMDD) que termina el 18 nov 2026, historial mensual viejo, navegador en
// America/Guatemala a las 00:10 del 20 nov (06:10 UTC). El valor vivo es el
// cierre del jueves 19, que el archivo no trae. IBKR mide 1S/1M/3M/1A desde
// E = 19 nov: 12 nov, 19 oct, 19 ago y 18 nov 2025. Antes Chispu tomaba E = 18
// (último día del archivo) y arrancaba un día hábil antes en los cuatro.
//
// Datos SINTÉTICOS (repo público): ningún monto ni cuenta real.
import { parseIBKRFile, formatIBKRFileResult } from '../parsers/ibkrFileParser'
import { planLedgerReconcile } from '../ledgerReconcile'
import { buildReconciledView, liveSessionDay, reconciledEndClose } from '../ledgerSeries'

const DAY = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const isWeekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())

function dailySeries({ from, to, v0 }) {
  const out = []
  let v = v0
  let i = 0
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const d = iso(t)
    if (isWeekend(d)) continue
    const r = Math.sin(i * 0.37) * 0.011 + 0.0006
    v = v * (1 + r)
    out.push({ d, v: Math.round(v * 100) / 100, r: r * 100 })
    i++
  }
  return out
}

const csvOf = (series) => {
  const ymd = (d) => d.replace(/-/g, '')
  return [
    'Introduction,Header,Name,Account,Alias,BaseCurrency,AccountType,AnalysisPeriod,PerformanceMeasure',
    'Introduction,Data,Demo,U***00000,,USD,Individual,"November 3, 2025 to November 18, 2026 (Daily)",TWR',
    'Allocation by Asset Class,MetaInfo,Analysis Period,"November 3, 2025 - November 18, 2026"',
    'Allocation by Asset Class,Header,Date,Equities,Fixed Income,Real Estate,Cash,NAV',
    ...series.map((p) => `Allocation by Asset Class,Data,${ymd(p.d)},${p.v},0,0,0,${p.v}`),
    'Time Period Benchmark Comparison,MetaInfo,Analysis Period,"November 3, 2025 - November 18, 2026"',
    'Time Period Benchmark Comparison,Header,Date,BM1,BM1Return,U***00000,U***00000Return',
    ...series.map((p) => `Time Period Benchmark Comparison,Data,${ymd(p.d)},SPXTR,0.1,U***00000,${p.r}`),
    'Open Position Summary,MetaInfo,As Of,"November 18, 2026"',
    'Open Position Summary,Header,Date,FinancialInstrument,Currency,Symbol,Description,Sector,Quantity,ClosePrice,Value,Cost Basis,UnrealizedP&L,FXRateToBase',
    'Open Position Summary,Data,11/18/2026,Stocks,USD,AAA,AAA INC,Technology,1,100,100,90,10,1',
  ].join('\n')
}

describe('FASE SN-b: E es la sesión del valor vivo, no el último día del archivo', () => {
  const NOW_NIGHT = Date.parse('2026-11-20T06:10:00Z') // 00:10 Guatemala, 01:10 NY
  const NOW_SESSION = Date.parse('2026-11-19T20:00:00Z') // 14:00 Guatemala, 15:00 NY

  const series = dailySeries({ from: '2025-11-03', to: '2026-11-18', v0: 5000 })
  const months = [
    { d: '2025-08-29', v: 4500, r: 1.1 },
    { d: '2025-09-30', v: 4700, r: 2.2 },
    { d: '2025-10-31', v: 4950, r: 3.3 },
  ]
  const parsed = formatIBKRFileResult(parseIBKRFile(csvOf(series)))
  const plan = planLedgerReconcile({
    parsed,
    accountKey: 'ibkr',
    items: [{ id: 'a', symbol: 'AAA', institution: 'IBKR', quantity: 1 }],
    existingLedgerAccount: { nav: months },
    newId: () => 'n1',
    now: '2026-11-19T00:00:00.000Z',
  })
  const nav = plan.ledgerAccount.nav
  const live = series[series.length - 1].v * 0.98 // cierre del 19 nov (−2%)
  const closeOn = (d) => nav.find((p) => p.d === d)

  it('el plan guarda los días y conserva los meses viejos (forma del archivo real)', () => {
    expect(process.env.TZ).toBe('America/Guatemala')
    expect(nav[nav.length - 1].d).toBe('2026-11-18')
    expect(nav.find((p) => p.d === '2025-09-30')).toBeDefined()
    expect(nav.filter((p) => p.f === 'd')).toHaveLength(series.length)
  })

  it('liveSessionDay: antes de la apertura y en fin de semana es la sesión anterior', () => {
    expect(liveSessionDay(NOW_NIGHT)).toBe('2026-11-19')
    expect(liveSessionDay(NOW_SESSION)).toBe('2026-11-19')
    expect(liveSessionDay(Date.parse('2026-11-19T14:00:00Z'))).toBe('2026-11-18') // 09:00 NY
    expect(liveSessionDay(Date.parse('2026-11-19T14:31:00Z'))).toBe('2026-11-19') // 09:31 NY
    expect(liveSessionDay(Date.parse('2026-11-22T18:00:00Z'))).toBe('2026-11-20') // domingo
    expect(liveSessionDay(Date.parse('2026-11-23T05:00:00Z'))).toBe('2026-11-20') // lunes 00:00 NY
  })

  it('reconciledEndClose: sin valor vivo o sin reloj, el último cierre de siempre', () => {
    expect(reconciledEndClose(nav, '2026-11-20', { now: NOW_NIGHT, endValue: live })).toBe('2026-11-19')
    expect(reconciledEndClose(nav, '2026-11-20', { now: NOW_NIGHT, endValue: null })).toBe('2026-11-18')
    expect(reconciledEndClose(nav, '2026-11-20', {})).toBe('2026-11-18')
  })

  const cases = [
    ['1W', '2026-11-12'],
    ['1M', '2026-10-19'],
    ['3M', '2026-08-19'],
    ['1Y', '2025-11-18'],
  ]
  for (const now of [NOW_NIGHT, NOW_SESSION]) {
    const today = new Date(now).toISOString().slice(0, 10) // como la gráfica
    for (const [period, start] of cases) {
      it(`${period} con reloj ${new Date(now).toISOString()} arranca EN el cierre del ${start}`, () => {
        const view = buildReconciledView({ nav, flows: [], daily: [], period, today, endValue: live, now })
        expect(view.endClose).toBe('2026-11-19')
        expect(view.from).toBe(start)
        expect(view.points[0].d).toBe(start)
        const base = closeOn(start)
        expect(base).toBeDefined()
        expect(view.points[0].v).toBeCloseTo(base.v, 6)
        // % = TWR encadenado desde el cierre DE ese día hasta el vivo.
        const expected = (live / base.v - 1) * 100
        expect(view.twr.pct).toBeCloseTo(expected, 1)
        // y no desde el cierre hábil anterior
        const prev = [...nav].reverse().find((p) => p.d < start)
        expect(Math.abs(view.twr.pct - (live / prev.v - 1) * 100)).toBeGreaterThan(0.05)
      })
    }
  }
})

describe('cableado FASE SN-b', () => {
  it('la gráfica le pasa el reloj a buildReconciledView', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8')
    expect(src).toMatch(/buildReconciledView\(\{[\s\S]{0,400}now: Date\.now\(\)/)
  })
})
