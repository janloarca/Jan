import { saveLastGood, getLastGood, _clearMemory } from '../priceCache'

// KV is not configured in tests — exercises the in-memory layer.
beforeEach(() => {
  _clearMemory()
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
})

describe('priceCache (in-memory layer)', () => {
  it('returns null when nothing stored', async () => {
    expect(await getLastGood('px:AAPL')).toBeNull()
  })

  it('round-trips a payload with an asOf timestamp', async () => {
    await saveLastGood('px:AAPL', { price: 195.2, currency: 'USD' })
    const entry = await getLastGood('px:AAPL')
    expect(entry.data).toEqual({ price: 195.2, currency: 'USD' })
    expect(new Date(entry.asOf).getTime()).toBeGreaterThan(0)
  })

  it('keys are independent', async () => {
    await saveLastGood('px:AAPL', { price: 1 })
    await saveLastGood('chart:BTC:1y', { prices: [1, 2] })
    expect((await getLastGood('px:AAPL')).data.price).toBe(1)
    expect((await getLastGood('chart:BTC:1y')).data.prices).toHaveLength(2)
    expect(await getLastGood('px:VOO')).toBeNull()
  })

  it('overwrites with the newest value', async () => {
    await saveLastGood('px:AAPL', { price: 1 })
    await saveLastGood('px:AAPL', { price: 2 })
    expect((await getLastGood('px:AAPL')).data.price).toBe(2)
  })

  it('evicts oldest entries beyond the cap without throwing', async () => {
    for (let i = 0; i < 510; i++) await saveLastGood(`px:S${i}`, { i })
    expect(await getLastGood('px:S0')).toBeNull() // evicted
    expect((await getLastGood('px:S509')).data.i).toBe(509)
  })
})
