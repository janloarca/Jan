/**
 * @jest-environment node
 */
// FASE IX4. La API PUBLICA de CoinGecko solo sirve 365 dias de historial:
// `days=max` la rechaza y la respuesta vuelve vacia, con lo que el Spreadsheet
// cae a mantener la cripto plana en su valor de HOY. `rangeForMonths`
// (lib/historicalValues.js) pide 'max' en cuanto la tabla abarca mas de un ano,
// o sea siempre en un portafolio con historia, asi que TODA la cripto del
// Spreadsheet quedaba en "~ estimado". Mismo defecto y mismo arreglo que
// FASE IV en portfolio-history. rangeToDays no es exportable (un route.js del
// App Router solo admite exports reconocidos por Next), asi que se verifica por
// la URL que de verdad se le pide a CoinGecko.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn() }))

const { fetchWithRetry } = require('../../../../../lib/fetchWithRetry')
const { GET } = require('../route')

function req(range) {
  return { url: `https://x.test/api/prices/chart?symbol=BTC&range=${range}&type=crypto` }
}

function daysAsked() {
  const url = fetchWithRetry.mock.calls[0][0]
  return new URL(url).searchParams.get('days')
}

beforeEach(() => {
  fetchWithRetry.mockReset()
  fetchWithRetry.mockImplementation(async () => ({ ok: true, json: async () => ({ prices: [[Date.now(), 63000]] }) }))
})

describe('ventana de cripto en /api/prices/chart (FASE IX4)', () => {
  test('nunca pide "max": la API publica lo rechaza', async () => {
    await GET(req('max'))
    expect(daysAsked()).not.toBe('max')
    expect(Number(daysAsked())).toBeLessThanOrEqual(364)
  })

  test('"max" y "1y" piden la ventana mas larga disponible', async () => {
    await GET(req('max'))
    expect(daysAsked()).toBe('364')
    fetchWithRetry.mockClear()
    await GET(req('1y'))
    expect(daysAsked()).toBe('364')
  })

  test('ninguna ventana valida excede el tope', async () => {
    for (const r of ['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', 'max']) {
      fetchWithRetry.mockClear()
      await GET(req(r))
      expect(Number(daysAsked())).toBeLessThanOrEqual(364)
      expect(Number(daysAsked())).toBeGreaterThan(0)
    }
  })

  test('las ventanas cortas no cambian', async () => {
    for (const [r, d] of [['1d', '1'], ['5d', '5'], ['1mo', '31'], ['3mo', '90'], ['6mo', '180']]) {
      fetchWithRetry.mockClear()
      await GET(req(r))
      expect(daysAsked()).toBe(d)
    }
  })
})
