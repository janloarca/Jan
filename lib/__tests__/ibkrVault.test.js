import { saveIbkrCredentials, clearIbkrCredentials } from '../ibkrVault'
import { authFetch } from '../authFetch'

// El alias `@/` no resuelve dentro de jest.mock en este repo (mismo tropiezo
// que documenta FASE GQ para route.test.js): la ruta va relativa.
jest.mock('../authFetch', () => ({ authFetch: jest.fn() }))

const resp = (status, body, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (contentType !== 'application/json') throw new Error('not json')
    return body
  },
})

describe('el vault de IBKR: un 500 NO es un guardado (FASE KC)', () => {
  beforeEach(() => authFetch.mockReset())

  it('con 200 resuelve y manda la accion correcta', async () => {
    authFetch.mockResolvedValue(resp(200, { saved: true }))
    await expect(saveIbkrCredentials('tok', 'q1')).resolves.toBe(true)
    const [url, opts] = authFetch.mock.calls[0]
    expect(url).toBe('/api/brokers/ibkr')
    expect(JSON.parse(opts.body)).toEqual({ action: 'save-credentials', token: 'tok', queryId: 'q1' })
  })

  it('LANZA con 500 en vez de resolver como si hubiera guardado', async () => {
    // Este es el caso real: sin CRYPTO_MASTER_KEY el cifrado del token falla y
    // la ruta contesta 500. Antes el caller seguia derecho y borraba el token
    // legacy, o sea perdia la unica copia que existia.
    authFetch.mockResolvedValue(resp(500, { error: 'Failed to save credentials' }))
    await expect(saveIbkrCredentials('tok', 'q1')).rejects.toThrow('Failed to save credentials')
  })

  it('el 429 del rate limit tampoco cuenta como guardado', async () => {
    authFetch.mockResolvedValue(resp(429, { error: 'Too many requests' }))
    await expect(saveIbkrCredentials('tok', 'q1')).rejects.toThrow('Too many requests')
  })

  it('una respuesta sin JSON no rompe el manejo del error: manda el status', async () => {
    authFetch.mockResolvedValue(resp(502, null, 'text/html'))
    await expect(saveIbkrCredentials('tok', 'q1')).rejects.toThrow('502')
  })

  it('un cuerpo JSON sin campo error tambien cae al status', async () => {
    authFetch.mockResolvedValue(resp(503, {}))
    await expect(saveIbkrCredentials('tok', 'q1')).rejects.toThrow('503')
  })

  it('clear manda la accion de borrado y lanza igual si no se confirma', async () => {
    authFetch.mockResolvedValue(resp(200, { saved: true }))
    await expect(clearIbkrCredentials()).resolves.toBe(true)
    expect(JSON.parse(authFetch.mock.calls[0][1].body))
      .toEqual({ action: 'save-credentials', token: null, queryId: null })

    authFetch.mockResolvedValue(resp(500, { error: 'nope' }))
    await expect(clearIbkrCredentials()).rejects.toThrow('nope')
  })

  it('un fallo de red sigue propagando (authFetch lanza por su cuenta)', async () => {
    authFetch.mockRejectedValue(new Error('network down'))
    await expect(saveIbkrCredentials('tok', 'q1')).rejects.toThrow('network down')
  })
})
