import {
  businessDaysSince,
  computeModifiedDietz,
  getItemValue,
  getItemPrice,
  getEffectiveYield,
  projectItemAnnualIncome,
  formatCurrency,
  formatPercent,
  getTypeCategory,
  getGeographyFromSymbol,
  getMaturityInfo,
  augmentSnapshots,
  findYearStartAnchor,
  findMonthStartAnchor,
  computeScopedReturns,
  effectiveAcqTs,
  formatMonth,
  shouldHoldFlat,
} from '../utils'

describe('projectItemAnnualIncome', () => {
  test('variable rate uses the midpoint of min/max', () => {
    const item = { rateType: 'variable', rateMin: 4, rateMax: 6 }
    expect(projectItemAnnualIncome(item, 10000)).toBeCloseTo(500) // 5% of 10k
  })

  test('continuous rate compounds with exp', () => {
    const item = { rateType: 'continuous', incomeRate: 5 }
    expect(projectItemAnnualIncome(item, 10000)).toBeCloseTo(10000 * (Math.exp(0.05) - 1))
  })

  test('fixed incomeAmount multiplies by payment count', () => {
    const item = { incomeAmount: 100, incomeMonths: [0, 3, 6, 9] }
    expect(projectItemAnnualIncome(item, 0)).toBe(400)
  })

  test('percent mode applies incomeRate to balance', () => {
    const item = { incomeMode: 'percent', incomeRate: 3 }
    expect(projectItemAnnualIncome(item, 20000)).toBeCloseTo(600)
  })

  test('dividendYield applies to balance', () => {
    const item = { dividendYield: 2.5 }
    expect(projectItemAnnualIncome(item, 8000)).toBeCloseTo(200)
  })

  test('variable rate takes priority over dividendYield', () => {
    const item = { rateType: 'variable', rateMin: 2, rateMax: 4, dividendYield: 10 }
    expect(projectItemAnnualIncome(item, 10000)).toBeCloseTo(300) // 3%, not 10%
  })

  test('incomeAmount takes priority over percent/dividendYield', () => {
    const item = { incomeAmount: 50, incomeMonths: [0, 6], incomeMode: 'percent', incomeRate: 9, dividendYield: 9 }
    expect(projectItemAnnualIncome(item, 100000)).toBe(100)
  })

  test('returns 0 when no income config applies', () => {
    expect(projectItemAnnualIncome({}, 10000)).toBe(0)
    expect(projectItemAnnualIncome({ dividendYield: 0 }, 10000)).toBe(0)
  })
})

describe('augmentSnapshots', () => {
  const idConvert = (v) => v // USD passthrough
  const ibkrSnap = { date: '2026-03-31', _source: 'ibkr', netWorthUSD: 1000, totalActivosUSD: 1000 }
  const dailySnap = { date: '2026-03-31', netWorthUSD: 5000, totalActivosUSD: 5000 }
  const bond = { id: 'b1', symbol: 'BND', quantity: 1, currentPrice: 300, _originalPrice: 300, _originalCurrency: 'USD', acquisitionDate: '2025-01-01' }

  test('augments only IBKR entries with non-IBKR held-flat value', () => {
    const out = augmentSnapshots([ibkrSnap], [bond], idConvert)
    expect(out[0].netWorthUSD).toBe(1300)
    expect(out[0].totalActivosUSD).toBe(1300)
  })

  test('leaves non-IBKR (daily) snapshots untouched', () => {
    const out = augmentSnapshots([dailySnap], [bond], idConvert)
    expect(out[0].netWorthUSD).toBe(5000)
  })

  test('gates by acquisition date (asset bought after the snapshot is not added)', () => {
    const future = { ...bond, acquisitionDate: '2026-06-01' }
    const out = augmentSnapshots([ibkrSnap], [future], idConvert)
    expect(out[0].netWorthUSD).toBe(1000)
  })

  test('no non-IBKR items → original array, snapshots not mutated', () => {
    const snaps = [{ ...ibkrSnap }]
    const out = augmentSnapshots(snaps, [{ id: 'x', _source: 'ibkr', quantity: 1, currentPrice: 10 }], idConvert)
    expect(out).toBe(snaps)
    expect(snaps[0].netWorthUSD).toBe(1000)
  })
})

describe('effectiveAcqTs', () => {
  test('uses acquisitionDate when present', () => {
    expect(effectiveAcqTs({ acquisitionDate: '2024-05-10' })).toBe(Date.parse('2024-05-10'))
  })

  test('falls back to Jan 1 of createdAt year', () => {
    expect(effectiveAcqTs({ createdAt: '2023-07-15T12:00:00Z' })).toBe(Date.UTC(2023, 0, 1))
  })

  test('null when neither is present', () => {
    expect(effectiveAcqTs({})).toBeNull()
  })
})

describe('formatMonth', () => {
  test('YYYY-MM → short month + 2-digit year', () => {
    expect(formatMonth('2026-06')).toBe('Jun 26')
  })

  test('non-string / invalid input is returned as-is', () => {
    expect(formatMonth(null)).toBe('')
    expect(formatMonth('garbage')).toBe('garbage')
  })
})

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

describe('findYearStartAnchor', () => {
  const year = 2026

  it('prefers a January snapshot of the target year', () => {
    const snaps = [
      { date: '2025-12-28', netWorthUSD: 90 },
      { date: '2026-01-05', netWorthUSD: 100 },
      { date: '2026-03-01', netWorthUSD: 120 },
    ]
    expect(findYearStartAnchor(snaps, year).date).toBe('2026-01-05')
  })

  it('falls back to late December of the prior year', () => {
    const snaps = [
      { date: '2025-12-29', netWorthUSD: 90 },
      { date: '2026-04-01', netWorthUSD: 120 },
    ]
    expect(findYearStartAnchor(snaps, year).date).toBe('2025-12-29')
  })

  it('rejects anchors outside the 15-day window of Jan 1', () => {
    const snaps = [
      { date: '2026-01-25', netWorthUSD: 100 },
      { date: '2026-06-01', netWorthUSD: 130 },
    ]
    expect(findYearStartAnchor(snaps, year)).toBeNull()
  })

  it('picks the LAST December snapshot when several exist', () => {
    const snaps = [
      { date: '2025-12-20', netWorthUSD: 80 },
      { date: '2025-12-30', netWorthUSD: 95 },
    ]
    expect(findYearStartAnchor(snaps, year).date).toBe('2025-12-30')
  })

  it('falls back to Dec-31 when a month-end Jan-31 row fails the window', () => {
    // With month-end stamping, a monthly PortfolioAnalyst export puts the
    // January NAV on '2026-01-31', 30 days from Jan 1. That row already holds
    // January's deposit and gain, so it must NOT anchor YTD; the truthful
    // baseline is the prior year's December month-end.
    const snaps = [
      { date: '2025-12-31', netWorthUSD: 98 },
      { date: '2026-01-31', netWorthUSD: 100 },
      { date: '2026-02-28', netWorthUSD: 103 },
    ]
    expect(findYearStartAnchor(snaps, year).date).toBe('2025-12-31')
  })

  it('returns null when the month-end Jan-31 row has no December fallback', () => {
    const snaps = [
      { date: '2026-01-31', netWorthUSD: 100 },
      { date: '2026-02-28', netWorthUSD: 103 },
    ]
    expect(findYearStartAnchor(snaps, year)).toBeNull()
  })

  it('still accepts a genuine early-January snapshot within the window', () => {
    const snaps = [
      { date: '2025-12-31', netWorthUSD: 98 },
      { date: '2026-01-02', netWorthUSD: 99 },
    ]
    expect(findYearStartAnchor(snaps, year).date).toBe('2026-01-02')
  })

  it('returns null for empty or dateless input', () => {
    expect(findYearStartAnchor([], year)).toBeNull()
    expect(findYearStartAnchor([{ netWorthUSD: 1 }], year)).toBeNull()
    expect(findYearStartAnchor(null, year)).toBeNull()
  })
})

describe('findMonthStartAnchor', () => {
  it('prefers the first snapshot of the target month', () => {
    const snaps = [
      { date: '2026-06-28', netWorthUSD: 90 },
      { date: '2026-07-02', netWorthUSD: 100 },
      { date: '2026-07-20', netWorthUSD: 120 },
    ]
    expect(findMonthStartAnchor(snaps, 2026, 6).date).toBe('2026-07-02') // month 6 = July
  })

  it('falls back to the last snapshot of the prior month (within 5 days)', () => {
    const snaps = [
      { date: '2026-06-29', netWorthUSD: 90 },
      { date: '2026-07-15', netWorthUSD: 120 },
    ]
    expect(findMonthStartAnchor(snaps, 2026, 6).date).toBe('2026-06-29')
  })

  it('handles the January boundary (prior month = prior year December)', () => {
    const snaps = [
      { date: '2025-12-30', netWorthUSD: 80 },
      { date: '2026-02-01', netWorthUSD: 95 },
    ]
    expect(findMonthStartAnchor(snaps, 2026, 0).date).toBe('2025-12-30')
  })

  it('rejects anchors outside the 5-day window of the 1st', () => {
    const snaps = [
      { date: '2026-07-09', netWorthUSD: 100 },
    ]
    expect(findMonthStartAnchor(snaps, 2026, 6)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(findMonthStartAnchor([], 2026, 6)).toBeNull()
    expect(findMonthStartAnchor(null, 2026, 6)).toBeNull()
  })
})

describe('computeScopedReturns', () => {
  const nowTs = Date.UTC(2026, 6, 15) // 2026-07-15
  const snapshots = [
    { date: '2026-01-01', netWorthUSD: 1000, _source: 'ibkr' },
    { date: '2026-07-01', netWorthUSD: 1100, _source: 'ibkr' },
    { date: '2026-07-14', netWorthUSD: 1180, _source: 'ibkr' },
    { date: '2026-01-01', netWorthUSD: 9000, _source: 'daily' }, // whole-portfolio, ignored
  ]
  const items = [
    { quantity: 1, currentPrice: 1200, _source: 'ibkr' },   // IBKR value now = 1200
    { quantity: 1, currentPrice: 5000, _source: 'manual' }, // excluded from IBKR scope
  ]
  const transactions = [
    { type: 'DEPOSIT', totalAmount: 100, currency: 'USD', date: '2026-03-01', _source: 'ibkr' },
    { type: 'DEPOSIT', totalAmount: 2000, currency: 'USD', date: '2026-03-01', _source: 'manual' }, // excluded
  ]
  const args = { snapshots, items, transactions, source: 'ibkr', convert: (v) => v, baseCurrency: 'USD', nowTs }

  it('computes IBKR-scoped YTD from broker NAV + broker flows only', () => {
    const { ytd } = computeScopedReturns(args)
    // gain = 1200 - 1000 - 100 = 100 over ~1069 weighted capital → ~9.3%.
    // If the manual deposit (2000) or manual item (5000) leaked in, this would be
    // negative or huge — so a small positive % proves the scoping.
    expect(ytd).toBeGreaterThan(9)
    expect(ytd).toBeLessThan(10)
  })

  it('computes MTD anchored to the month-start snapshot', () => {
    // start 1100 (Jul 1), end 1200, no flows within July → 100/1100 ≈ 9.09%.
    expect(computeScopedReturns(args).mtd).toBeCloseTo(9.09, 1)
  })

  it('computes daily change vs the last snapshot before today', () => {
    // baseline 1180 (Jul 14) → (1200-1180)/1180 ≈ 1.69%.
    expect(computeScopedReturns(args).day).toBeCloseTo(1.69, 1)
  })

  it('returns nulls when the source has no snapshots or no value', () => {
    expect(computeScopedReturns({ ...args, source: 'alpaca' })).toEqual({ ytd: null, mtd: null, day: null })
    expect(computeScopedReturns({ ...args, items: [] })).toEqual({ ytd: null, mtd: null, day: null })
  })

  it('nets out a same-day deposit from day change instead of reading it as market gain', () => {
    // A statement import lands today with a fresh $900 deposit on top of the
    // Jul 14 baseline (1180). Without netting, (2100-1180)/1180 ≈ 78% "today".
    const freshDeposit = [
      ...transactions,
      { type: 'DEPOSIT', totalAmount: 900, currency: 'USD', date: '2026-07-15', _source: 'ibkr' },
    ]
    const bigItems = [items[0], items[1], { quantity: 1, currentPrice: 900, _source: 'ibkr' }]
    const { day } = computeScopedReturns({ ...args, items: bigItems, transactions: freshDeposit })
    // endValue now 2100, baseline 1180, deposit 900 netted out → (2100-1180-900)/1180 ≈ 1.69%
    expect(day).toBeCloseTo(1.69, 1)
  })
})

describe('shouldHoldFlat', () => {
  const ibkr = { symbol: 'META', _source: 'ibkr' }

  it('holds flat an IBKR position with no trade or lot history', () => {
    expect(shouldHoldFlat(ibkr, [], [])).toBe(true)
  })

  it('does NOT hold flat non-IBKR positions', () => {
    expect(shouldHoldFlat({ symbol: 'META', _source: 'manual' }, [], [])).toBe(false)
    expect(shouldHoldFlat({ symbol: 'META' }, [], [])).toBe(false)
  })

  it('does NOT hold flat when a real BUY/SELL trade exists for the symbol', () => {
    const trades = [{ type: 'BUY', symbol: 'META' }]
    expect(shouldHoldFlat(ibkr, trades, [])).toBe(false)
    expect(shouldHoldFlat(ibkr, [{ type: 'SELL', symbol: 'meta' }], [])).toBe(false)
  })

  it('ignores trades for a different symbol', () => {
    expect(shouldHoldFlat(ibkr, [{ type: 'BUY', symbol: 'AAPL' }])).toBe(true)
  })

  it('does NOT hold flat with real multi-lot or closed-lot history', () => {
    expect(shouldHoldFlat(ibkr, [], [{ symbol: 'META' }, { symbol: 'META' }])).toBe(false)
    expect(shouldHoldFlat(ibkr, [], [{ symbol: 'META', status: 'closed' }])).toBe(false)
  })

  it('still holds flat with a single open import lot', () => {
    expect(shouldHoldFlat(ibkr, [], [{ symbol: 'META', status: 'open' }])).toBe(true)
  })

  it('guards against missing symbol', () => {
    expect(shouldHoldFlat({ _source: 'ibkr' }, [], [])).toBe(false)
  })
})

describe('businessDaysSince', () => {
  // Fixed reference points so the assertions don't drift with the real clock.
  // 2026-07-28 is a Tuesday.
  const tue = new Date('2026-07-28T12:00:00Z').getTime()

  it('returns 0 for a sync that happened today', () => {
    expect(businessDaysSince(new Date(tue).toISOString(), tue)).toBe(0)
  })

  it('does not count the weekend: Friday -> Monday is 1 business day', () => {
    const fri = new Date('2026-07-24T12:00:00Z').getTime()
    const mon = new Date('2026-07-27T12:00:00Z').getTime()
    expect(businessDaysSince(new Date(fri).toISOString(), mon)).toBe(1)
  })

  it('a sync last Friday is still under the 5-day alarm on the next Thursday', () => {
    const fri = new Date('2026-07-24T12:00:00Z').getTime()
    const thu = new Date('2026-07-30T12:00:00Z').getTime()
    expect(businessDaysSince(new Date(fri).toISOString(), thu)).toBe(4)
  })

  it('reaches 5 business days only on the following Friday', () => {
    const fri = new Date('2026-07-24T12:00:00Z').getTime()
    const nextFri = new Date('2026-07-31T12:00:00Z').getTime()
    expect(businessDaysSince(new Date(fri).toISOString(), nextFri)).toBe(5)
  })

  it('treats a missing or invalid date as infinitely stale', () => {
    expect(businessDaysSince(null, tue)).toBe(Infinity)
    expect(businessDaysSince('not-a-date', tue)).toBe(Infinity)
  })

  it('never returns negative for a future date', () => {
    const future = new Date('2026-08-05T12:00:00Z').toISOString()
    expect(businessDaysSince(future, tue)).toBe(0)
  })
})
