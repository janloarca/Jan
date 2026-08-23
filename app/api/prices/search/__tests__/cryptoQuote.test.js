/**
 * @jest-environment node
 */
// CRYPTO_MAP guarda el id de CoinGecko como STRING plano (`ETH: 'ethereum'`),
// y esta ruta era la unica de las nueve superficies que lo leia como `.id`:
// la URL salia con `ids=undefined`, CoinGecko contestaba `{}` y CADA cripto
// volvia sin precio. No fallaba ruidosamente, porque el caller (AddAccountModal)
// no tenia rama de fallo: el precio de la busqueda ANTERIOR sobrevivia en el
// formulario y quedaba guardado como el costo de ESTA (un ETF de $56 archivado
// como Ethereum, y de ahi +3970% en cuanto el precio vivo aterrizaba en ~$2,400).
//
// Igual que en FASE IX4, la funcion no es exportable (un route.js del App Router
// solo admite exports reconocidos por Next), asi que se verifica por la URL que
// de verdad se le pide a CoinGecko.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn() }))

const { fetchWithRetry } = require('../../../../../lib/fetchWithRetry')
const { CRYPTO_MAP } = require('../../../../../lib/cryptoMap')
const { GET } = require('../route')

const req = (symbol, type) => ({ url: `https://x.test/api/prices/search?symbol=${symbol}&type=${type}` })
const coingeckoCall = () => fetchWithRetry.mock.calls.find((c) => String(c[0]).includes('coingecko'))

beforeEach(() => {
  fetchWithRetry.mockReset()
})

describe('cotizacion de cripto en /api/prices/search', () => {
  test('el mapa guarda strings, no objetos con .id', () => {
    const values = Object.values(CRYPTO_MAP)
    expect(values.length).toBeGreaterThan(20)
    for (const v of values) expect(typeof v).toBe('string')
  })

  test('la URL lleva el id real y NUNCA "undefined"', async () => {
    fetchWithRetry.mockImplementation(async () => ({ ok: true, json: async () => ({ ethereum: { usd: 2412.5 } }) }))
    const res = await GET(req('ETH', 'Crypto'))
    const call = coingeckoCall()
    expect(call).toBeDefined()
    const ids = new URL(call[0]).searchParams.get('ids')
    expect(ids).toBe('ethereum')
    expect(String(call[0])).not.toContain('undefined')
    const body = await res.json()
    expect(body.quote.price).toBeCloseTo(2412.5)
    expect(body.quote.currency).toBe('USD')
  })

  // El comportamiento viejo, fijado como regresion negativa: con `info.id` sobre
  // un string la respuesta se indexaba por `undefined` y el quote salia null.
  test('un id que la respuesta no trae devuelve quote null, nunca un precio inventado', async () => {
    fetchWithRetry.mockImplementation(async () => ({ ok: true, json: async () => ({}) }))
    const res = await GET(req('ETH', 'Crypto'))
    const body = await res.json()
    expect(body.quote).toBeNull()
  })

  test('un simbolo fuera del mapa no llama a CoinGecko', async () => {
    const res = await GET(req('NOSUCHCOIN', 'Crypto'))
    expect(coingeckoCall()).toBeUndefined()
    const body = await res.json()
    expect(body.quote).toBeNull()
  })

  test('las tres cripto mas comunes resuelven a su id', async () => {
    for (const [sym, id] of [['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['SOL', 'solana']]) {
      fetchWithRetry.mockReset()
      fetchWithRetry.mockImplementation(async () => ({ ok: true, json: async () => ({ [id]: { usd: 1 } }) }))
      await GET(req(sym, 'Crypto'))
      expect(new URL(coingeckoCall()[0]).searchParams.get('ids')).toBe(id)
    }
  })
})
