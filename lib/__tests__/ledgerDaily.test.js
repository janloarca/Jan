// FASE SM. Cierres DIARIOS del broker en una cuenta conciliada.
//
// Con el reporte mensual, el % de 1M, 3M y 1A depende de estimar el valor del
// día en que empieza la ventana (puente lineal entre dos cierres de mes, o la
// cantidad de HOY × precio de entonces). Con el reporte DIARIO de
// PortfolioAnalyst cada día de mercado trae su NAV y su retorno: el % es el
// TWR de IBKR encadenado desde el cierre del primer día.
//
// Datos SINTÉTICOS (repo público): ningún monto ni cuenta real.
import { parseIBKRFile, formatIBKRFileResult, parseAccountMonthlyReturns, extractReportFrequency } from '../parsers/ibkrFileParser'
import { mergeLedgerNav, planLedgerReconcile } from '../ledgerReconcile'
import { buildReconciledView, snapToDailyClose } from '../ledgerSeries'

const DAY = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const isWeekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || d.endsWith('-01-01')

// Serie diaria determinista: retorno r(i) y un depósito opcional.
function dailySeries({ from, to, v0, flows = {} }) {
  const out = []
  let v = v0
  let i = 0
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const d = iso(t)
    if (isWeekend(d)) continue
    const r = Math.sin(i * 0.7) * 0.012 + 0.0004 // ±1.2% al día
    v = v * (1 + r) + (flows[d] || 0)
    out.push({ d, v, r: r * 100, f: 'd' })
    i++
  }
  return out
}

const chained = (pts, fromExcl, toIncl) => pts
  .filter((p) => p.d > fromExcl && p.d <= toIncl)
  .reduce((g, p) => g * (1 + p.r / 100), 1)

describe('parser: retornos diarios de PortfolioAnalyst', () => {
  const sec = (rows, headers = ['Date', 'BM1', 'BM1Return', 'U***00000', 'U***00000Return']) => ({
    'Time Period Benchmark Comparison': { headers, rows },
  })

  it('lee filas diarias en cualquier formato de fecha y las mensuales como antes', () => {
    const out = parseAccountMonthlyReturns(sec([
      ['Nov 2026', 'SPXTR', '1', 'U***00000', '-4.1'],
      ['20261117', 'SPXTR', '1', 'U***00000', '0.5'],
      ['11/18/26', 'SPXTR', '1', 'U***00000', '-1.25'],
      ['11/19/2026', 'SPXTR', '1', 'U***00000', '0.1'],
      ['2026-11-20', 'SPXTR', '1', 'U***00000', '0.2'],
      ['Nov 23, 2026', 'SPXTR', '1', 'U***00000', '0.3'],
      ['202611', 'SPXTR', '1', 'U***00000', '9'],
    ]))
    expect(out[0]).toEqual({ month: '2026-11', pct: -4.1, account: 'U***00000' })
    expect(out.slice(1).map((r) => r.date)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'])
    expect(out.slice(1).every((r) => r.daily)).toBe(true)
    expect(out.find((r) => r.date === '2026-11-18').pct).toBe(-1.25)
  })

  it('la frecuencia sale de la Introduction', () => {
    const intro = (txt) => ({ Introduction: { headers: ['Name', 'AnalysisPeriod'], rows: [['X', txt]] } })
    expect(extractReportFrequency(intro('November 1, 2025 to November 18, 2026 (Daily)'))).toBe('daily')
    expect(extractReportFrequency(intro('June 23, 2023 to November 18, 2026 (Monthly)'))).toBe('monthly')
    expect(extractReportFrequency({})).toBeNull()
  })

  it('un reporte diario pega el retorno de cada día a su NAV', () => {
    const series = dailySeries({ from: '2026-10-01', to: '2026-10-16', v0: 1000 })
    const csv = [
      'Introduction,Header,Name,Account,Alias,BaseCurrency,AccountType,AnalysisPeriod,PerformanceMeasure',
      'Introduction,Data,Demo,U***00000,,USD,Individual,"October 1, 2026 to October 16, 2026 (Daily)",TWR',
      'Allocation by Asset Class,MetaInfo,Analysis Period,"October 1, 2026 - October 16, 2026"',
      'Allocation by Asset Class,Header,Date,Equities,Fixed Income,Real Estate,Cash,NAV',
      ...series.map((p) => `Allocation by Asset Class,Data,${p.d.replace(/-/g, '')},${p.v},0,0,0,${p.v}`),
      'Time Period Benchmark Comparison,MetaInfo,Analysis Period,"October 1, 2026 - October 16, 2026"',
      'Time Period Benchmark Comparison,Header,Date,BM1,BM1Return,U***00000,U***00000Return',
      ...series.map((p) => `Time Period Benchmark Comparison,Data,${p.d.replace(/-/g, '')},SPXTR,0.1,U***00000,${p.r}`),
      'Open Position Summary,MetaInfo,As Of,"October 16, 2026"',
      'Open Position Summary,Header,Date,FinancialInstrument,Currency,Symbol,Description,Sector,Quantity,ClosePrice,Value,Cost Basis,UnrealizedP&L,FXRateToBase',
      'Open Position Summary,Data,10/16/2026,Stocks,USD,AAA,AAA INC,Technology,1,100,100,90,10,1',
    ].join('\n')
    const parsed = formatIBKRFileResult(parseIBKRFile(csv))
    expect(parsed.navFrequency).toBe('daily')
    const nav = parsed.equityHistory.filter((e) => !e._type)
    expect(nav).toHaveLength(series.length)
    expect(nav.every((e) => Number.isFinite(e._brokerDailyReturn))).toBe(true)
    expect(nav.some((e) => Number.isFinite(e._brokerMonthlyReturn))).toBe(false)
    expect(nav[3]._brokerDailyReturn).toBeCloseTo(series[3].r, 9)
  })
})

describe('mergeLedgerNav: un reporte diario no borra los meses viejos ni cuenta dos veces', () => {
  const months = [
    { d: '2025-09-30', v: 900, r: 1 },
    { d: '2025-10-31', v: 950, r: 2 },
    { d: '2025-11-30', v: 960, r: 3 },
    { d: '2025-12-31', v: 990, r: 4 },
  ]

  it('conserva lo de antes del archivo, quita los mensuales dentro del tramo diario', () => {
    const daily = dailySeries({ from: '2025-11-03', to: '2026-01-09', v0: 950 })
    const out = mergeLedgerNav(months, daily)
    expect(out.find((p) => p.d === '2025-09-30')).toEqual(months[0])
    expect(out.find((p) => p.d === '2025-10-31')).toEqual(months[1])
    expect(out.some((p) => p.d === '2025-11-30')).toBe(false)
    // El 31 dic es día de mercado: queda el DIARIO, no el cierre mensual.
    expect(out.find((p) => p.d === '2025-12-31')).toMatchObject({ f: 'd' })
    expect(out.filter((p) => p.d === '2025-12-31')).toHaveLength(1)
    // El 3 nov está a 3 días del 31 oct: su retorno diario es la costura exacta.
    expect(out.find((p) => p.d === '2025-11-03').r).toBeCloseTo(daily[0].r, 9)
  })

  it('si el tramo diario arranca lejos del último cierre, ese primer día se mide por Dietz', () => {
    const daily = dailySeries({ from: '2025-11-19', to: '2025-12-05', v0: 955 })
    const out = mergeLedgerNav(months, daily)
    expect(out.find((p) => p.d === '2025-11-19').r).toBeUndefined()
    expect(out.find((p) => p.d === '2025-11-20').r).toBeCloseTo(daily[1].r, 9)
    // El 31 dic mensual queda después del tramo, pero su mes empezó antes del
    // último día diario (5 dic): su retorno publicado mide días repetidos.
    const dec = out.find((p) => p.d === '2025-12-31')
    expect(dec).toBeDefined()
    expect(dec.r).toBeUndefined()
  })

  it('un archivo mensual después del diario no borra los días', () => {
    const daily = dailySeries({ from: '2025-11-03', to: '2025-12-31', v0: 950 })
    const stored = mergeLedgerNav(months, daily)
    const monthlyAgain = [...months, { d: '2026-01-31', v: 1000, r: 1.5 }]
    const out = mergeLedgerNav(stored, monthlyAgain)
    expect(out.filter((p) => p.f === 'd').length).toBe(daily.length - 1) // el 31 dic lo reemplaza el mensual
    expect(out.some((p) => p.d === '2025-11-30')).toBe(false)
    const dec = out.find((p) => p.d === '2025-12-31')
    expect(dec.f).toBeUndefined()
    expect(dec.r).toBeUndefined() // Dietz desde el 30 dic diario
    expect(out.find((p) => p.d === '2026-01-31').r).toBe(1.5)
  })

  it('sin archivo nuevo deja lo guardado igual', () => {
    expect(mergeLedgerNav(months, [])).toEqual(months)
  })
})

describe('buildReconciledView con cierres diarios: el % es el TWR del broker desde el día exacto', () => {
  const months = [
    { d: '2025-09-30', v: 800, r: 1.1 },
    { d: '2025-10-31', v: 820, r: 2.5 },
  ]
  const flows = [{ date: '2026-09-25', amount: 300 }]
  const daily = dailySeries({ from: '2025-11-03', to: '2026-11-18', v0: 820, flows: { '2026-09-25': 300 } })
  const nav = mergeLedgerNav(months, daily)
  const last = daily[daily.length - 1]
  const today = '2026-11-19'
  const endValue = last.v * 0.99
  const liveR = endValue / last.v

  it('1A = cadena diaria desde el cierre de hace un año menos un día, sin puente lineal', () => {
    // Reloj 19 nov, último cierre 18 nov. 1A = 18 nov 2025 − 1 día = 17 nov 2025.
    const view = buildReconciledView({ nav, flows, period: '1Y', today, endValue })
    expect(view.endClose).toBe('2026-11-18')
    expect(view.from).toBe('2025-11-17')
    expect(view.points[0].d).toBe('2025-11-17')
    const expected = (chained(daily, '2025-11-17', last.d) * liveR - 1) * 100
    expect(view.twr.pct).toBeCloseTo(expected, 6)
    expect(view.points[0].v).toBeCloseTo(daily.find((p) => p.d === '2025-11-17').v, 6)
  })

  it('3M (tres meses de calendario) cruza el depósito de septiembre sin contarlo como ganancia', () => {
    const view = buildReconciledView({ nav, flows, period: '3M', today, endValue })
    expect(view.from).toBe('2026-08-18')
    expect(view.points[0].d).toBe(view.from)
    const expected = (chained(daily, '2026-08-18', last.d) * liveR - 1) * 100
    expect(view.twr.pct).toBeCloseTo(expected, 6)
  })

  it('un rango que empieza en sábado arranca en el cierre del viernes', () => {
    // E = 17 nov (martes). 1M de calendario = 17 oct, sábado → viernes 16.
    const d2 = dailySeries({ from: '2026-10-01', to: '2026-11-17', v0: 1000 })
    const view = buildReconciledView({ nav: d2, flows: [], period: '1M', today: '2026-11-18', endValue: d2[d2.length - 1].v })
    expect(view.endClose).toBe('2026-11-17')
    expect(view.from).toBe('2026-10-16')
    expect(view.points[0].d).toBe('2026-10-16')
    expect(view.twr.pct).toBeCloseTo((chained(d2, '2026-10-16', '2026-11-17') - 1) * 100, 6)
  })

  it('sin cierres diarios, el inicio no se mueve', () => {
    expect(snapToDailyClose(months, '2025-10-05')).toBe('2025-10-05')
    expect(snapToDailyClose([{ d: '2026-11-13', v: 1, f: 'd' }], '2026-11-30')).toBe('2026-11-30')
  })

  it('YTD y TODO siguen encadenando los retornos publicados', () => {
    const ytd = buildReconciledView({ nav, flows, period: 'YTD', today, endValue })
    expect(ytd.twr.pct).toBeCloseTo((chained(daily, '2025-12-31', last.d) * liveR - 1) * 100, 6)
    const all = buildReconciledView({ nav, flows, period: 'ALL', today, endValue })
    const expectedAll = (1.011 * 1.025 * chained(daily, '2025-10-31', last.d) * liveR - 1) * 100
    expect(all.twr.pct).toBeCloseTo(expectedAll, 6)
  })
})

describe('planLedgerReconcile con un reporte diario', () => {
  it('guarda los días con f: "d" y conserva los meses que ya estaban', () => {
    const daily = dailySeries({ from: '2026-10-01', to: '2026-10-16', v0: 1000 })
    const parsed = {
      periodEnd: '2026-10-16',
      items: [],
      transactions: [],
      equityHistory: daily.map((p) => ({ date: p.d, netWorthUSD: p.v, _brokerDailyReturn: p.r })),
    }
    const existingLedgerAccount = { nav: [{ d: '2026-08-31', v: 900, r: 1 }, { d: '2026-09-30', v: 990, r: 2 }, { d: '2026-10-31', v: 1, r: 9 }] }
    const plan = planLedgerReconcile({
      parsed,
      accountKey: 'ibkr',
      items: [{ id: 'a', symbol: 'AAA', institution: 'IBKR', quantity: 1 }],
      existingLedgerAccount,
      newId: () => 'n1',
      now: '2026-10-17T00:00:00.000Z',
    })
    const nav = plan.ledgerAccount.nav
    expect(nav[0]).toEqual({ d: '2026-08-31', v: 900, r: 1 })
    expect(nav[1]).toEqual({ d: '2026-09-30', v: 990, r: 2 })
    expect(nav.filter((p) => p.f === 'd')).toHaveLength(daily.length)
    expect(plan.ledgerAccount.navFrequency).toBe('daily')
    // El 31 oct guardado es POSTERIOR al archivo: se queda, sin su retorno
    // (su mes ya lo cubren los días).
    const oct = nav.find((p) => p.d === '2026-10-31')
    expect(oct.r).toBeUndefined()
  })
})

describe('cableado de los cierres diarios', () => {
  const fs = require('fs')
  const path = require('path')
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
  it('el modal pasa los cierres guardados al planificador y la gráfica conserva f', () => {
    expect(read('components/FileImportModal.jsx')).toMatch(/existingLedgerAccount: \(existingLedgerAccounts \|\| \{\}\)\[reconcileAccountKey\]/)
    expect(read('components/dashboard/PortfolioGrowthChart.jsx')).toMatch(/r: p\.r, \.\.\.\(p\.f === 'd' \? \{ f: 'd' \} : \{\}\)/)
  })
})
