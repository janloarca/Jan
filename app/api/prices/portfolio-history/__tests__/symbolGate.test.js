/**
 * @jest-environment node
 */
// FASE OA. La validacion de forma del simbolo solo aplica a lo que SI se va a
// pedir a un proveedor. Un activo estatico (bono, banco, inmueble) lleva un
// simbolo SINTETICO armado del nombre, y un nombre con acento o con `%`
// ("Bono Azucar 8%") producia un simbolo que el regex rechazaba: la ruta
// contestaba 400 por el portafolio ENTERO, y con eso se quedaban sin
// respuesta la grafica, el ancla del YTD y el backfill. Un simbolo asi jamas
// sale a la red, asi que rechazarlo no protege nada.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn(async () => { throw new Error('network down') }) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))

const { POST } = require('../route')

const req = (body) => ({ json: async () => body })

describe('FASE OA: simbolo sintetico de un activo estatico', () => {
  test('un bono con acento y % en su simbolo NO tumba la peticion entera', async () => {
    const res = await POST(req({
      items: [
        { id: 'b1', symbol: 'BONO-AZÚCAR-8%', type: 'Bond', quantity: 1, currentPrice: 5000, purchasePrice: 5000, acquisitionDate: '2025-01-01' },
        { id: 'k1', symbol: 'BANCO-CUENTA', type: 'Bank', quantity: 1, currentPrice: 500, purchasePrice: 500, acquisitionDate: '2025-01-01' },
      ],
      period: 'YTD',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.dataPoints.length).toBeGreaterThan(0)
    expect(data.dataPoints[data.dataPoints.length - 1].total).toBeCloseTo(5500, 2)
  })

  test('control: un activo de MERCADO con simbolo malformado sigue rechazado', async () => {
    const res = await POST(req({
      items: [
        { id: 's1', symbol: 'AC ME!', type: 'Stock', quantity: 1, currentPrice: 10, purchasePrice: 10, acquisitionDate: '2025-01-01' },
      ],
      period: 'YTD',
    }))
    expect(res.status).toBe(400)
  })
})
