/**
 * @jest-environment node
 */
import { getHistoricalItemValues } from '@/lib/historicalValues'
import { getItemPrice, getItemValue } from '@/components/dashboard/utils'

// ⛔ EL DEFECTO: la columna del mes actual pregunta por `getItemPrice`, que
// antepone `lastManualValuation` en un iliquido; la reconstruccion tenia su
// propia cascada y no la conocia. Un inmueble revaluado a mano mostraba el
// valor VIEJO en todo el historico y el NUEVO solo hoy: un salto inventado.
const casa = (extra) => ({
  id: 'casa', name: 'Casa', type: 'RealEstate', currency: 'USD', quantity: 1,
  isIlliquid: true, currentPrice: 200000, purchasePrice: 200000,
  acquisitionDate: '2024-01-01', ...extra,
})
const hist = (it, months = ['2026-05', '2026-06', '2026-07']) =>
  getHistoricalItemValues([it], months, (v) => v, 'USD', [], [], [])

describe('un iliquido revaluado a mano', () => {
  it('el historico dice lo MISMO que la columna del mes actual', async () => {
    const it = casa({ lastManualValuation: 250000 })
    expect(getItemPrice(it)).toBe(250000)
    expect(getItemValue(it)).toBe(250000)
    const r = await hist(it)
    for (const m of ['2026-05', '2026-06', '2026-07']) {
      expect(r[m].casa.value).toBe(250000)
    }
  })

  it('sin revaluacion nada cambia', async () => {
    const r = await hist(casa())
    expect(r['2026-05'].casa.value).toBe(200000)
  })

  // La valuacion solo manda cuando el item ES iliquido y el numero es real:
  // misma condicion exacta que `getItemPrice`, para que no puedan divergir.
  it('un item NO iliquido ignora la valuacion, igual que getItemPrice', async () => {
    const noIliquido = casa({ isIlliquid: false, lastManualValuation: 250000 })
    expect(getItemPrice(noIliquido)).toBe(200000)
    const r = await hist(noIliquido)
    expect(r['2026-05'].casa.value).toBe(200000)
  })

  it('una valuacion en cero o negativa no manda', async () => {
    for (const v of [0, -5, null]) {
      const r = await hist(casa({ lastManualValuation: v }))
      expect(r['2026-05'].casa.value).toBe(200000)
    }
  })
})
