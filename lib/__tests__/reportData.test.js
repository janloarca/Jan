// FASE HT. El reporte consume la MISMA lógica que las tarjetas: estos tests
// fijan que los números que imprimen el PDF y el modal de imprimir salen de
// los helpers compartidos, no de una reimplementación que pueda divergir.
// El caso VITALI (3.94%) se recalcula aquí con las funciones reales, igual
// que en corporateBondWithEntryFee.test.js: si ese número cambia, la
// respuesta correcta NO es actualizar el test (ver lib/assetLogic/).

import { buildReportData, buildReportSeries, periodRange } from '../reportData'

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

describe('periodRange', () => {
  test('ventanas correctas para ago 2026', () => {
    expect(new Date(periodRange('month', NOW).startTs).getMonth()).toBe(7)
    expect(new Date(periodRange('quarter', NOW).startTs).getMonth()).toBe(6)
    expect(new Date(periodRange('ytd', NOW).startTs).getMonth()).toBe(0)
    expect(periodRange('all', NOW).startTs).toBeNull()
  })
})
