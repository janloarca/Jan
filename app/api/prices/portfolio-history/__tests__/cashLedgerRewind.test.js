/**
 * @jest-environment node
 */
// FASE IX. La linea de efectivo de un broker se rebobina deshaciendo TODO
// movimiento posterior. Dos cosas se colaban en esa lista y no pertenecen a la
// caja de esa cuenta:
//
//  1. Los depositos de apertura de las cuentas MANUALES (VITALI 6,098, XOCHI
//     1,966, ...). Esos ya rebobinan el saldo de su propio item, asi que el
//     mismo dinero se deshacia dos veces y el efectivo del broker en el pasado
//     quedaba ~la suma de todos ellos por debajo: el portafolio reconstruido
//     terminaba en NEGATIVO (la vista "Todas" arrancando en -$6.3K).
//  2. La venta de una posicion que hoy ya no existe: le resta sus ingresos al
//     efectivo sin devolver las acciones que los produjeron.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn() }))

const { fetchWithRetry } = require('../../../../../lib/fetchWithRetry')
const { POST } = require('../route')
const {
  buildCashFlows, buildTxEvents, brokerAccountTransactions, rewindableTradeSymbols,
} = require('../../../../../lib/portfolioRewind')

function mockRequest(body) {
  return { json: async () => body }
}

const NOW = Date.now()
const DAY = 86400000
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString().split('T')[0]

function yahooFlat(price, days) {
  const ts = []
  const close = []
  for (let i = days; i >= 0; i--) { ts.push(Math.floor((NOW - i * DAY) / 1000)); close.push(price) }
  return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ close }] } }] } }
}

beforeEach(() => {
  fetchWithRetry.mockReset()
  fetchWithRetry.mockImplementation(async () => ({ ok: true, json: async () => yahooFlat(100, 400) }))
})

// La forma del portafolio real: una cuenta de broker (efectivo + una accion que
// sigue en cartera) mas una cuenta MANUAL (un bono) fondeada este ano con su
// propio deposito de apertura.
const brokerCash = {
  id: 'cash1', symbol: 'CASH-USD', type: 'Bank', quantity: 1,
  currentPrice: 1000, purchasePrice: 1000, currency: 'USD', _source: 'ibkr',
}
const brokerStock = {
  id: 'stk1', symbol: 'AAA', type: 'Stock', quantity: 50,
  currentPrice: 100, purchasePrice: 100, currency: 'USD',
  acquisitionDate: iso(10), _source: 'ibkr',
}
const manualBond = {
  id: 'bond1', symbol: 'VITALI', type: 'Bond', quantity: 1,
  currentPrice: 6000, purchasePrice: 6000, currency: 'USD',
  acquisitionDate: iso(200),
}
const items = [brokerCash, brokerStock, manualBond]

const transactions = [
  // Movimientos del BROKER.
  { type: 'DEPOSIT', date: iso(300), totalAmount: 1000, currency: 'USD', symbol: 'CASH', _source: 'ibkr' },
  { type: 'BUY', date: iso(290), symbol: 'AAA', quantity: 50, totalAmount: 5000, currency: 'USD', _source: 'ibkr' },
  // Venta de una posicion que hoy ya NO existe (no viene entre los items).
  { type: 'SELL', date: iso(150), symbol: 'GONE', quantity: 10, totalAmount: 5000, currency: 'USD', _source: 'ibkr' },
  // Deposito de apertura de la cuenta MANUAL: NO es de la caja del broker.
  {
    type: 'DEPOSIT', date: iso(200), totalAmount: 6098, currency: 'USD', symbol: 'VITALI',
    _source: 'manual_new_account', _linkedItemId: 'bond1',
  },
]

const brokerItems = items.filter((it) => it._source === 'ibkr')

function ledger({ scoped }) {
  const txEventsBySym = buildTxEvents(transactions)
  const source = scoped ? brokerAccountTransactions(transactions, brokerItems) : transactions
  return buildCashFlows(source, null, scoped
    ? { rewindableSymbols: rewindableTradeSymbols(items, txEventsBySym) }
    : {})
}

async function reconstruct(flows) {
  const res = await POST(mockRequest({
    period: '1Y',
    items: items.map((it) => (it.id === 'cash1'
      ? { ...it, cashFlows: flows, _flowIsAccountLevel: true }
      : it)),
  }))
  return res.json()
}

describe('la caja del broker solo lleva movimientos del broker (FASE IX)', () => {
  test('un deposito de una cuenta manual queda fuera del ledger', () => {
    const all = brokerAccountTransactions(transactions, brokerItems)
    expect(all).toHaveLength(3)
    expect(all.every((t) => t._linkedItemId !== 'bond1')).toBe(true)
  })

  test('una venta sin contraparte reconstruible queda fuera del ledger', () => {
    const flows = ledger({ scoped: true })
    // Quedan el deposito y la compra de AAA; la venta de GONE no.
    expect(flows).toHaveLength(2)
    expect(flows.some((f) => Math.abs(f.amount - 5000) < 0.01)).toBe(false)
  })

  test('el comportamiento VIEJO reconstruia un portafolio negativo', async () => {
    const data = await reconstruct(ledger({ scoped: false }))
    const min = Math.min(...data.dataPoints.map((p) => p.total))
    expect(min).toBeLessThan(0)
  })

  test('con el ledger correcto el total nunca es negativo', async () => {
    const data = await reconstruct(ledger({ scoped: true }))
    const min = Math.min(...data.dataPoints.map((p) => p.total))
    expect(min).toBeGreaterThanOrEqual(0)
  })

  test('sin rewindableSymbols el comportamiento es el de siempre', () => {
    const plain = buildCashFlows(transactions)
    expect(plain).toHaveLength(4)
  })
})

describe('comisiones e impuestos mueven la caja (FASE IX)', () => {
  test('una retencion se deshace al rebobinar, con su signo del reporte', () => {
    const flows = buildCashFlows([
      { type: 'TAX', date: iso(30), totalAmount: 12.5, currency: 'USD', _signedAmount: -12.5, _source: 'ibkr' },
      { type: 'FEE', date: iso(20), totalAmount: 1.1, currency: 'USD', _source: 'ibkr' },
      { type: 'INTEREST', date: iso(10), totalAmount: 3, currency: 'USD', _signedAmount: 3, _source: 'ibkr' },
    ])
    expect(flows.map((f) => f.amount).sort((a, b) => a - b)).toEqual([-12.5, -1.1, 3])
  })
})
