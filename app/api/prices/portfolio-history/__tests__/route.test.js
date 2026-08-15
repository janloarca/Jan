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

  // FASE IN. `failedSymbols` responde "¿debe el backfill abstenerse de
  // escribir?" y por eso deja fuera al crypto sin id en CRYPTO_MAP. Pero para
  // QUIEN LEE UN RETORNO las dos rutas son el mismo defecto: un activo plano en
  // su valor de HOY aporta CERO al cambio del periodo, o sea su perdida
  // desaparece. `staticFallbackSymbols` las junta, sin cambiar failedSymbols.
  test('staticFallbackSymbols junta las dos rutas al camino plano', async () => {
    const req = mockRequest({
      items: [
        { id: 'stk1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 200, purchasePrice: 150, acquisitionDate: '2025-01-01' },
        { id: 'c1', symbol: 'MICOIN', type: 'Crypto', quantity: 5, currentPrice: 10, purchasePrice: 8, acquisitionDate: '2025-01-01' },
      ],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    // El fallo transitorio se sigue reportando como tal...
    expect(data.failedSymbols).toContain('AAPL')
    // ...y el estatico-por-diseno NO, para no bloquear al backfill.
    expect(data.failedSymbols).not.toContain('MICOIN')
    // Pero los dos quedan declarados como "no medido".
    expect(data.staticFallbackSymbols).toEqual(expect.arrayContaining(['AAPL', 'MICOIN']))
  })

  test('un portafolio 100% estatico no reporta ningun fallback de precios', async () => {
    const req = mockRequest({
      items: [
        { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      ],
      period: 'YTD',
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.staticFallbackSymbols).toEqual([])
  })

  test('maxDuration exportado: sin el, el default de 10s de Vercel mataba la peticion pesada', () => {
    expect(maxDuration).toBe(60)
  })
})

describe('fecha de adquisicion no confiable: la posicion de broker no se borra del pasado (FASE HL)', () => {
  const { fetchWithRetry } = require('../../../../../lib/fetchWithRetry')
  const YEAR = new Date().getUTCFullYear()
  const day = (m, d) => Date.UTC(YEAR, m, d) / 1000
  // Serie Yahoo sintetica: precio 100 constante desde enero.
  const yahooOk = () => ({
    ok: true,
    json: async () => ({
      chart: { result: [{
        timestamp: [day(0, 5), day(2, 5), day(5, 5)],
        indicators: { quote: [{ close: [100, 100, 100] }] },
      }] },
    }),
  })

  beforeEach(() => { fetchWithRetry.mockImplementation(async () => yahooOk()) })
  afterEach(() => { fetchWithRetry.mockImplementation(async () => { throw new Error('network down') }) })

  // El caso real: posicion de IBKR cuyo acquisitionDate es el SELLO DEL SYNC
  // (hoy). Sin el flag, el gate `ts < acquiredTs` la pone en CERO todo el año
  // y la reconstruccion entera omite la cuenta del broker.
  const syncStamp = new Date().toISOString().split('T')[0]

  test('sin el flag, el sello de sync borra la posicion del pasado (comportamiento viejo)', async () => {
    const res = await POST(mockRequest({
      items: [{ id: 'ib1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 100, purchasePrice: 90, acquisitionDate: syncStamp }],
      period: 'YTD',
    }))
    const data = await res.json()
    const early = data.dataPoints.filter((p) => p.ts < Date.UTC(YEAR, 5, 1))
    expect(early.length).toBeGreaterThan(0)
    for (const p of early) expect(p.total).toBe(0)
  })

  test('con _dateUnreliable, la posicion se mantiene plana hacia atras en vez de valer cero', async () => {
    const res = await POST(mockRequest({
      items: [{ id: 'ib1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 100, purchasePrice: 90, acquisitionDate: syncStamp, _dateUnreliable: true }],
      period: 'YTD',
    }))
    const data = await res.json()
    const early = data.dataPoints.filter((p) => p.ts < Date.UTC(YEAR, 5, 1))
    expect(early.length).toBeGreaterThan(0)
    for (const p of early) expect(p.total).toBeCloseTo(1000, 2) // 10 x 100
  })

  test('los lots del mismo import (sello de sync) tampoco pueden borrar el pasado', async () => {
    const res = await POST(mockRequest({
      items: [{ id: 'ib1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 100, purchasePrice: 90, acquisitionDate: syncStamp, _dateUnreliable: true }],
      // Lots que RECONCILIAN con la cantidad de hoy pero llevan la misma fecha
      // sellada: la rama de lots daria 0 en el pasado igual que el gate.
      lots: [{ symbol: 'AAPL', quantity: 10, acquisitionDate: syncStamp, closedDate: null }],
      period: 'YTD',
    }))
    const data = await res.json()
    const early = data.dataPoints.filter((p) => p.ts < Date.UTC(YEAR, 5, 1))
    for (const p of early) expect(p.total).toBeCloseTo(1000, 2)
  })

  test('un ledger de trades COMPLETO sigue mandando sobre el hold-flat', async () => {
    // Compro 4 en marzo: antes de esa fecha la posicion real era 6, no 10.
    const res = await POST(mockRequest({
      items: [{
        id: 'ib1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 100, purchasePrice: 90,
        acquisitionDate: syncStamp, _dateUnreliable: true,
        txEvents: [{ ts: Date.UTC(YEAR, 3, 1), qtyDelta: 4 }],
      }],
      period: 'YTD',
    }))
    const data = await res.json()
    const early = data.dataPoints.filter((p) => p.ts < Date.UTC(YEAR, 3, 1))
    expect(early.length).toBeGreaterThan(0)
    for (const p of early) expect(p.total).toBeCloseTo(600, 2) // 6 x 100, no 1000
    expect(data.transactional).toBe(true)
  })

  test('un item MANUAL con fecha real conserva el gate: nada existe antes de comprarlo', async () => {
    const res = await POST(mockRequest({
      items: [{ id: 'm1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 100, purchasePrice: 90, acquisitionDate: `${YEAR}-05-01` }],
      period: 'YTD',
    }))
    const data = await res.json()
    const early = data.dataPoints.filter((p) => p.ts < Date.UTC(YEAR, 3, 1))
    expect(early.length).toBeGreaterThan(0)
    for (const p of early) expect(p.total).toBe(0)
  })
})

// FASE IO. La garantia que el panel del YTD necesita y que nadie estaba
// fijando: el desglose por activo (byKey) es una PARTICION del total del mismo
// punto. Si alguna rama suma a `total` sin escribir en byKey (o escribe bajo
// una llave que el consumidor no puede resolver), el panel mide un portafolio
// mas chico que la grafica sobre los mismos datos, que es exactamente la forma
// del mismatch de LEGDER: misma cuenta, mismos activos, dos arranques.
describe('byKey es una particion exacta del total (FASE IO)', () => {
  test('con activos estaticos y de mercado mezclados, la suma de byKey reconstruye el total', async () => {
    const req = mockRequest({
      items: [
        // Estatico con flujos propios (bono con deposito de apertura).
        { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01',
          cashFlows: [{ ts: Date.UTC(2020, 0, 1), amount: 6098 }], _flowClampZero: true },
        // Estatico sin flujos.
        { id: 'bank1', symbol: 'BANKGT', type: 'Bank', quantity: 1, currentPrice: 602, purchasePrice: 602, acquisitionDate: '2019-01-01' },
        // De mercado: en este arnes su fetch SIEMPRE falla, asi que cae al
        // camino estatico. Es justo el caso donde byKey cambia de llave
        // (simbolo -> id) y donde el consumidor puede perderlo.
        { id: 'btc1', symbol: 'BTC', type: 'Crypto', quantity: 0.00463473, currentPrice: 63000, purchasePrice: 42000, acquisitionDate: '2022-01-06' },
        { id: 'eth1', symbol: 'ETH', type: 'Crypto', quantity: 0.38, currentPrice: 1881, purchasePrice: 1800, acquisitionDate: '2022-06-06' },
      ],
      period: 'YTD',
      breakdown: true,
    })
    const res = await POST(req)
    const data = await res.json()
    expect(data.dataPoints.length).toBeGreaterThan(0)
    for (const p of data.dataPoints) {
      const sum = Object.values(p.byKey || {}).reduce((s, v) => s + v, 0)
      // Un centavo de tolerancia: byKey se redondea por llave y el total una vez.
      expect(Math.abs(sum - p.total)).toBeLessThan(0.05)
    }
  })

  test('toda llave de byKey es resoluble: id de item o simbolo de un item enviado', async () => {
    const items = [
      { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      { id: 'btc1', symbol: 'BTC', type: 'Crypto', quantity: 0.00463473, currentPrice: 63000, purchasePrice: 42000, acquisitionDate: '2022-01-06' },
    ]
    const res = await POST(mockRequest({ items, period: 'YTD', breakdown: true }))
    const data = await res.json()
    const ids = new Set(items.map((it) => it.id))
    const syms = new Set(items.map((it) => (it.symbol || '').toUpperCase()))
    for (const p of data.dataPoints) {
      for (const k of Object.keys(p.byKey || {})) {
        expect(ids.has(k) || syms.has(k)).toBe(true)
      }
    }
  })
})
