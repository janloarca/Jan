/**
 * Tests for exchange rate conversion logic extracted from useExchangeRates.js
 *
 * We test the pure `convert` and `getRate` functions by recreating their logic
 * (they live inside a hook and use refs, so we simulate the core algorithm).
 */

// Simulates the convert function from useExchangeRates.js (lines 58-71)
function createConvert(rates, baseCurrency = 'USD') {
  return (amount, fromCurrency, toCurrency) => {
    if (!amount || !rates) return amount || 0
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseCurrency || 'USD').toUpperCase()
    if (from === to) return amount
    const fromRate = rates[from]
    const toRate = rates[to]
    if (!fromRate || !toRate) return amount
    const result = (amount / fromRate) * toRate
    return isFinite(result) ? result : amount
  }
}

// Simulates the getRate function from useExchangeRates.js (lines 73-85)
function createGetRate(rates, baseCurrency = 'USD') {
  return (fromCurrency, toCurrency) => {
    if (!rates) return 1
    const from = (fromCurrency || 'USD').toUpperCase()
    const to = (toCurrency || baseCurrency || 'USD').toUpperCase()
    if (from === to) return 1
    const fromRate = rates[from]
    const toRate = rates[to]
    if (!fromRate || !toRate) return 1
    return toRate / fromRate
  }
}

// Realistic rates (USD-based, as returned by the exchange rate API)
const RATES = {
  USD: 1,
  GTQ: 7.75,
  MXN: 17.15,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  BTC: 0.000015,
}

describe('convert()', () => {
  const convert = createConvert(RATES)

  describe('same currency', () => {
    it('returns the same amount when from === to', () => {
      expect(convert(100, 'USD', 'USD')).toBe(100)
    })

    it('is case-insensitive', () => {
      expect(convert(100, 'usd', 'USD')).toBe(100)
      expect(convert(100, 'Usd', 'usd')).toBe(100)
    })
  })

  describe('USD to GTQ', () => {
    it('converts correctly with known rate', () => {
      // 100 USD * (7.75 / 1) = 775 GTQ
      expect(convert(100, 'USD', 'GTQ')).toBe(775)
    })
  })

  describe('GTQ to USD (inverse)', () => {
    it('converts correctly', () => {
      // 775 GTQ * (1 / 7.75) = 100 USD
      expect(convert(775, 'GTQ', 'USD')).toBeCloseTo(100, 10)
    })
  })

  describe('cross-currency (GTQ -> MXN via USD pivot)', () => {
    it('converts GTQ to MXN through USD base', () => {
      // 100 GTQ -> USD: 100 / 7.75 = 12.903..
      // USD -> MXN: 12.903.. * 17.15 = 221.29..
      const result = convert(100, 'GTQ', 'MXN')
      expect(result).toBeCloseTo((100 / 7.75) * 17.15, 8)
    })

    it('cross-currency round-trip is consistent', () => {
      const gtqToMxn = convert(1000, 'GTQ', 'MXN')
      const convertBack = createConvert(RATES)
      const mxnToGtq = convertBack(gtqToMxn, 'MXN', 'GTQ')
      expect(mxnToGtq).toBeCloseTo(1000, 8)
    })
  })

  describe('missing rate', () => {
    it('returns original amount when from currency is unknown', () => {
      expect(convert(100, 'XYZ', 'USD')).toBe(100)
    })

    it('returns original amount when to currency is unknown', () => {
      expect(convert(100, 'USD', 'XYZ')).toBe(100)
    })

    it('returns original amount when both currencies are unknown', () => {
      expect(convert(100, 'ABC', 'XYZ')).toBe(100)
    })
  })

  describe('zero amount', () => {
    it('returns 0 for zero amount', () => {
      // The function does !amount check first, so 0 is falsy => returns amount || 0 = 0
      expect(convert(0, 'USD', 'GTQ')).toBe(0)
    })
  })

  describe('null/undefined handling', () => {
    it('returns 0 for null amount', () => {
      expect(convert(null, 'USD', 'GTQ')).toBe(0)
    })

    it('returns 0 for undefined amount', () => {
      expect(convert(undefined, 'USD', 'GTQ')).toBe(0)
    })

    it('defaults fromCurrency to USD when null', () => {
      // null from => USD, to GTQ: 100 * 7.75 = 775
      expect(convert(100, null, 'GTQ')).toBe(775)
    })

    it('defaults toCurrency to baseCurrency when null', () => {
      const convertWithBase = createConvert(RATES, 'GTQ')
      // from USD, to defaults to GTQ: 100 * 7.75 = 775
      expect(convertWithBase(100, 'USD', null)).toBe(775)
    })

    it('returns amount when rates object is null', () => {
      const noRates = createConvert(null)
      expect(noRates(100, 'USD', 'GTQ')).toBe(100)
    })
  })

  describe('NaN/Infinity rate handling', () => {
    it('returns original amount when rate would produce Infinity', () => {
      const badRates = { USD: 0, GTQ: 7.75 }
      const convertBad = createConvert(badRates)
      // 100 / 0 * 7.75 = Infinity, isFinite check should catch it
      expect(convertBad(100, 'USD', 'GTQ')).toBe(100)
    })

    it('handles NaN rate gracefully', () => {
      // NaN rates are filtered out by the hook (line 27-28: v > 0 && isFinite(v))
      // but if they snuck through, the convert function should handle it
      const badRates = { USD: 1, GTQ: NaN }
      const convertBad = createConvert(badRates)
      // NaN is falsy for the !toRate check, so returns amount
      expect(convertBad(100, 'USD', 'GTQ')).toBe(100)
    })
  })

  describe('very large amounts', () => {
    it('handles very large amounts without overflow', () => {
      const result = convert(1e15, 'USD', 'GTQ')
      expect(result).toBe(1e15 * 7.75)
      expect(isFinite(result)).toBe(true)
    })
  })

  describe('very small fractional amounts', () => {
    it('handles sub-cent amounts', () => {
      const result = convert(0.001, 'USD', 'GTQ')
      expect(result).toBeCloseTo(0.00775, 10)
    })

    it('handles satoshi-level crypto amounts', () => {
      // Convert 0.00000001 BTC to USD
      // 0.00000001 / 0.000015 * 1 = 0.000666..
      const result = convert(0.00000001, 'BTC', 'USD')
      expect(result).toBeCloseTo(0.00000001 / 0.000015, 8)
      expect(isFinite(result)).toBe(true)
    })
  })

  describe('negative amounts', () => {
    it('converts negative amounts correctly (e.g., losses)', () => {
      // negative amounts: !amount is false for negative numbers, so it converts
      expect(convert(-100, 'USD', 'GTQ')).toBe(-775)
    })
  })
})

describe('getRate()', () => {
  const getRate = createGetRate(RATES)

  it('returns 1 for same currency', () => {
    expect(getRate('USD', 'USD')).toBe(1)
  })

  it('returns correct rate USD to GTQ', () => {
    expect(getRate('USD', 'GTQ')).toBe(7.75)
  })

  it('returns inverse rate GTQ to USD', () => {
    expect(getRate('GTQ', 'USD')).toBeCloseTo(1 / 7.75, 10)
  })

  it('returns 1 when rates is null', () => {
    const noRates = createGetRate(null)
    expect(noRates('USD', 'GTQ')).toBe(1)
  })

  it('returns 1 when currency is missing', () => {
    expect(getRate('USD', 'XYZ')).toBe(1)
    expect(getRate('XYZ', 'USD')).toBe(1)
  })

  it('defaults from to USD when null', () => {
    expect(getRate(null, 'GTQ')).toBe(7.75)
  })

  it('defaults to to baseCurrency when null', () => {
    const getRateGTQ = createGetRate(RATES, 'GTQ')
    // null to => GTQ, from USD => 7.75 / 1 = 7.75
    expect(getRateGTQ('USD', null)).toBe(7.75)
  })

  it('cross-currency rate is consistent with convert', () => {
    const convert = createConvert(RATES)
    const rate = getRate('GTQ', 'MXN')
    const converted = convert(1000, 'GTQ', 'MXN')
    expect(converted).toBeCloseTo(1000 * rate, 8)
  })
})
