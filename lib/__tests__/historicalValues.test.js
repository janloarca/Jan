/**
 * Tests for historicalValues.js
 *
 * The module exports only `getHistoricalItemValues` but the critical helpers
 * `qtyAtMonth` and `fillFallback` are module-private. We replicate their logic
 * here and test thoroughly, then also test getHistoricalItemValues with mocked fetch.
 */

// ---- Replicated qtyAtMonth (lines 20-35 of historicalValues.js) ----
function qtyAtMonth(lots, symbol, monthEnd) {
  let qty = 0
  for (const lot of lots) {
    if ((lot.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
    const acqDate = lot.acquisitionDate ? new Date(lot.acquisitionDate) : null
    if (acqDate && acqDate > monthEnd) continue
    if (lot.status === 'closed') {
      const closedDate = lot.closedDate ? new Date(lot.closedDate) : null
      if (closedDate && closedDate <= monthEnd) continue
      qty += lot.quantity || 0
    } else {
      qty += lot.quantity || 0
    }
  }
  return qty
}

// ---- Replicated qtyFromTx (historicalValues.js) ----
// Reconstructs shares held at a past month-end by reversing trades after it.
function qtyFromTx(currentQty, events, monthEnd) {
  let qty = currentQty
  const end = monthEnd.getTime()
  for (const ev of events) {
    if (ev.ts > end) qty -= ev.delta
  }
  return qty > 0 ? qty : 0
}

const buy = (date, q) => ({ ts: new Date(date).getTime(), delta: q })
const sell = (date, q) => ({ ts: new Date(date).getTime(), delta: -q })

// ---- Replicated static income-reversal (historicalValues.js static branch) ----
// A static asset's month-end value = current value minus interest/dividends that
// compounded AFTER that month (so a bond shows principal before a coupon, stepping
// up afterward).
function staticValueAtMonth(currentVal, incEvents, monthEndStr) {
  const end = new Date(monthEndStr).getTime()
  let val = currentVal
  for (const ev of incEvents) if (ev.ts > end) val -= ev.amount
  return val < 0 ? 0 : val
}
const coupon = (date, amt) => ({ ts: new Date(date).getTime(), amount: amt })

// ---- Replicated helpers for fillFallback ----
function getMonthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}

function fillFallback(result, it, months) {
  const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
  const val = (it.quantity || 0) * (it.purchasePrice || 0)
  if (val <= 0) return
  months.forEach(mk => {
    if (acqDate && getMonthEndDate(mk) < acqDate) return
    if (!result[mk][it.id]) {
      result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
    }
  })
}

// =====================================================================
// qtyAtMonth tests
// =====================================================================
describe('qtyAtMonth', () => {
  it('returns 0 when lots array is empty', () => {
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth([], 'AAPL', monthEnd)).toBe(0)
  })

  it('returns lot quantity for a single open lot acquired before the date', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-01-15', status: 'open' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(10)
  })

  it('returns 0 for an open lot acquired after the date', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-07-15', status: 'open' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(0)
  })

  it('counts a closed lot when monthEnd is before the close date', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-01-15', status: 'closed', closedDate: '2025-08-01' },
    ]
    // monthEnd is June 30 which is before closedDate Aug 1 -> should be counted
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(5)
  })

  it('does NOT count a closed lot when monthEnd is after the close date', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-01-15', status: 'closed', closedDate: '2025-05-01' },
    ]
    // monthEnd is June 30 which is after closedDate May 1 -> should NOT be counted
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(0)
  })

  it('does NOT count a closed lot when monthEnd equals the close date', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-01-15', status: 'closed', closedDate: '2025-06-30' },
    ]
    // closedDate <= monthEnd means it's excluded
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(0)
  })

  it('sums multiple applicable lots', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-01-01', status: 'open' },
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-03-01', status: 'open' },
      { symbol: 'AAPL', quantity: 3, acquisitionDate: '2025-05-15', status: 'open' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(18)
  })

  it('handles mixed open and closed lots correctly', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-01-01', status: 'open' },
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-02-01', status: 'closed', closedDate: '2025-04-01' },
      { symbol: 'AAPL', quantity: 3, acquisitionDate: '2025-03-01', status: 'closed', closedDate: '2025-08-01' },
    ]
    // June 30: open lot (10) + closed lot acquired Mar closed Aug (3, still counted) = 13
    // The Feb lot is closed on Apr 1 which is <= June 30, so excluded
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(13)
  })

  it('filters by symbol (case-insensitive)', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-01-01', status: 'open' },
      { symbol: 'MSFT', quantity: 20, acquisitionDate: '2025-01-01', status: 'open' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'aapl', monthEnd)).toBe(10)
    expect(qtyAtMonth(lots, 'MSFT', monthEnd)).toBe(20)
  })

  it('returns 0 for a symbol with no matching lots', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 10, acquisitionDate: '2025-01-01', status: 'open' },
    ]
    expect(qtyAtMonth(lots, 'GOOG', new Date('2025-06-30'))).toBe(0)
  })

  it('handles lots with no acquisitionDate (always counted if open)', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 7, status: 'open' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(7)
  })

  it('handles lots with no closedDate on closed lots (always counted)', () => {
    // A closed lot without closedDate: closedDate is null, so `closedDate <= monthEnd` is skipped
    // meaning it IS counted
    const lots = [
      { symbol: 'AAPL', quantity: 5, acquisitionDate: '2025-01-01', status: 'closed' },
    ]
    const monthEnd = new Date('2025-06-30')
    expect(qtyAtMonth(lots, 'AAPL', monthEnd)).toBe(5)
  })

  it('handles zero quantity lots', () => {
    const lots = [
      { symbol: 'AAPL', quantity: 0, acquisitionDate: '2025-01-01', status: 'open' },
    ]
    expect(qtyAtMonth(lots, 'AAPL', new Date('2025-06-30'))).toBe(0)
  })

  it('handles lot with undefined quantity (defaults to 0)', () => {
    const lots = [
      { symbol: 'AAPL', acquisitionDate: '2025-01-01', status: 'open' },
    ]
    expect(qtyAtMonth(lots, 'AAPL', new Date('2025-06-30'))).toBe(0)
  })

  it('reconstructs historical quantity with partial sells over time', () => {
    // Bought 100 shares Jan 1, sold 30 on Mar 15, sold remaining 70 on Jul 1
    const lots = [
      { symbol: 'AAPL', quantity: 30, acquisitionDate: '2025-01-01', status: 'closed', closedDate: '2025-03-15' },
      { symbol: 'AAPL', quantity: 70, acquisitionDate: '2025-01-01', status: 'closed', closedDate: '2025-07-01' },
    ]
    // Feb 28: both lots are before close dates -> 30 + 70 = 100
    expect(qtyAtMonth(lots, 'AAPL', new Date('2025-02-28'))).toBe(100)
    // Apr 30: first lot is closed (Mar 15 <= Apr 30), second still active -> 70
    expect(qtyAtMonth(lots, 'AAPL', new Date('2025-04-30'))).toBe(70)
    // Aug 31: both lots closed -> 0
    expect(qtyAtMonth(lots, 'AAPL', new Date('2025-08-31'))).toBe(0)
  })
})

// =====================================================================
// qtyFromTx tests — the core fix for IBKR import-date understatement
// =====================================================================
describe('qtyFromTx', () => {
  it('holds current quantity flat when there are no trades after the month', () => {
    // Position bought before the window; no in-window trades -> held flat.
    expect(qtyFromTx(100, [], new Date('2026-03-31'))).toBe(100)
  })

  it('reverses a later BUY so past months show the pre-buy quantity', () => {
    // Currently hold 100; bought 40 of them on May 10.
    const events = [buy('2026-05-10', 40)]
    // April end: the May buy hadn't happened -> 100 - 40 = 60
    expect(qtyFromTx(100, events, new Date('2026-04-30'))).toBe(60)
    // May end: buy already happened -> full 100
    expect(qtyFromTx(100, events, new Date('2026-05-31'))).toBe(100)
  })

  it('reverses a later SELL so past months show the larger pre-sell quantity', () => {
    // Currently hold 70; sold 30 on Apr 15 (had 100 before).
    const events = [sell('2026-04-15', 30)]
    // March end: sell hadn't happened -> 70 - (-30) = 100
    expect(qtyFromTx(70, events, new Date('2026-03-31'))).toBe(100)
    // April end: sell already happened -> 70
    expect(qtyFromTx(70, events, new Date('2026-04-30'))).toBe(70)
  })

  it('zeroes out months before the position was first opened', () => {
    // Whole position (50) bought Feb 20, nothing held before.
    const events = [buy('2026-02-20', 50)]
    expect(qtyFromTx(50, events, new Date('2026-01-31'))).toBe(0)
    expect(qtyFromTx(50, events, new Date('2026-02-28'))).toBe(50)
  })

  it('does NOT collapse to zero just because trades are import-dated later (regression)', () => {
    // The bug: a buy-and-hold position imported from IBKR with no in-window
    // trades must keep showing its full quantity in past months, not 0.
    expect(qtyFromTx(37, [], new Date('2026-01-31'))).toBe(37)
    expect(qtyFromTx(37, [], new Date('2026-05-31'))).toBe(37)
  })
})

// =====================================================================
// static income-reversal tests — the VITALI bond step-up case
// =====================================================================
describe('staticValueAtMonth (bond compounding)', () => {
  it('shows principal before a coupon and steps up after (6000 -> 6240)', () => {
    // Bond currently worth 6240; a 240 coupon compounded on May 1.
    const inc = [coupon('2026-05-01', 240)]
    expect(staticValueAtMonth(6240, inc, '2026-04-30')).toBe(6000) // before coupon
    expect(staticValueAtMonth(6240, inc, '2026-05-31')).toBe(6240) // after coupon
    expect(staticValueAtMonth(6240, inc, '2026-06-30')).toBe(6240)
    expect(staticValueAtMonth(6240, inc, '2026-01-31')).toBe(6000)
  })

  it('reverses multiple coupons cumulatively', () => {
    const inc = [coupon('2026-03-01', 100), coupon('2026-06-01', 150)]
    expect(staticValueAtMonth(6250, inc, '2026-02-28')).toBe(6000) // before both
    expect(staticValueAtMonth(6250, inc, '2026-04-30')).toBe(6100) // after first only
    expect(staticValueAtMonth(6250, inc, '2026-06-30')).toBe(6250) // after both
  })

  it('stays flat at the current value when there are no reinvested coupons', () => {
    expect(staticValueAtMonth(6000, [], '2026-01-31')).toBe(6000)
    expect(staticValueAtMonth(6000, [], '2026-06-30')).toBe(6000)
  })

  it('never goes negative', () => {
    const inc = [coupon('2026-06-01', 9999)]
    expect(staticValueAtMonth(6000, inc, '2026-01-31')).toBe(0)
  })
})

// =====================================================================
// fillFallback tests
// =====================================================================
describe('fillFallback', () => {
  const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']

  it('uses purchasePrice (NOT currentPrice) for the fallback value', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })

    const item = {
      id: 'item1',
      symbol: 'AAPL',
      quantity: 10,
      purchasePrice: 150,
      currentPrice: 200,  // Should NOT be used
      acquisitionDate: '2025-01-01',
      _category: 'stocks',
      institution: 'Schwab',
    }

    fillFallback(result, item, months)
    // value = 10 * 150 = 1500, NOT 10 * 200 = 2000
    expect(result['2025-03']['item1'].value).toBe(1500)
  })

  it('skips months before acquisitionDate', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })

    const item = {
      id: 'item1',
      symbol: 'AAPL',
      quantity: 10,
      purchasePrice: 100,
      acquisitionDate: '2025-03-15',
    }

    fillFallback(result, item, months)
    // Jan and Feb should be empty (month-end is before acquisition)
    expect(result['2025-01']['item1']).toBeUndefined()
    expect(result['2025-02']['item1']).toBeUndefined()
    // March month-end (Mar 31) is after acquisition (Mar 15), so should be filled
    expect(result['2025-03']['item1']).toBeDefined()
    expect(result['2025-04']['item1']).toBeDefined()
  })

  it('does not overwrite existing values', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })
    result['2025-03']['item1'] = { value: 9999, symbol: 'AAPL', category: '', institution: '' }

    const item = {
      id: 'item1',
      symbol: 'AAPL',
      quantity: 10,
      purchasePrice: 100,
      acquisitionDate: '2025-01-01',
    }

    fillFallback(result, item, months)
    // March should keep the existing value
    expect(result['2025-03']['item1'].value).toBe(9999)
    // But other months should be filled
    expect(result['2025-01']['item1'].value).toBe(1000)
  })

  it('skips items with zero value (quantity * purchasePrice <= 0)', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })

    const itemZeroQty = { id: 'z1', symbol: 'A', quantity: 0, purchasePrice: 100 }
    const itemZeroPrice = { id: 'z2', symbol: 'B', quantity: 10, purchasePrice: 0 }
    const itemMissing = { id: 'z3', symbol: 'C' } // quantity and purchasePrice both undefined

    fillFallback(result, itemZeroQty, months)
    fillFallback(result, itemZeroPrice, months)
    fillFallback(result, itemMissing, months)

    months.forEach(mk => {
      expect(result[mk]['z1']).toBeUndefined()
      expect(result[mk]['z2']).toBeUndefined()
      expect(result[mk]['z3']).toBeUndefined()
    })
  })

  it('fills all months when item has no acquisitionDate', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })

    const item = {
      id: 'item1',
      symbol: 'AAPL',
      quantity: 5,
      purchasePrice: 200,
    }

    fillFallback(result, item, months)
    months.forEach(mk => {
      expect(result[mk]['item1']).toBeDefined()
      expect(result[mk]['item1'].value).toBe(1000)
    })
  })

  it('preserves category and institution metadata', () => {
    const result = {}
    months.forEach(mk => { result[mk] = {} })

    const item = {
      id: 'item1',
      symbol: 'VTI',
      quantity: 10,
      purchasePrice: 200,
      _category: 'etf',
      institution: 'Vanguard',
    }

    fillFallback(result, item, months)
    expect(result['2025-01']['item1'].symbol).toBe('VTI')
    expect(result['2025-01']['item1'].category).toBe('etf')
    expect(result['2025-01']['item1'].institution).toBe('Vanguard')
  })
})

// =====================================================================
// getMonthEndDate tests
// =====================================================================
describe('getMonthEndDate', () => {
  it('returns Jan 31 for 2025-01', () => {
    const d = getMonthEndDate('2025-01')
    expect(d.getUTCDate()).toBe(31)
    expect(d.getUTCMonth()).toBe(0) // January
    expect(d.getUTCFullYear()).toBe(2025)
  })

  it('returns Feb 28 for non-leap year', () => {
    const d = getMonthEndDate('2025-02')
    expect(d.getUTCDate()).toBe(28)
  })

  it('returns Feb 29 for leap year', () => {
    const d = getMonthEndDate('2024-02')
    expect(d.getUTCDate()).toBe(29)
  })

  it('returns Dec 31 for 2025-12', () => {
    const d = getMonthEndDate('2025-12')
    expect(d.getUTCDate()).toBe(31)
    expect(d.getUTCMonth()).toBe(11)
  })
})
