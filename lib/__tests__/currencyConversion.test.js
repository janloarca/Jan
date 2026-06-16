/**
 * Integration-style tests for multi-currency portfolio scenarios.
 *
 * These test the interplay between exchange rate conversion and portfolio items,
 * simulating what useDashboardData does when enriching items with converted values.
 */

// Recreate the convert function (from useExchangeRates.js)
function createConvert(rates, baseCurrency = 'USD') {
  return (amount, from, to) => {
    if (!amount || !rates) return amount || 0
    from = (from || 'USD').toUpperCase()
    to = (to || baseCurrency || 'USD').toUpperCase()
    if (from === to) return amount
    const fromRate = rates[from]
    const toRate = rates[to]
    if (!fromRate || !toRate) return amount
    const result = (amount / fromRate) * toRate
    return isFinite(result) ? result : amount
  }
}

// Recreate convertItemValue (from useExchangeRates.js lines 87-94)
function createConvertItemValue(rates, baseCurrency = 'USD') {
  const convert = createConvert(rates, baseCurrency)
  return (item) => {
    const qty = item.quantity || 0
    const price = item.currentPrice || item.purchasePrice || item.price || item.cost || 0
    const itemCurrency = item.marketCurrency || item.currency || 'USD'
    const rawValue = qty * price
    if (!isFinite(rawValue)) return 0
    return convert(rawValue, itemCurrency, baseCurrency)
  }
}

// Simulates how useDashboardData enriches items
function enrichItem(item, convert, baseCurrency) {
  const itemCurrency = item.marketCurrency || item.currency || 'USD'
  const currentPrice = convert(item.currentPrice || 0, itemCurrency, baseCurrency)
  const purchasePrice = convert(item.purchasePrice || 0, itemCurrency, baseCurrency)
  return {
    ...item,
    currentPrice,
    purchasePrice,
    _originalPrice: item.currentPrice,
    _originalPurchasePrice: item.purchasePrice,
    _originalCurrency: itemCurrency,
  }
}

const RATES = {
  USD: 1,
  GTQ: 7.75,
  MXN: 17.15,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
}

describe('Multi-currency portfolio item conversion', () => {
  describe('Item in GTQ, baseCurrency USD', () => {
    const convert = createConvert(RATES, 'USD')
    const convertItemValue = createConvertItemValue(RATES, 'USD')

    it('converts item value from GTQ to USD correctly', () => {
      const item = {
        quantity: 100,
        currentPrice: 775, // 775 GTQ
        currency: 'GTQ',
      }
      const value = convertItemValue(item)
      // 100 * 775 GTQ = 77500 GTQ -> USD: 77500 / 7.75 = 10000
      expect(value).toBeCloseTo(10000, 2)
    })

    it('enriches prices to baseCurrency', () => {
      const item = {
        currentPrice: 77.5,
        purchasePrice: 62,
        currency: 'GTQ',
      }
      const enriched = enrichItem(item, convert, 'USD')
      expect(enriched.currentPrice).toBeCloseTo(10, 2) // 77.5 / 7.75 = 10
      expect(enriched.purchasePrice).toBeCloseTo(8, 2) // 62 / 7.75 = 8
      expect(enriched._originalPrice).toBe(77.5)
      expect(enriched._originalPurchasePrice).toBe(62)
      expect(enriched._originalCurrency).toBe('GTQ')
    })
  })

  describe('Item in USD, baseCurrency GTQ', () => {
    const convert = createConvert(RATES, 'GTQ')
    const convertItemValue = createConvertItemValue(RATES, 'GTQ')

    it('converts USD item to GTQ without double conversion', () => {
      const item = {
        quantity: 10,
        currentPrice: 100, // 100 USD
        currency: 'USD',
      }
      const value = convertItemValue(item)
      // 10 * 100 USD = 1000 USD -> GTQ: 1000 * 7.75 = 7750
      expect(value).toBeCloseTo(7750, 2)
    })

    it('does not convert when item currency is already baseCurrency', () => {
      const item = {
        quantity: 10,
        currentPrice: 1000, // 1000 GTQ
        currency: 'GTQ',
      }
      const value = convertItemValue(item)
      // Already in GTQ, should be 10 * 1000 = 10000
      expect(value).toBe(10000)
    })
  })

  describe('Rate of 1.0 (same effective currency)', () => {
    it('returns the same value when rate is 1:1', () => {
      const ratesWithPeg = { ...RATES, PEG: 1 } // pegged to USD
      const convert = createConvert(ratesWithPeg, 'USD')
      expect(convert(100, 'PEG', 'USD')).toBe(100)
      expect(convert(100, 'USD', 'PEG')).toBe(100)
    })
  })

  describe('Missing rate for exotic currency', () => {
    const convert = createConvert(RATES, 'USD')
    const convertItemValue = createConvertItemValue(RATES, 'USD')

    it('returns unconverted value when item currency is not in rates', () => {
      const item = {
        quantity: 10,
        currentPrice: 500,
        currency: 'XAF', // not in RATES
      }
      const value = convertItemValue(item)
      // convert returns the raw value since XAF rate is missing
      expect(value).toBe(5000) // 10 * 500, unchanged
    })

    it('convert returns original amount for exotic from-currency', () => {
      expect(convert(100, 'XAF', 'USD')).toBe(100)
    })

    it('convert returns original amount for exotic to-currency', () => {
      expect(convert(100, 'USD', 'XAF')).toBe(100)
    })
  })

  describe('null/undefined baseCurrency defaults to USD', () => {
    it('defaults baseCurrency to USD when null', () => {
      const convert = createConvert(RATES, null)
      // to defaults to baseCurrency || 'USD' = 'USD'
      expect(convert(100, 'GTQ', null)).toBeCloseTo(100 / 7.75, 8)
    })

    it('defaults baseCurrency to USD when undefined', () => {
      const convert = createConvert(RATES, undefined)
      expect(convert(100, 'GTQ', undefined)).toBeCloseTo(100 / 7.75, 8)
    })

    it('convertItemValue defaults to USD when baseCurrency is null', () => {
      const convertItemValue = createConvertItemValue(RATES, null)
      const item = { quantity: 1, currentPrice: 7.75, currency: 'GTQ' }
      // 7.75 GTQ -> USD = 1 USD
      expect(convertItemValue(item)).toBeCloseTo(1, 8)
    })
  })

  describe('Portfolio total with mixed currencies', () => {
    it('calculates correct total when items are in different currencies', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const items = [
        { quantity: 10, currentPrice: 150, currency: 'USD' },    // 1500 USD
        { quantity: 100, currentPrice: 77.5, currency: 'GTQ' },  // 7750 GTQ -> 1000 USD
        { quantity: 5, currentPrice: 100, currency: 'EUR' },     // 500 EUR -> 500/0.92 = ~543.48 USD
      ]
      const total = items.reduce((sum, item) => sum + convertItemValue(item), 0)
      const expected = 1500 + (100 * 77.5 / 7.75) + (5 * 100 / 0.92)
      expect(total).toBeCloseTo(expected, 2)
    })
  })

  describe('Edge cases with item price fallbacks', () => {
    it('falls back to purchasePrice when currentPrice is missing', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: 10, purchasePrice: 100, currency: 'USD' }
      expect(convertItemValue(item)).toBe(1000)
    })

    it('falls back to price field when currentPrice and purchasePrice missing', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: 10, price: 50, currency: 'USD' }
      expect(convertItemValue(item)).toBe(500)
    })

    it('falls back to cost field as last resort', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: 10, cost: 25, currency: 'USD' }
      expect(convertItemValue(item)).toBe(250)
    })

    it('returns 0 when no price fields exist', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: 10, currency: 'USD' }
      expect(convertItemValue(item)).toBe(0)
    })

    it('returns 0 when quantity is 0', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: 0, currentPrice: 100, currency: 'USD' }
      expect(convertItemValue(item)).toBe(0)
    })

    it('returns 0 for NaN raw value', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: NaN, currentPrice: 100, currency: 'USD' }
      expect(convertItemValue(item)).toBe(0)
    })

    it('returns 0 for Infinity raw value', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = { quantity: Infinity, currentPrice: 100, currency: 'USD' }
      expect(convertItemValue(item)).toBe(0)
    })
  })

  describe('marketCurrency takes precedence over currency', () => {
    it('uses marketCurrency when both are present', () => {
      const convertItemValue = createConvertItemValue(RATES, 'USD')
      const item = {
        quantity: 1,
        currentPrice: 100,
        marketCurrency: 'EUR',  // should be used
        currency: 'GTQ',        // should be ignored
      }
      const value = convertItemValue(item)
      // 100 EUR -> USD: 100 / 0.92 = ~108.70
      expect(value).toBeCloseTo(100 / 0.92, 2)
    })
  })

  describe('Currency picker simulation (temporary currency switch)', () => {
    it('all derived values convert consistently when switching display currency', () => {
      const baseCurrency = 'GTQ'
      const convert = createConvert(RATES, baseCurrency)

      const item = {
        currentPrice: 150,   // USD
        purchasePrice: 100,  // USD
        quantity: 10,
        currency: 'USD',
      }

      // Simulate enrichment to GTQ
      const enriched = enrichItem(item, convert, baseCurrency)

      // All enriched values should be in GTQ
      expect(enriched.currentPrice).toBeCloseTo(150 * 7.75, 2)  // 1162.5
      expect(enriched.purchasePrice).toBeCloseTo(100 * 7.75, 2) // 775

      // Gain should be consistent: (currentPrice - purchasePrice) * quantity
      const gainInGTQ = (enriched.currentPrice - enriched.purchasePrice) * item.quantity
      const gainInUSD = (item.currentPrice - item.purchasePrice) * item.quantity // 500 USD
      expect(convert(gainInUSD, 'USD', 'GTQ')).toBeCloseTo(gainInGTQ, 2)
    })
  })
})
