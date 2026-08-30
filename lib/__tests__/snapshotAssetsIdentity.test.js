import { snapshotAssetsUSD } from '../assetReturns'
import { parseEquitySummary } from '@/lib/parsers/ibkrEquitySummary'

// ⛔ EL DEFECTO QUE ESTO EXISTE PARA IMPEDIR.
//
// El guard original preguntaba "¿el doc declara totalDebtUSD?", asumiendo que
// un NAV de broker no lo trae. El parser SIEMPRE lo emite, asi que la rama de
// respaldo reservada para "broker NAV" era codigo muerto y todo doc de broker
// se leia por totalActivosUSD = totalLong + cash, que FASE FX documenta como
// no confiable. La grafica principal salia inflada todos los dias.
describe('snapshotAssetsUSD: un doc de broker no puede leerse inflado', () => {
  it('el parser SIEMPRE escribe totalDebtUSD (por eso el guard viejo moria)', () => {
    const xml = '<EquitySummaryByReportDateInBase reportDate="20260828" total="10000" totalLong="10000" totalShort="0" cash="1000" />'
    const row = parseEquitySummary(xml)[0]
    expect(row.totalDebtUSD).toBe(0)
    expect(row.totalDebtUSD).not.toBeUndefined()
  })

  it('un NAV de broker se lee por su NAV, no por totalLong + cash', () => {
    const xml = '<EquitySummaryByReportDateInBase reportDate="20260828" total="10000" totalLong="10000" totalShort="0" cash="1000" />'
    const doc = { ...parseEquitySummary(xml)[0], _source: 'ibkr' }
    expect(doc.totalActivosUSD).toBe(11000)   // el campo no confiable
    expect(snapshotAssetsUSD(doc)).toBe(10000) // lo que de verdad vale
  })

  // Un doc NUESTRO cumple activos - deuda = neto por construccion, y ahi
  // totalActivosUSD SI es la respuesta correcta.
  it('un doc propio con deuda conserva su lectura de siempre', () => {
    const doc = { totalActivosUSD: 26000, totalDebtUSD: 5000, netWorthUSD: 21000, _source: 'daily' }
    expect(snapshotAssetsUSD(doc)).toBe(26000)
  })

  it('un doc propio SIN deuda tambien', () => {
    const doc = { totalActivosUSD: 26000, totalDebtUSD: 0, netWorthUSD: 26000, _source: 'backfill' }
    expect(snapshotAssetsUSD(doc)).toBe(26000)
  })

  it('tolera el ruido de punto flotante de la conversion a USD', () => {
    const doc = { totalActivosUSD: 26000.001, totalDebtUSD: 5000, netWorthUSD: 21000 }
    expect(snapshotAssetsUSD(doc)).toBeCloseTo(26000.001, 3)
  })

  // Cuando la identidad cierra, las dos lecturas dan lo MISMO: el guard solo
  // puede ayudar, nunca cambiar un caso que ya estaba bien.
  it('con la identidad cerrada las dos lecturas coinciden', () => {
    const doc = { totalActivosUSD: 10000, totalDebtUSD: 0, netWorthUSD: 10000 }
    expect(snapshotAssetsUSD(doc)).toBe(10000)
  })

  it('docs viejos y anclas de calibracion: la lectura de siempre', () => {
    expect(snapshotAssetsUSD({ netWorthUSD: 7000 })).toBe(7000)
    expect(snapshotAssetsUSD({ totalActivosUSD: 7000 })).toBe(7000)
    expect(snapshotAssetsUSD({ netWorthUSD: 7000, totalDebtUSD: 500 })).toBe(7500)
    expect(snapshotAssetsUSD(null)).toBe(0)
    expect(snapshotAssetsUSD({})).toBe(0)
  })
})
