/**
 * @jest-environment node
 */
// FASE GQ: byKey breakdown in /api/prices/portfolio-history. Only exercises the
// STATIC-item path (no Yahoo/CoinGecko network mocks needed): a static item never
// reaches fetchYahooHistory/fetchCryptoHistory, so this locks in the new
// per-item accumulation without touching the network layer.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
// FASE HJ: el upstream de historial siempre falla en este arnés (y sin caché
// last-good), para poder fijar la semántica de degradación explícita.
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn(async () => { throw new Error('network down') }) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))

const { POST, maxDuration } = require('../route')

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

describe('portfolio-history degradacion explicita (FASE HJ)', () => {
  test('un item de mercado cuyo fetch fallo cae al camino plano PERO la respuesta lo declara', async () => {
    const req = mockRequest({
      items: [
        { id: 'stk1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 200, purchasePrice: 150, acquisitionDate: '2025-01-01' },
        { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      ],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    // El comportamiento de display no cambia: hay serie (plana) igual que antes.
    expect(data.dataPoints.length).toBeGreaterThan(0)
    // Pero el consumidor que PERSISTE (backfill) ahora puede saber que esta
    // reconstruccion tiene simbolos planos por fallo, no por diseno.
    expect(data.degraded).toBe(true)
    expect(data.failedSymbols).toContain('AAPL')
  })

  test('un portafolio 100% estatico jamas se reporta degradado', async () => {
    const req = mockRequest({
      items: [
        { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      ],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.degraded).toBe(false)
    expect(data.failedSymbols).toEqual([])
  })

  test('un crypto sin id en CRYPTO_MAP es estatico por diseno, no degradacion', async () => {
    const req = mockRequest({
      items: [
        { id: 'c1', symbol: 'MICOIN', type: 'Crypto', quantity: 5, currentPrice: 10, purchasePrice: 8, acquisitionDate: '2025-01-01' },
      ],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.degraded).toBe(false)
  })

  test('maxDuration exportado: sin el, el default de 10s de Vercel mataba la peticion pesada', () => {
    expect(maxDuration).toBe(60)
  })
})
