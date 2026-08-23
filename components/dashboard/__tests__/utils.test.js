import {
  businessDaysSince,
  ibkrAttentionNeeded,
  entryFeeAddbacks,
  computeModifiedDietz,
  getItemValue,
  getItemPrice,
  isBankLike,
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
  computeDayChange,
  quarterEndDate,
  quartersBetween,
  quarterSnapshotDate,
  getDividendIncomeByItem,
  getIncomeReceivedByItem,
  getInvestedCapital,
  getItemCostBasis,
  getItemPrincipalCost,
  isMarketPriced,
  DEBT_CLARIFICATION,
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
  // A synced IBKR NAV only describes the portfolio when the portfolio actually
  // holds IBKR positions, so the top-up fixtures carry one (see the orphan test).
  const ibkrPos = { id: 'i1', symbol: 'AAPL', _source: 'ibkr', quantity: 1, currentPrice: 10, _originalPrice: 10, _originalCurrency: 'USD', acquisitionDate: '2025-01-01' }

  test('augments only IBKR entries with non-IBKR held-flat value', () => {
    const out = augmentSnapshots([ibkrSnap], [bond, ibkrPos], idConvert)
    expect(out[0].netWorthUSD).toBe(1300)
    expect(out[0].totalActivosUSD).toBe(1300)
  })

  test('leaves non-IBKR (daily) snapshots untouched', () => {
    const out = augmentSnapshots([dailySnap], [bond, ibkrPos], idConvert)
    expect(out[0].netWorthUSD).toBe(5000)
  })

  test('gates by acquisition date (asset bought after the snapshot is not added)', () => {
    const future = { ...bond, acquisitionDate: '2026-06-01' }
    const out = augmentSnapshots([ibkrSnap], [future, ibkrPos], idConvert)
    expect(out[0].netWorthUSD).toBe(1000)
  })

  // FASE DW: a synced IBKR NAV left behind by an account whose positions are no
  // longer in the portfolio measures money netWorth does not count. Topping it up
  // with the manual assets produced a series worth 2x the headline.
  test('drops a synced IBKR NAV when the portfolio holds no IBKR position', () => {
    const out = augmentSnapshots([ibkrSnap], [bond], idConvert)
    expect(out).toEqual([])
  })

  test('keeps a transcribed quarter even with no IBKR position (typed by hand, often before any import)', () => {
    const q = { date: '2026-03-31', _source: 'ibkr_quarterly', netWorthUSD: 1000, totalActivosUSD: 1000 }
    const out = augmentSnapshots([q], [bond], idConvert)
    expect(out).toHaveLength(1)
    expect(out[0].netWorthUSD).toBe(1300)
  })

  test('never drops anything before the items have loaded', () => {
    const snaps = [ibkrSnap]
    expect(augmentSnapshots(snaps, [], idConvert)).toBe(snaps)
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

describe('isMarketPriced', () => {
  test('a public stock with a symbol is market-priced', () => {
    expect(isMarketPriced({ type: 'Stock', symbol: 'AAPL' })).toBe(true)
  })

  test('private common/preferred stock is NOT market-priced despite type Stock', () => {
    // Regression: item.type is still 'Stock' for a private company's shares
    // (it matches MARKET_TYPE_RE on its own), so without checking subtype the
    // synthetic slug symbol AddAccountModal builds from the company name
    // would trigger a live Yahoo Finance fetch that can collide with an
    // unrelated real ticker (FASE FB).
    expect(isMarketPriced({ type: 'Stock', subtype: 'private_common', symbol: 'ACME-INC' })).toBe(false)
    expect(isMarketPriced({ type: 'Stock', subtype: 'private_preferred', symbol: 'ACME-INC' })).toBe(false)
  })

  test('legacy private subtype (pre-split) is also excluded', () => {
    expect(isMarketPriced({ type: 'Stock', subtype: 'private', symbol: 'ACME-INC' })).toBe(false)
  })

  test('an item with no symbol is never market-priced', () => {
    expect(isMarketPriced({ type: 'Stock' })).toBe(false)
  })

  test('a bond is never market-priced regardless of symbol', () => {
    expect(isMarketPriced({ type: 'Bond', symbol: 'VITALI' })).toBe(false)
  })
})

describe('DEBT_CLARIFICATION', () => {
  test('states in both locales that a liability is not an investment instrument', () => {
    expect(DEBT_CLARIFICATION.es).toMatch(/pasivo/i)
    expect(DEBT_CLARIFICATION.es).toMatch(/no es un instrumento de inversión/i)
    expect(DEBT_CLARIFICATION.en).toMatch(/liability/i)
    expect(DEBT_CLARIFICATION.en).toMatch(/not an investment instrument/i)
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

  it('computes daily change from today\'s price moves inside the scope', () => {
    // The scoped day change follows the same rule as the headline HOY: what
    // prices did today, not a diff against yesterday's snapshot.
    const moved = [{ ...items[0], change1d: 2 }, items[1]]
    // 1200 × 2% = +24 on a 1176 start → ~2.04%.
    expect(computeScopedReturns({ ...args, items: moved }).day).toBeCloseTo(2.04, 1)
  })

  it('claims nothing for the day when no scoped price moved', () => {
    expect(computeScopedReturns(args).day).toBeNull()
  })

  it('returns nulls when the source has no snapshots or no value', () => {
    expect(computeScopedReturns({ ...args, source: 'alpaca' })).toEqual({ ytd: null, mtd: null, day: null })
    expect(computeScopedReturns({ ...args, items: [] })).toEqual({ ytd: null, mtd: null, day: null })
  })

  it('never reads money that arrived today as a gain', () => {
    // A statement import lands today with a fresh $900 deposit on top of the
    // Jul 14 baseline (1180). A snapshot diff called that +78% "today"; the
    // event-based rule only ever counts what prices and income actually did.
    const freshDeposit = [
      ...transactions,
      { type: 'DEPOSIT', totalAmount: 900, currency: 'USD', date: '2026-07-15', _source: 'ibkr' },
    ]
    const bigItems = [
      { ...items[0], change1d: 2 }, items[1],
      { quantity: 1, currentPrice: 900, _source: 'ibkr' },
    ]
    const { day } = computeScopedReturns({ ...args, items: bigItems, transactions: freshDeposit })
    // Only the +24 from the priced position counts: 24 / (2100-24) ≈ 1.16%.
    expect(day).toBeCloseTo(1.16, 1)
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
    expect(shouldHoldFlat(ibkr, [{ type: 'BUY', symbol: 'AAPL' }], [])).toBe(true)
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

// FASE IA: bordes del helper de addback de comisiones (el caso central, con el
// caso VITALI completo, vive en lib/__tests__/corporateBondWithEntryFee.test.js).
describe('entryFeeAddbacks', () => {
  const jan1 = new Date('2026-01-01T00:00:00Z').getTime()
  const aug = new Date('2026-08-06T00:00:00Z').getTime()
  const bond = { id: 'b1', entryFee: 98, entryFeeMode: 'separate', acquisitionDate: '2026-01-06', currency: 'USD' }
  const dep = { type: 'DEPOSIT', date: '2026-01-06', _linkedItemId: 'b1', totalAmount: 6098 }

  it('modo deducted no devuelve nada: el depósito archivado ya era solo el principal', () => {
    const m = entryFeeAddbacks([{ ...bond, entryFeeMode: 'deducted' }], [dep], { fromTs: jan1, toTs: aug })
    expect(m.size).toBe(0)
  })

  it('una compra ANTERIOR a la ventana no devuelve nada: su comisión ya vive en el arranque', () => {
    const old = { ...bond, acquisitionDate: '2025-06-01' }
    const oldDep = { ...dep, date: '2025-06-01' }
    expect(entryFeeAddbacks([old], [oldDep], { fromTs: jan1, toTs: aug }).size).toBe(0)
  })

  it('sin el depósito vinculado en la lista neteada, no hay nada que devolver', () => {
    expect(entryFeeAddbacks([bond], [], { fromTs: jan1, toTs: aug }).size).toBe(0)
    const unlinked = { ...dep, _linkedItemId: null }
    expect(entryFeeAddbacks([bond], [unlinked], { fromTs: jan1, toTs: aug }).size).toBe(0)
  })

  it('convierte la comisión a la moneda base con el mismo convert del caller', () => {
    const q = { ...bond, currency: 'GTQ' }
    const conv = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const m = entryFeeAddbacks([q], [dep], { fromTs: jan1, toTs: aug, convert: conv, baseCurrency: 'USD' })
    expect(m.get('b1')).toBeCloseTo(98 / 7.7, 9)
  })
})

// FASE HX: la regla del usuario, textual: "el periodo en que aparezca es si no
// se conecta en 5 dias habiles ... Ayer se conecto entonces no paso ni un dia".
describe('ibkrAttentionNeeded', () => {
  // 2026-08-12 is a Wednesday (the day the user reported the bug).
  const wed = new Date('2026-08-12T12:00:00Z').getTime()
  const tueBefore = new Date('2026-08-11T12:00:00Z').toISOString()

  it('is quiet with no error code, regardless of stamps', () => {
    expect(ibkrAttentionNeeded({ errorCode: null }, wed)).toBe(false)
    expect(ibkrAttentionNeeded({ errorCode: '' , connectedAt: tueBefore }, wed)).toBe(false)
  })

  it("the user's exact case: credentials saved YESTERDAY, sync failing today, never synced -> quiet", () => {
    expect(ibkrAttentionNeeded({ errorCode: 'UNKNOWN', connectedAt: tueBefore }, wed)).toBe(false)
  })

  it('regression-negative: the old 2-business-day short fuse for never-synced connections is gone', () => {
    // Connected Friday 2026-08-07, failing on Wednesday 2026-08-12 = 3 business
    // days. The old rule (>= 2) alarmed here; the unified 5-day rule stays quiet.
    const fri = new Date('2026-08-07T12:00:00Z').toISOString()
    expect(ibkrAttentionNeeded({ errorCode: 'TIMEOUT', connectedAt: fri }, wed)).toBe(false)
  })

  it('fatal codes (TOKEN_EXPIRED / INVALID_QUERY) also wait the 5 business days', () => {
    // Previously they alarmed from the very first failed attempt.
    expect(ibkrAttentionNeeded({ errorCode: 'TOKEN_EXPIRED', lastAutoSync: tueBefore }, wed)).toBe(false)
    expect(ibkrAttentionNeeded({ errorCode: 'INVALID_QUERY', lastSync: tueBefore }, wed)).toBe(false)
  })

  it('the clock is the MOST RECENT stamp, never a first-truthy || walk', () => {
    // A months-old manual sync must not outrank yesterday's successful
    // auto-sync (doAutoSync only stamps _ibkrLastAutoSync).
    const monthsAgo = new Date('2026-05-04T12:00:00Z').toISOString()
    expect(ibkrAttentionNeeded({ errorCode: 'LOCKED', lastSync: monthsAgo, lastAutoSync: tueBefore }, wed)).toBe(false)
  })

  it('alarms once 5 business days pass without any connection signal', () => {
    // Friday 2026-07-24 -> Friday 2026-07-31 is exactly 5 business days
    // (mirrors the businessDaysSince fixture above).
    const fri = new Date('2026-07-24T12:00:00Z').toISOString()
    const nextFri = new Date('2026-07-31T12:00:00Z').getTime()
    expect(ibkrAttentionNeeded({ errorCode: 'UNKNOWN', connectedAt: fri }, nextFri)).toBe(true)
    expect(ibkrAttentionNeeded({ errorCode: 'TOKEN_EXPIRED', lastSync: fri }, nextFri)).toBe(true)
  })

  it('alarms immediately when there is no stamp at all (no evidence it ever worked)', () => {
    expect(ibkrAttentionNeeded({ errorCode: 'UNKNOWN' }, wed)).toBe(true)
    expect(ibkrAttentionNeeded({ errorCode: 'UNKNOWN', connectedAt: 'not-a-date' }, wed)).toBe(true)
  })
})

describe('getDividendIncomeByItem', () => {
  const bond = { id: 'bond1', dividendAction: 'cash' }
  const reinvestingFund = { id: 'fund1', dividendAction: 'reinvest' }

  it('attributes a cash dividend to the SOURCE item, not wherever it settled', () => {
    const transactions = [
      { type: 'DIVIDEND', totalAmount: 240, currency: 'USD', date: '2026-05-15', _linkedItemId: 'bond1' },
    ]
    const map = getDividendIncomeByItem(transactions, [bond], null, 'USD')
    expect(map.get('bond1')).toBe(240)
  })

  it('excludes reinvested dividends — that gain already shows as higher quantity/value', () => {
    const transactions = [
      { type: 'DIVIDEND', totalAmount: 50, currency: 'USD', date: '2026-05-15', _linkedItemId: 'fund1', _reinvested: true },
      { type: 'DIVIDEND', totalAmount: 30, currency: 'USD', date: '2026-06-15', _linkedItemId: 'fund1' }, // item.dividendAction says reinvest too
    ]
    const map = getDividendIncomeByItem(transactions, [reinvestingFund], null, 'USD')
    expect(map.has('fund1')).toBe(false)
  })

  it('sums multiple payments for the same item', () => {
    const transactions = [
      { type: 'DIVIDEND', totalAmount: 240, currency: 'USD', date: '2026-05-15', _linkedItemId: 'bond1' },
      { type: 'DIVIDEND', totalAmount: 240, currency: 'USD', date: '2026-12-15', _linkedItemId: 'bond1' },
    ]
    const map = getDividendIncomeByItem(transactions, [bond], null, 'USD')
    expect(map.get('bond1')).toBe(480)
  })

  it('converts to the target currency', () => {
    const transactions = [
      { type: 'DIVIDEND', totalAmount: 100, currency: 'GTQ', date: '2026-05-15', _linkedItemId: 'bond1' },
    ]
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD' ? amt / 7.8 : amt)
    const map = getDividendIncomeByItem(transactions, [bond], convert, 'USD')
    expect(map.get('bond1')).toBeCloseTo(100 / 7.8)
  })

  it('ignores non-DIVIDEND transactions and unlinked ones', () => {
    const transactions = [
      { type: 'DEPOSIT', totalAmount: 6000, currency: 'USD', date: '2026-01-06', _linkedItemId: 'bond1' },
      { type: 'DIVIDEND', totalAmount: 240, currency: 'USD', date: '2026-05-15' }, // no _linkedItemId
    ]
    const map = getDividendIncomeByItem(transactions, [bond], null, 'USD')
    expect(map.size).toBe(0)
  })

  it('returns an empty map for no transactions', () => {
    expect(getDividendIncomeByItem([], [bond], null, 'USD').size).toBe(0)
    expect(getDividendIncomeByItem(null, [bond], null, 'USD').size).toBe(0)
  })
})

describe('getItemCostBasis', () => {
  it('is just quantity × purchasePrice when there is no entry fee', () => {
    expect(getItemCostBasis({ quantity: 1, purchasePrice: 6000 })).toBe(6000)
  })

  it('adds the one-time entry fee on top of the purchase cost', () => {
    expect(getItemCostBasis({ quantity: 1, purchasePrice: 6000, entryFee: 95.78 })).toBeCloseTo(6095.78)
  })

  it('scales with quantity for share-based items', () => {
    expect(getItemCostBasis({ quantity: 10, purchasePrice: 150, entryFee: 5 })).toBeCloseTo(1505)
  })

  it('treats a missing quantity/price/fee as 0, never NaN', () => {
    expect(getItemCostBasis({})).toBe(0)
  })

  it('getItemPrincipalCost excludes the fee that getItemCostBasis includes', () => {
    const bond = { quantity: 1, purchasePrice: 6000, entryFee: 95.78 }
    expect(getItemPrincipalCost(bond)).toBe(6000)
    expect(getItemCostBasis(bond)).toBeCloseTo(6095.78)
  })

  // The real VITALI case: a $6,000 bond bought for $6,095.78 all-in that has
  // paid $240 of interest. Gain is measured against principal, the % divides
  // by all-in cost, so the fee drags the yield 4.00% -> 3.94% without also
  // being charged as a capital loss.
  it('yields the expected 3.94% for a bond with an entry fee', () => {
    const bond = { quantity: 1, purchasePrice: 6000, currentPrice: 6000, entryFee: 95.78 }
    const value = 6000
    const income = 240
    const gain = (value - getItemPrincipalCost(bond)) + income
    const pct = (gain / getItemCostBasis(bond)) * 100
    expect(gain).toBeCloseTo(240)
    expect(pct).toBeCloseTo(3.94, 2)
  })

  // entryFeeMode 'deducted': the $6,000 you sent already contained the fee, so
  // only $5,904.22 bought the bond and nothing is added on top.
  it("entryFeeMode 'deducted' keeps the fee inside the amount sent", () => {
    const bond = { quantity: 1, purchasePrice: 6000, entryFee: 95.78, entryFeeMode: 'deducted' }
    expect(getItemCostBasis(bond)).toBeCloseTo(6000)
    expect(getItemPrincipalCost(bond)).toBeCloseTo(5904.22)
    // The invariant both cards rely on: the gap between the two IS the fee.
    expect(getItemCostBasis(bond) - getItemPrincipalCost(bond)).toBeCloseTo(95.78)
  })

  it('holds the same cost-minus-principal invariant in separate mode', () => {
    const bond = { quantity: 1, purchasePrice: 6000, entryFee: 95.78 }
    expect(getItemCostBasis(bond) - getItemPrincipalCost(bond)).toBeCloseTo(95.78)
  })

  it('defaults to separate mode when entryFeeMode is absent (no behavior change)', () => {
    expect(getItemCostBasis({ quantity: 1, purchasePrice: 100, entryFee: 5 })).toBe(105)
  })
})

describe('computeDayChange', () => {
  const usd = (a) => a
  const today = '2026-08-05'

  it('reports only what prices did today', () => {
    const items = [
      { id: 'a', quantity: 10, currentPrice: 100, change1d: 2 },   // 1000 → +20
      { id: 'b', quantity: 5, currentPrice: 40, change1d: -1 },    // 200 → -2
    ]
    const r = computeDayChange({ items, transactions: [], netWorth: 1200, convert: usd, today })
    expect(r.abs).toBeCloseTo(18, 6)
    expect(r.pct).toBeCloseTo((18 / 1182) * 100, 6)
  })

  // The bug this function exists for: a $6,000 bond bought in January, typed in
  // today, must not read as a $6,000 gain today.
  it('ignores a position typed in today (new money is never a gain)', () => {
    const items = [
      { id: 'stock', quantity: 10, currentPrice: 100, change1d: 1 },      // +10
      { id: 'vitali', quantity: 1, currentPrice: 6000, type: 'bond' },    // no change1d
    ]
    const transactions = [
      { type: 'DEPOSIT', date: '2026-01-06', totalAmount: 6000, currency: 'USD', _linkedItemId: 'vitali' },
    ]
    const r = computeDayChange({ items, transactions, netWorth: 7000, convert: usd, today })
    expect(r.abs).toBeCloseTo(10, 6)
  })

  it('counts a coupon on the day it was paid, not on any other day', () => {
    const items = [{ id: 'stock', quantity: 10, currentPrice: 100, change1d: 0 }]
    const coupon = { type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD' }
    expect(computeDayChange({ items, transactions: [coupon], netWorth: 1240, convert: usd, today }).abs)
      .toBeCloseTo(0, 6)
    expect(computeDayChange({ items, transactions: [coupon], netWorth: 1240, convert: usd, today: '2026-05-15' }).abs)
      .toBeCloseTo(240, 6)
  })

  it('adds a coupon paid today on top of the day\'s market move', () => {
    const items = [{ id: 'stock', quantity: 10, currentPrice: 100, change1d: 1 }]
    const transactions = [{ type: 'DIVIDEND', date: today, totalAmount: 240, currency: 'USD' }]
    expect(computeDayChange({ items, transactions, netWorth: 1250, convert: usd, today }).abs)
      .toBeCloseTo(250, 6)
  })

  it('returns null when there is nothing to measure', () => {
    const items = [{ id: 'cash', quantity: 1, currentPrice: 500, type: 'bank' }]
    expect(computeDayChange({ items, transactions: [], netWorth: 500, convert: usd, today })).toBeNull()
    expect(computeDayChange({ items, transactions: [], netWorth: 0, convert: usd, today })).toBeNull()
  })

  it('skips debt and excluded items', () => {
    const items = [
      { id: 'a', quantity: 10, currentPrice: 100, change1d: 1 },
      { id: 'd', quantity: 1, currentPrice: 1000, change1d: 50, isDebt: true },
    ]
    expect(computeDayChange({ items, transactions: [], netWorth: 1000, convert: usd, today }).abs)
      .toBeCloseTo(10, 6)
  })

  it('converts income to the base currency', () => {
    const items = [{ id: 'a', quantity: 1, currentPrice: 100, change1d: 0 }]
    const transactions = [{ type: 'INTEREST', date: today, totalAmount: 100, currency: 'EUR' }]
    const convert = (amt, from, to) => (from === 'EUR' && to === 'USD' ? amt * 1.1 : amt)
    expect(computeDayChange({ items, transactions, netWorth: 210, convert, baseCurrency: 'USD', today }).abs)
      .toBeCloseTo(110, 6)
  })
})

describe('quarterly NAV helpers', () => {
  it('maps a quarter to its last calendar day', () => {
    expect(quarterEndDate(2026, 1)).toBe('2026-03-31')
    expect(quarterEndDate(2026, 2)).toBe('2026-06-30')
    expect(quarterEndDate(2026, 3)).toBe('2026-09-30')
    expect(quarterEndDate(2026, 4)).toBe('2026-12-31')
    expect(quarterEndDate(2026, 5)).toBeNull()
  })

  it('lists every quarter from a start up to the one containing today', () => {
    const rows = quartersBetween(2025, 3, new Date('2026-08-05T12:00:00Z'))
    expect(rows.map((r) => r.label)).toEqual([
      'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026',
    ])
  })

  it('caps the row count so a mistyped year cannot explode the grid', () => {
    expect(quartersBetween(1900, 1, new Date('2026-08-05T12:00:00Z')).length).toBe(80)
    expect(quartersBetween('abc', 1).length).toBe(0)
  })

  // The open quarter's figure is the value RIGHT NOW, so dating it at the
  // future quarter end would put today's portfolio in the future.
  it('stamps an unfinished quarter with today, a closed one with its end', () => {
    const today = new Date('2026-08-05T12:00:00Z')
    expect(quarterSnapshotDate(2026, 3, today)).toBe('2026-08-05')
    expect(quarterSnapshotDate(2026, 2, today)).toBe('2026-06-30')
  })
})

describe('augmentSnapshots with transcribed quarterly NAV', () => {
  const idConvert = (v) => v
  const bond = { id: 'b1', symbol: 'BND', quantity: 1, currentPrice: 300, _originalPrice: 300, _originalCurrency: 'USD', acquisitionDate: '2025-01-01' }

  it('tops up a transcribed quarter like any other broker-only NAV', () => {
    const snap = { date: '2026-03-31', _source: 'ibkr_quarterly', netWorthUSD: 1000, totalActivosUSD: 1000 }
    const out = augmentSnapshots([snap], [bond], idConvert)
    expect(out[0].netWorthUSD).toBe(1300)
  })
})

// FASE DY: the same 240 was counted as income in the numerator AND as invested
// capital in the denominator (a bank item stores its balance in purchasePrice,
// which IS its cost basis by design), so the institution card read 3.79% where
// the asset-class card read 3.94% on the very same holdings.
describe('getIncomeReceivedByItem / getInvestedCapital', () => {
  const bond = { id: 'vitali', symbol: 'VITALI', name: 'Vitali', quantity: 1, purchasePrice: 6000, currentPrice: 6000, entryFee: 98, incomeDestination: 'fondo' }
  const fondo = { id: 'fondo', symbol: 'IDC-CASH', name: 'Fondo', type: 'bank', quantity: 1, purchasePrice: 240, currentPrice: 240 }
  const coupon = { type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD', _linkedItemId: 'vitali' }

  it('credits the DESTINATION, never the asset that produced it', () => {
    const m = getIncomeReceivedByItem([coupon], [bond, fondo], null, 'USD')
    expect(m.get('fondo')).toBe(240)
    expect(m.get('vitali')).toBeUndefined()
  })

  it('follows an explicit _destinationItemId over incomeDestination', () => {
    const other = { id: 'otra', name: 'Otra', type: 'bank', quantity: 1, purchasePrice: 0 }
    const tx = { ...coupon, _destinationItemId: 'otra' }
    const m = getIncomeReceivedByItem([tx], [bond, fondo, other], null, 'USD')
    expect(m.get('otra')).toBe(240)
    expect(m.get('fondo')).toBeUndefined()
  })

  it('ignores reinvested income (it never left its own asset)', () => {
    const m = getIncomeReceivedByItem([{ ...coupon, _reinvested: true }], [bond, fondo], null, 'USD')
    expect(m.size).toBe(0)
  })

  it('ignores income with nowhere tracked to land', () => {
    const orphan = { ...coupon }
    const m = getIncomeReceivedByItem([orphan], [{ ...bond, incomeDestination: null }], null, 'USD')
    expect(m.size).toBe(0)
  })

  it('takes the income back out of the invested capital', () => {
    const received = getIncomeReceivedByItem([coupon], [bond, fondo], null, 'USD')
    expect(getInvestedCapital(fondo, received.get('fondo'))).toBe(0)
    // The bond keeps its full all-in cost: principal plus the entry fee.
    expect(getInvestedCapital(bond, received.get('vitali'))).toBe(6098)
  })

  it('never goes negative when more income arrived than the balance holds', () => {
    const spent = { ...fondo, purchasePrice: 100, currentPrice: 100 }
    expect(getInvestedCapital(spent, 240)).toBe(0)
  })

  it('leaves an item with no income received untouched', () => {
    expect(getInvestedCapital(bond, undefined)).toBe(6098)
    expect(getInvestedCapital(bond, 0)).toBe(6098)
  })

  it('makes the two cards agree: 240 gain over 6,098 invested, either grouping', () => {
    const received = getIncomeReceivedByItem([coupon], [bond, fondo], null, 'USD')
    const invested = [bond, fondo].reduce((s, it) => s + getInvestedCapital(it, received.get(it.id)), 0)
    expect(invested).toBe(6098)
    expect((240 / invested) * 100).toBeCloseTo(3.936, 2)
  })
})

// FASE JA. La regla de "esta cuenta guarda su saldo en los DOS campos" vivía
// escrita a mano en tres lugares y la Hoja, que es la tercera superficie que
// corrige saldos bancarios, no la conocía: escribía solo `currentPrice` y dejaba
// el costo en el valor viejo, así que corregir un saldo de 1,000 a 1,200 hacía
// que la app creyera que el usuario ganó 200 en una cuenta de ahorro.
describe('isBankLike: una sola definición de "el saldo ES el costo"', () => {
  test('reconoce las formas en que la app nombra una cuenta de efectivo', () => {
    for (const type of ['Bank', 'Banco', 'Cash', 'Savings', 'Checking', 'Cuenta Monetaria', 'Ahorro', 'Efectivo']) {
      expect(isBankLike({ type })).toBe(true)
    }
  })

  test('no arrastra activos cuyo costo de compra es un hecho aparte del valor', () => {
    for (const type of ['Stock', 'Bond', 'Crypto', 'Fund', 'Real Estate', 'Alternative']) {
      expect(isBankLike({ type })).toBe(false)
    }
  })

  test('un item sin tipo, nulo o indefinido no rompe', () => {
    expect(isBankLike({})).toBe(false)
    expect(isBankLike(null)).toBe(false)
    expect(isBankLike(undefined)).toBe(false)
  })
})
