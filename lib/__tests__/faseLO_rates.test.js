/**
 * @jest-environment node
 */
// FASE LO, arreglo 5: las tasas de cambio salen del último snapshot QUE LAS
// TRAIGA, no del último por fecha.
//
// Desde FASE FU una misma fecha puede tener varios documentos: el `daily` con
// id plano, el NAV paralelo del broker (`fecha~nav~ibkr`) y las anclas de
// calibración. El único escritor de `rates` es el snapshot diario; los otros
// guardan cuatro campos y ninguno es la tasa. Como `.get()` devuelve por id
// ascendente y '~' ordena DESPUÉS del id plano, entre docs de la misma fecha
// ganaba justo el que no las trae, `convert` caía a la identidad y una cuenta
// en quetzales se sumaba como si fueran dólares.
//
// Se ejercita el pipeline REAL con un db falso (mismo arnés que
// briefContext.test.js), no una copia de la expresión: probar una copia de la
// regla que se está arreglando es exactamente la enfermedad. Activos solo
// estáticos a propósito: `priceItems` no toca la red sin símbolos de mercado.

import { loadUserPortfolioContext } from '../briefContext'

// Una cuenta en quetzales: es la que delata el bug, porque sin tasa se suma
// cruda y vale 7.7 veces de más.
const ITEMS = [
  { id: 'gtq1', name: 'Fondo Líquido', type: 'Bank', institution: 'IDC', quantity: 1, purchasePrice: 7700, currentPrice: 7700, currency: 'GTQ' },
]

const DAILY = { id: '2026-08-27', date: '2026-08-27', netWorthUSD: 1000, rates: { USD: 1, GTQ: 7.7 }, baseCurrency: 'USD', _source: 'daily' }
// El NAV paralelo, tal como lo escribe planEquitySnapshotWrites: cuatro campos,
// sin tasas. Va DESPUÉS del plano, que es el orden real de Firestore.
const NAV_PARALELO = { id: '2026-08-27~nav~ibkr', date: '2026-08-27', totalActivosUSD: 9800, totalDebtUSD: 0, netWorthUSD: 9800, _source: 'ibkr' }

function makeDb(snapshots) {
  return {
    collection: (path) => ({
      get: async () => {
        const name = path.split('/').pop()
        const rows = name === 'items' ? ITEMS : name === 'snapshots' ? snapshots : []
        return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
      },
    }),
    doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
  }
}

const load = (snapshots) => loadUserPortfolioContext({
  db: makeDb(snapshots), uid: 'u1', prefs: { baseCurrency: 'USD' }, includeSnapshots: true,
})

describe('las tasas ganan al doc paralelo de la misma fecha', () => {
  test('con el NAV paralelo después del daily, la cuenta en GTQ se convierte', async () => {
    const ctx = await load([DAILY, NAV_PARALELO])
    // 7700 GTQ / 7.7 = 1000 USD. Sin tasas daría 7700.
    expect(ctx.netWorth).toBeCloseTo(1000, 2)
    expect(ctx.convert(7700, 'GTQ', 'USD')).toBeCloseTo(1000, 6)
  })

  test('sin el doc paralelo el resultado es el mismo: nada cambió para quien ya andaba bien', async () => {
    const ctx = await load([DAILY])
    expect(ctx.netWorth).toBeCloseTo(1000, 2)
  })

  test('un ancla de calibración tampoco puede ganar', async () => {
    const ancla = { id: '2026-08-27~cal~ibkr', date: '2026-08-27', netWorthUSD: 5000, _source: 'manual', _calibrated: true }
    const ctx = await load([DAILY, ancla])
    expect(ctx.netWorth).toBeCloseTo(1000, 2)
  })

  test('el daily más reciente sigue ganando sobre uno más viejo', async () => {
    const viejo = { id: '2026-08-01', date: '2026-08-01', netWorthUSD: 900, rates: { USD: 1, GTQ: 3.85 }, baseCurrency: 'USD', _source: 'daily' }
    const ctx = await load([viejo, DAILY, NAV_PARALELO])
    // Con la tasa VIEJA daría 2000; con la reciente, 1000.
    expect(ctx.netWorth).toBeCloseTo(1000, 2)
  })

  test('sin ningún doc con tasas no revienta: cae al comportamiento de siempre', async () => {
    const ctx = await load([NAV_PARALELO])
    expect(ctx).not.toBeNull()
    expect(Number.isFinite(ctx.netWorth)).toBe(true)
  })
})
