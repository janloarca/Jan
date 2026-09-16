/**
 * FASE NS: una posición de IBKR que el usuario YA VENDIÓ se reconstruye desde el
 * ledger de trades y aparece en los meses en que se tuvo, bajo una llave
 * sintética propia (IBKR_CLOSED_KEY_PREFIX).
 *
 * El defecto que cierra, medido sobre el archivo real: 7 de las 18 posiciones
 * del Flex se vendieron, y un mes pasado de la Hoja sumaba solo las posiciones
 * que existen HOY. Una vendida no aportaba nada, así que la fila del broker en
 * esos meses quedaba corta por el valor entero de lo vendido.
 *
 * Lo que fija, en las dos direcciones:
 *   - con ledger cerrado y consistente → fila por mes, cantidad EXACTA, cero en
 *     el mes de la venta y después
 *   - ledger que arranca con una VENTA (la posición antecede a los ~365 días
 *     del Flex) → nada: no se sabe cuánto se tenía
 *   - ledger que no termina en cero → nada: la app ya negó esa tenencia
 *   - símbolo que un item VIVO ya lleva → nada: se contaría dos veces
 *   - sin ningún item de IBKR vivo → nada (borrar la cuenta = sin historial)
 *   - proveedor que falla → nada, y el diag lo anota como 'skipped', no como
 *     'unavailable': un ticker deslistado no puede congelar el año
 *   - colisión de ticker contra el precio del último trade → nada
 */

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(),
  safeJson: (res) => res.json(),
}))

const { authFetch } = require('../authFetch')
const { getHistoricalItemValues, closedIbkrLedgers, IBKR_CLOSED_KEY_PREFIX, IBKR_UNKNOWN_KEY_PREFIX } = require('../historicalValues')

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const INST = 'Interactive Brokers'
const KEY = (sym) => `${IBKR_CLOSED_KEY_PREFIX}${INST}__${sym}`

const live = (id, symbol, quantity, price, extra = {}) => ({
  id, symbol, name: symbol, type: 'Stock',
  quantity, currentPrice: price, purchasePrice: price, currency: 'USD',
  institution: INST, _category: 'stocks', _source: 'ibkr',
  acquisitionDate: '2026-06-15', createdAt: '2026-06-15T00:00:00.000Z',
  _ibkrAccountId: 'U111', ...extra,
})
const trade = (type, symbol, quantity, date, price = 10, extra = {}) => ({
  type, symbol, quantity, date, pricePerUnit: price, totalAmount: quantity * price,
  currency: 'USD', _source: 'ibkr', _ibkrAccountId: 'U111', ...extra,
})
const snapshots = [
  { date: '2026-01-31', netWorthUSD: 1000, _source: 'ibkr' },
  { date: '2026-06-30', netWorthUSD: 2000, _source: 'ibkr' },
]

function mockPrices(map, failing = new Set(), empty = new Set()) {
  authFetch.mockImplementation(async (url) => {
    const sym = decodeURIComponent(String(url).match(/symbol=([^&]+)/)[1])
    if (failing.has(sym)) return { ok: false, status: 503 }
    if (empty.has(sym)) return { ok: true, json: async () => ({ prices: [] }) }
    return {
      ok: true,
      json: async () => ({
        currency: 'USD',
        prices: MONTHS.map((mk) => ({ date: `${mk}-28T00:00:00Z`, close: map[sym] })),
      }),
    }
  })
}

// Una posición viva CON trades, para que el grupo tenga algo real y el bucket
// no sea el único habitante.
const items = [live('p1', 'AAA', 10, 100)]
const liveTx = [trade('BUY', 'AAA', 10, '2026-01-10', 100)]

describe('la llave sintética se arma igual en los tres sitios', () => {
  // PortfolioSpreadsheet.jsx y lib/monthlySpreadsheet.js re-declaran el string
  // (no pueden importar este módulo: arrastra authFetch → Firebase a Jest). Si
  // uno de los tres cambia solo, las filas se escriben y nadie las dibuja.
  const fs = require('fs')
  const path = require('path')
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8')
  it('PortfolioSpreadsheet.jsx y monthlySpreadsheet.js usan el mismo prefijo', () => {
    expect(IBKR_CLOSED_KEY_PREFIX).toBe('__ibkr_closed__')
    expect(read('components/dashboard/PortfolioSpreadsheet.jsx')).toContain(`const IBKR_CLOSED_KEY_PREFIX = '${IBKR_CLOSED_KEY_PREFIX}'`)
    expect(read('lib/monthlySpreadsheet.js')).toContain(`const IBKR_CLOSED_KEY_PREFIX = '${IBKR_CLOSED_KEY_PREFIX}'`)
  })
})

describe('closedIbkrLedgers (puro)', () => {
  it('devuelve el ledger de un símbolo comprado y vendido dentro de la ventana', () => {
    const txs = [...liveTx, trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('SELL', 'OWL', 20, '2026-05-10', 18)]
    const out = closedIbkrLedgers(items, txs)
    expect(out).toHaveLength(1)
    expect(out[0].symbol).toBe('OWL')
    expect(out[0].institution).toBe(INST)
    expect(out[0].events.map(e => e.delta)).toEqual([20, -20])
    expect(out[0].lastTrade.price).toBe(18)
  })

  it('un ledger que ARRANCA vendiendo se salta: la posición antecede al Flex', () => {
    const txs = [...liveTx, trade('SELL', 'OLD', 5, '2026-03-01')]
    expect(closedIbkrLedgers(items, txs)).toEqual([])
  })

  it('un ledger que NO termina en cero se salta: no hay item y no hay venta', () => {
    const txs = [...liveTx, trade('BUY', 'GHOST', 5, '2026-03-01')]
    expect(closedIbkrLedgers(items, txs)).toEqual([])
  })

  it('un símbolo que un item VIVO lleva no se reconstruye como vendida (ni de otra fuente)', () => {
    const manual = { id: 'm1', symbol: 'ZZZ', name: 'ZZZ', type: 'Stock', quantity: 1, currentPrice: 5, purchasePrice: 5, institution: 'Otro' }
    const txs = [...liveTx, trade('BUY', 'ZZZ', 2, '2026-02-01'), trade('SELL', 'ZZZ', 2, '2026-03-01')]
    expect(closedIbkrLedgers([...items, manual], txs)).toEqual([])
  })

  it('sin ningún item de IBKR vivo no devuelve nada (borrar la cuenta = sin historial)', () => {
    const txs = [trade('BUY', 'OWL', 20, '2026-02-10'), trade('SELL', 'OWL', 20, '2026-05-10')]
    expect(closedIbkrLedgers([], txs)).toEqual([])
  })

  it('ignora CASH, pares de divisas y trades que no son de IBKR', () => {
    const txs = [
      ...liveTx,
      trade('BUY', 'CASH', 1, '2026-02-01'), trade('SELL', 'CASH', 1, '2026-03-01'),
      trade('BUY', 'EUR.USD', 1, '2026-02-01'), trade('SELL', 'EUR.USD', 1, '2026-03-01'),
      trade('BUY', 'MAN', 1, '2026-02-01', 10, { _source: 'manual' }), trade('SELL', 'MAN', 1, '2026-03-01', 10, { _source: 'manual' }),
    ]
    expect(closedIbkrLedgers(items, txs)).toEqual([])
  })

  it('la institución sale del item vivo de la MISMA cuenta', () => {
    const two = [live('p1', 'AAA', 10, 100), live('p2', 'BBB', 1, 1, { institution: 'IBKR Pro', _ibkrAccountId: 'U222' })]
    const txs = [trade('BUY', 'OWL', 2, '2026-02-01', 10, { _ibkrAccountId: 'U222' }), trade('SELL', 'OWL', 2, '2026-03-01', 10, { _ibkrAccountId: 'U222' })]
    expect(closedIbkrLedgers(two, txs)[0].institution).toBe('IBKR Pro')
  })
})

describe('getHistoricalItemValues: filas de posiciones vendidas', () => {
  beforeEach(() => authFetch.mockReset())

  it('escribe la vendida en los meses en que se tuvo, con la cantidad exacta, y NADA desde la venta', async () => {
    // 20 en febrero, 10 más en marzo, todo vendido en mayo.
    const txs = [...liveTx,
      trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('BUY', 'OWL', 10, '2026-03-10', 15), trade('SELL', 'OWL', 30, '2026-05-10', 15)]
    mockPrices({ AAA: 100, OWL: 15 })
    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots)
    const k = KEY('OWL')
    expect(res['2026-01'][k]).toBeUndefined()
    expect(res['2026-02'][k].value).toBe(20 * 15)
    expect(res['2026-03'][k].value).toBe(30 * 15)
    expect(res['2026-04'][k].value).toBe(30 * 15)
    expect(res['2026-05'][k]).toBeUndefined()
    expect(res['2026-06'][k]).toBeUndefined()
    expect(res['2026-03'][k]).toMatchObject({ symbol: 'OWL', institution: INST, category: 'stocks', estimated: false, _syntheticIbkr: true })
    // La identidad de "vendida" es la LLAVE, no un campo: nada mas se persiste.
    expect(Object.keys(res['2026-03'][k]).sort()).toEqual(['_syntheticIbkr', 'category', 'estimated', 'institution', 'symbol', 'value'])
  })

  it('el mes de la institución ya no queda corto: la vendida suma junto a la viva', async () => {
    const txs = [...liveTx, trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('SELL', 'OWL', 20, '2026-05-10', 15)]
    mockPrices({ AAA: 100, OWL: 15 })
    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots)
    const march = Object.values(res['2026-03']).reduce((s, v) => s + v.value, 0)
    // Sin la vendida, marzo sumaba solo AAA (1,000). Con ella, los 300 de OWL.
    expect(march).toBe(1000 + 300)
    // Y no aparece ningún bucket: todo el grupo vivo se reconstruyó.
    expect(Object.keys(res['2026-03']).filter(k => k.startsWith(IBKR_UNKNOWN_KEY_PREFIX))).toEqual([])
  })

  it('NO pide precio para una vendida que no se tuvo en ningún mes pedido', async () => {
    const txs = [...liveTx, trade('BUY', 'OLD', 5, '2024-02-10'), trade('SELL', 'OLD', 5, '2024-05-10')]
    mockPrices({ AAA: 100, OLD: 7 })
    await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots)
    const asked = authFetch.mock.calls.map(c => decodeURIComponent(String(c[0]).match(/symbol=([^&]+)/)[1]))
    expect(asked).toEqual(['AAA'])
  })

  it('si el proveedor falla sobre la vendida: sin fila, y el diag dice skipped (no unavailable)', async () => {
    const txs = [...liveTx, trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('SELL', 'OWL', 20, '2026-05-10', 15)]
    mockPrices({ AAA: 100 }, new Set(['OWL']))
    const diag = {}
    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots, diag)
    expect(res['2026-03'][KEY('OWL')]).toBeUndefined()
    expect(diag[KEY('OWL')].source).toBe('skipped')
    expect(Object.values(diag).some(d => d.source === 'unavailable')).toBe(false)
    // La viva no se afecta.
    expect(res['2026-03'].p1.value).toBe(1000)
  })

  it('un ticker que resuelve a OTRO instrumento se descarta por el precio del último trade', async () => {
    const txs = [...liveTx, trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('SELL', 'OWL', 20, '2026-05-10', 15)]
    // El proveedor dice 900 donde el trade se hizo a 15: 60x, no es este activo.
    mockPrices({ AAA: 100, OWL: 900 })
    const diag = {}
    const res = await getHistoricalItemValues(items, MONTHS, null, 'USD', [], txs, snapshots, diag)
    expect(res['2026-03'][KEY('OWL')]).toBeUndefined()
    expect(diag[KEY('OWL')].source).toBe('flat')
  })

  it('convierte a la moneda base con el mismo convert que todo lo demás', async () => {
    const txs = [...liveTx, trade('BUY', 'OWL', 20, '2026-02-10', 15), trade('SELL', 'OWL', 20, '2026-05-10', 15)]
    mockPrices({ AAA: 100, OWL: 15 })
    const convert = (v, from, to) => (from === 'USD' && to === 'GTQ' ? v * 7.7 : v)
    const res = await getHistoricalItemValues(items, MONTHS, convert, 'GTQ', [], txs, snapshots)
    expect(res['2026-03'][KEY('OWL')].value).toBeCloseTo(300 * 7.7)
  })
})
