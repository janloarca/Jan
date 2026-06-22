/**
 * Integration test: multi-instrument portfolio spreadsheet.
 *
 * Creates 8 items with different dividend types, schedules, and dates, then
 * calls getHistoricalItemValues and verifies per-item history, monthly totals,
 * and that June values match current prices.
 */

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))

const { getHistoricalItemValues } = require('../historicalValues')

const convert = (v) => v
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

// ── Items ──────────────────────────────────────────────────────────────

const vitali = {
  id: 'vitali', symbol: 'Vitali Bond', name: 'Vitali', type: 'inversion',
  quantity: 1, currentPrice: 6000, purchasePrice: 6000,
  acquisitionDate: '2026-01-01', institution: 'IDC',
  incomeDestination: 'fondo', _category: 'bonds',
}

const fondo = {
  id: 'fondo', symbol: 'IDC-CASH', name: 'Fondo liquido dolares', type: 'Bank',
  quantity: 1, currentPrice: 240, purchasePrice: 240,
  acquisitionDate: '2026-01-01', institution: 'IDC', _category: 'banks',
}

const cdt = {
  id: 'cdt', symbol: 'CDT-2026', name: 'CDT Reinvest', type: 'bond',
  quantity: 1, currentPrice: 10240, purchasePrice: 10240,
  acquisitionDate: '2025-06-01', institution: 'Banco', _category: 'bonds',
  dividendAction: 'reinvest',
}

const savings = {
  id: 'savings', symbol: 'SAVINGS', name: 'Savings Account', type: 'Bank',
  quantity: 1, currentPrice: 3500, purchasePrice: 3500,
  acquisitionDate: '2025-12-01', institution: 'Chase', _category: 'banks',
}

const checking = {
  id: 'checking', symbol: 'CHECKING', name: 'Checking', type: 'Bank',
  quantity: 1, currentPrice: 800, purchasePrice: 800,
  acquisitionDate: '2025-12-01', institution: 'Chase', _category: 'banks',
}

const lateBond = {
  id: 'latebond', symbol: 'LATE-BOND', name: 'Late Bond', type: 'bond',
  quantity: 1, currentPrice: 5000, purchasePrice: 5000,
  acquisitionDate: '2026-04-01', institution: 'Broker', _category: 'bonds',
}

const fundSrc = {
  id: 'fundsrc', symbol: 'Fund Income', name: 'Fund Source', type: 'inversion',
  quantity: 1, currentPrice: 8000, purchasePrice: 8000,
  acquisitionDate: '2025-06-01', institution: 'Broker', _category: 'bonds',
  incomeDestination: 'SAVINGS-CASH',
}

const savings2 = {
  id: 'savings2', symbol: 'SAVINGS-CASH', name: 'Savings 2', type: 'Bank',
  quantity: 1, currentPrice: 100, purchasePrice: 100,
  acquisitionDate: '2025-12-01', institution: 'Broker', _category: 'banks',
}

const allItems = [vitali, fondo, cdt, savings, checking, lateBond, fundSrc, savings2]

// ── Transactions ───────────────────────────────────────────────────────

const txs = [
  // 1. Vitali → Fondo cash dividend in May
  { type: 'DIVIDEND', date: '2026-05-01', symbol: 'Vitali Bond', totalAmount: 240,
    currency: 'USD', _source: 'auto', _linkedItemId: 'vitali' },

  // 2. CDT reinvested dividend in March
  { type: 'DIVIDEND', date: '2026-03-15', symbol: 'CDT-2026', totalAmount: 240,
    currency: 'USD', _source: 'auto', _linkedItemId: 'cdt', _reinvested: true },

  // 3. Savings deposits: Feb, Apr, Jun
  { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 1000, currency: 'USD', _linkedItemId: 'savings' },
  { type: 'DEPOSIT', date: '2026-04-01', totalAmount: 1500, currency: 'USD', _linkedItemId: 'savings' },
  { type: 'DEPOSIT', date: '2026-06-01', totalAmount: 1000, currency: 'USD', _linkedItemId: 'savings' },

  // 4. Checking: deposit Jan, withdrawal Apr
  { type: 'DEPOSIT', date: '2026-01-15', totalAmount: 2000, currency: 'USD', _linkedItemId: 'checking' },
  { type: 'WITHDRAWAL', date: '2026-04-10', totalAmount: 1200, currency: 'USD', _linkedItemId: 'checking' },

  // 5. LateBond: no events

  // 6. Fund → Savings2 via symbol-based destination
  { type: 'DIVIDEND', date: '2026-02-15', symbol: 'Fund Income', totalAmount: 100,
    currency: 'USD', _source: 'auto', _linkedItemId: 'fundsrc' },
]

// ── Tests ───────────────────────────────────────────────────────────────

let result

beforeAll(async () => {
  result = await getHistoricalItemValues(allItems, months, convert, 'USD', [], txs, [])
})

describe('Spreadsheet integration — multi-instrument portfolio', () => {

  // ── Scenario 1: Vitali (bond with cash dividend to destination) ──

  it('Vitali stays flat at $6,000 across all months', () => {
    months.forEach(mk => {
      expect(result[mk]['vitali'].value).toBe(6000)
    })
  })

  // ── Scenario 2: Fondo (destination receives dividend in May) ──

  it('Fondo shows $0 before May, $240 from May onward', () => {
    expect(result['2026-01']['fondo'].value).toBe(0)
    expect(result['2026-02']['fondo'].value).toBe(0)
    expect(result['2026-03']['fondo'].value).toBe(0)
    expect(result['2026-04']['fondo'].value).toBe(0)
    expect(result['2026-05']['fondo'].value).toBe(240)
    expect(result['2026-06']['fondo'].value).toBe(240)
  })

  // ── Scenario 3: CDT reinvested dividend ──

  it('CDT reinvested: $10,000 before March, $10,240 from March', () => {
    expect(result['2026-01']['cdt'].value).toBe(10000)
    expect(result['2026-02']['cdt'].value).toBe(10000)
    expect(result['2026-03']['cdt'].value).toBe(10240)
    expect(result['2026-04']['cdt'].value).toBe(10240)
    expect(result['2026-05']['cdt'].value).toBe(10240)
    expect(result['2026-06']['cdt'].value).toBe(10240)
  })

  // ── Scenario 4: Savings with staggered deposits ──

  it('Savings steps up with each deposit', () => {
    expect(result['2026-01']['savings'].value).toBe(0)
    expect(result['2026-02']['savings'].value).toBe(1000)
    expect(result['2026-03']['savings'].value).toBe(1000)
    expect(result['2026-04']['savings'].value).toBe(2500)
    expect(result['2026-05']['savings'].value).toBe(2500)
    expect(result['2026-06']['savings'].value).toBe(3500)
  })

  // ── Scenario 5: Checking with deposit + withdrawal ──

  it('Checking: $2,000 until April withdrawal drops to $800', () => {
    expect(result['2026-01']['checking'].value).toBe(2000)
    expect(result['2026-02']['checking'].value).toBe(2000)
    expect(result['2026-03']['checking'].value).toBe(2000)
    expect(result['2026-04']['checking'].value).toBe(800)
    expect(result['2026-05']['checking'].value).toBe(800)
    expect(result['2026-06']['checking'].value).toBe(800)
  })

  // ── Scenario 6: Late acquisition ──

  it('LateBond: undefined before April acquisition, $5,000 after', () => {
    expect(result['2026-01']['latebond']).toBeUndefined()
    expect(result['2026-02']['latebond']).toBeUndefined()
    expect(result['2026-03']['latebond']).toBeUndefined()
    expect(result['2026-04']['latebond'].value).toBe(5000)
    expect(result['2026-05']['latebond'].value).toBe(5000)
    expect(result['2026-06']['latebond'].value).toBe(5000)
  })

  // ── Scenario 7: Symbol-based destination routing ──

  it('Symbol-based destination resolves correctly (Fund → Savings2)', () => {
    expect(result['2026-01']['savings2'].value).toBe(0)
    expect(result['2026-02']['savings2'].value).toBe(100)
    expect(result['2026-03']['savings2'].value).toBe(100)
    expect(result['2026-06']['savings2'].value).toBe(100)
  })

  it('Fund source stays flat (dividend routed away)', () => {
    months.forEach(mk => {
      expect(result[mk]['fundsrc'].value).toBe(8000)
    })
  })

  // ── Aggregate checks ──

  it('monthly totals = sum of all item values per month', () => {
    const expected = {
      '2026-01': 6000 + 0 + 10000 + 0 + 2000 + 0 + 8000 + 0,       // 26000
      '2026-02': 6000 + 0 + 10000 + 1000 + 2000 + 0 + 8000 + 100,   // 27100
      '2026-03': 6000 + 0 + 10240 + 1000 + 2000 + 0 + 8000 + 100,   // 27340
      '2026-04': 6000 + 0 + 10240 + 2500 + 800 + 5000 + 8000 + 100,  // 32640
      '2026-05': 6000 + 240 + 10240 + 2500 + 800 + 5000 + 8000 + 100, // 32880
      '2026-06': 6000 + 240 + 10240 + 3500 + 800 + 5000 + 8000 + 100, // 33880
    }
    months.forEach(mk => {
      let sum = 0
      allItems.forEach(it => {
        const entry = result[mk][it.id]
        if (entry) sum += entry.value
      })
      expect(sum).toBe(expected[mk])
    })
  })

  it('June values match current prices for all existing items', () => {
    allItems.forEach(it => {
      const entry = result['2026-06'][it.id]
      expect(entry).toBeDefined()
      expect(entry.value).toBe(it.currentPrice * it.quantity)
    })
  })

  // ── Metadata checks ──

  it('each entry carries correct symbol, category, and institution', () => {
    const entry = result['2026-06']['vitali']
    expect(entry.symbol).toBe('Vitali')
    expect(entry.category).toBe('bonds')
    expect(entry.institution).toBe('IDC')

    const fondoEntry = result['2026-06']['fondo']
    expect(fondoEntry.symbol).toBe('Fondo liquido dolares')
    expect(fondoEntry.category).toBe('banks')
    expect(fondoEntry.institution).toBe('IDC')
  })
})
