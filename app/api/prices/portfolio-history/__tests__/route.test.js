/**
 * @jest-environment node
 */
// FASE GQ: byKey breakdown in /api/prices/portfolio-history. Only exercises the
// STATIC-item path (no Yahoo/CoinGecko network mocks needed): a static item never
// reaches fetchYahooHistory/fetchCryptoHistory, so this locks in the new
// per-item accumulation without touching the network layer.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))

const { POST } = require('../route')

function mockRequest(body) {
  return { json: async () => body }
}

describe('portfolio-history byKey breakdown', () => {
  test('omits byKey entirely when breakdown is not requested', async () => {
    const req = mockRequest({
      items: [{ id: 'a1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' }],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.dataPoints.length).toBeGreaterThan(0)
    for (const p of data.dataPoints) expect(p.byKey).toBeUndefined()
  })

  test('splits total across two static items by id, reconciling with total', async () => {
    const req = mockRequest({
      items: [
        { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
        { id: 'bank1', symbol: 'CASH', type: 'Bank', quantity: 1, currentPrice: 500, purchasePrice: 500, acquisitionDate: '2020-01-01' },
      ],
      period: 'YTD',
      breakdown: true,
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.dataPoints.length).toBeGreaterThan(0)
    for (const p of data.dataPoints) {
      expect(p.byKey).toBeDefined()
      expect(p.byKey.bond1).toBeCloseTo(6000, 2)
      expect(p.byKey.bank1).toBeCloseTo(500, 2)
      // The parts add up to the whole the headline shows — the exact guarantee
      // the dashboard's consumer (ytdBreakdown) relies on before it trusts this.
      const sum = Object.values(p.byKey).reduce((s, v) => s + v, 0)
      expect(sum).toBeCloseTo(p.total, 1)
    }
  })

  test('an item without a real id falls back to its uppercase symbol as the key', async () => {
    const req = mockRequest({
      items: [
        { symbol: 'idcbond', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      ],
      period: 'YTD',
      breakdown: true,
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.dataPoints[0].byKey.IDCBOND).toBeCloseTo(6000, 2)
  })
})
