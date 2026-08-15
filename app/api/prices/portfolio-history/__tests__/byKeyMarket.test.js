/**
 * @jest-environment node
 */
// FASE IO. La rama de MERCADO de byKey, que el otro arnés no puede tocar (ahí
// el fetch siempre falla y todo cae al camino estático). Es justo la rama donde
// byKey cambia de llave: los activos estáticos se indexan por ID DE ACTIVO y
// los de mercado por SÍMBOLO. Si esa mezcla puede dejar un activo fuera del
// desglose, el panel del YTD mide un portafolio más chico que la gráfica sobre
// los mismos datos, que es la forma exacta del mismatch de LEGDER.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn() }))

const { fetchWithRetry } = require('../../../../../lib/fetchWithRetry')
const { POST } = require('../route')

function mockRequest(body) {
  return { json: async () => body }
}

// Una serie diaria descendente, para que el arranque del año sea claramente
// distinto del valor de hoy: un activo mantenido plano se delataría solo.
// El instante se congela a nivel de modulo: si cada fetch llamara Date.now()
// por su cuenta, dos series pedidas con milisegundos de diferencia tendrian
// timestamps distintos y las dos respuestas no compartirian linea de tiempo,
// que es un artefacto del arnes y no del codigo bajo prueba.
const NOW = Date.now()

function series(startPrice, endPrice, days) {
  const now = NOW
  const out = []
  for (let i = days; i >= 0; i--) {
    const f = (days - i) / days
    out.push({ ts: now - i * 86400000, close: startPrice + (endPrice - startPrice) * f })
  }
  return out
}

function yahooBody(pts) {
  return {
    chart: {
      result: [{
        timestamp: pts.map((p) => Math.floor(p.ts / 1000)),
        indicators: { quote: [{ close: pts.map((p) => p.close) }] },
      }],
    },
  }
}

function coingeckoBody(pts) {
  return { prices: pts.map((p) => [p.ts, p.close]) }
}

beforeEach(() => {
  fetchWithRetry.mockReset()
  fetchWithRetry.mockImplementation(async (url) => {
    if (url.includes('coingecko')) {
      const id = url.includes('/bitcoin/') ? 'btc' : 'eth'
      const pts = id === 'btc' ? series(105000, 63000, 300) : series(3100, 1881, 300)
      return { ok: true, json: async () => coingeckoBody(pts) }
    }
    return { ok: true, json: async () => yahooBody(series(150, 200, 300)) }
  })
})

describe('byKey en la rama de mercado (FASE IO)', () => {
  const legder = [
    { id: 'btc1', symbol: 'BTC', type: 'Crypto', quantity: 0.00463473, currentPrice: 63000, purchasePrice: 42000, acquisitionDate: '2022-01-06' },
    { id: 'eth1', symbol: 'ETH', type: 'Crypto', quantity: 0.38, currentPrice: 1881, purchasePrice: 1800, acquisitionDate: '2022-06-06' },
  ]

  test('la suma de byKey reconstruye el total en TODO punto', async () => {
    const res = await POST(mockRequest({ items: legder, period: 'YTD', breakdown: true }))
    const data = await res.json()
    expect(data.staticFallbackSymbols).toEqual([])
    expect(data.dataPoints.length).toBeGreaterThan(0)
    for (const p of data.dataPoints) {
      const sum = Object.values(p.byKey || {}).reduce((s, v) => s + v, 0)
      expect(Math.abs(sum - p.total)).toBeLessThan(0.05)
    }
  })

  test('toda llave de byKey se resuelve a un activo enviado', async () => {
    const res = await POST(mockRequest({ items: legder, period: 'YTD', breakdown: true }))
    const data = await res.json()
    const ids = new Set(legder.map((it) => it.id))
    const syms = new Set(legder.map((it) => it.symbol.toUpperCase()))
    for (const p of data.dataPoints) {
      for (const k of Object.keys(p.byKey || {})) expect(ids.has(k) || syms.has(k)).toBe(true)
    }
  })


  // El caso que la peticion escopada NUNCA ve y la del portafolio completo SI:
  // el mismo simbolo en DOS cuentas. `allTimeSeries` se indexa por simbolo y
  // `reconstructionFor` recibe UN item, asi que el segundo puede pisar al
  // primero y su cantidad no contarse nunca. Si eso pasa, la fila del panel
  // mide menos que la grafica de esa misma cuenta sobre los mismos activos.
  test('dos activos con el mismo simbolo en cuentas distintas: los DOS cuentan', async () => {
    const items = [
      { id: 'btcA', symbol: 'BTC', type: 'Crypto', quantity: 0.00463473, currentPrice: 63000, purchasePrice: 42000, acquisitionDate: '2022-01-06' },
      { id: 'btcB', symbol: 'BTC', type: 'Crypto', quantity: 0.02, currentPrice: 63000, purchasePrice: 50000, acquisitionDate: '2023-05-01' },
    ]
    const res = await POST(mockRequest({ items, period: 'YTD', breakdown: true }))
    const data = await res.json()
    const last = data.dataPoints[data.dataPoints.length - 1]
    // Hoy las dos posiciones juntas valen (0.00463473 + 0.02) x precio de hoy.
    const expected = (0.00463473 + 0.02) * 63000
    expect(Math.abs(last.total - expected)).toBeLessThan(1)
  })

  // El caso que de verdad interesa: la MISMA cuenta pedida sola (como hace la
  // gráfica escopada) y dentro de un portafolio grande (como hace el panel).
  // Si las dos reconstrucciones no coinciden, la fila y su gráfica no pueden
  // coincidir por más que el reparto cuadre.
  test('pedir la cuenta sola o dentro del portafolio completo da el MISMO valor por activo', async () => {
    const others = [
      { id: 'bond1', symbol: 'IDCBOND', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, acquisitionDate: '2020-01-01' },
      { id: 'stk1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 200, purchasePrice: 150, acquisitionDate: '2024-01-01' },
      { id: 'stk2', symbol: 'MSFT', type: 'Stock', quantity: 5, currentPrice: 200, purchasePrice: 150, acquisitionDate: '2024-01-01' },
    ]
    const scoped = await (await POST(mockRequest({ items: legder, period: 'YTD', breakdown: true }))).json()
    const full = await (await POST(mockRequest({ items: [...others, ...legder], period: 'YTD', breakdown: true }))).json()

    const at = (data, key) => {
      const p = data.dataPoints.find((pt) => pt.byKey && pt.byKey[key] != null)
      return p ? { ts: p.ts, v: p.byKey[key] } : null
    }
    // Ahora la llave es el ID del activo (FASE IO): dos posiciones del mismo
    // simbolo ya no comparten entrada.
    for (const key of ['btc1', 'eth1']) {
      const a = at(scoped, key)
      const b = full.dataPoints.find((pt) => pt.ts === a.ts)
      expect(b).toBeDefined()
      expect(Math.abs(b.byKey[key] - a.v)).toBeLessThan(0.05)
    }
  })
})

// FASE IS. La ULTIMA diferencia entre la fila del panel y la grafica de su
// cuenta: cada superficie elige su propio punto de arranque.
//   - la grafica escopada usa chartData[0] de una peticion que SOLO tiene esa
//     cuenta, o sea su rejilla de tiempo es la de sus propios precios;
//   - el panel usa el primer punto con total > 0 de la peticion del portafolio
//     COMPLETO, cuya rejilla es la UNION de todas: cripto cotiza los 365 dias a
//     las 00:00 UTC, una accion solo en dias habiles al cierre.
// Si esas dos rejillas no arrancan en el mismo instante, las dos superficies
// miden el mismo activo en dias distintos, y en cripto un dia son ~1%.
describe('el punto de arranque que elige cada superficie (FASE IS)', () => {
  const DAY = 86400000
  // Rejillas REALISTAS y distintas: cripto todos los dias a medianoche, accion
  // solo de lunes a viernes al cierre.
  const cryptoGrid = (startPrice, endPrice, days) => {
    const out = []
    for (let i = days; i >= 0; i--) {
      const ts = Math.floor((NOW - i * DAY) / DAY) * DAY
      out.push({ ts, close: startPrice + (endPrice - startPrice) * ((days - i) / days) })
    }
    return out
  }
  const stockGrid = (startPrice, endPrice, days) => {
    const out = []
    for (let i = days; i >= 0; i--) {
      const ts = Math.floor((NOW - i * DAY) / DAY) * DAY + 21 * 3600000
      const dow = new Date(ts).getUTCDay()
      if (dow === 0 || dow === 6) continue
      out.push({ ts, close: startPrice + (endPrice - startPrice) * ((days - i) / days) })
    }
    return out
  }

  beforeEach(() => {
    fetchWithRetry.mockImplementation(async (url) => {
      if (url.includes('coingecko')) {
        return { ok: true, json: async () => coingeckoBody(cryptoGrid(105000, 63000, 300)) }
      }
      return { ok: true, json: async () => yahooBody(stockGrid(150, 200, 300)) }
    })
  })

  const crypto = [
    { id: 'btc1', symbol: 'BTC', type: 'Crypto', quantity: 0.00463473, currentPrice: 63000, purchasePrice: 42000, acquisitionDate: '2022-01-06' },
  ]
  const stocks = [
    { id: 'stk1', symbol: 'AAPL', type: 'Stock', quantity: 10, currentPrice: 200, purchasePrice: 150, acquisitionDate: '2020-01-01' },
  ]

  test('el primer punto de la peticion escopada y el de la completa son el MISMO instante', async () => {
    const scoped = await (await POST(mockRequest({ items: crypto, period: 'YTD', breakdown: true }))).json()
    const full = await (await POST(mockRequest({ items: [...stocks, ...crypto], period: 'YTD', breakdown: true }))).json()
    const scopedFirst = scoped.dataPoints.find((p) => p.total > 0)
    const fullFirst = full.dataPoints.find((p) => p.total > 0)
    expect(new Date(fullFirst.ts).toISOString()).toBe(new Date(scopedFirst.ts).toISOString())
  })

  test('en ese punto, el activo vale lo MISMO en las dos', async () => {
    const scoped = await (await POST(mockRequest({ items: crypto, period: 'YTD', breakdown: true }))).json()
    const full = await (await POST(mockRequest({ items: [...stocks, ...crypto], period: 'YTD', breakdown: true }))).json()
    const scopedFirst = scoped.dataPoints.find((p) => p.total > 0)
    const fullFirst = full.dataPoints.find((p) => p.total > 0)
    expect(Math.abs((fullFirst.byKey?.btc1 ?? 0) - (scopedFirst.byKey?.btc1 ?? 0))).toBeLessThan(0.05)
  })
})
