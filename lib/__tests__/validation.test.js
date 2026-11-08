
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

describe('FASE RA: imports no recortan en silencio la cantidad', () => {
  const { sanitizeImportItem, validateItem, assertQuantitiesWithinLimit, oversizedQuantityRows } = require('../validation')
  it('sanitizeImportItem deja la cantidad tal cual, sin recortar a 1e9', () => {
    expect(sanitizeImportItem({ symbol: 'SPCX', quantity: 1_000_000_001 }).quantity).toBe(1_000_000_001)
    expect(sanitizeImportItem({ symbol: 'SPCX', quantity: 5_000_000_000 }).quantity).toBe(5_000_000_000)
  })
  it('la fila sobre el tope se rechaza en validateItem (no se importa)', () => {
    const row = sanitizeImportItem({ name: 'x', type: 'Stock', symbol: 'SPCX', purchasePrice: 1, currency: 'USD', quantity: 1_000_000_001 })
    expect(validateItem(row)).toContain('Quantity exceeds 1000000000')
  })
  it('el limite exacto sigue valido', () => {
    expect(() => assertQuantitiesWithinLimit([{ symbol: 'A', quantity: 1_000_000_000 }])).not.toThrow()
    expect(oversizedQuantityRows([{ quantity: 1_000_000_000 }])).toEqual([])
  })
  it('un lote con una fila sobre el tope lanza en espanol y nombra el simbolo', () => {
    expect(() => assertQuantitiesWithinLimit([{ symbol: 'OK', quantity: 5 }, { symbol: 'SPCX', quantity: 1_000_000_001 }]))
      .toThrow(/Se rechazó la importación.*SPCX.*No se importó nada/)
  })
  it('las cantidades negativas de deuda cuentan por magnitud', () => {
    expect(() => assertQuantitiesWithinLimit([{ symbol: 'D', quantity: -2_000_000_000 }])).toThrow()
  })
})
