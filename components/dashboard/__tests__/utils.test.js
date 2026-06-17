import {
  computeModifiedDietz,
  getItemValue,
  getItemPrice,
  getEffectiveYield,
  formatCurrency,
  formatPercent,
  getTypeCategory,
  getGeographyFromSymbol,
  getMaturityInfo,
} from '../utils'

describe('computeModifiedDietz', () => {
  const day = 86400000

  test('normal growth with no flows', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 11000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [],
    })
    expect(result.pct).toBeCloseTo(10, 1)
    expect(result.abs).toBeCloseTo(1000)
  })

  test('returns 0 when startValue is 0', () => {
    const result = computeModifiedDietz({
      startValue: 0,
      endValue: 5000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [],
    })
    expect(result.pct).toBe(0)
    expect(result.abs).toBe(0)
  })

  test('accounts for deposit flow', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 15000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(15 * day).toISOString(), type: 'DEPOSIT', totalAmount: 4000, currency: 'USD' },
      ],
    })
    expect(result.abs).toBeCloseTo(1000)
    expect(result.pct).toBeGreaterThan(0)
    expect(result.pct).toBeLessThan(20)
  })

  test('BUY/SELL are internal rebalancing, not external flows', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 12000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(10 * day).toISOString(), type: 'BUY', totalAmount: 1000, currency: 'USD' },
      ],
    })
    expect(result.abs).toBeCloseTo(2000)
  })

  test('DEPOSIT is counted as external flow', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 12000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(10 * day).toISOString(), type: 'DEPOSIT', totalAmount: 1000, currency: 'USD' },
      ],
    })
    expect(result.abs).toBeCloseTo(1000)
  })

  test('handles negative weightedCapital (large withdrawal)', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 2000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(1 * day).toISOString(), type: 'WITHDRAWAL', totalAmount: 12000, currency: 'USD' },
      ],
    })
    expect(result.pct).not.toBe(0)
  })

  test('returns 0 for zero time period', () => {
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 11000,
      startTs: 100,
      endTs: 100,
      transactions: [],
    })
    expect(result.pct).toBe(0)
  })

  test('uses convert function when provided', () => {
    const convert = (amt, from, to) => (from === 'MXN' && to === 'USD' ? amt / 20 : amt)
    const result = computeModifiedDietz({
      startValue: 10000,
      endValue: 11000,
      startTs: 0,
      endTs: 30 * day,
      transactions: [
        { date: new Date(15 * day).toISOString(), type: 'DEPOSIT', totalAmount: 20000, currency: 'MXN' },
      ],
      convert,
      baseCurrency: 'USD',
    })
    expect(result.abs).toBeCloseTo(0)
  })
})

describe('getItemValue', () => {
  test('stock: quantity * price', () => {
    expect(getItemValue({ quantity: 10, currentPrice: 150 })).toBe(1500)
  })

  test('debt: returns negative value', () => {
    expect(getItemValue({ quantity: 1, currentPrice: 5000, isDebt: true })).toBe(-5000)
  })

  test('illiquid: uses lastManualValuation', () => {
    expect(getItemValue({ quantity: 1, isIlliquid: true, lastManualValuation: 250000 })).toBe(250000)
  })

  test('falls back through price fields', () => {
    expect(getItemValue({ quantity: 2, purchasePrice: 50 })).toBe(100)
    expect(getItemValue({ quantity: 3, price: 10 })).toBe(30)
    expect(getItemValue({ quantity: 4, cost: 5 })).toBe(20)
    expect(getItemValue({ quantity: 5, averagePrice: 8 })).toBe(40)
  })

  test('returns 0 when no quantity', () => {
    expect(getItemValue({ currentPrice: 100 })).toBe(0)
  })
})

describe('getEffectiveYield', () => {
  test('uses dividendYield when available', () => {
    expect(getEffectiveYield({ dividendYield: 3.5 })).toBe(3.5)
  })

  test('variable rate: uses midpoint', () => {
    expect(getEffectiveYield({ rateType: 'variable', rateMin: 4, rateMax: 6 })).toBe(5)
  })

  test('percent income mode', () => {
    expect(getEffectiveYield({ incomeMode: 'percent', incomeRate: 7 })).toBe(7)
  })

  test('calculates from incomeAmount and months', () => {
    const result = getEffectiveYield({
      incomeAmount: 100,
      incomeMonths: [0, 3, 6, 9],
      purchasePrice: 10000,
      quantity: 1,
    })
    expect(result).toBeCloseTo(4)
  })

  test('returns null when no income data', () => {
    expect(getEffectiveYield({})).toBeNull()
  })
})

describe('formatCurrency', () => {
  test('formats USD', () => {
    const result = formatCurrency(1234.56, 'USD')
    expect(result).toContain('1,234.56')
  })

  test('formats zero', () => {
    expect(formatCurrency(0, 'USD')).toContain('0.00')
  })

  test('handles null/NaN', () => {
    expect(formatCurrency(null)).toBe('$0.00')
    expect(formatCurrency(NaN)).toBe('$0.00')
    expect(formatCurrency(undefined)).toBe('$0.00')
  })

  test('handles negative values', () => {
    const result = formatCurrency(-500, 'USD')
    expect(result).toContain('500.00')
  })
})

describe('formatPercent', () => {
  test('positive value with + sign', () => {
    expect(formatPercent(12.345)).toBe('+12.35%')
  })

  test('negative value', () => {
    expect(formatPercent(-3.1)).toBe('-3.10%')
  })

  test('null/NaN returns 0.00%', () => {
    expect(formatPercent(null)).toBe('0.00%')
    expect(formatPercent(NaN)).toBe('0.00%')
  })
})

describe('getTypeCategory', () => {
  test('identifies stocks', () => {
    expect(getTypeCategory('stock')).toBe('stocks')
    expect(getTypeCategory('Accion')).toBe('stocks')
  })

  test('identifies crypto', () => {
    expect(getTypeCategory('crypto')).toBe('crypto')
    expect(getTypeCategory('Bitcoin')).toBe('crypto')
  })

  test('identifies debts from isDebt flag', () => {
    expect(getTypeCategory({ isDebt: true, type: 'anything' })).toBe('debts')
  })

  test('identifies debts from type string', () => {
    expect(getTypeCategory('mortgage')).toBe('debts')
    expect(getTypeCategory('hipoteca')).toBe('debts')
    expect(getTypeCategory('tarjeta de credito')).toBe('debts')
  })

  test('returns other for unknown', () => {
    expect(getTypeCategory('misc_asset')).toBe('other')
    expect(getTypeCategory(null)).toBe('other')
  })
})

describe('getGeographyFromSymbol', () => {
  test('US stocks default', () => {
    expect(getGeographyFromSymbol('AAPL')).toBe('US')
  })

  test('international suffixes', () => {
    expect(getGeographyFromSymbol('BABA.HK')).toBe('Hong Kong')
    expect(getGeographyFromSymbol('SAP.DE')).toBe('Germany')
    expect(getGeographyFromSymbol('AC.MX')).toBe('Mexico')
  })

  test('crypto returns Global', () => {
    expect(getGeographyFromSymbol('BTC')).toBe('Global')
    expect(getGeographyFromSymbol('ETH')).toBe('Global')
  })

  test('null returns Unknown', () => {
    expect(getGeographyFromSymbol(null)).toBe('Unknown')
  })
})

describe('getMaturityInfo', () => {
  test('returns null for no maturity date', () => {
    expect(getMaturityInfo({})).toBeNull()
  })

  test('expired instrument', () => {
    const result = getMaturityInfo({ maturityDate: '2020-01-01' })
    expect(result.expired).toBe(true)
    expect(result.days).toBe(0)
  })

  test('near maturity (< 90 days)', () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 30)
    const result = getMaturityInfo({ maturityDate: futureDate.toISOString() })
    expect(result.expired).toBe(false)
    expect(result.color).toBe('red')
    expect(result.days).toBeLessThanOrEqual(31)
  })
})
