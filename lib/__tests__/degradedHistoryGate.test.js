/**
 * FASE NK. Dos defectos que el usuario reportó con capturas del Spreadsheet:
 *
 *   2. "No hay historial en 2025 cuando son 365 dias"
 *   3. "El % no funciona"
 *
 * (2) NO era la lógica: medido con el motor REAL sobre su XML, los meses de
 * 2025 SÍ producen 8-10 filas por mes cuando el proveedor contesta. Lo que
 * pasó es que la corrida en la que el fetch de precios falló se GUARDÓ, y a
 * partir de ahí el chequeo de "¿ya se calculó este mes?" lo encontró cubierto
 * y no lo volvió a pedir nunca: un hipo de un minuto congela el año para
 * siempre. Es el invariante 5 de la serie histórica (FASE HJ, "un consumidor
 * que PERSISTE nunca escribe desde una respuesta degradada") en la superficie
 * que aquella pasada no tocó.
 *
 * (3) El % vivía SOLO en las filas de categoría: con 18 posiciones la columna
 * tenía dos valores y veinte celdas vacías.
 *
 * Lo que fijan estos tests:
 *   - el motor DISTINGUE "el proveedor no contestó" de "este símbolo no
 *     cotiza", que es lo único que permite decidir si el mes se puede guardar;
 *   - la Hoja no guarda ni estampa una corrida degradada, y lo dice;
 *   - `shareLabel` no imprime "0%" sobre una fila que sí pesa.
 */
const fs = require('fs')
const path = require('path')

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(),
  safeJson: (res) => res.json(),
}))

const { authFetch } = require('../authFetch')
const { getHistoricalItemValues } = require('../historicalValues')
const { shareLabel } = require('../../components/dashboard/PortfolioSpreadsheet')

const MONTHS = ['2026-01', '2026-02', '2026-03']

const stock = (id, symbol) => ({
  id, symbol, name: symbol, type: 'Stock',
  quantity: 10, currentPrice: 100, purchasePrice: 100, currency: 'USD',
  institution: 'Acme', _category: 'stocks',
  acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z',
})

describe('FASE NK: una corrida degradada se distingue de una medición', () => {
  beforeEach(() => authFetch.mockReset())

  it('el proveedor que NO contesta se reporta "unavailable", no "flat"', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 500 })
    const diag = {}

    await getHistoricalItemValues([stock('s1', 'AAA')], MONTHS, null, 'USD', [], [], [], diag)

    expect(diag.s1.source).toBe('unavailable')
  })

  it('un símbolo que contesta SIN precios sigue siendo "flat" y se puede cachear', async () => {
    // Este es el caso de un activo que legítimamente no cotiza. Sin esta
    // distinción, un portafolio de puros activos estáticos no podría guardar
    // un solo mes: el gate de arriba lo leería como proveedor caído.
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ currency: 'USD', prices: [] }) })
    const diag = {}

    await getHistoricalItemValues([stock('s1', 'AAA')], MONTHS, null, 'USD', [], [], [], diag)

    expect(diag.s1.source).toBe('flat')
  })

  it('un fetch que LANZA también es "unavailable"', async () => {
    authFetch.mockRejectedValue(new Error('network'))
    const diag = {}

    await getHistoricalItemValues([stock('s1', 'AAA')], MONTHS, null, 'USD', [], [], [], diag)

    expect(diag.s1.source).toBe('unavailable')
  })

  it('el que sí contestó se mide igual aunque otro haya fallado', async () => {
    authFetch.mockImplementation(async (url) => {
      const sym = decodeURIComponent(String(url).match(/symbol=([^&]+)/)[1])
      if (sym === 'BBB') return { ok: false, status: 429 }
      return {
        ok: true,
        json: async () => ({
          currency: 'USD',
          prices: MONTHS.map((mk) => ({ date: `${mk}-28T00:00:00Z`, close: 50 })),
        }),
      }
    })
    const diag = {}

    await getHistoricalItemValues([stock('s1', 'AAA'), stock('s2', 'BBB')], MONTHS, null, 'USD', [], [], [], diag)

    expect(diag.s1.source).toBe('market')
    expect(diag.s2.source).toBe('unavailable')
  })
})

// El efecto de cómputo y el botón "Recalcular" viven dentro de un componente
// que jest no puede montar sin el dashboard entero (Firestore, precios en vivo,
// el caché mensual), así que el gate se fija LEYENDO LA FUENTE. Precedente:
// ibkrImportGate.test.js, moneyInputs.test.js.
describe('FASE NK: la Hoja no persiste una corrida degradada', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../components/dashboard/PortfolioSpreadsheet.jsx'),
    'utf8',
  )
  // Sin comentarios: el porqué del gate está escrito ahí y nombra las mismas
  // palabras que el test busca (lección FASE LE).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('el efecto automático corta ANTES de estampar y de guardar', () => {
    const at = code.indexOf("filter(d => d.source === 'unavailable')")
    expect(at).toBeGreaterThan(-1)
    const body = code.slice(at, at + 900)
    expect(body).toMatch(/if\s*\(\s*unavailable\.length\s*>\s*0\s*\)/)
    expect(body).toMatch(/return/)
    // y el corte ocurre antes de la escritura del caché
    expect(body.indexOf('return')).toBeLessThan(
      code.indexOf('onSaveItemSnapshots(mk', at) - at,
    )
  })

  it('el efecto reintenta en vez de rendirse al primer fallo, con techo', () => {
    expect(code).toMatch(/MAX_DEGRADED_TRIES\s*=\s*[1-9]/)
    // el sello que apaga el re-fetch solo se pone al agotar los intentos
    expect(code).toMatch(/tries\s*>=\s*MAX_DEGRADED_TRIES\)\s*lastFetchedYearRef\.current/)
  })

  it('"Recalcular" tampoco guarda ni estampa una corrida degradada', () => {
    const at = code.indexOf('const handleRecalculate')
    expect(at).toBeGreaterThan(-1)
    const body = code.slice(at, code.indexOf('setRecalcReport({ months', at))
    expect(body).toMatch(/if\s*\(\s*unavailable\.length\s*>\s*0\s*\)\s*break/)
    expect(body).toMatch(/if\s*\(\s*unavailable\.length\s*===\s*0\s*\)/)
  })

  it('lo dice en pantalla en vez de degradar en silencio', () => {
    expect(code).toMatch(/data-testid="degraded-notice"/)
  })

  it('las TRES filas de la tabla imprimen su %, no solo la categoría', () => {
    // Que `shareLabel` exista no prueba que esté cableada: el defecto era
    // exactamente que dos de las tres filas renderizaban un <td/> pelado.
    const wired = code.match(/shareLabel\(/g) || []
    expect(wired.length).toBeGreaterThanOrEqual(3)
    expect(code).toMatch(/shareLabel\(cat\.total,\s*grandTotal\)/)
    expect(code).toMatch(/shareLabel\(inst\.total,\s*grandTotal\)/)
    expect(code).toMatch(/shareLabel\(getItemValue\(item\),\s*grandTotal\)/)
  })
})

describe('FASE NK: el % de la columna', () => {
  it('una fila chica dice "<1%", nunca "0%"', () => {
    // Un cero AFIRMA que la fila no pesa nada, y $20 dentro de $10,000 sí pesa.
    expect(shareLabel(20, 10000)).toBe('<1%')
    // El borde: 0.5% redondea a 1% y ese sí se imprime como número.
    expect(shareLabel(50, 10000)).toBe('1%')
  })

  it('redondea a entero el caso común', () => {
    expect(shareLabel(2500, 10000)).toBe('25%')
    expect(shareLabel(10000, 10000)).toBe('100%')
  })

  it('sin denominador no imprime nada, en vez de inventar un 0%', () => {
    expect(shareLabel(100, 0)).toBeNull()
    expect(shareLabel(100, null)).toBeNull()
  })

  it('un valor CERO sí es 0%: es un hecho, no una división imposible', () => {
    expect(shareLabel(0, 10000)).toBe('0%')
  })

  it('una deuda pesa por su magnitud, no por su signo', () => {
    // getItemValue devuelve negativo para un pasivo; "-25%" del patrimonio no
    // significa nada, lo que la fila dice es cuánto de la tabla ocupa.
    expect(shareLabel(-2500, 10000)).toBe('25%')
  })
})
