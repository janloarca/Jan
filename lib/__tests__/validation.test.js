
describe('tope de currentPrice', () => {
  const { validateItem, translateValidationError } = require('../validation')
  test('una deuda con currentPrice sobre el tope se rechaza', () => {
    const errs = validateItem({ isDebt: true, quantity: 1, currentPrice: 3_500_000_000, currency: 'USD' })
    expect(errs.some(e => /Current price exceeds/.test(e))).toBe(true)
    expect(translateValidationError(errs.find(e => /Current price/.test(e)))).toMatch(/supera el máximo/)
  })
  test('un valor normal pasa', () => {
    expect(validateItem({ quantity: 1, currentPrice: 5000, currency: 'USD' })).toEqual([])
  })
})

describe('tope de cantidad: inclusivo', () => {
  const { validateItem, translateValidationError } = require('../validation')
  const base = { name: 'Space', type: 'Stock', symbol: 'SPCX', purchasePrice: 1, currency: 'USD' }
  it('exactamente 1,000,000,000 es válido', () => {
    expect(validateItem({ ...base, quantity: 1_000_000_000 })).toEqual([])
  })
  it('un tick por encima se rechaza, con mensaje en español', () => {
    const errs = validateItem({ ...base, quantity: 1_000_000_001 })
    expect(errs).toContain('Quantity exceeds 1000000000')
    expect(translateValidationError(errs[0], 'es')).toMatch(/La cantidad supera el máximo/)
  })
})
