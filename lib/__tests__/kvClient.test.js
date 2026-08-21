/**
 * @jest-environment node
 */
// FASE HS. El caché de respaldo (Upstash Redis) se apagaba EN SILENCIO cuando
// las credenciales venían con los nombres de Upstash en vez de los de Vercel:
// se comportaba igual que sin base. Estos tests fijan que los DOS juegos de
// nombres funcionan, y que un fallo del caché nunca propaga una excepción al
// caller (es best-effort por diseño).

const ENV_KEYS = [
  'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
]

describe('kvClient', () => {
  let saved
  beforeEach(() => {
    saved = {}
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
    jest.resetModules()
    global.fetch = jest.fn()
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const load = () => require('../kvClient')

  test('sin credenciales: no configurado, backend "none", y nada explota', async () => {
    const kv = load()
    expect(kv.kvConfigured()).toBe(false)
    expect(kv.kvBackend()).toBe('none')
    await expect(kv.kvSetJSON('k', { a: 1 }, 60)).resolves.toBeUndefined()
    await expect(kv.kvGetJSON('k')).resolves.toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('nombres de Vercel (KV_REST_API_*) activan el cache', () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    expect(kv.kvConfigured()).toBe(true)
    expect(kv.kvBackend()).toBe('upstash')
  })

  // El caso que estaba roto: una base conectada por el Marketplace puede
  // exponer SOLO estos nombres, y los tres consumidores la ignoraban.
  test('nombres de Upstash (UPSTASH_REDIS_REST_*) tambien activan el cache', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'
    const kv = load()
    expect(kv.kvConfigured()).toBe(true)
    expect(kv.kvBackend()).toBe('upstash')
  })

  test('set/get hacen un round-trip JSON contra la API REST', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io/'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()

    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'OK' }) })
    await kv.kvSetJSON('px:AAPL', { close: 1 }, 604800)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://example.upstash.io') // barra final normalizada
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual(['SET', 'px:AAPL', '{"close":1}', 'EX', '604800'])

    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: '{"close":1}' }) })
    await expect(kv.kvGetJSON('px:AAPL')).resolves.toEqual({ close: 1 })
  })

  test('una clave inexistente devuelve null, no una excepcion', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) })
    await expect(kv.kvGetJSON('nope')).resolves.toBeNull()
  })

  // Best-effort: un caché caído jamás puede hacer fallar la petición que lo usa.
  test('un fallo de red se traga y devuelve null', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    await expect(kv.kvGetJSON('k')).resolves.toBeNull()
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    await expect(kv.kvSetJSON('k', { a: 1 }, 60)).resolves.toBeUndefined()
  })

  test('un status no-ok tampoco propaga', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    await expect(kv.kvGetJSON('k')).resolves.toBeNull()
  })

  // FASE KP: la purga puntual del caché del link compartido.
  test('kvDel manda el comando DEL y un fallo no propaga', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 1 }) })
    await kv.kvDel('share:abc123')
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(['DEL', 'share:abc123'])
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    await expect(kv.kvDel('share:abc123')).resolves.toBeUndefined()
  })

  test('kvIncr devuelve el contador; sin respuesta usable devuelve null', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    const kv = load()
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 3 }) })
    await expect(kv.kvIncr('rl:1.2.3.4:99')).resolves.toBe(3)
    // Sin numero no se puede afirmar nada atomico: el caller cae a memoria.
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await expect(kv.kvIncr('rl:1.2.3.4:99')).resolves.toBeNull()
  })
})
