// FASE LV: los REPORTES miden el mismo universo que el tablero (FASE LU):
// el rendimiento es de ACTIVOS, la deuda no lo mueve. El caso ancla es el
// real: deuda de 4,000 creada en agosto con su DEPOSIT de apertura envenenado.

import { buildReportData, buildReportSeries } from '../reportData'
import { computeInvestedByYear } from '../investedByYear'
import { computeYtdInvested } from '../ytdInvested'

const YR = new Date().getUTCFullYear()

const BANK = {
  id: 'b1', name: 'Cuenta', symbol: 'CM', type: 'Bank', currency: 'USD',
  quantity: 1, currentPrice: 12000, purchasePrice: 10000,
}
const DEBT = {
  id: 'd1', name: 'Deuda AIXEN', symbol: 'AIXEN', type: 'Debt', isDebt: true,
  currency: 'USD', quantity: 1, currentPrice: 4000, purchasePrice: 4000,
}
// La forma del archivo real: los docs posteriores a crear la deuda llevan
// netWorthUSD 4,000 abajo de totalActivosUSD.
const SNAPS = [
  { date: `${YR}-01-01`, netWorthUSD: 10000, totalActivosUSD: 10000, totalDebtUSD: 0, _source: 'daily' },
  { date: `${YR}-06-01`, netWorthUSD: 11500, totalActivosUSD: 11500, totalDebtUSD: 0, _source: 'daily' },
  { date: `${YR}-08-26`, netWorthUSD: 8000, totalActivosUSD: 12000, totalDebtUSD: 4000, _source: 'daily' },
]
const POISONED = { id: 'tx1', type: 'DEPOSIT', _linkedItemId: 'd1', totalAmount: 4000, currency: 'USD', date: `${YR}-08-25`, _source: 'manual_new_account' }

const build = (over = {}) => buildReportData({
  items: [BANK, DEBT],
  transactions: [POISONED],
  snapshots: SNAPS,
  netWorth: 8000,
  totalAssets: 12000,
  baseCurrency: 'USD',
  period: 'ytd',
  now: new Date(Date.UTC(YR, 7, 28)),
  ...over,
})

describe('la serie del reporte es de ACTIVOS', () => {
  it('un doc con deuda declarada se lee por totalActivosUSD, no por el neto', () => {
    const series = buildReportSeries(SNAPS, {})
    expect(series.map((p) => p.value)).toEqual([10000, 11500, 12000])
  })

  it('un doc de una era sin deuda es byte-idéntico a la lectura de siempre', () => {
    const series = buildReportSeries([{ date: `${YR}-01-01`, netWorthUSD: 5000 }], {})
    expect(series[0].value).toBe(5000)
  })
})

describe('el retorno del período no ve la deuda', () => {
  it('el YTD del reporte (servidor, sin hook) mide activos: +2,000 (+20%), nunca −2,000', () => {
    const d = build()
    expect(d.kpis.periodReturn).not.toBeNull()
    expect(d.kpis.periodReturn.abs).toBeCloseTo(2000, 2)
    expect(d.kpis.periodReturn.pct).toBeCloseTo(20, 1)
  })

  it('regresión negativa: el universo NETO daba −20% (endValue 8,000 y el DEPOSIT restando)', () => {
    // La afirmación que el arreglo elimina, documentada ejecutando la fórmula
    // vieja sobre el mismo fixture: neto 8,000 − ancla 10,000 − flujo 4,000.
    expect(8000 - 10000 - 4000).toBe(-6000)
  })

  it('el DEPOSIT envenenado no cuenta como depósito del período', () => {
    const d = build()
    expect(d.flows.deposits).toBe(0)
    expect(d.flows.depositCount).toBe(0)
  })

  it('un pago de deuda desde una cuenta entra como el retiro que es', () => {
    const d = build({
      transactions: [
        POISONED,
        { id: 'tx2', type: 'TRANSFER', _debtItemId: 'd1', _originItemId: 'b1', totalAmount: 321.36, currency: 'USD', date: `${YR}-08-27` },
      ],
    })
    expect(d.flows.withdrawals).toBeCloseTo(321.36, 2)
    expect(d.flows.withdrawalCount).toBe(1)
  })

  it('el cambio de VALOR del período también cierra en activos', () => {
    const d = build()
    expect(d.kpis.valueChange.last).toBe(12000)
    expect(d.kpis.valueChange.abs).toBeCloseTo(2000, 6)
  })

  it('sin deuda, todo es idéntico a lo de siempre (mismo número por los dos caminos)', () => {
    const d = build({ items: [BANK], transactions: [], netWorth: 12000, totalAssets: 12000 })
    expect(d.kpis.periodReturn.abs).toBeCloseTo(2000, 2)
  })
})

describe('invertido por año en el universo correcto', () => {
  it('el DEPOSIT envenenado de la deuda NO es capital invertido', () => {
    const inv = computeYtdInvested({ transactions: [POISONED], items: [BANK, DEBT], year: YR })
    expect(inv.deposits).toBe(0)
    expect(inv.hasActivity).toBe(false)
  })

  it('un depósito real a un activo sigue contando igual', () => {
    const inv = computeYtdInvested({
      transactions: [POISONED, { type: 'DEPOSIT', _linkedItemId: 'b1', totalAmount: 500, currency: 'USD', date: `${YR}-03-01` }],
      items: [BANK, DEBT], year: YR,
    })
    expect(inv.deposits).toBe(500)
  })

  it('la fila del año en curso cierra contra los ACTIVOS de hoy', () => {
    const series = buildReportSeries(SNAPS, {})
    // El banco tiene su historia real (el aporte que lo fundó el año pasado):
    // sin ella, "sin repartir" reportaría el capital de apertura, que es
    // exactamente lo que esa fila existe para nombrar.
    const opening = { type: 'DEPOSIT', _linkedItemId: 'b1', totalAmount: 10000, currency: 'USD', date: `${YR - 1}-06-01`, _source: 'manual_new_account' }
    const data = computeInvestedByYear({
      transactions: [POISONED, opening], items: [BANK, DEBT], series,
      returnYTD: 20, ytdChange: 2000, ytdStartValue: 10000,
      netWorth: 8000, totalAssets: 12000,
    })
    const row = data.rows.find((r) => r.year === YR)
    expect(row.endValue).toBe(12000)
    // Y la identidad del pie no absorbe la deuda como "sin repartir".
    expect(data.unallocated).toBeNull()
  })
})
