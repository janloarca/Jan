// FASE SN. Ventanas móviles de una cuenta conciliada, con la convención de
// IBKR: el fin E es el último cierre de la serie, no el reloj.
//
//   1S = E − 7 días de calendario
//   1M = E − 1 mes de calendario
//   3M = E − 3 meses de calendario
//   1A = E − 1 año de calendario − 1 día
//
// Un inicio en fin de semana o feriado ancla al cierre hábil anterior
// (snapToDailyClose, FASE SM). HOY, MES, AÑO y TODO no se mueven.
// Montos sintéticos: el repo es público.
import fs from 'fs'
import path from 'path'
import {
  buildReconciledView,
  reconciledPeriodWindow,
  lastAvailableClose,
} from '../ledgerSeries'

const DAY = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)

function dailySeries({ from, to, v0 = 1000, skip = [] }) {
  const omit = new Set(skip)
  const out = []
  let v = v0
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const d = iso(t)
    const dow = new Date(t).getUTCDay()
    if (dow === 0 || dow === 6 || d.endsWith('-01-01') || omit.has(d)) continue
    const r = 0.1
    v = Math.round(v * (1 + r / 100) * 100) / 100
    out.push({ d, v, r, f: 'd' })
  }
  return out
}

const chained = (pts, fromExcl, toIncl) => pts
  .filter((p) => p.d > fromExcl && p.d <= toIncl)
  .reduce((g, p) => g * (1 + p.r / 100), 1)

// E = 19 nov 2026 (jueves). Estas cuatro fechas son las que IBKR mide.
const E = '2026-11-19'
const START = {
  '1W': '2026-11-12',
  '1M': '2026-10-19',
  '3M': '2026-08-19',
  '6M': '2026-05-19',
  '1Y': '2025-11-18',
}

describe('E = 19 nov 2026, cierre en día hábil', () => {
  const nav = dailySeries({ from: '2025-11-01', to: E })
  const endValue = nav[nav.length - 1].v

  it('1S, 1M, 3M y 1A arrancan en el cierre de calendario, y el primer punto es esa fecha', () => {
    expect(lastAvailableClose(nav, E)).toBe(E)
    for (const period of ['1W', '1M', '3M', '1Y']) {
      const view = buildReconciledView({ nav, flows: [], period, today: E, endValue })
      expect(view.endClose).toBe(E)
      expect(reconciledPeriodWindow(period, E, null, E).from).toBe(START[period])
      expect(view.from).toBe(START[period])
      // El encabezado lee la fecha del primer punto visible. En ese punto el
      // cambio desde el arranque es cero: es el origen de la ventana.
      expect(view.points[0].d).toBe(START[period])
      expect(view.points[0].d).toBe(view.from)
      expect(view.twr.anchor.d).toBe(view.points[0].d)
      expect(view.twr.anchor.v).toBeCloseTo(view.points[0].v, 6)
    }
  })

  it('el TWR de 1S encadena desde el 12 nov, no desde el conteo viejo de 7 días del reloj', () => {
    const view = buildReconciledView({ nav, flows: [], period: '1W', today: E, endValue })
    const pct = (chained(nav, '2026-11-12', E) - 1) * 100
    const old = (chained(nav, '2026-11-13', E) - 1) * 100
    expect(view.twr.pct).toBeCloseTo(pct, 6)
    expect(view.twr.pct).not.toBeCloseTo(old, 4)
  })

  it('6M es seis meses de calendario desde el mismo cierre', () => {
    expect(reconciledPeriodWindow('6M', E, null, E).from).toBe(START['6M'])
    const view = buildReconciledView({ nav, flows: [], period: '6M', today: E, endValue })
    expect(view.from).toBe('2026-05-19')
    expect(view.points[0].d).toBe(view.from)
  })
})

describe('de noche el reloj ya es el día siguiente y el último cierre sigue siendo el 19', () => {
  const nav = dailySeries({ from: '2025-11-01', to: E })
  const today = '2026-11-20'
  const endValue = nav[nav.length - 1].v * 1.01

  it('1S, 1M, 3M y 1A no se corren al 20; el tramo vivo sí llega hasta hoy', () => {
    expect(lastAvailableClose(nav, today)).toBe(E)
    for (const period of ['1W', '1M', '3M', '1Y']) {
      const view = buildReconciledView({ nav, flows: [], period, today, endValue })
      expect(view.endClose).toBe(E)
      expect(view.from).toBe(START[period])
      expect(view.points[0].d).toBe(START[period])
      expect(view.points[view.points.length - 1].d).toBe(today)
      // Lo que daba el reloj del 20 (7/30/90/365, o un mes calendario desde el 20).
      const wall = reconciledPeriodWindow(period, today, null, today).from
      expect(view.from).not.toBe(wall)
    }
  })

  it('el TWR de 1A incluye el tramo vivo y arranca el 18 nov 2025', () => {
    const view = buildReconciledView({ nav, flows: [], period: '1Y', today, endValue })
    const live = endValue / nav[nav.length - 1].v
    const pct = (chained(nav, '2025-11-18', E) * live - 1) * 100
    const fromWall = (chained(nav, '2025-11-19', E) * live - 1) * 100
    expect(view.twr.pct).toBeCloseTo(pct, 6)
    expect(view.twr.pct).not.toBeCloseTo(fromWall, 4)
  })

  it('HOY, MES, AÑO y TODO siguen el reloj, no el último cierre', () => {
    const day = buildReconciledView({ nav, flows: [], period: 'DAY', today, endValue })
    expect(day.from).toBe('2026-11-19')
    expect(day.points[0].d).toBe('2026-11-19')
    expect(day.points[0].d).not.toBe('2026-11-18')

    const mtd = buildReconciledView({ nav, flows: [], period: 'MTD', today, endValue })
    expect(mtd.from).toBe('2026-11-01')
    expect(mtd.pin).toBe('anchor')
    expect(mtd.points[0].d).toBe('2026-10-30')
    expect(mtd.from).not.toBe(START['1M'])

    const ytd = buildReconciledView({ nav, flows: [], period: 'YTD', today, endValue })
    expect(ytd.from).toBe('2026-01-01')
    expect(ytd.pin).toBe('anchor')
    expect(ytd.points[0].d).toBe('2025-12-31')

    const all = buildReconciledView({ nav, flows: [], period: 'ALL', today, endValue })
    expect(all.from).toBeNull()
    expect(all.points[0].d).toBe(nav[0].d)
    expect(all.points[all.points.length - 1].d).toBe(today)
  })
})

describe('un inicio en fin de semana o feriado ancla al cierre hábil anterior', () => {
  it('1M que cae en sábado arranca el viernes', () => {
    // E = 17 nov 2026 (martes). 1M = 17 oct, sábado. El viernes 16 está en la serie.
    const nav = dailySeries({ from: '2026-10-01', to: '2026-11-17' })
    const view = buildReconciledView({
      nav, flows: [], period: '1M', today: '2026-11-18', endValue: nav[nav.length - 1].v,
    })
    expect(reconciledPeriodWindow('1M', '2026-11-18', null, '2026-11-17').from).toBe('2026-10-17')
    expect(view.from).toBe('2026-10-16')
    expect(view.points[0].d).toBe('2026-10-16')
    expect(view.twr.anchor.d).toBe(view.points[0].d)
  })

  it('1M que cae en un viernes feriado arranca el jueves', () => {
    // E = 16 nov. 1M = 16 oct (viernes), ausente de la serie. El jueves 15 sí está.
    const nav = dailySeries({ from: '2026-10-01', to: '2026-11-16', skip: ['2026-10-16'] })
    const view = buildReconciledView({
      nav, flows: [], period: '1M', today: '2026-11-16', endValue: nav[nav.length - 1].v,
    })
    expect(reconciledPeriodWindow('1M', '2026-11-16', null, '2026-11-16').from).toBe('2026-10-16')
    expect(view.from).toBe('2026-10-15')
    expect(view.points[0].d).toBe('2026-10-15')
  })
})

describe('fin de mes: el día que no existe se recorta a febrero', () => {
  it('el 31 de marzo da el 28 o el 29, y un 1 de marzo bisiesto menos un año y un día cae el 29', () => {
    expect(reconciledPeriodWindow('1M', '2026-04-01', null, '2026-03-31').from).toBe('2026-02-28')
    expect(reconciledPeriodWindow('1M', '2024-04-01', null, '2024-03-31').from).toBe('2024-02-29')
    expect(reconciledPeriodWindow('1M', '2026-06-01', null, '2026-05-31').from).toBe('2026-04-30')
    // Primero el año, después un día: 1 mar 2025 → 1 mar 2024 → 29 feb 2024.
    // Al revés (primero el día) daría el 28 feb 2024.
    expect(reconciledPeriodWindow('1Y', '2025-03-01', null, '2025-03-01').from).toBe('2024-02-29')
    expect(reconciledPeriodWindow('1Y', '2024-02-29', null, '2024-02-29').from).toBe('2023-02-27')
  })

  it('una serie diaria con E = 31 mar 2024 arranca el 29 feb', () => {
    const nav = dailySeries({ from: '2024-01-02', to: '2024-03-29' })
    nav.push({ d: '2024-03-31', v: nav[nav.length - 1].v * 1.001, r: 0.1, f: 'd' })
    const view = buildReconciledView({
      nav, flows: [], period: '1M', today: '2024-04-01', endValue: nav[nav.length - 1].v,
    })
    expect(view.endClose).toBe('2024-03-31')
    expect(view.from).toBe('2024-02-29')
    expect(view.points[0].d).toBe('2024-02-29')
  })

  it('el 28 feb 2026 es sábado: el calendario da 28 y el cierre hábil anterior es el 27', () => {
    const nav = dailySeries({ from: '2026-02-02', to: '2026-03-31' })
    const view = buildReconciledView({
      nav, flows: [], period: '1M', today: '2026-04-01', endValue: nav[nav.length - 1].v,
    })
    expect(view.endClose).toBe('2026-03-31')
    expect(reconciledPeriodWindow('1M', '2026-04-01', null, view.endClose).from).toBe('2026-02-28')
    expect(view.from).toBe('2026-02-27')
    expect(view.points[0].d).toBe('2026-02-27')
  })
})

describe('23:51 en Guatemala (05:51Z del 20): el inicio que es día hábil no retrocede', () => {
  const wall = new Date('2026-11-20T05:51:00.000Z')
  const nav = dailySeries({ from: '2025-11-01', to: E })
  const endValue = nav[nav.length - 1].v * 1.01

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(wall)
  })
  afterEach(() => jest.useRealTimers())

  function todayLikeTheChart() {
    return new Date().toISOString().slice(0, 10)
  }

  function localDayOfNoon(iso) {
    const d = new Date(`${iso}T12:00:00Z`)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  it('el reloj UTC ya es 20 nov y el reloj local de Guatemala sigue en el 19', () => {
    expect(todayLikeTheChart()).toBe('2026-11-20')
    expect(wall.toISOString()).toBe('2026-11-20T05:51:00.000Z')
    if (new Date().getTimezoneOffset() === 0) expect(new Date().getDate()).toBe(20)
    else expect(new Date().getDate()).toBe(19)
  })

  it('1S, 1M, 3M y 1A anclan EN el cierre de esa fecha, en UTC y en Guatemala', () => {
    const today = todayLikeTheChart()
    for (const period of ['1W', '1M', '3M', '1Y']) {
      const view = buildReconciledView({ nav, flows: [], period, today, endValue })
      expect(view.endClose).toBe(E)
      expect(view.from).toBe(START[period])
      expect(view.points[0].d).toBe(START[period])
      // Mediodía UTC no cambia de día ni en UTC-6 ni en UTC.
      expect(localDayOfNoon(view.points[0].d)).toBe(START[period])
      const live = endValue / nav[nav.length - 1].v
      const pct = (chained(nav, START[period], E) * live - 1) * 100
      const prev = {
        '1W': '2026-11-11',
        '1M': '2026-10-16',
        '3M': '2026-08-18',
        '1Y': '2025-11-17',
      }[period]
      const early = (chained(nav, prev, E) * live - 1) * 100
      expect(view.twr.pct).toBeCloseTo(pct, 6)
      expect(view.twr.pct).not.toBeCloseTo(early, 4)
    }
  })

  it('un Date en medianoche UTC no se lee como el día anterior', () => {
    const dated = nav.map((p) => ({ ...p, d: new Date(`${p.d}T00:00:00Z`) }))
    const view = buildReconciledView({
      nav: dated, flows: [], period: '1M', today: todayLikeTheChart(), endValue,
    })
    expect(view.endClose).toBe(E)
    expect(view.from).toBe('2026-10-19')
    expect(view.points[0].d).toBe('2026-10-19')
    expect(localDayOfNoon(view.points[0].d)).toBe('2026-10-19')
  })

  it('el cierre del día de inicio manda aunque no traiga la marca diaria', () => {
    // El lunes 19 oct tiene NAV pero el retorno diario quedó en el viernes.
    // Antes el snap se iba al viernes 16. El cierre del 19 existe: se queda.
    const stripped = nav.map((p) => (p.d === '2026-10-19' ? { d: p.d, v: p.v, r: p.r } : p))
    const view = buildReconciledView({
      nav: stripped, flows: [], period: '1M', today: todayLikeTheChart(), endValue,
    })
    expect(view.from).toBe('2026-10-19')
    expect(view.points[0].d).toBe('2026-10-19')
    const live = endValue / nav[nav.length - 1].v
    const onMonday = (chained(nav, '2026-10-19', E) * live - 1) * 100
    const onFriday = (chained(nav, '2026-10-16', E) * live - 1) * 100
    expect(view.twr.pct).toBeCloseTo(onMonday, 5)
    expect(view.twr.pct).not.toBeCloseTo(onFriday, 4)
  })
})

describe('el encabezado y el primer punto leen el mismo inicio', () => {
  it('la gráfica conciliada no recorta otra vez por 7/30/90/365 y el "desde" es chartData[0]', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/if \(ledgerPoints\) return ledgerPoints/)
    expect(code).toMatch(/valueRebasedFrom \|\| chartData\[0\]\?\.ts/)
    expect(code).toMatch(/if \(i === 0\) return 0/)
    expect(code).toMatch(/T12:00:00Z/)
    expect(code).toMatch(/formatDate\(ledgerPack\.points\[0\]\.d\)/)
  })
})
