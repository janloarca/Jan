// FASE LU: el universo del rendimiento son los ACTIVOS (decisión del usuario:
// "la deuda tampoco debería de afectar el YTD"). El caso ancla es el real:
// deuda de 4,000 creada en agosto, con su DEPOSIT de apertura envenenado.

import { snapshotAssetsUSD, debtItemIds, assetOnlyFlows } from '../assetReturns'
import { computeModifiedDietz } from '../../components/dashboard/utils'

const DEBT = { id: 'd1', isDebt: true, name: 'Deuda AIXEN' }
const BANK = { id: 'b1', name: 'Cuenta Monetaria' }
const debtIds = debtItemIds([DEBT, BANK])

describe('snapshotAssetsUSD', () => {
  it('prefiere totalActivosUSD cuando el doc declara totalDebtUSD', () => {
    expect(snapshotAssetsUSD({ netWorthUSD: 24815, totalActivosUSD: 28815, totalDebtUSD: 4000 })).toBe(28815)
  })

  it('sin totalActivosUSD reconstruye: neto + |deuda|', () => {
    expect(snapshotAssetsUSD({ netWorthUSD: 24815, totalDebtUSD: 4000 })).toBe(28815)
  })

  it('⛔ un doc SIN totalDebtUSD (NAV de broker, docs viejos) lee netWorthUSD: su totalActivosUSD no es confiable (FASE FX)', () => {
    // El parser del Flex guarda totalActivosUSD = totalLong + cash, que puede
    // duplicar el efectivo. netWorthUSD es la lectura de siempre.
    expect(snapshotAssetsUSD({ netWorthUSD: 10000, totalActivosUSD: 10600, _source: 'ibkr' })).toBe(10000)
  })

  it('doc de una era sin deuda: mismo número por cualquier camino', () => {
    expect(snapshotAssetsUSD({ netWorthUSD: 11856.08, totalActivosUSD: 11856.08, totalDebtUSD: 0 })).toBe(11856.08)
    expect(snapshotAssetsUSD({ netWorthUSD: 11856.08 })).toBe(11856.08)
    expect(snapshotAssetsUSD({ totalActivosUSD: 11856.08 })).toBe(11856.08)
  })

  it('nulo o vacío es 0, nunca NaN', () => {
    expect(snapshotAssetsUSD(null)).toBe(0)
    expect(snapshotAssetsUSD({})).toBe(0)
    expect(snapshotAssetsUSD({ netWorthUSD: 'basura', totalDebtUSD: 100 })).toBe(0)
  })
})

describe('assetOnlyFlows', () => {
  it('sin deudas devuelve la MISMA lista (identidad intacta: nada aguas abajo se invalida)', () => {
    const txs = [{ type: 'DEPOSIT', _linkedItemId: 'b1', totalAmount: 100 }]
    expect(assetOnlyFlows(txs, new Set())).toBe(txs)
    expect(assetOnlyFlows(txs, debtItemIds([BANK]))).toBe(txs)
  })

  it('el DEPOSIT de apertura envenenado de una deuda vieja se DESCARTA (sana sin borrar la deuda)', () => {
    const poisoned = { type: 'DEPOSIT', _linkedItemId: 'd1', totalAmount: 4000, _source: 'manual_new_account' }
    const real = { type: 'DEPOSIT', _linkedItemId: 'b1', totalAmount: 500 }
    const out = assetOnlyFlows([poisoned, real], debtIds)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(real) // el resto pasa con su misma referencia
  })

  it('el WITHDRAWAL de manual_loan_proceeds (fuera de la app) tampoco entra: ningún activo se movió', () => {
    const w = { type: 'WITHDRAWAL', _linkedItemId: 'd1', _loanItemId: 'd1', totalAmount: 4000, _source: 'manual_loan_proceeds' }
    expect(assetOnlyFlows([w], debtIds)).toHaveLength(0)
  })

  it('pago de deuda desde una cuenta: WITHDRAWAL sintético vinculado a la cuenta que pagó', () => {
    const pay = { type: 'TRANSFER', _debtItemId: 'd1', _originItemId: 'b1', totalAmount: 321.36, currency: 'USD', date: '2026-08-27' }
    const out = assetOnlyFlows([pay], debtIds)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('WITHDRAWAL')
    expect(out[0]._linkedItemId).toBe('b1')
    expect(out[0].totalAmount).toBe(321.36)
    expect(out[0].date).toBe('2026-08-27')
    expect(out[0]._assetFlowSynth).toBe(true)
  })

  it('pago desde la Hoja (sin origen): se descarta entero, ningún activo se movió', () => {
    const pay = { type: 'TRANSFER', _debtItemId: 'd1', totalAmount: 321.36, _source: 'manual_debt_payment' }
    expect(assetOnlyFlows([pay], debtIds)).toHaveLength(0)
  })

  it('desembolso de un préstamo a una cuenta: DEPOSIT sintético en la que lo recibió', () => {
    const proceeds = { type: 'TRANSFER', _loanItemId: 'd1', _linkedItemId: 'b1', totalAmount: 4000, currency: 'USD', date: '2026-08-25', _source: 'manual_loan_proceeds' }
    const out = assetOnlyFlows([proceeds], debtIds)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('DEPOSIT')
    expect(out[0]._linkedItemId).toBe('b1')
    expect(out[0].totalAmount).toBe(4000)
    expect(out[0]._assetFlowSynth).toBe(true)
  })

  it('un TRANSFER entre dos ACTIVOS pasa intacto, misma referencia', () => {
    const t = { type: 'TRANSFER', _originItemId: 'b1', _linkedItemId: 'b2', totalAmount: 200 }
    const out = assetOnlyFlows([t], debtIds)
    expect(out[0]).toBe(t)
  })

  it('un TRANSFER cuyo extremo directo es la deuda (forma vieja) se descarta, nunca a medias', () => {
    const t = { type: 'TRANSFER', _originItemId: 'b1', _linkedItemId: 'd1', totalAmount: 200 }
    expect(assetOnlyFlows([t], debtIds)).toHaveLength(0)
  })
})

// ── Los cuatro escenarios, con el Dietz REAL sobre el universo de activos ──
// endValue/startValue son ACTIVOS; la deuda no aparece en ninguno de los dos.
describe('la deuda no mueve el retorno (Dietz real, universo de activos)', () => {
  const jan1 = Date.UTC(2026, 0, 1)
  const now = Date.UTC(2026, 8, 1)
  const dietz = (transactions) => computeModifiedDietz({
    startValue: 10000, endValue: 10000,
    startTs: jan1, endTs: now,
    transactions, convert: null, baseCurrency: 'USD',
  })

  it('regresión negativa: en el universo VIEJO (neto), crear la deuda daba −2B', () => {
    // endValue neto cae 4,000 (la deuda) y el DEPOSIT envenenado resta otros
    // 4,000: la pérdida inventada de −8,000 del caso real (−24.13% YTD).
    const { abs } = computeModifiedDietz({
      startValue: 10000, endValue: 6000,
      startTs: jan1, endTs: now,
      transactions: [{ type: 'DEPOSIT', _linkedItemId: 'd1', totalAmount: 4000, currency: 'USD', date: '2026-08-25' }],
      convert: null, baseCurrency: 'USD',
    })
    expect(abs).toBeCloseTo(-8000, 6)
  })

  it('deuda vieja con DEPOSIT envenenado: activos quietos → ganancia CERO', () => {
    const flows = assetOnlyFlows([
      { type: 'DEPOSIT', _linkedItemId: 'd1', totalAmount: 4000, currency: 'USD', date: '2026-08-25', _source: 'manual_new_account' },
    ], debtIds)
    expect(dietz(flows).abs).toBeCloseTo(0, 6)
  })

  it('desembolso a una cuenta registrada: la cuenta sube 4,000, el DEPOSIT sintético lo netea → CERO', () => {
    const flows = assetOnlyFlows([
      { type: 'TRANSFER', _loanItemId: 'd1', _linkedItemId: 'b1', totalAmount: 4000, currency: 'USD', date: '2026-08-25', _source: 'manual_loan_proceeds' },
    ], debtIds)
    const { abs } = computeModifiedDietz({
      startValue: 10000, endValue: 14000,
      startTs: jan1, endTs: now, transactions: flows, convert: null, baseCurrency: 'USD',
    })
    expect(abs).toBeCloseTo(0, 6)
    // Regresión negativa: sin la transformación, esos 4,000 se leían como ganancia.
    const raw = computeModifiedDietz({
      startValue: 10000, endValue: 14000,
      startTs: jan1, endTs: now,
      transactions: [{ type: 'TRANSFER', _loanItemId: 'd1', _linkedItemId: 'b1', totalAmount: 4000, currency: 'USD', date: '2026-08-25' }],
      convert: null, baseCurrency: 'USD',
    })
    expect(raw.abs).toBeCloseTo(4000, 6)
  })

  it('pago de deuda desde una cuenta: la cuenta baja 321.36, el WITHDRAWAL sintético lo netea → CERO', () => {
    const flows = assetOnlyFlows([
      { type: 'TRANSFER', _debtItemId: 'd1', _originItemId: 'b1', totalAmount: 321.36, currency: 'USD', date: '2026-08-27' },
    ], debtIds)
    const { abs } = computeModifiedDietz({
      startValue: 10000, endValue: 9678.64,
      startTs: jan1, endTs: now, transactions: flows, convert: null, baseCurrency: 'USD',
    })
    expect(abs).toBeCloseTo(0, 6)
  })

  it('pago desde la Hoja: ningún activo se movió → CERO sin ningún flujo', () => {
    const flows = assetOnlyFlows([
      { type: 'TRANSFER', _debtItemId: 'd1', totalAmount: 321.36, currency: 'USD', date: '2026-08-27', _source: 'manual_debt_payment' },
    ], debtIds)
    expect(flows).toHaveLength(0)
    expect(dietz(flows).abs).toBeCloseTo(0, 6)
  })
})
