// FASE OL. Por qué la fecha del merge importa: la Hoja reconstruye el pasado
// de un activo de saldo gateando por `acquisitionDate` (applyStaticHistory,
// congelada F, usada como INPUT y no tocada). Con la fecha de ESTA compra
// escrita encima de la real, un bono comprado en enero al que se le agrega
// un aporte hoy pierde toda su historia anterior. Motor REAL.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(async () => ({ ok: false })),
  safeJson: jest.fn(async () => null),
}))
const { getHistoricalItemValues } = require('../historicalValues')
const { mergedAcquisitionDate } = require('../mergePosition')

const MONTHS = ['2026-01', '2026-02', '2026-05', '2026-08', '2026-09']
const bond = (acquisitionDate) => ({
  id: 'b1', symbol: 'BONO-IDC', name: 'Bono IDC', type: 'Bond', quantity: 1,
  currentPrice: 6000, purchasePrice: 6000, currency: 'USD', institution: 'IDC', _category: 'bonds',
  acquisitionDate, createdAt: '2026-01-06T15:00:00.000Z',
})
// Los dos DEPOSIT que explican el saldo: la compra de enero y el aporte de hoy.
const txs = [
  { id: 't1', type: 'DEPOSIT', date: '2026-01-06', symbol: 'BONO-IDC', totalAmount: 5000, currency: 'USD', _linkedItemId: 'b1', _source: 'manual_new_account' },
  { id: 't2', type: 'DEPOSIT', date: '2026-09-07', symbol: 'BONO-IDC', totalAmount: 1000, currency: 'USD', _linkedItemId: 'b1', _source: 'manual_new_account' },
]

describe('FASE OL: la fecha que el merge escribe decide si la Hoja conserva la historia', () => {
  it('regresión negativa: con la fecha de ESTE aporte encima, los meses anteriores quedan en blanco', async () => {
    const res = await getHistoricalItemValues([bond('2026-09-07')], MONTHS, null, 'USD', [], txs, [])
    expect(res['2026-01']?.b1).toBeUndefined()
    expect(res['2026-05']?.b1).toBeUndefined()
    expect(res['2026-08']?.b1).toBeUndefined()
    expect(res['2026-09']?.b1?.value).toBeCloseTo(6000, 2)
  })
  it('con la fecha MÁS VIEJA (la que el merge conserva), cada mes rebobina al saldo que tenía', async () => {
    const date = mergedAcquisitionDate('2026-01-06', '2026-09-07')
    const res = await getHistoricalItemValues([bond(date)], MONTHS, null, 'USD', [], txs, [])
    expect(res['2026-01']?.b1?.value).toBeCloseTo(5000, 2)
    expect(res['2026-05']?.b1?.value).toBeCloseTo(5000, 2)
    expect(res['2026-08']?.b1?.value).toBeCloseTo(5000, 2)
    expect(res['2026-09']?.b1?.value).toBeCloseTo(6000, 2)
  })
})
