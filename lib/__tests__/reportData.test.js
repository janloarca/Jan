// FASE HT. El reporte consume la MISMA lógica que las tarjetas: estos tests
// fijan que los números que imprimen el PDF y el modal de imprimir salen de
// los helpers compartidos, no de una reimplementación que pueda divergir.
// El caso VITALI (3.94%) se recalcula aquí con las funciones reales, igual
// que en corporateBondWithEntryFee.test.js: si ese número cambia, la
// respuesta correcta NO es actualizar el test (ver lib/assetLogic/).

import { buildReportData, buildReportSeries, periodRange, regionLabel, maxDrawdown } from '../reportData'
import { attributeYtd, attributionRefusalText } from '../ytdAttribution'
import { augmentSnapshots } from '../../components/dashboard/utils'
import { preferFullPortfolioPerDay } from '../snapshotSelect'

const NOW = new Date('2026-08-11T12:00:00Z')

const identity = (v) => v
const convertGTQ = (v, from, to) => {
  if (from === to) return v
  if (from === 'GTQ' && to === 'USD') return v / 7.7
  if (from === 'USD' && to === 'GTQ') return v * 7.7
  return v
}

function vitaliPortfolio() {
  const bond = {
    id: 'vitali',
    name: 'VITALI',
    symbol: 'VITALI',
    type: 'Bond',
    institution: 'IDC',
    quantity: 1,
    purchasePrice: 6000,
    currentPrice: 6000,
    entryFee: 95.78,
    entryFeeMode: 'separate',
    currency: 'USD',
  }
  const coupon = {
    id: 'tx-coupon',
    type: 'DIVIDEND',
    date: '2026-05-15',
    totalAmount: 240,
    currency: 'USD',
    _linkedItemId: 'vitali',
  }
  return { items: [bond], transactions: [coupon] }
}

describe('reportData: la fórmula congelada por posición', () => {
  test('VITALI reporta 3.94%, nunca 0% ni 2.33%', () => {
    const { items, transactions } = vitaliPortfolio()
    const data = buildReportData({
      items, transactions, snapshots: [],
      netWorth: 6240, totalAssets: 6240,
      convert: identity, now: NOW,
    })
    const h = data.holdings.find((x) => x.id === 'vitali')
    expect(h).toBeTruthy()
    // ganancia = (6000 - 6000) + 240 = 240; % = 240 / 6095.78 = 3.94%
    expect(h.gain).toBeCloseTo(240, 6)
    expect(h.costBasis).toBeCloseTo(6095.78, 2)
    expect(h.retPct).toBeCloseTo(3.9371, 3)
  })

  test('un cupón reinvertido no entra a la ganancia realizada', () => {
    const { items, transactions } = vitaliPortfolio()
    transactions[0]._reinvested = true
    const data = buildReportData({
      items, transactions, snapshots: [],
      netWorth: 6240, totalAssets: 6240,
      convert: identity, now: NOW,
    })
    expect(data.holdings[0].gain).toBeCloseTo(0, 6)
  })
})

describe('reportData: serie resuelta por día', () => {
  test('un NAV solo-broker no compite contra la observación completa del mismo día', () => {
    const snaps = [
      { date: '2026-08-01', netWorthUSD: 23000, _source: 'daily' },
      { date: '2026-08-01', netWorthUSD: 10000, _source: 'ibkr' },
      { date: '2026-08-02', netWorthUSD: 10050, _source: 'ibkr' },
    ]
    const series = buildReportSeries(snaps, { convert: identity })
    expect(series).toHaveLength(2)
    expect(series[0].value).toBe(23000)
    // Un día donde el ÚNICO doc es NAV de broker se conserva (el caller pasa
    // los snapshots ya aumentados, donde ese día ya incluye lo manual).
    expect(series[1].value).toBe(10050)
  })

  test('anclas de calibración y docs por cuenta quedan fuera', () => {
    const snaps = [
      { date: '2026-07-01', netWorthUSD: 20000, _source: 'daily' },
      { date: '2026-07-02', netWorthUSD: 999, _calibrated: true },
      { date: '2026-07-03', netWorthUSD: 500, _account: 'idc' },
    ]
    const series = buildReportSeries(snaps, { convert: identity })
    expect(series).toHaveLength(1)
    expect(series[0].value).toBe(20000)
  })

  test('convierte de USD a la moneda base', () => {
    const snaps = [{ date: '2026-08-01', netWorthUSD: 770, _source: 'daily' }]
    const series = buildReportSeries(snaps, { convert: convertGTQ, baseCurrency: 'GTQ' })
    expect(series[0].value).toBeCloseTo(770 * 7.7, 6)
  })
})

describe('reportData: retorno del período (mes/trimestre)', () => {
  const monthSnaps = [
    { date: '2026-07-31', netWorthUSD: 10000, _source: 'daily' },
    { date: '2026-08-05', netWorthUSD: 10400, _source: 'daily' },
  ]

  test('un depósito dentro del mes NO se lee como ganancia', () => {
    const deposit = { id: 'd1', type: 'DEPOSIT', date: '2026-08-05', totalAmount: 300, currency: 'USD' }
    const data = buildReportData({
      items: [], transactions: [deposit], snapshots: monthSnaps,
      netWorth: 10500, totalAssets: 10500,
      convert: identity, period: 'month', now: NOW,
    })
    expect(data.kpis.periodReturn).toBeTruthy()
    // ganancia = 10500 - 10000 - 300 = 200, no 500
    expect(data.kpis.periodReturn.abs).toBeCloseTo(200, 6)
    expect(data.kpis.periodReturn.pct).toBeLessThan(3)
    expect(data.kpis.periodReturn.pct).toBeGreaterThan(1.5)
  })

  test('un flujo fechado EXACTO en el ancla no se resta doble (lección FASE DV)', () => {
    const deposit = { id: 'd2', type: 'DEPOSIT', date: '2026-07-31', totalAmount: 5000, currency: 'USD' }
    const data = buildReportData({
      items: [], transactions: [deposit], snapshots: monthSnaps,
      netWorth: 10100, totalAssets: 10100,
      convert: identity, period: 'month', now: NOW,
    })
    // El depósito del 31 jul ya vive dentro del ancla de 10000: la ganancia
    // del mes es 100, no 100 - 5000.
    expect(data.kpis.periodReturn.abs).toBeCloseTo(100, 6)
  })

  test('sin ancla cercana al arranque no se inventa un retorno', () => {
    const farSnaps = [{ date: '2026-05-01', netWorthUSD: 9000, _source: 'daily' }]
    const data = buildReportData({
      items: [], transactions: [], snapshots: farSnaps,
      netWorth: 10500, totalAssets: 10500,
      convert: identity, period: 'month', now: NOW,
    })
    expect(data.kpis.periodReturn).toBeNull()
  })

  test('periodStartTs mueve la ventana al mes que acaba de cerrar (correo mensual, FASE IE)', () => {
    // Enviado el 1 de septiembre: periodRange('month') anclaría en sep (ventana
    // de cero horas); el override ancla en el 1 de agosto y el Dietz cubre
    // agosto completo, neteando el depósito de mitad de mes.
    const sep1 = new Date('2026-09-01T22:00:00Z')
    const deposit = { id: 'd3', type: 'DEPOSIT', date: '2026-08-10', totalAmount: 300, currency: 'USD' }
    const data = buildReportData({
      items: [], transactions: [deposit], snapshots: monthSnaps,
      netWorth: 10800, totalAssets: 10800,
      convert: identity, period: 'month',
      periodStartTs: Date.UTC(2026, 7, 1), now: sep1,
    })
    // ganancia de agosto = 10800 - 10000 (ancla 31 jul) - 300 = 500
    expect(data.kpis.periodReturn.abs).toBeCloseTo(500, 6)
  })

  test('el período YTD usa el número del encabezado tal cual, jamás lo recalcula', () => {
    const data = buildReportData({
      items: [], transactions: [], snapshots: monthSnaps,
      netWorth: 10500, totalAssets: 10500,
      returnYTD: 7.39, ytdChange: 700.27,
      convert: identity, period: 'ytd', now: NOW,
    })
    expect(data.kpis.periodReturn.pct).toBe(7.39)
    expect(data.kpis.periodReturn.abs).toBe(700.27)
    expect(data.kpis.periodReturn.source).toBe('header')
  })
})

describe('reportData: flujos e ingresos del período', () => {
  test('suma depósitos/retiros convertidos a base y separa ingresos cobrados', () => {
    const txs = [
      { type: 'DEPOSIT', date: '2026-08-03', totalAmount: 1000, currency: 'GTQ' },
      { type: 'WITHDRAWAL', date: '2026-08-04', totalAmount: 500, currency: 'GTQ' },
      { type: 'DIVIDEND', date: '2026-08-05', totalAmount: 240, currency: 'USD' },
      // fuera de la ventana del mes:
      { type: 'DEPOSIT', date: '2026-07-10', totalAmount: 9999, currency: 'USD' },
      // reinvertido: no es ingreso cobrado
      { type: 'DIVIDEND', date: '2026-08-06', totalAmount: 50, currency: 'USD', _reinvested: true },
    ]
    const data = buildReportData({
      items: [], transactions: txs, snapshots: [],
      netWorth: 0, totalAssets: 0,
      convert: convertGTQ, baseCurrency: 'USD', period: 'month', now: NOW,
    })
    expect(data.flows.deposits).toBeCloseTo(1000 / 7.7, 4)
    expect(data.flows.withdrawals).toBeCloseTo(500 / 7.7, 4)
    expect(data.flows.net).toBeCloseTo(500 / 7.7, 4)
    expect(data.flows.incomeCollected).toBeCloseTo(240, 6)
    expect(data.flows.incomeCount).toBe(1)
    expect(data.flows.depositCount).toBe(1)
  })
})

describe('reportData: agrupaciones', () => {
  const items = [
    { id: 'a', name: 'AAPL', symbol: 'AAPL', type: 'Stock', institution: 'Interactive Brokers', _source: 'ibkr', quantity: 10, currentPrice: 100, purchasePrice: 90, currency: 'USD', _originalCurrency: 'USD' },
    { id: 'b', name: 'Fondo', type: 'Bank', institution: 'Banco Industrial', quantity: 1, purchasePrice: 770, currency: 'GTQ', _originalCurrency: 'GTQ' },
    { id: 'c', name: 'Tarjeta', type: 'Debt', institution: 'Banco Industrial', isDebt: true, quantity: 1, purchasePrice: 200, interestRate: 30 },
  ]

  test('exposición por moneda usa la denominación ORIGINAL', () => {
    const data = buildReportData({
      items, transactions: [], snapshots: [],
      netWorth: 1570, totalAssets: 1770,
      convert: identity, now: NOW,
    })
    const gtq = data.currencies.find((c) => c.key === 'GTQ')
    expect(gtq).toBeTruthy()
    expect(gtq.value).toBeCloseTo(770, 6)
  })

  test('instituciones: valor propio, y ganancia/retorno YTD solo del motor de atribución', () => {
    const breakdown = {
      groups: [
        { key: 'ibkr', name: 'Interactive Brokers', gain: 700.27, ret: 7.39 },
        { key: '__unexplained__', name: null, isUnexplained: true, gain: -12, ret: null },
      ],
    }
    const data = buildReportData({
      items, transactions: [], snapshots: [],
      netWorth: 1570, totalAssets: 1770, ytdBreakdown: breakdown,
      convert: identity, now: NOW,
    })
    const ibkr = data.institutions.find((i) => i.key === 'ibkr')
    expect(ibkr.ytdGain).toBeCloseTo(700.27, 2)
    expect(ibkr.ytdRetPct).toBeCloseTo(7.39, 2)
    const bi = data.institutions.find((i) => i.key === 'banco industrial')
    // Sin fila del motor de atribución: sin retorno inventado.
    expect(bi.ytdGain).toBeNull()
    // La deuda resta en el valor de su institución (770 - 200).
    expect(bi.value).toBeCloseTo(570, 6)
    expect(data.ytdUnexplained.gain).toBeCloseTo(-12, 6)
  })

  test('deudas: total y filas', () => {
    const data = buildReportData({
      items, transactions: [], snapshots: [],
      netWorth: 1570, totalAssets: 1770,
      convert: identity, now: NOW,
    })
    expect(data.kpis.debtTotal).toBeCloseTo(200, 6)
    expect(data.debts[0].ratePct).toBe(30)
  })
})

describe('reportData: geografía y etiquetas de región', () => {
  test("'GLOBAL' y 'Global' se mergean en una sola fila (caso real del usuario)", () => {
    const items = [
      { id: 'a', name: 'L', type: 'Stock', institution: 'X', quantity: 1, currentPrice: 1000, assetCountry: 'GLOBAL' },
      { id: 'b', name: 'O', type: 'Stock', institution: 'Y', quantity: 1, currentPrice: 100, assetCountry: 'Global' },
    ]
    const data = buildReportData({
      items, transactions: [], snapshots: [],
      netWorth: 1100, totalAssets: 1100, convert: identity, now: NOW,
    })
    const globals = data.geography.filter((r) => r.key.toUpperCase() === 'GLOBAL')
    expect(globals).toHaveLength(1)
    expect(globals[0].value).toBeCloseTo(1100, 6)
  })

  test('regionLabel: ISO2 a nombre, buckets normalizados, resto pasa tal cual', () => {
    expect(regionLabel('GT', 'es-GT', 'Otros')).toBe('Guatemala')
    expect(regionLabel('US', 'en-US', 'Other')).toBe('United States')
    expect(regionLabel('Unknown', 'es-GT', 'Otros')).toBe('Otros')
    expect(regionLabel('GLOBAL', 'es-GT', 'Otros')).toBe('Global')
    expect(regionLabel('Denmark', 'es-GT', 'Otros')).toBe('Denmark')
  })
})

describe('reportData: tabla de rendimiento por horizonte', () => {
  const snaps = [
    { date: '2026-05-11', netWorthUSD: 10000, _source: 'daily' },
    { date: '2026-07-11', netWorthUSD: 10200, _source: 'daily' },
    { date: '2026-08-01', netWorthUSD: 10400, _source: 'daily' },
  ]

  test('1M y 3M son Dietz anclado; YTD y desde-inicio llegan del hook tal cual', () => {
    const data = buildReportData({
      items: [], transactions: [], snapshots: snaps,
      netWorth: 10500, totalAssets: 10500,
      returnYTD: 7.39, ytdChange: 700, returnSinceStart: 22.5, sinceStartDate: '2024-03-01',
      convert: identity, now: NOW,
    })
    const byKey = Object.fromEntries(data.performance.map((p) => [p.key, p]))
    // 3M: ancla 2026-05-11 exacta (10000) → (10500-10000)/10000 = 5%
    expect(byKey['3m'].pct).toBeCloseTo(5, 1)
    // 1M: arranque nominal 11 jul, ancla exacta ese día (10200)
    expect(byKey['1m'].pct).toBeCloseTo((10500 - 10200) / 10200 * 100, 1)
    expect(byKey.ytd.pct).toBe(7.39)
    expect(byKey.all.pct).toBe(22.5)
    // 12 meses: no hay ancla hace un año → null honesto
    expect(byKey['1y'].pct).toBeNull()
  })

  test('riesgo: máxima caída del período y fees de entrada', () => {
    const ddSnaps = [
      { date: '2026-02-01', netWorthUSD: 10000, _source: 'daily' },
      { date: '2026-03-01', netWorthUSD: 12000, _source: 'daily' },
      { date: '2026-04-01', netWorthUSD: 9000, _source: 'daily' },
      { date: '2026-05-01', netWorthUSD: 11000, _source: 'daily' },
    ]
    const items = [
      { id: 'v', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, entryFee: 95.78, acquisitionDate: '2026-01-06' },
      { id: 'x', name: 'XOCHI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 1900, currentPrice: 1900, entryFee: 66.26, acquisitionDate: '2025-06-01' },
    ]
    const data = buildReportData({
      items, transactions: [], snapshots: ddSnaps,
      netWorth: 9900, totalAssets: 9900,
      volatilityPct: 8.4, convert: identity, period: 'ytd', now: NOW,
    })
    expect(data.risk.maxDrawdown.pct).toBeCloseTo(-25, 1)
    expect(data.risk.volatilityPct).toBe(8.4)
    // VITALI se compró DENTRO del año (período ytd); XOCHI antes.
    expect(data.fees.periodEntryFees).toBeCloseTo(95.78, 2)
    expect(data.fees.totalEntryFees).toBeCloseTo(162.04, 2)
  })

  test('maxDrawdown: serie monótona no inventa caída', () => {
    expect(maxDrawdown([{ ts: 1, value: 10 }, { ts: 2, value: 11 }, { ts: 3, value: 12 }])).toBeNull()
  })

  test('3 años anualizado solo aparece cuando el archivo alcanza (y con la matemática geométrica)', () => {
    const longSnaps = [
      { date: '2023-08-05', netWorthUSD: 8000, _source: 'daily' },
      { date: '2025-08-05', netWorthUSD: 9000, _source: 'daily' },
      { date: '2026-08-08', netWorthUSD: 10500, _source: 'daily' },
    ]
    const data = buildReportData({
      items: [], transactions: [], snapshots: longSnaps,
      netWorth: 10648, totalAssets: 10648, convert: identity, now: NOW,
    })
    const y3 = data.performance.find((p) => p.key === '3y')
    expect(y3).toBeTruthy()
    // ventana: 8000 → 10648 en 3 años = +33.1% total → ~10% anualizado
    expect(y3.pct).toBeCloseTo((Math.pow(10648 / 8000, 1 / 3) - 1) * 100, 1)
    expect(y3.annualized).toBe(true)
    // 5 años: sin ancla → la fila NO existe (decisión: solo datos que estén)
    expect(data.performance.find((p) => p.key === '5y')).toBeUndefined()
  })

  test('años calendario: cada año con ambas anclas; el actual usa el YTD del hook; sin datos no aparece', () => {
    const snaps = [
      { date: '2024-12-31', netWorthUSD: 10000, _source: 'daily' },
      { date: '2025-12-30', netWorthUSD: 11000, _source: 'daily' },
      { date: '2026-08-08', netWorthUSD: 11500, _source: 'daily' },
    ]
    const deposit = { type: 'DEPOSIT', date: '2025-06-01', totalAmount: 500, currency: 'USD' }
    const data = buildReportData({
      items: [], transactions: [deposit], snapshots: snaps,
      netWorth: 11600, totalAssets: 11600,
      returnYTD: 1.54, ytdChange: 326.65,
      convert: identity, now: NOW,
    })
    const y2025 = data.calendarYears.find((c) => c.year === 2025)
    expect(y2025).toBeTruthy()
    // 11000 - 10000 - 500 = 500 de ganancia real (el depósito no cuenta)
    expect(y2025.abs).toBeCloseTo(500, 6)
    const y2026 = data.calendarYears.find((c) => c.year === 2026)
    expect(y2026.pct).toBe(1.54)
    expect(y2026.partial).toBe(true)
    // 2024 no tiene ancla de ARRANQUE (la serie empieza el 31 dic): fuera
    expect(data.calendarYears.find((c) => c.year === 2024)).toBeUndefined()
  })

  test('años calendario: el año en curso cae al Dietz del servidor cuando el hook no manda YTD', () => {
    // Mismo fixture que el test de arriba pero SIN returnYTD/ytdChange: el
    // camino del SERVIDOR (correos, link compartido), donde el dashboard no
    // corre. Antes de FASE KP el año en curso simplemente desaparecía de la
    // barra de años en ese camino.
    const snaps = [
      { date: '2024-12-31', netWorthUSD: 10000, _source: 'daily' },
      { date: '2025-12-30', netWorthUSD: 11000, _source: 'daily' },
      { date: '2026-08-08', netWorthUSD: 11500, _source: 'daily' },
    ]
    const deposit = { type: 'DEPOSIT', date: '2025-06-01', totalAmount: 500, currency: 'USD' }
    const data = buildReportData({
      items: [], transactions: [deposit], snapshots: snaps,
      netWorth: 11600, totalAssets: 11600,
      convert: identity, now: NOW,
    })
    const y2026 = data.calendarYears.find((c) => c.year === 2026)
    expect(y2026).toBeTruthy()
    expect(y2026.partial).toBe(true)
    // Ancla 2025-12-30 en 11000 (cae dentro de la ventana de 10 días antes
    // del 1-ene); el depósito de jun-2025 queda FUERA de la ventana:
    // ganancia 11600 - 11000 = 600.
    expect(y2026.abs).toBeCloseTo(600, 6)
    expect(y2026.pct).toBeCloseTo((600 / 11000) * 100, 4)
    // Y es LA MISMA cifra que la fila YTD de la tabla de rendimiento (ambas
    // salen del mismo ytdFallback): la barra de años y la tabla no pueden
    // decir cosas distintas en el mismo documento.
    const ytdRow = data.performance.find((p) => p.key === 'ytd')
    expect(y2026.pct).toBe(ytdRow.pct)
  })

  test('años calendario: sin ancla de arranque el año en curso se sigue omitiendo', () => {
    // La serie nace en marzo: no hay punto a <=10 días antes ni <=7 después
    // del 1-ene, el Dietz no tiene contra qué medir, y la respuesta honesta
    // sigue siendo la ausencia, nunca un número inventado.
    const snaps = [
      { date: '2026-03-01', netWorthUSD: 9000, _source: 'daily' },
      { date: '2026-08-08', netWorthUSD: 9500, _source: 'daily' },
    ]
    const data = buildReportData({
      items: [], transactions: [], snapshots: snaps,
      netWorth: 9600, totalAssets: 9600, convert: identity, now: NOW,
    })
    expect(data.calendarYears.find((c) => c.year === 2026)).toBeUndefined()
  })

  test('exposición por sector agrupa con la regla compartida', () => {
    const items = [
      { id: 'a', name: 'APPLE INC', symbol: 'AAPL', type: 'Stock', sector: 'Technology', institution: 'X', quantity: 1, currentPrice: 500 },
      { id: 'b', name: 'UNH', symbol: 'UNH', type: 'Stock', sector: 'Healthcare', institution: 'X', quantity: 1, currentPrice: 300 },
    ]
    const data = buildReportData({
      items, transactions: [], snapshots: [],
      netWorth: 800, totalAssets: 800, convert: identity, now: NOW,
    })
    const tech = data.sectors.find((s) => s.key === 'Technology')
    expect(tech.value).toBeCloseTo(500, 6)
    expect(tech.pct).toBeCloseTo(62.5, 3)
  })

  test('sharpe y beta pasan al bloque de riesgo sin recalcularse', () => {
    const data = buildReportData({
      items: [], transactions: [], snapshots: [],
      netWorth: 0, totalAssets: 0,
      sharpe: 1.23, beta: 0.85, convert: identity, now: NOW,
    })
    expect(data.risk.sharpe).toBe(1.23)
    expect(data.risk.beta).toBe(0.85)
  })
})

describe('atribución: el rechazo ahora dice por qué', () => {
  test('cada refusal escribe su razón en diag sin cambiar el resultado', () => {
    const d1 = {}
    expect(attributeYtd({ accounts: [], portfolioStart: 100, headlineGain: 10 }, d1)).toBeNull()
    expect(d1.reason).toBe('no-accounts')

    const d2 = {}
    expect(attributeYtd({
      accounts: [{ key: 'a', name: 'A', endVal: 100, flow: 0, start: -5, flowBase: 0 }],
      portfolioStart: 100, headlineGain: 10,
    }, d2)).toBeNull()
    expect(d2.reason).toBe('negative-start')
    expect(d2.detail.name).toBe('A')

    const d3 = {}
    expect(attributeYtd({
      accounts: [{ key: 'a', name: 'A', endVal: 100, flow: 0, start: 50, flowBase: 0 }],
      portfolioStart: 100, headlineGain: 500,
    }, d3)).toBeNull()
    expect(d3.reason).toBe('unexplained-too-large')

    // Sin diag: mismo comportamiento de siempre (null pelado, sin throw).
    expect(attributeYtd({ accounts: [], portfolioStart: 100, headlineGain: 10 })).toBeNull()
  })

  test('attributionRefusalText: texto humano en ambos idiomas y fallback', () => {
    expect(attributionRefusalText('unexplained-too-large', 'es')).toMatch(/no cuadran/)
    expect(attributionRefusalText('negative-start', 'en')).toMatch(/negative/)
    expect(attributionRefusalText('algo-desconocido', 'es')).toMatch(/validaciones/)
  })
})

describe('periodRange', () => {
  test('ventanas correctas para ago 2026', () => {
    expect(new Date(periodRange('month', NOW).startTs).getMonth()).toBe(7)
    expect(new Date(periodRange('quarter', NOW).startTs).getMonth()).toBe(6)
    expect(new Date(periodRange('ytd', NOW).startTs).getMonth()).toBe(0)
    expect(periodRange('all', NOW).startTs).toBeNull()
  })
})

// FASE HZ3. La primera prueba real del correo imprimió "máxima caída del
// período -62.9%" sobre una semana que se movió 0.44%, con un piso de $9,900
// en la gráfica. Causa: el cron pasaba los snapshots CRUDOS, y un día cuyo
// único doc es NAV solo-broker mide UNA cuenta (~$9.9K), no el portafolio
// (~$27K). El dashboard nunca lo sufre porque siempre pasa los aumentados.
describe('un día solo-broker sin aumentar envenena la serie', () => {
  const items = [
    { id: 'ib', symbol: 'AAPL', type: 'Stock', institution: 'Interactive Brokers', _source: 'ibkr', quantity: 55, currentPrice: 180, currency: 'USD', acquisitionDate: '2024-01-01' },
    { id: 'bond', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 17000, currentPrice: 17000, currency: 'USD', acquisitionDate: '2024-01-01' },
  ]
  const snaps = [
    { date: '2026-08-07', netWorthUSD: 26646, _source: 'daily' },
    { date: '2026-08-10', netWorthUSD: 9900, _source: 'ibkr' }, // solo el broker
    { date: '2026-08-13', netWorthUSD: 27228, _source: 'daily' },
  ]

  test('crudos: inventa una caída del 60% que nunca ocurrió', () => {
    const data = buildReportData({
      items, transactions: [], snapshots: snaps,
      netWorth: 27228, totalAssets: 27228, convert: identity, period: 'week',
      now: new Date('2026-08-13T12:00:00Z'),
    })
    expect(data.risk.maxDrawdown.pct).toBeLessThan(-50)
  })

  test('aumentados: el día solo-broker se completa y la caída desaparece', () => {
    const augmented = augmentSnapshots(preferFullPortfolioPerDay(snaps), items, identity)
    const data = buildReportData({
      items, transactions: [], snapshots: augmented,
      netWorth: 27228, totalAssets: 27228, convert: identity, period: 'week',
      now: new Date('2026-08-13T12:00:00Z'),
    })
    // Con los activos manuales sumados encima, ese día ya no es un pozo.
    expect(data.risk.maxDrawdown == null || data.risk.maxDrawdown.pct > -20).toBe(true)
  })
})
