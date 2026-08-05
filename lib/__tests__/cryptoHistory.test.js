/**
 * Regression tests: crypto held since 2021 must appear in the history from its
 * first BUY trade — even when the item has no acquisitionDate and was added to
 * the app years later (e.g. a Ledger sync stamps no acquisition date).
 *
 * Covers the effectiveAcqDate fallback chain:
 *   acquisitionDate → earliest BUY per symbol → Jan 1 of the createdAt year.
 */

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))

const { authFetch, safeJson } = require('../authFetch')
const { getHistoricalItemValues } = require('../historicalValues')

const convert = (v) => v
const months2021 = ['2021-01', '2021-02', '2021-03', '2021-04', '2021-05', '2021-06', '2021-07', '2021-08', '2021-09', '2021-10', '2021-11', '2021-12']

// Ledger-synced ETH: no acquisitionDate, added to the app in 2026, but with
// real BUY trades back to January 2021.
const ethLedger = {
  id: 'eth1', symbol: 'ETH', name: 'Ethereum', type: 'Crypto',
  quantity: 0.38, currentPrice: 1900, purchasePrice: 1900,
  _source: 'ledger', createdAt: '2026-01-10', _category: 'crypto',
}

const ethBuys = [
  { type: 'BUY', symbol: 'ETH', date: '2021-01-12', quantity: 0.3 },
  { type: 'BUY', symbol: 'ETH', date: '2021-03-05', quantity: 0.08 },
]

beforeEach(() => {
  authFetch.mockClear()
  safeJson.mockClear()
})

describe('crypto history from first BUY trade', () => {
  it('shows a Ledger crypto with no acquisitionDate from its first BUY (Jan 2021), not its add-year', async () => {
    // Chart endpoint unavailable → static/fallback path, still gated by firstBuy.
    authFetch.mockImplementation(() => Promise.resolve({ ok: false }))

    const months = ['2020-11', '2020-12', ...months2021]
    const result = await getHistoricalItemValues([ethLedger], months, convert, 'USD', [], ethBuys, [])

    // Present every month of 2021 at the held-flat estimate (0.38 × 1900 = 722).
    for (const mk of months2021) {
      expect(result[mk].eth1).toBeDefined()
      expect(result[mk].eth1.value).toBeCloseTo(722, 2)
      expect(result[mk].eth1.estimated).toBe(true)
    }
    // Absent before the first BUY — the add-year (2026) must not gate, but the
    // asset also must not leak into months before it existed.
    expect(result['2020-11'].eth1).toBeUndefined()
    expect(result['2020-12'].eth1).toBeUndefined()
  })

  it('prefers an explicit acquisitionDate over the earlier BUY trades', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: false }))

    const btc = {
      id: 'btc1', symbol: 'BTC', name: 'Bitcoin', type: 'Crypto',
      quantity: 0.05, currentPrice: 60000, purchasePrice: 60000,
      _source: 'ledger', createdAt: '2026-01-10',
      acquisitionDate: '2022-06-01', _category: 'crypto',
    }
    const btcBuys = [{ type: 'BUY', symbol: 'BTC', date: '2021-01-12', quantity: 0.05 }]

    const months = ['2021-01', '2022-05', '2022-06']
    const result = await getHistoricalItemValues([btc], months, convert, 'USD', [], btcBuys, [])

    // acquisitionDate 2022-06-01 wins over the 2021 BUY: nothing before June 2022.
    expect(result['2021-01'].btc1).toBeUndefined()
    expect(result['2022-05'].btc1).toBeUndefined()
    expect(result['2022-06'].btc1).toBeDefined()
    expect(result['2022-06'].btc1.value).toBeCloseTo(3000, 2)
  })

  it('gates two shared-symbol Ledger positions (main + dust) by their first BUY on the market path', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: true }))
    safeJson.mockImplementation(() => Promise.resolve({
      currency: 'USD',
      prices: [
        { date: '2021-01-31', close: 1300 },
        { date: '2021-02-28', close: 1400 },
      ],
    }))

    const main = { ...ethLedger, id: 'eth-main' }
    const dust = { ...ethLedger, id: 'eth-dust', quantity: 0.00024371 }
    const firstBuy = [{ type: 'BUY', symbol: 'ETH', date: '2021-01-12', quantity: 0.38 }]

    const months = ['2020-12', '2021-01', '2021-02']
    const result = await getHistoricalItemValues([main, dust], months, convert, 'USD', [], firstBuy, [])

    // Same symbol on two items → each held flat at its own quantity × real price.
    expect(result['2021-01']['eth-main'].value).toBeCloseTo(0.38 * 1300, 2)
    expect(result['2021-01']['eth-dust'].value).toBeCloseTo(0.00024371 * 1300, 4)
    expect(result['2021-02']['eth-main'].value).toBeCloseTo(0.38 * 1400, 2)
    expect(result['2021-02']['eth-dust'].value).toBeCloseTo(0.00024371 * 1400, 4)

    // Before the first BUY, neither position existed.
    expect(result['2020-12']['eth-main']).toBeUndefined()
    expect(result['2020-12']['eth-dust']).toBeUndefined()
  })
})
