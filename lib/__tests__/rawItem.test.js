import { toRawItem } from '../rawItem'
import { planCellEdit, ANSWER_CORRECTION, ANSWER_FLOW } from '../spreadsheetEdit'

// El enriquecimiento EXACTO de hooks/useDashboardData.js:150-164.
function enrich(raw, rate, base = 'USD') {
  const cur = raw.marketCurrency || raw.currency || 'USD'
  const price = raw.currentPrice || raw.purchasePrice || raw.price || raw.cost || 0
  return {
    ...raw,
    currentPrice: price / rate,
    purchasePrice: raw.purchasePrice ? raw.purchasePrice / rate : 0,
    _originalPrice: price,
    _originalPurchasePrice: raw.purchasePrice || 0,
    _originalCurrency: cur,
    _displayCurrency: base,
  }
}

const fondoQ = { id: 'q', name: 'FONDO Q', type: 'Bank', currency: 'GTQ', quantity: 1, currentPrice: 5000, purchasePrice: 5000 }

describe('toRawItem', () => {
  it('devuelve los precios GUARDADOS, no los convertidos a moneda base', () => {
    const raw = toRawItem(enrich(fondoQ, 7.7))
    expect(raw.currentPrice).toBe(5000)
    expect(raw.purchasePrice).toBe(5000)
    expect(raw.currency).toBe('GTQ')
  })

  it('quita los campos de display para que no lleguen a Firestore', () => {
    const raw = toRawItem({ ...enrich(fondoQ, 7.7), totalValue: 9, percentOfPortfolio: 3, change1d: 1, _category: 'x' })
    for (const k of ['_originalPrice', '_originalPurchasePrice', '_originalCurrency', '_displayCurrency',
      'totalValue', 'percentOfPortfolio', 'change1d', '_category']) {
      expect(raw).not.toHaveProperty(k)
    }
  })

  it('un item que NO viene enriquecido pasa igual', () => {
    expect(toRawItem(fondoQ)).toEqual(fondoQ)
    expect(toRawItem(null)).toBeNull()
  })
})

// ⛔ EL DEFECTO QUE ESTO EXISTE PARA IMPEDIR.
//
// `oldValue`/`newValue` salen de `_originalPrice`, o sea vienen en la moneda
// ORIGINAL. `planCellEdit` suma ese delta sobre los campos de precio del item.
// Con el item ENRIQUECIDO esos campos ya estan en moneda BASE, asi que se
// mezclan dos monedas y el resultado se ESCRIBE como si fuera crudo.
describe('la celda de la Hoja sobre una cuenta en moneda distinta de la base', () => {
  const enriquecido = enrich(fondoQ, 7.7) // base USD
  const oldValue = 5000, newValue = 5200  // crudos, en GTQ

  it('CORRECCION: el costo se conserva en la moneda de la cuenta', () => {
    const { patch } = planCellEdit({ item: toRawItem(enriquecido), oldValue, newValue, answer: ANSWER_CORRECTION })
    expect(patch.currentPrice).toBeCloseTo(5200, 2)
    expect(patch.purchasePrice).toBeCloseTo(5200, 2)
  })

  it('FLUJO: el saldo queda en 5,200 y no en 849.35', () => {
    const { patch } = planCellEdit({ item: toRawItem(enriquecido), oldValue, newValue, answer: ANSWER_FLOW, date: '2026-08-30' })
    const leido = (patch.quantity ?? enriquecido.quantity) * patch.currentPrice
    expect(leido).toBeCloseTo(5200, 2)
  })

  // Regresion NEGATIVA: el comportamiento viejo, fijado para que no vuelva.
  it('con el item ENRIQUECIDO el saldo se destruia (comportamiento viejo)', () => {
    const { patch } = planCellEdit({ item: enriquecido, oldValue, newValue, answer: ANSWER_FLOW, date: '2026-08-30' })
    expect(patch.currentPrice).toBeCloseTo(849.35, 2) // Q5,000 -> Q849.35
  })

  it('una cuenta en la MISMA moneda que la base no cambia de comportamiento', () => {
    const usd = { ...fondoQ, id: 'u', currency: 'USD' }
    const e = enrich(usd, 1)
    const a = planCellEdit({ item: toRawItem(e), oldValue, newValue, answer: ANSWER_CORRECTION })
    const b = planCellEdit({ item: e, oldValue, newValue, answer: ANSWER_CORRECTION })
    expect(a.patch).toEqual(b.patch)
  })
})
