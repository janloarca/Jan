// FASE GK: el tablero de conciliación contra PortfolioAnalyst. Fixtures con
// los números reales del caso de referencia (captura del usuario: Beginning
// 0.00, Ending 9,919.38, Net D&W 7,909.99, Period 68.23%).

import { ibkrReconciliationReport } from '../ibkrReconciliation'

const PA = {
  beginning: 0, ending: 9919.38, change: 9919.38,
  returnPeriodPct: 68.23, netFlows: 7909.99,
  currency: 'USD', savedAt: '2026-08-09T18:00:00.000Z',
}

const flow = (date, amt, type = 'DEPOSIT', src = 'ibkr') => ({
  date, totalAmount: amt, type, _source: src, currency: 'USD',
})

describe('ibkrReconciliationReport', () => {
  it('null sin resumen o sin las primitivas minimas', () => {
    expect(ibkrReconciliationReport({})).toBeNull()
    expect(ibkrReconciliationReport({ paSummary: { ending: 100 } })).toBeNull()
    expect(ibkrReconciliationReport({ paSummary: { netFlows: 100 } })).toBeNull()
  })

  it('las tres filas cierran cuando el archivo cuenta la misma historia que la foto', () => {
    const r = ibkrReconciliationReport({
      paSummary: PA,
      snapshots: [
        { id: '2026-08-07~nav~ibkr', date: '2026-08-07', netWorthUSD: 9902.5, _source: 'ibkr' },
        { id: '2026-08-08', date: '2026-08-08', netWorthUSD: 23181, _source: 'daily' },
      ],
      transactions: [
        flow('2026-01-27', 1450), flow('2026-02-26', 1350), flow('2026-04-10', 1150),
        flow('2026-04-17', 5, 'WITHDRAWAL'),
        // Pre-ventana: inferidos aceptados que completan el neto de por vida.
        flow('2024-05-15', 3964.99, 'DEPOSIT', 'inferred_flow'),
      ],
    })
    expect(r.asOfDate).toBe('2026-08-09')
    // NAV: 9,902.50 vs 9,919.38 -> delta -16.88, dentro del 1% (99.19)
    expect(r.nav.ok).toBe(true)
    expect(r.nav.oursDate).toBe('2026-08-07')
    // Flujos: 1450+1350+1150-5+3964.99 = 7,909.99 exacto
    expect(r.netFlows.oursUSD).toBeCloseTo(7909.99, 2)
    expect(r.netFlows.ok).toBe(true)
    // Ganancia: nuestra (9902.5-7909.99=1992.51) vs PA (9919.38-0-7909.99=2009.39)
    expect(r.pl.paUSD).toBeCloseTo(2009.39, 2)
    expect(r.pl.ok).toBe(true)
    expect(r.periodPct).toBe(68.23)
  })

  it('un deposito faltante rompe SU fila y la de ganancia, con el delta visible', () => {
    const r = ibkrReconciliationReport({
      paSummary: PA,
      snapshots: [{ id: '2026-08-07~nav~ibkr', date: '2026-08-07', netWorthUSD: 9919.38, _source: 'ibkr' }],
      transactions: [flow('2026-01-27', 1450), flow('2026-02-26', 1350), flow('2026-04-10', 1150), flow('2026-04-17', 5, 'WITHDRAWAL')],
    })
    expect(r.nav.ok).toBe(true)
    expect(r.netFlows.ok).toBe(false)
    expect(r.netFlows.deltaUSD).toBeCloseTo(3945 - 7909.99, 2)
    expect(r.pl.ok).toBe(false)
  })

  it('solo cuenta evidencia de la MISMA epoca que la foto: nada posterior a asOf', () => {
    const r = ibkrReconciliationReport({
      paSummary: PA,
      snapshots: [
        { id: '2026-08-07~nav~ibkr', date: '2026-08-07', netWorthUSD: 9919.38, _source: 'ibkr' },
        // NAV posterior a la captura: no puede compararse contra ella.
        { id: '2026-09-01~nav~ibkr', date: '2026-09-01', netWorthUSD: 12000, _source: 'ibkr' },
      ],
      transactions: [
        flow('2026-01-27', 7909.99),
        // Deposito posterior a la captura: la foto no pudo contenerlo.
        flow('2026-09-02', 5000),
      ],
    })
    expect(r.nav.oursDate).toBe('2026-08-07')
    expect(r.netFlows.oursUSD).toBeCloseTo(7909.99, 2)
  })

  it('anclas de calibracion y docs de otras fuentes jamas cuentan como NAV del broker', () => {
    const r = ibkrReconciliationReport({
      paSummary: PA,
      snapshots: [
        { id: '2026-08-01~cal~ibkr', date: '2026-08-01', netWorthUSD: 5, _source: 'manual', _calibrated: true, _account: 'ibkr' },
        { id: '2026-08-05', date: '2026-08-05', netWorthUSD: 23181, _source: 'daily' },
        { id: '2026-07-30', date: '2026-07-30', netWorthUSD: 9800, _source: 'ibkr' },
      ],
      transactions: [],
    })
    expect(r.nav.oursDate).toBe('2026-07-30')
    expect(r.nav.oursUSD).toBe(9800)
  })

  it('sin NAV del broker: la fila queda sin dato, nunca inventa', () => {
    const r = ibkrReconciliationReport({ paSummary: PA, snapshots: [], transactions: [] })
    expect(r.nav.oursUSD).toBeNull()
    expect(r.nav.ok).toBe(false)
    expect(r.pl.oursUSD).toBeNull()
  })

  it('moneda no-USD del resumen se convierte con toUSD', () => {
    const r = ibkrReconciliationReport({
      paSummary: { ...PA, ending: 9000, netFlows: 7000, beginning: 0, currency: 'EUR' },
      snapshots: [], transactions: [],
      toUSD: (v, cur) => (cur === 'EUR' ? v * 1.1 : v),
    })
    expect(r.nav.paUSD).toBeCloseTo(9900, 2)
    expect(r.netFlows.paUSD).toBeCloseTo(7700, 2)
  })
})
