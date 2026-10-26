
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
