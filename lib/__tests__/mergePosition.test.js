const { mergeCurrencyOf, mergeCurrencyConflict, mergedAcquisitionDate, mergePositionFields } = require('../mergePosition')

describe('FASE OL: moneda del merge', () => {
  it('la moneda del existente manda, con la original por delante de la enriquecida', () => {
    expect(mergeCurrencyOf({ currency: 'GTQ' })).toBe('GTQ')
    expect(mergeCurrencyOf({ currency: 'USD', _originalCurrency: 'GTQ' })).toBe('GTQ')
    expect(mergeCurrencyOf({})).toBe('USD')
    expect(mergeCurrencyOf(null)).toBe('USD')
  })
  it('misma moneda: sin conflicto; distinta: nombra las dos', () => {
    expect(mergeCurrencyConflict({ currency: 'GTQ' }, 'GTQ')).toBeNull()
    expect(mergeCurrencyConflict({ currency: 'gtq' }, 'GTQ')).toBeNull()
    expect(mergeCurrencyConflict({ currency: 'GTQ' }, 'USD')).toEqual({ existing: 'GTQ', typed: 'USD' })
    expect(mergeCurrencyConflict({}, 'GTQ')).toEqual({ existing: 'USD', typed: 'GTQ' })
  })
})

describe('FASE OL: la fecha del ítem es la más vieja', () => {
  it('conserva la compra original cuando el aporte es posterior', () => {
    expect(mergedAcquisitionDate('2026-01-06', '2026-09-07')).toBe('2026-01-06')
  })
  it('y toma la nueva si resulta ANTERIOR (el usuario registra una compra vieja)', () => {
    expect(mergedAcquisitionDate('2026-09-07', '2026-01-06')).toBe('2026-01-06')
  })
  it('sin una de las dos, la otra; sin ninguna, undefined; basura no cuenta', () => {
    expect(mergedAcquisitionDate(undefined, '2026-01-06')).toBe('2026-01-06')
    expect(mergedAcquisitionDate('2026-01-06', '')).toBe('2026-01-06')
    expect(mergedAcquisitionDate('ayer', '2026-01-06')).toBe('2026-01-06')
    expect(mergedAcquisitionDate(undefined, undefined)).toBeUndefined()
  })
})

describe('FASE OL: la aritmética del merge (FASE OA, sin cambios)', () => {
  it('activo de saldo: SUMA los montos y deja cantidad 1 (5,000 + 1,000 = 6,000)', () => {
    const out = mergePositionFields({
      existing: { quantity: 1, purchasePrice: 5000, currentPrice: 5000 },
      item: { quantity: 1, purchasePrice: 1000, currentPrice: 1000 }, isMarketAsset: false, qty: 1, price: 1000, newCurrent: 1000,
    })
    expect(out).toEqual({ quantity: 1, purchasePrice: 6000, currentPrice: 6000 })
  })
  it('activo de saldo con cantidad heredada 5 × 1,000: suma el TOTAL, no por unidad', () => {
    const out = mergePositionFields({
      existing: { quantity: 5, purchasePrice: 1000 },
      item: { quantity: 1, purchasePrice: 1000 }, isMarketAsset: false, qty: 1, price: 1000, newCurrent: 1000,
    })
    expect(out.purchasePrice).toBe(6000)
    expect(out.quantity).toBe(1)
    expect(out.currentPrice).toBeUndefined()
  })
  it('comisión de entrada: se hereda si el form no trae, se suma si trae', () => {
    const base = { existing: { quantity: 1, purchasePrice: 5000, entryFee: 98 }, isMarketAsset: false, qty: 1, price: 1000, newCurrent: 1000 }
    expect(mergePositionFields({ ...base, item: { purchasePrice: 1000 } }).entryFee).toBe(98)
    expect(mergePositionFields({ ...base, item: { purchasePrice: 1000, entryFee: 10 } }).entryFee).toBe(108)
  })
  it('activo de mercado: suma cantidades y promedia el costo', () => {
    const out = mergePositionFields({
      existing: { quantity: 10, purchasePrice: 100 },
      item: { quantity: 10, purchasePrice: 200 }, isMarketAsset: true, qty: 10, price: 200,
    })
    expect(out).toEqual({ quantity: 20, purchasePrice: 150 })
  })
  it('una deuda no se fusiona: {}', () => {
    expect(mergePositionFields({ existing: { purchasePrice: 4000 }, item: { isDebt: true, purchasePrice: 100 }, isMarketAsset: false, qty: 1, price: 100 })).toEqual({})
    expect(mergePositionFields({ existing: null, item: {}, isMarketAsset: false, qty: 1, price: 100 })).toEqual({})
  })
})
