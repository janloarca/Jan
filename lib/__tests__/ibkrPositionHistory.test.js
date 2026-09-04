/**
 * FASE NJ: una posición de IBKR con ledger de trades se reconstruye POR
 * POSICIÓN en el Spreadsheet, en vez de colapsarse en el bucket sintético.
 *
 * El defecto que cierra, reportado con captura: 18 posiciones de IBKR con "-"
 * en TODOS los meses pasados, mientras la fila de la institución sí traía
 * números. El filtro de `marketItems` excluía a todo item `_source:'ibkr'` con
 * esta razón: "de un mes pasado solo se conoce el NAV TOTAL de la cuenta". Esa
 * premisa es cierta sin trades y FALSA con ellos: el Flex trae hasta 365 días
 * de operaciones, así que la cantidad de cada mes se rebobina EXACTA y el
 * precio de ese mes lo da el proveedor. Deja de ser un reparto y pasa a ser
 * una medición.
 *
 * Lo que estos tests fijan, en las DOS direcciones:
 *   - con trades → fila propia por mes, y CERO bucket (o sea nadie suma doble)
 *   - sin trades → bucket, exactamente como siempre
 *   - el proveedor falla → vuelve al bucket, nunca se queda sin nada
 */

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(),
  safeJson: (res) => res.json(),
}))

const { authFetch } = require('../authFetch')
const { getHistoricalItemValues, IBKR_UNKNOWN_KEY_PREFIX } = require('../historicalValues')

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const BUCKET = `${IBKR_UNKNOWN_KEY_PREFIX}Interactive Brokers__stocks`

// Una posición importada: `acquisitionDate` es el sello del SYNC, no la compra
// real, que es justamente por qué su historia no puede salir de esa fecha.
const pos = (id, symbol, quantity, price) => ({
  id, symbol, name: symbol, type: 'Stock',
  quantity, currentPrice: price, purchasePrice: price, currency: 'USD',
  institution: 'Interactive Brokers', _category: 'stocks', _source: 'ibkr',
  acquisitionDate: '2026-06-15', createdAt: '2026-06-15T00:00:00.000Z',
})

const buy = (symbol, quantity, date) => ({
  type: 'BUY', symbol, quantity, date, totalAmount: quantity * 10,
  currency: 'USD', _source: 'ibkr',
})

// NAV real del broker: es lo que alimenta al bucket cuando hace falta.
const snapshots = [
  { date: '2026-01-31', netWorthUSD: 1000, _source: 'ibkr' },
  { date: '2026-06-30', netWorthUSD: 2000, _source: 'ibkr' },
]

// Precio plano por símbolo, para que el valor de un mes sea qty × precio y la
// aritmética se pueda comprobar a mano.
function mockPrices(map, failing = new Set()) {
  authFetch.mockImplementation(async (url) => {
    const sym = decodeURIComponent(String(url).match(/symbol=([^&]+)/)[1])
    if (failing.has(sym)) return { ok: false, status: 500 }
    return {
      ok: true,
      json: async () => ({
        currency: 'USD',
        prices: MONTHS.map((mk) => ({ date: `${mk}-28T00:00:00Z`, close: map[sym] })),
      }),
    }
  })
}

const keysOf = (month) => Object.keys(month || {})
const bucketsIn = (month) => keysOf(month).filter((k) => k.startsWith(IBKR_UNKNOWN_KEY_PREFIX))

describe('posiciones de IBKR con ledger de trades', () => {
  beforeEach(() => authFetch.mockReset())

  it('escribe una fila POR POSICIÓN, con la cantidad rebobinada del mes', async () => {
    const items = [pos('p1', 'AAA', 10, 100)]
    // 6 compradas en enero, 4 más en abril → en febrero se tenían 6, no 10.
    const txs = [buy('AAA', 6, '2026-01-10'), buy('AAA', 4, '2026-04-10')]
    mockPrices({ AAA: 100 })

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots)

    expect(res['2026-02'].p1.value).toBe(600)
    expect(res['2026-05'].p1.value).toBe(1000)
    expect(res['2026-02'].p1.symbol).toBe('AAA')
  })

  it('NO deja bucket cuando todas las posiciones del grupo se reconstruyeron', async () => {
    const items = [pos('p1', 'AAA', 10, 100), pos('p2', 'BBB', 5, 20)]
    const txs = [buy('AAA', 10, '2026-01-10'), buy('BBB', 5, '2026-01-10')]
    mockPrices({ AAA: 100, BBB: 20 })

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots)

    // Sin este invariante el bucket sumaría ENCIMA de las filas reconstruidas:
    // el doble conteo de FASE FT, entrando por la puerta de al lado.
    expect(bucketsIn(res['2026-03'])).toEqual([])
    const total = keysOf(res['2026-03']).reduce((s, k) => s + res['2026-03'][k].value, 0)
    expect(total).toBe(10 * 100 + 5 * 20)
  })

  it('un mes ANTERIOR a la primera compra queda vacío, no relleno con el valor de hoy', async () => {
    // El respaldo held-flat existe para no dejar en blanco un mes que el activo
    // sí vivió; acá el activo NO existía, así que rellenarlo sería inventarlo.
    const items = [pos('p1', 'AAA', 10, 100)]
    mockPrices({ AAA: 100 })

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], [buy('AAA', 10, '2026-04-10')], snapshots)

    expect(res['2026-02'].p1).toBeUndefined()
    expect(res['2026-05'].p1.value).toBe(1000)
  })

  it('una posición SIN trades sigue yendo al bucket, como siempre', async () => {
    const items = [pos('p1', 'AAA', 10, 100)]
    mockPrices({ AAA: 100 })

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], [], snapshots)

    expect(res['2026-03'].p1).toBeUndefined()
    expect(bucketsIn(res['2026-03'])).toEqual([BUCKET])
  })

  it('con trades y sin trades conviven: fila propia para una, bucket para la otra', async () => {
    const items = [pos('p1', 'AAA', 10, 100), pos('p2', 'BBB', 5, 20)]
    mockPrices({ AAA: 100, BBB: 20 })

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], [buy('AAA', 10, '2026-01-10')], snapshots)

    const m = res['2026-03']
    expect(m.p1.value).toBe(1000)
    expect(m.p2).toBeUndefined()
    // El bucket cubre SOLO lo que quedó sin reconstruir, y lo dice.
    expect(m[BUCKET]._covers).toEqual(['p2'])
  })

  it('si el proveedor de precios falla, la posición VUELVE al bucket', async () => {
    // Sin esto se quedaba sin nada: fuera del bucket por haber entrado al
    // camino de mercado, y sin fila propia porque su respaldo se gatea con la
    // fecha del sync, que deja fuera todos los meses anteriores.
    const items = [pos('p1', 'AAA', 10, 100)]
    mockPrices({ AAA: 100 }, new Set(['AAA']))

    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], [buy('AAA', 10, '2026-01-10')], snapshots)

    expect(res['2026-03'].p1).toBeUndefined()
    expect(bucketsIn(res['2026-03'])).toEqual([BUCKET])
    expect(res['2026-03'][BUCKET]._covers).toEqual(['p1'])
  })

  it('el diagnóstico dice de dónde salió cada serie', async () => {
    const items = [pos('p1', 'AAA', 10, 100), pos('p2', 'BBB', 5, 20)]
    mockPrices({ AAA: 100, BBB: 20 }, new Set(['BBB']))
    const diag = {}

    await getHistoricalItemValues(items, MONTHS, null, 'USD', [], [buy('AAA', 10, '2026-01-10'), buy('BBB', 5, '2026-01-10')], snapshots, diag)

    expect(diag.p1.source).toBe('market')
    // FASE NK: esta línea decía 'flat', y ese valor describía el comportamiento
    // de entonces, no un invariante. Un fetch que FALLA no midió nada y ahora
    // se nombra aparte ('unavailable') justamente porque esa diferencia decide
    // si el mes se puede guardar: un símbolo que legítimamente no cotiza sigue
    // siendo 'flat' y se cachea igual que siempre.
    expect(diag.p2.source).toBe('unavailable')
  })
})
