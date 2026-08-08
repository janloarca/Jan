// FASE FP. computeAnchoredMWRSeries: la hermana money-weighted de la serie
// congelada (computeAnchoredReturnSeries). Extensión, no reescritura: estos
// tests fijan (1) que con CERO flujos a media ventana las dos series son
// IDÉNTICAS (VITALI da 3.94% en ambas pestañas, el invariante congelado),
// (2) que la rama de prefijo hold-flat es byte-idéntica entre ambas, y
// (3) que con capital llegando a media ventana las dos DIVERGEN en la
// dirección correcta: capital tarde => MWR < TWR (la tabla del usuario:
// "cuando metes capital tarde, TWR > MWR").

import { computeAnchoredReturnSeries, computeAnchoredMWRSeries } from '@/components/dashboard/analytics'
import { VITALI, INVARIANTS } from '@/lib/assetLogic/corporateBondWithEntryFee'

const inv = (id) => INVARIANTS.find((i) => i.id === id)
const d = (s) => new Date(`${s}T00:00:00Z`).getTime()

// El mismo fixture del test congelado (lib/__tests__/corporateBondWithEntryFee.test.js).
const openingDeposit = {
  id: 'dep', type: 'DEPOSIT', date: VITALI.acquisitionDate,
  totalAmount: VITALI.cashOutOfPocket, currency: 'USD',
  _linkedItemId: 'vitali', _source: 'manual_new_account',
}
const coupon = {
  id: 'cup', type: 'DIVIDEND', date: VITALI.couponDate,
  totalAmount: VITALI.couponPaid, currency: 'USD',
  _linkedItemId: 'vitali', _source: 'auto',
}
const vitaliTxs = [openingDeposit, coupon]
const vitaliChart = [
  { ts: d('2026-01-01'), value: 0 },
  { ts: d(VITALI.acquisitionDate), value: VITALI.principal },
  { ts: d(VITALI.couponDate), value: VITALI.expectedNetWorth },
  { ts: d('2026-08-06'), value: VITALI.expectedNetWorth },
]

describe('sin flujos a media ventana: MWR coincide EXACTO con la serie congelada', () => {
  it('VITALI-solo da el mismo 3.94% en la pestaña MWR', () => {
    const mwr = computeAnchoredMWRSeries(vitaliChart, vitaliTxs, null, 'USD')
    expect(mwr[0]).toBe(0) // antes de fondearse
    expect(mwr[mwr.length - 1]).toBeCloseTo(inv('pct-vs-cost-basis').expected, 9)
  })

  it('y la serie completa es idéntica punto a punto a la congelada', () => {
    const twr = computeAnchoredReturnSeries(vitaliChart, vitaliTxs, null, 'USD')
    const mwr = computeAnchoredMWRSeries(vitaliChart, vitaliTxs, null, 'USD')
    expect(mwr.length).toBe(twr.length)
    mwr.forEach((v, i) => expect(v).toBeCloseTo(twr[i], 9))
  })
})

describe('rama de prefijo hold-flat: byte-idéntica entre las dos', () => {
  // Un prefijo reconstruido antes del primer NAV real: ambas funciones caen a
  // la MISMA ventana Dietz única, así que TWR y MWR coinciden ahí por diseño
  // (un prefijo de broker no carga comisión de entrada por-item que las separe).
  const chart = [
    { ts: d('2026-01-01'), value: 1000 },
    { ts: d('2026-03-01'), value: 1000 },  // prefijo estimado
    { ts: d('2026-06-01'), value: 1000 },  // primer NAV real
    { ts: d('2026-08-01'), value: 1100 },
  ]
  const firstRealTs = d('2026-06-01')

  it('mismas series con firstRealTs', () => {
    const twr = computeAnchoredReturnSeries(chart, [], null, 'USD', { firstRealTs })
    const mwr = computeAnchoredMWRSeries(chart, [], null, 'USD', { firstRealTs })
    expect(mwr).toEqual(twr)
  })
})

describe('capital a media ventana: divergen, y en la dirección correcta', () => {
  // Ventana de 182 días exactos (1 ene -> 2 jul). El portafolio arranca en
  // 1,000 orgánico, gana 10% (1,100 al 1 abr), y el 2 abr (mitad EXACTA de la
  // ventana: peso Dietz 0.5) entra un depósito de 1,100 que queda plano el
  // resto de la ventana.
  const chart = [
    { ts: d('2026-01-01'), value: 1000 },
    { ts: d('2026-04-01'), value: 1100 },  // +10% orgánico
    { ts: d('2026-04-02'), value: 2200 },  // entra el depósito de 1,100
    { ts: d('2026-07-02'), value: 2200 },  // plano desde entonces
  ]
  const deposit = { id: 'dep2', type: 'DEPOSIT', date: '2026-04-02', totalAmount: 1100, currency: 'USD' }

  it('TWR (congelada): 10%, el timing del depósito NO cuenta', () => {
    // Segmento 1: (1100-1000)/1000 = 10%. Segmento 2 (post-depósito): 0%.
    // Cadena: 10%. Re-escale: principal 2100 / costo 2100 = 1.
    const twr = computeAnchoredReturnSeries(chart, [deposit], null, 'USD')
    expect(twr[twr.length - 1]).toBeCloseTo(10, 6)
  })

  it('MWR: 6.45%, el capital tarde SÍ diluye (metiste capital tarde => MWR < TWR)', () => {
    // Dietz de una sola ventana: (2200 - 1000 - 1100) / (1000 + 1100*0.5)
    // = 100 / 1550 = 6.4516...%
    const mwr = computeAnchoredMWRSeries(chart, [deposit], null, 'USD')
    expect(mwr[mwr.length - 1]).toBeCloseTo((100 / 1550) * 100, 6)
  })

  it('la relación entre ambas es la esperada', () => {
    const twr = computeAnchoredReturnSeries(chart, [deposit], null, 'USD')
    const mwr = computeAnchoredMWRSeries(chart, [deposit], null, 'USD')
    expect(mwr[mwr.length - 1]).toBeLessThan(twr[twr.length - 1])
  })
})

describe('crecimiento orgánico puro: idénticas por definición', () => {
  const chart = [
    { ts: d('2026-01-01'), value: 1000 },
    { ts: d('2026-04-01'), value: 1050 },
    { ts: d('2026-08-01'), value: 1100 },
  ]

  it('sin transacciones, ambas dan +10%', () => {
    const twr = computeAnchoredReturnSeries(chart, [], null, 'USD')
    const mwr = computeAnchoredMWRSeries(chart, [], null, 'USD')
    expect(twr[twr.length - 1]).toBeCloseTo(10, 6)
    expect(mwr[mwr.length - 1]).toBeCloseTo(10, 6)
  })
})
