/** @jest-environment node */
// FASE SJ. Un símbolo colgado no puede dejar al portafolio entero sin precios.
jest.mock('../priceCache', () => ({
  saveLastGood: jest.fn(() => Promise.resolve()),
  getLastGood: jest.fn((key) => Promise.resolve(
    key === 'px:SLOW' ? { data: { price: 50, currency: 'USD' }, asOf: '2026-11-14T00:00:00Z' } : null)),
}))

const { fetchStockPrices, priceItems } = require('../marketPrices')

const chart = (price) => ({
  ok: true, status: 200,
  clone() { return this },
  json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: price, previousClose: price - 1, currency: 'USD' }, timestamp: [1763000000], indicators: { quote: [{ close: [price - 1, price] }] } }] } }),
})

// fetch falso: SLOW nunca contesta (salvo que lo aborten), el resto contesta al instante.
beforeEach(() => {
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('/SLOW?')) {
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener?.('abort', () => reject(new Error('aborted')))
      })
    }
    const sym = decodeURIComponent(url.split('/chart/')[1].split('?')[0])
    return Promise.resolve(chart(sym.length * 10))
  })
})

test('el deadline corta al símbolo lento y deja pasar a los demás', async () => {
  const t0 = Date.now()
  const { results, timedOut } = await fetchStockPrices(['AAPL', 'SLOW', 'MSFT'], { concurrency: 3, symbolTimeoutMs: 5000, deadlineMs: 150 })
  expect(Date.now() - t0).toBeLessThan(1000)
  expect(Object.keys(results).sort()).toEqual(['AAPL', 'MSFT'])
  expect(timedOut).toEqual(['SLOW'])
})

test('el límite por intento corta antes del deadline (los dos hosts)', async () => {
  const t0 = Date.now()
  const { results } = await fetchStockPrices(['SLOW', 'AAPL'], { concurrency: 1, symbolTimeoutMs: 60, deadlineMs: 5000 })
  // concurrencia 1: AAPL espera a que SLOW agote sus dos hosts (~120ms), no 5s.
  expect(Date.now() - t0).toBeLessThan(1500)
  expect(results.AAPL.price).toBe(40)
  expect(results.SLOW).toBeUndefined()
})

test('nunca empieza un símbolo pasado el deadline', async () => {
  const { timedOut } = await fetchStockPrices(['SLOW', 'AAPL'], { concurrency: 1, symbolTimeoutMs: 5000, deadlineMs: 80 })
  expect(timedOut).toEqual(['SLOW', 'AAPL'])
  expect(global.fetch.mock.calls.some(([u]) => u.includes('/AAPL?'))).toBe(false)
})

test('lo que no llegó cae al respaldo marcado stale, nunca a cero', async () => {
  const { PRICE_BUDGET } = require('../marketPrices')
  const saved = { ...PRICE_BUDGET }
  Object.assign(PRICE_BUDGET, { symbolTimeoutMs: 60, deadlineMs: 300 })
  try {
    const { prices, usedStale, timedOut } = await priceItems([
      { symbol: 'AAPL', type: 'Stock', quantity: 1 },
      { symbol: 'SLOW', type: 'Stock', quantity: 1 },
    ])
    expect(prices.AAPL.price).toBe(40)
    expect(prices.SLOW).toMatchObject({ price: 50, stale: true })
    expect(usedStale).toBe(true)
    expect(Array.isArray(timedOut)).toBe(true)
  } finally {
    Object.assign(PRICE_BUDGET, saved)
  }
})
