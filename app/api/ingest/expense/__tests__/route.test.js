/**
 * @jest-environment node
 */
// FASE KR. El atajo del iPhone recibió `{"error":"Internal server error"}` dos
// veces sobre compras REALES de Apple Pay: la automatización disparó bien y el
// servidor se cayó. Lo que se fija acá es qué pasa cuando la base de datos
// falla, porque ese es el único origen posible de ese 500 (toda función pura
// del camino devuelve un error en vez de lanzar).
//
// Se mockea por ruta RELATIVA, no por el alias `@/`, por el mismo motivo que el
// test de portfolio-history: el alias no resuelve dentro de jest.mock() acá.
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/firebase-admin', () => ({ getAdminDb: jest.fn(() => ({ __fake: true })) }))

const stampIngestResult = jest.fn(async () => {})
jest.mock('../../../../../lib/ingestTokens', () => ({
  resolveIngestToken: jest.fn(async () => ({ uid: 'u1', label: 'iPhone' })),
  readUserRules: jest.fn(async () => []),
  readUserBaseCurrency: jest.fn(async () => 'GTQ'),
  stampIngestResult: (...a) => stampIngestResult(...a),
}))

const ingestExpense = jest.fn()
jest.mock('../../../../../lib/expenseIngest', () => ({
  ...jest.requireActual('../../../../../lib/expenseIngest'),
  ingestExpense: (...a) => ingestExpense(...a),
}))

const { POST } = require('../route')

const grpc = (code, name) => Object.assign(new Error(`${code} ${name}: boom`), { code })

function req(body = {}) {
  return {
    url: 'https://chispu.xyz/api/ingest/expense',
    headers: { get: (k) => (k.toLowerCase() === 'authorization' ? 'Bearer ' + 'a'.repeat(32) : null) },
    json: async () => ({ amount: 18, currency: 'GTQ', merchant: 'Mcdonalds 50 Bancos', ...body }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('un hipo de la base ya no pierde el cobro', () => {
  test('reintenta un fallo transitorio y termina registrando el gasto', async () => {
    let n = 0
    ingestExpense.mockImplementation(async () => {
      n++
      if (n === 1) throw grpc(14, 'UNAVAILABLE')
      return { status: 'created', id: 'x', transaction: { category: 'Alimentación' } }
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.status).toBe('created')
    expect(n).toBe(2)
  })

  // La automatización de Wallet dispara UNA vez por compra y no vuelve, así que
  // sin reintento ese gasto se pierde hasta que el estado de cuenta lo traiga.
  test('un transitorio que no cede se reporta como pasajero, no como bug', async () => {
    ingestExpense.mockRejectedValue(grpc(14, 'UNAVAILABLE'))
    const res = await POST(req())
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toBe('error:14')
    expect(data.kind).toBe('transient')
    expect(data.message).toBeTruthy()
  })
})

describe('la cuota diaria', () => {
  test('NO se reintenta: insistir la gasta más rápido', async () => {
    ingestExpense.mockRejectedValue(grpc(8, 'RESOURCE_EXHAUSTED'))
    const res = await POST(req())
    expect(ingestExpense).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toBe('error:quota')
    expect(data.message).toMatch(/límite diario/i)
  })
})

describe('el fallo deja rastro en el token', () => {
  // Sin esto, la línea de "último uso" seguía mostrando el resultado ANTERIOR:
  // un crash se veía idéntico a "el atajo nunca llegó", que es justo la
  // distinción que ese campo existe para hacer.
  test('se estampa el código del fallo', async () => {
    ingestExpense.mockRejectedValue(grpc(8, 'RESOURCE_EXHAUSTED'))
    await POST(req())
    expect(stampIngestResult).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(32), 'error:quota', 'shortcut')
  })

  test('un éxito sigue estampando su estado, como siempre', async () => {
    ingestExpense.mockResolvedValue({ status: 'created', id: 'x', transaction: {} })
    await POST(req())
    expect(stampIngestResult).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(32), 'created', 'shortcut')
  })
})

describe('un fallo que NO es de la base', () => {
  test('sigue siendo 500 y no se presenta como pasajero', async () => {
    ingestExpense.mockRejectedValue(new Error('bug de verdad'))
    expect(ingestExpense).toHaveBeenCalledTimes(0)
    const res = await POST(req())
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.kind).toBe('unknown')
  })
})

describe('lo que ya funcionaba no cambia', () => {
  test('un rechazo del atajo sigue siendo 400 con su frase', async () => {
    // Correr la automatización a mano desde Atajos: no hay compra de Wallet, así
    // que el monto llega vacío.
    const res = await POST(req({ amount: '' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('MISSING_AMOUNT')
    expect(data.message).toMatch(/a mano desde Atajos/i)
    expect(ingestExpense).not.toHaveBeenCalled()
  })
})

describe('el transporte queda registrado', () => {
  // El atajo dispara con cada compra, así que pisa el "último uso" el mismo día:
  // sin guardar POR TRANSPORTE, "el correo nunca ha entregado nada" y "entregó y
  // el atajo lo tapó" se ven idénticos, que es justo la pregunta de quien acaba
  // de configurar el reenvío.
  test('android se estampa como android, no como atajo', async () => {
    ingestExpense.mockResolvedValue({ status: 'created', id: 'x', transaction: {} })
    await POST(req({ source: 'android', title: 'Banco', text: 'Compra por Q18.00 en MCDONALDS', amount: undefined }))
    expect(stampIngestResult).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(32), 'created', 'android')
  })

  test('un transporte inventado cae a la lista cerrada', async () => {
    ingestExpense.mockResolvedValue({ status: 'created', id: 'x', transaction: {} })
    await POST(req({ source: 'telepatia' }))
    expect(stampIngestResult).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(32), 'created', 'shortcut')
  })
})

// ⛔ FASE OT. El DÍA con el que entra un gasto capturado por Android.
//
// La ruta arma `receivedAt` con su propio reloj, que corre en UTC, así que sin
// ninguna zona declarada el día se lee en UTC y en Guatemala eso rota a las seis
// de la tarde: una compra de la noche del último día del mes se archiva en el
// mes SIGUIENTE. En Flujo eso no es un día de diferencia, es dinero cambiado de
// mes.
//
// Lo que se fija acá es el CABLEADO: que la ruta lea el desfase que el cuerpo
// declara y se lo pase al parser. El motor tiene sus propios tests.
describe('el día de una captura de Android sale de la zona que declara', () => {
  // 8:05pm del 31 de agosto en Guatemala (UTC-6) ya es el 1 de septiembre en UTC.
  const BORDE = new Date('2026-09-01T02:05:00Z')
  const PUSH = { source: 'android', title: 'Alerta de compra', text: 'Compra por Q75.00 en DONALD EXPRESS GT' }

  const dayFor = async (body) => {
    jest.useFakeTimers().setSystemTime(BORDE)
    try {
      ingestExpense.mockResolvedValue({ status: 'created', id: 'x', transaction: { category: 'Alimentación' } })
      const res = await POST(req(body))
      expect(res.status ?? 200).toBe(200)
      return ingestExpense.mock.calls[0][0].input.date
    } finally {
      jest.useRealTimers()
    }
  }

  test('con la zona declarada en occurredAt, el gasto queda en AGOSTO', async () => {
    expect(await dayFor({ ...PUSH, occurredAt: '2026-08-31T20:05:00-0600' })).toBe('2026-08-31')
  })

  // Regresión NEGATIVA: sin zona no se inventa una, se deja el comportamiento
  // de siempre. El arreglo solo puede mejorar un caso, nunca empeorar uno.
  test('sin zona declarada se comporta igual que antes', async () => {
    expect(await dayFor(PUSH)).toBe('2026-09-01')
  })

  // Un Zulu es el instante ya normalizado: no dice dónde estaba el pagador, y
  // leerlo como desfase cero afirmaría que vive en Greenwich.
  test('un occurredAt Zulu no cuenta como zona declarada', async () => {
    expect(await dayFor({ ...PUSH, occurredAt: '2026-09-01T02:05:00Z' })).toBe('2026-09-01')
  })
})
