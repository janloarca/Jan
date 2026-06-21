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
// applyStaticHistory tests — the extracted helper for fixed-value assets
// =====================================================================

function parseUTCDate(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function valueInBase(it, rawPrice, convert, baseCurrency) {
  const rawCurrency = it._originalCurrency || it.currency || baseCurrency || 'USD'
  let val = (it.quantity || 0) * (rawPrice || 0)
  if (convert && rawCurrency !== (baseCurrency || 'USD')) {
    val = convert(val, rawCurrency, baseCurrency || 'USD')
  }
  return val
}

function applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestBySym) {
  const acqDate = parseUTCDate(it.acquisitionDate)
  const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? it.price ?? it.cost ?? 0
  const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
  const balEvents = balanceEventsById[it.id] || []
  const symEvents = reinvestBySym[(it.symbol || it.name || '').toUpperCase()] || []
  const allEvents = balEvents.length && symEvents.length ? [...balEvents, ...symEvents] : (balEvents.length ? balEvents : symEvents)
  months.forEach(mk => {
    const monthEnd = getMonthEndDate(mk)
    if (acqDate && monthEnd < acqDate) return
    let val = curVal
    if (allEvents.length) {
      const end = monthEnd.getTime()
      for (const ev of allEvents) if (ev.ts > end) val -= ev.amount
      if (val < 0) val = 0
    }
    result[mk][it.id] = { value: val, symbol: it.name || it.symbol || '', category: it._category || '', institution: it.institution || '' }
  })
}

describe('applyStaticHistory', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

  function makeResult() {
    const r = {}
    months.forEach(mk => { r[mk] = {} })
    return r
  }

  it('shows step-up after dividend (6000 → 6240)', () => {
    const result = makeResult()
    const item = { id: 'vitali', name: 'Vitali', quantity: 1, currentPrice: 6240, acquisitionDate: '2025-12-01' }
    const reinvest = { VITALI: [{ ts: new Date('2026-05-01').getTime(), amount: 240 }] }
    applyStaticHistory(result, item, months, null, 'USD', {}, reinvest)

    expect(result['2026-01']['vitali'].value).toBe(6000)
    expect(result['2026-04']['vitali'].value).toBe(6000)
    expect(result['2026-05']['vitali'].value).toBe(6240)
    expect(result['2026-06']['vitali'].value).toBe(6240)
  })

  it('reverses multiple deposits cumulatively', () => {
    const result = makeResult()
    const item = { id: 'acc1', name: 'Account', quantity: 1, currentPrice: 1500 }
    const balEvents = {
      acc1: [
        { ts: new Date('2026-03-01').getTime(), amount: 500 },
        { ts: new Date('2026-05-01').getTime(), amount: 200 },
      ],
    }
    applyStaticHistory(result, item, months, null, 'USD', balEvents, {})

    expect(result['2026-01']['acc1'].value).toBe(800)
    expect(result['2026-02']['acc1'].value).toBe(800)
    expect(result['2026-03']['acc1'].value).toBe(1300)
    expect(result['2026-04']['acc1'].value).toBe(1300)
    expect(result['2026-05']['acc1'].value).toBe(1500)
  })

  it('shows flat value when there are no events', () => {
    const result = makeResult()
    const item = { id: 'flat', name: 'FlatAsset', quantity: 1, currentPrice: 10000 }
    applyStaticHistory(result, item, months, null, 'USD', {}, {})

    months.forEach(mk => {
      expect(result[mk]['flat'].value).toBe(10000)
    })
  })

  it('skips months before acquisitionDate', () => {
    const result = makeResult()
    const item = { id: 'late', name: 'LateAsset', quantity: 1, currentPrice: 5000, acquisitionDate: '2026-04-01' }
    applyStaticHistory(result, item, months, null, 'USD', {}, {})

    expect(result['2026-01']['late']).toBeUndefined()
    expect(result['2026-02']['late']).toBeUndefined()
    expect(result['2026-03']['late']).toBeUndefined()
    expect(result['2026-04']['late'].value).toBe(5000)
    expect(result['2026-05']['late'].value).toBe(5000)
  })

  it('clamps value to 0 when events exceed current value', () => {
    const result = makeResult()
    const item = { id: 'small', name: 'Small', quantity: 1, currentPrice: 100 }
    const balEvents = { small: [{ ts: new Date('2026-06-01').getTime(), amount: 9999 }] }
    applyStaticHistory(result, item, months, null, 'USD', balEvents, {})

    expect(result['2026-01']['small'].value).toBe(0)
    expect(result['2026-06']['small'].value).toBe(100)
  })

  it('applies currency conversion', () => {
    const result = makeResult()
    const item = { id: 'eur', name: 'EurAsset', quantity: 1, currentPrice: 1000, _originalCurrency: 'EUR', currency: 'EUR' }
    const convert = (val, from, to) => from === 'EUR' && to === 'USD' ? val * 1.1 : val
    applyStaticHistory(result, item, months, convert, 'USD', {}, {})

    expect(result['2026-01']['eur'].value).toBeCloseTo(1100)
  })

  it('combines balanceEvents and reinvestBySym', () => {
    const result = makeResult()
    const item = { id: 'combo', symbol: 'COMBO', quantity: 1, currentPrice: 2000 }
    const balEvents = { combo: [{ ts: new Date('2026-04-01').getTime(), amount: 300 }] }
    const reinvest = { COMBO: [{ ts: new Date('2026-05-15').getTime(), amount: 200 }] }
    applyStaticHistory(result, item, months, null, 'USD', balEvents, reinvest)

    expect(result['2026-01']['combo'].value).toBe(1500)
    expect(result['2026-04']['combo'].value).toBe(1800)
    expect(result['2026-06']['combo'].value).toBe(2000)
  })
})

// ---- Replicated transaction-indexing routing (getHistoricalItemValues lines 125-160) ----
// Each dividend feeds exactly ONE bucket so a value is never reversed twice.
function indexEvents(transactions, items, convert, baseCurrency) {
  const balanceEventsById = {}
  const reinvestBySym = {}
  const itemById = new Map(items.map((it) => [it.id, it]))
  const itemBySym = new Map(items.map((it) => [(it.symbol || '').toUpperCase(), it]))
  const pushBalance = (id, ev) => { (balanceEventsById[id] = balanceEventsById[id] || []).push(ev) }
  for (const tx of transactions) {
    const ty = (tx.type || '').toUpperCase()
    if (ty !== 'DEPOSIT' && ty !== 'DIVIDEND' && ty !== 'WITHDRAWAL') continue
    const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
    const d = tx.date ? new Date(tx.date) : null
    if (!(amtRaw > 0) || !d) continue
    const linked = tx._linkedItemId ? itemById.get(tx._linkedItemId) : null
    const cur = tx.currency || baseCurrency || 'USD'
    const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
    const delta = ty === 'WITHDRAWAL' ? -amount : amount
    const ts = d.getTime()
    if (ty === 'DIVIDEND') {
      const reinvest = tx._reinvested === true
        || (linked && linked.dividendAction === 'reinvest')
        || tx._source === 'manual_contribution'
        || !tx._linkedItemId
      if (!reinvest && linked && linked.incomeDestination) {
        const dest = itemById.get(linked.incomeDestination)
          || itemBySym.get(String(linked.incomeDestination).toUpperCase())
        if (dest && dest.id) pushBalance(dest.id, { ts, amount: delta })
      } else if (reinvest) {
        const sym = (tx.symbol || (linked && (linked.symbol || linked.name)) || '').toUpperCase()
        if (sym) (reinvestBySym[sym] = reinvestBySym[sym] || []).push({ ts, amount })
      }
    } else if (tx._linkedItemId) {
      pushBalance(tx._linkedItemId, { ts, amount: delta })
    }
  }
  return { balanceEventsById, reinvestBySym }
}

describe('dividend destination routing (indexing)', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
  const makeResult = () => { const r = {}; months.forEach((m) => { r[m] = {} }); return r }

  const vitali = { id: 'vitali', symbol: 'VITALI', name: 'Vitali', dividendAction: 'cash', incomeDestination: 'fondo' }
  const fondo = { id: 'fondo', symbol: 'IDC-CASH', name: 'Fondo', quantity: 1, currentPrice: 241 }
  const items = [vitali, fondo]
  const cashDividend = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240, _linkedItemId: 'vitali', _source: 'auto' }]

  it('credits the destination account, never the source', () => {
    const { balanceEventsById, reinvestBySym } = indexEvents(cashDividend, items, null, 'USD')
    expect(balanceEventsById['vitali']).toBeUndefined()
    expect(reinvestBySym['VITALI']).toBeUndefined()
    expect(balanceEventsById['fondo']).toHaveLength(1)
  })

  it('steps the destination up in May and keeps the source flat', () => {
    const { balanceEventsById, reinvestBySym } = indexEvents(cashDividend, items, null, 'USD')
    const result = makeResult()
    applyStaticHistory(result, fondo, months, null, 'USD', balanceEventsById, reinvestBySym)
    expect(result['2026-01']['fondo'].value).toBe(1)
    expect(result['2026-04']['fondo'].value).toBe(1)
    expect(result['2026-05']['fondo'].value).toBe(241)
    expect(result['2026-06']['fondo'].value).toBe(241)

    const r2 = makeResult()
    const vitaliItem = { id: 'vitali', symbol: 'VITALI', name: 'Vitali', quantity: 1, currentPrice: 6000 }
    applyStaticHistory(r2, vitaliItem, months, null, 'USD', balanceEventsById, reinvestBySym)
    months.forEach((m) => expect(r2[m]['vitali'].value).toBe(6000))
  })

  it('routes a reinvested dividend to the source symbol only', () => {
    const reinvestSrc = [{ ...vitali, dividendAction: 'reinvest', incomeDestination: null }, fondo]
    const txs = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240, _linkedItemId: 'vitali', _reinvested: true }]
    const { balanceEventsById, reinvestBySym } = indexEvents(txs, reinvestSrc, null, 'USD')
    expect(reinvestBySym['VITALI']).toHaveLength(1)
    expect(balanceEventsById['vitali']).toBeUndefined()
    expect(balanceEventsById['fondo']).toBeUndefined()
  })

  it('keeps DEPOSIT/WITHDRAWAL linked to their own account', () => {
    const txs = [
      { type: 'DEPOSIT', date: '2026-03-01', totalAmount: 500, _linkedItemId: 'fondo' },
      { type: 'WITHDRAWAL', date: '2026-04-01', totalAmount: 100, _linkedItemId: 'fondo' },
    ]
    const { balanceEventsById } = indexEvents(txs, items, null, 'USD')
    expect(balanceEventsById['fondo']).toEqual([
      { ts: new Date('2026-03-01').getTime(), amount: 500 },
      { ts: new Date('2026-04-01').getTime(), amount: -100 },
    ])
  })
})

// =====================================================================
// IBKR NAV scaling tests
// =====================================================================

function ibkrScale(ibkrItems, months, snapshots, convert, baseCurrency) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

  const ibkrSnaps = snapshots.filter(s => s._source === 'ibkr' && s.date)
  const navByMonth = {}
  const navDates = {}
  function gmk(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
  ;(ibkrSnaps.length ? ibkrSnaps : snapshots.filter(s => s.date)).forEach(s => {
    const navUSD = s.netWorthUSD ?? s.totalActivosUSD ?? 0
    if (!navUSD) return
    const mk = gmk(new Date(s.date))
    const sd = new Date(s.date)
    if (!navDates[mk] || sd > navDates[mk]) {
      navDates[mk] = sd
      navByMonth[mk] = convert ? convert(navUSD, 'USD', baseCurrency || 'USD') : navUSD
    }
  })

  const currentNAV = ibkrItems.reduce((sum, it) => {
    const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
    return sum + valueInBase(it, rawPrice, null, baseCurrency)
  }, 0)

  const navMonthKeys = Object.keys(navByMonth).sort()
  if (currentNAV > 0 && navMonthKeys.length > 0) {
    const navForMonth = (mk) => {
      if (navByMonth[mk] != null) return navByMonth[mk]
      let chosen = null
      for (const k of navMonthKeys) { if (k <= mk) chosen = navByMonth[k]; else break }
      return chosen
    }
    months.forEach(mk => {
      const nav = navForMonth(mk)
      if (nav == null) return
      const scale = nav / currentNAV
      ibkrItems.forEach(it => {
        const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
        const curItemVal = valueInBase(it, rawPrice, null, baseCurrency)
        if (curItemVal <= 0) return
        result[mk][it.id] = {
          value: curItemVal * scale,
          symbol: it.symbol || it.name || '',
          category: it._category || '',
          institution: it.institution || '',
        }
      })
    })
  }
  return result
}

describe('IBKR NAV scaling', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

  it('scales items proportionally to NAV from snapshots', () => {
    const items = [
      { id: 'aapl', symbol: 'AAPL', quantity: 50, currentPrice: 100, _source: 'ibkr' },
      { id: 'msft', symbol: 'MSFT', quantity: 50, currentPrice: 100, _source: 'ibkr' },
    ]
    const snapshots = [
      { date: '2026-01-31', netWorthUSD: 8000, _source: 'ibkr' },
      { date: '2026-06-30', netWorthUSD: 10000, _source: 'ibkr' },
    ]
    const result = ibkrScale(items, months, snapshots, null, 'USD')

    expect(result['2026-01']['aapl'].value).toBe(4000)
    expect(result['2026-01']['msft'].value).toBe(4000)
    expect(result['2026-06']['aapl'].value).toBe(5000)
    expect(result['2026-06']['msft'].value).toBe(5000)
  })

  it('item sums equal NAV per month', () => {
    const items = [
      { id: 'a', symbol: 'A', quantity: 30, currentPrice: 100, _source: 'ibkr' },
      { id: 'b', symbol: 'B', quantity: 70, currentPrice: 100, _source: 'ibkr' },
    ]
    const snapshots = [
      { date: '2026-03-31', netWorthUSD: 5400, _source: 'ibkr' },
      { date: '2026-06-30', netWorthUSD: 10000, _source: 'ibkr' },
    ]
    const result = ibkrScale(items, months, snapshots, null, 'USD')

    const sumMar = (result['2026-03']['a']?.value || 0) + (result['2026-03']['b']?.value || 0)
    expect(sumMar).toBeCloseTo(5400)

    const sumJun = (result['2026-06']['a']?.value || 0) + (result['2026-06']['b']?.value || 0)
    expect(sumJun).toBeCloseTo(10000)
  })

  it('carry-forwards NAV when a month has no snapshot', () => {
    const items = [
      { id: 'x', symbol: 'X', quantity: 100, currentPrice: 100, _source: 'ibkr' },
    ]
    const snapshots = [
      { date: '2026-01-31', netWorthUSD: 8000, _source: 'ibkr' },
      { date: '2026-06-30', netWorthUSD: 10000, _source: 'ibkr' },
    ]
    const result = ibkrScale(items, months, snapshots, null, 'USD')

    expect(result['2026-02']['x'].value).toBe(8000)
    expect(result['2026-05']['x'].value).toBe(8000)
    expect(result['2026-06']['x'].value).toBe(10000)
  })

  it('handles currentNAV = 0 without dividing by zero', () => {
    const items = [
      { id: 'z', symbol: 'Z', quantity: 0, currentPrice: 0, _source: 'ibkr' },
    ]
    const snapshots = [
      { date: '2026-01-31', netWorthUSD: 5000, _source: 'ibkr' },
    ]
    const result = ibkrScale(items, months, snapshots, null, 'USD')

    months.forEach(mk => {
      expect(result[mk]['z']).toBeUndefined()
    })
  })

  it('skips months before the first snapshot', () => {
    const items = [
      { id: 'y', symbol: 'Y', quantity: 100, currentPrice: 50, _source: 'ibkr' },
    ]
    const snapshots = [
      { date: '2026-04-30', netWorthUSD: 4000, _source: 'ibkr' },
      { date: '2026-06-30', netWorthUSD: 5000, _source: 'ibkr' },
    ]
    const result = ibkrScale(items, months, snapshots, null, 'USD')

    expect(result['2026-01']['y']).toBeUndefined()
    expect(result['2026-03']['y']).toBeUndefined()
    expect(result['2026-04']['y'].value).toBe(4000)
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
