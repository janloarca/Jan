// FASE OD. Cuatro defectos de vender y deshacer, fijados con los hooks REALES
// (arnes de FASE JB2 + doble de Firestore de test-utils/fakeFirestore.js).
const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')
const { makeFake } = require('../../test-utils/fakeFirestore')
const { buildSaleTransactions } = require('../../lib/saleTx')
const { saleReversalPlan } = require('../../lib/saleReversal')

const UID = 'u1'; const P = (c) => `users/${UID}/${c}`
const RATES = { USD: 1, GTQ: 7.7 }
const convert = (amt, from, to) => (!from || !to || from === to ? amt : amt / RATES[from] * RATES[to])

function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return { items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null, loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: jest.fn(async () => {}), deleteItem: noop, deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop, deleteDemoData: noop,
    addTransaction: jest.fn(async () => {}), updateTransaction: jest.fn(async () => {}), deleteTransaction: jest.fn(async () => {}), deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop, lots: [], addLot: jest.fn(async () => {}), closeLotsFIFO: noop, transferFunds: noop,
    reverseTransfer: jest.fn(async () => {}), executeSaleAtomic: noop, reverseSaleAtomic: jest.fn(async () => {}), executeContribution: noop, bulkImport: noop,
    bulkWriting: false, bulkWritingRef: { current: false }, deletionEpoch: 0,
    portfolios: [], addPortfolio: noop, deletePortfolio: noop, financeTransactions: [], addFinanceTransaction: noop, updateFinanceTransaction: noop,
    deleteFinanceTransaction: noop, deleteAllFinanceTransactions: noop, deleteFinanceTransactionsByIds: noop,
    saveGoals: noop, saveSettings: jest.fn(async () => {}), saveProfile: noop, incomePlan: null, saveIncomePlan: noop, saveItemSnapshots: noop, loadItemSnapshots: jest.fn(async () => ({})), ...over }
}
function bootDashboard({ items, transactions, lots = [] }) {
  jest.resetModules(); pinReact(); jest.useFakeTimers().setSystemTime(new Date('2026-09-05T15:00:00Z'))
  const ff = makeFirestore({ items, transactions, lots, settings: { baseCurrency: 'USD' } })
  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => ff }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => ({ enrichedItems: items, prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null, refresh: jest.fn() }) }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => ({ rates: RATES, convert, getRate: (c) => RATES[c], convertItemValue: () => 0, loading: false, error: null, lastUpdate: null, refresh: jest.fn() }) }))
  jest.doMock('../useBenchmark', () => ({ useBenchmark: () => ({ benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500', loading: false, error: null, refetch: jest.fn() }) }))
  jest.doMock('../useTabCoordination', () => ({ useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }) }))
  jest.doMock('../../lib/authFetch', () => ({ authFetch: jest.fn(async () => jsonResponse({})), safeJson: jest.fn(async () => ({})) }))
  const { useDashboardData } = require('../useDashboardData')
  const hook = renderHook(() => useDashboardData({ user: { uid: UID }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__' }))
  return { ff, hook }
}
const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() }) }
afterEach(() => jest.useRealTimers())

const gtq = () => ({ id: 'gtq', name: 'Fondo Q', symbol: 'FONDO-Q', type: 'Bank', quantity: 1, purchasePrice: 10000, currentPrice: 10000, currency: 'GTQ', acquisitionDate: '2024-01-01', createdAt: '2024-01-01' })
const usd = () => ({ id: 'usd', name: 'Cuenta USD', symbol: 'BANCO-USD', type: 'Bank', quantity: 1, purchasePrice: 5324.68, currentPrice: 5324.68, currency: 'USD', acquisitionDate: '2024-01-01', createdAt: '2024-01-01' })

describe('D. la reversa de saldo razona en la moneda del item, no en la base', () => {
  const tr = { id: 'tr1', type: 'TRANSFER', symbol: 'FONDO-Q', date: '2026-08-01', totalAmount: 2500, currency: 'GTQ', _originItemId: 'gtq', _linkedItemId: 'usd', _toAmount: 324.68, _toCurrency: 'USD', _source: 'manual_transfer' }
  const dep = { id: 'dep1', type: 'DEPOSIT', symbol: 'FONDO-Q', date: '2026-08-02', totalAmount: 3000, currency: 'GTQ', _linkedItemId: 'gtq', _balanceMoved: true, _source: 'manual_contribution' }

  it('deshacer una transferencia desde una cuenta en GTQ (base USD) la deja en Q12,500, no en 3,798.70', async () => {
    const { ff, hook } = bootDashboard({ items: [gtq(), usd()], transactions: [tr, dep] })
    await settle()
    // El enriquecido SI viene convertido: es lo que hacia falta no usar.
    expect(hook.result.current.enrichedItems.find((i) => i.id === 'gtq').currentPrice).toBeCloseTo(1298.7, 1)
    await act(async () => { await hook.result.current.deleteTransactionWithReversal('tr1') })
    const [[call]] = ff.reverseTransfer.mock.calls
    expect(call.fromId).toBe('gtq')
    expect(call.fromFields).toEqual({ currentPrice: 12500, purchasePrice: 12500 })
    expect(call.toFields).toEqual({ currentPrice: 5000, purchasePrice: 5000 })
  })
  it('borrar un aporte _balanceMoved sobre esa cuenta sana NO se rehusa y la deja en Q7,000', async () => {
    const { ff, hook } = bootDashboard({ items: [gtq(), usd()], transactions: [tr, dep] })
    await settle()
    await act(async () => { await hook.result.current.deleteTransactionWithReversal('dep1') })
    expect(ff.reverseTransfer).toHaveBeenCalledTimes(1)
    expect(ff.reverseTransfer.mock.calls[0][0].fromFields).toEqual({ currentPrice: 7000, purchasePrice: 7000 })
  })
  it('control: una cuenta en la moneda base se comporta igual que siempre', async () => {
    const tr2 = { ...tr, id: 'tr2', symbol: 'BANCO-USD', totalAmount: 300, currency: 'USD', _originItemId: 'usd', _linkedItemId: 'gtq', _toAmount: 2310, _toCurrency: 'GTQ' }
    const { ff, hook } = bootDashboard({ items: [gtq(), usd()], transactions: [tr2] })
    await settle()
    await act(async () => { await hook.result.current.deleteTransactionWithReversal('tr2') })
    expect(ff.reverseTransfer.mock.calls[0][0].fromFields).toEqual({ currentPrice: 5624.68, purchasePrice: 5624.68 })
    expect(ff.reverseTransfer.mock.calls[0][0].toFields).toEqual({ currentPrice: 7690, purchasePrice: 7690 })
  })
})

describe('B. borrar una fila SELL desde el tablero', () => {
  const aapl = () => ({ id: 'aapl', name: 'Apple', symbol: 'AAPL', type: 'Stock', quantity: 8, purchasePrice: 100, currentPrice: 200, currency: 'USD', acquisitionDate: '2025-01-01', createdAt: '2025-01-01', institution: 'IBKR' })
  const bank = () => ({ id: 'bank', name: 'Cuenta USD', symbol: 'BANCO-USD', type: 'Bank', quantity: 1, purchasePrice: 1400, currentPrice: 1400, currency: 'USD', acquisitionDate: '2024-01-01', createdAt: '2024-01-01' })
  const lotsFx = () => [
    { id: 'l1', symbol: 'AAPL', quantity: 8, costBasis: 100, status: 'open', institution: 'IBKR', itemId: 'aapl' },
    { id: 'l1-closed-2026-08-01-1000000000', symbol: 'AAPL', quantity: 2, costBasis: 100, status: 'closed', closedDate: '2026-08-01' },
  ]
  const marked = () => ({ id: 'sell1', type: 'SELL', symbol: 'AAPL', date: '2026-08-01', createdAt: '2026-08-01T10:00:00Z', totalAmount: 400, quantity: 2, pricePerUnit: 200, currency: 'USD',
    _linkedItemId: 'aapl', _destinationItemId: 'bank', _saleId: 'n1', _txNonce: 'n1',
    _sale: { qty: 2, soldFully: false, prevItemFields: { quantity: 10, currentPrice: 200, purchasePrice: 100 }, destId: 'bank', destKind: 'bank', destAmount: 400, destCurrency: 'USD', destAddQty: 0 },
    _lotCloses: [{ lotId: 'l1', closable: 2, whole: false, closedId: 'l1-closed-2026-08-01-1000000000' }] })

  it('con marcas: deshace posicion, lotes y destino en un solo batch, y se lleva su retiro compañero', async () => {
    const w = { id: 'w1', type: 'WITHDRAWAL', date: '2026-08-01', createdAt: '2026-08-01T10:00:00.005Z', totalAmount: 400, currency: 'USD', _linkedItemId: 'aapl', _saleId: 'n1' }
    const { ff, hook } = bootDashboard({ items: [aapl(), bank()], transactions: [marked(), w], lots: lotsFx() })
    await settle()
    await act(async () => { await hook.result.current.deleteTransactionWithReversal('sell1') })
    expect(ff.deleteTransaction).not.toHaveBeenCalled()
    expect(ff.reverseSaleAtomic).toHaveBeenCalledTimes(1)
    expect(ff.reverseSaleAtomic.mock.calls[0][0]).toEqual({
      itemId: 'aapl', itemFields: { quantity: 10 },
      lotWrites: [{ id: 'l1', fields: { quantity: 10 } }], deleteLotIds: ['l1-closed-2026-08-01-1000000000'],
      destId: 'bank', destFields: { currentPrice: 1000, purchasePrice: 1000 },
      txIds: ['sell1', 'w1'],
    })
  })
  it('sin marcas (fila anterior a esta version): se borra a secas, como antes', async () => {
    const old = { ...marked(), _sale: undefined, _lotCloses: undefined, _saleId: undefined }
    const { ff, hook } = bootDashboard({ items: [aapl(), bank()], transactions: [old], lots: lotsFx() })
    await settle()
    await act(async () => { await hook.result.current.deleteTransactionWithReversal('sell1') })
    expect(ff.deleteTransaction).toHaveBeenCalledWith('sell1')
    expect(ff.reverseSaleAtomic).not.toHaveBeenCalled()
  })
  it('con actividad posterior: rehusa con su razon y no borra NADA', async () => {
    const later = { id: 'sell2', type: 'SELL', date: '2026-08-05', totalAmount: 200, _linkedItemId: 'aapl' }
    const { ff, hook } = bootDashboard({ items: [aapl(), bank()], transactions: [marked(), later], lots: lotsFx() })
    await settle()
    let err = null
    try { await act(async () => { await hook.result.current.deleteTransactionWithReversal('sell1') }) } catch (e) { err = e }
    expect(err?.code).toBe('sale-refused')
    expect(err?.reason).toBe('later-activity')
    expect(err?.message).toMatch(/otro movimiento despu/)
    expect(ff.deleteTransaction).not.toHaveBeenCalled()
    expect(ff.reverseSaleAtomic).not.toHaveBeenCalled()
  })
})

describe('C + B. el escritor REAL: dos ventas iguales el mismo dia, y la reversa completa', () => {
  function bootStore(initial) {
    jest.resetModules(); pinReact()
    // Los describes de arriba registraron un doble de useFirestoreItems con
    // doMock, y esa fabrica SOBREVIVE a resetModules: sin esto, este bloque
    // correria contra el doble (executeSaleAtomic vacio) y no contra el hook real.
    jest.dontMock('../useFirestoreItems')
    const fake = makeFake(initial)
    jest.doMock('firebase/firestore', () => ({ __esModule: true, ...fake.fs }))
    jest.doMock('../../lib/firebase', () => ({ __esModule: true, db: { __db: true }, auth: { currentUser: { uid: UID } } }))
    jest.doMock('firebase/auth', () => ({ __esModule: true, onAuthStateChanged: (a, cb) => { cb({ uid: UID }); return () => {} } }))
    const { useFirestoreItems } = require('../useFirestoreItems')
    return { store: fake.store, hook: renderHook(() => useFirestoreItems()) }
  }
  const initial = () => ({
    [P('items')]: { aapl: { name: 'Apple', symbol: 'AAPL', type: 'Stock', quantity: 10, purchasePrice: 100, currentPrice: 200, currency: 'USD', institution: 'IBKR' },
                    bank: { name: 'Cuenta', symbol: 'BANCO', type: 'Bank', quantity: 1, purchasePrice: 1000, currentPrice: 1000, currency: 'USD' } },
    [P('lots')]: { l1: { symbol: 'AAPL', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01', status: 'open', institution: 'IBKR', itemId: 'aapl' } },
    [P('transactions')]: {},
  })
  const item = { id: 'aapl', name: 'Apple', symbol: 'AAPL', quantity: 10 }
  const bank = { id: 'bank', currency: 'USD' }
  const sale = (qtyNow) => {
    const { transactions } = buildSaleTransactions({ item: { ...item, quantity: qtyNow }, qtySell: 2, price: 200, proceeds: 400, saleDate: '2026-08-01', currency: 'USD',
      soldFully: false, prevItemFields: { quantity: qtyNow, currentPrice: 200, purchasePrice: 100 }, destination: '__stay__', dest: bank, destAmount: 400, destKind: 'bank' })
    return { itemId: 'aapl', itemFields: { quantity: qtyNow - 2 }, transactions, destId: 'bank', destFields: { currentPrice: 1000 + 400 * (10 - qtyNow) / 2 + 400, purchasePrice: 1000 + 400 * (10 - qtyNow) / 2 + 400 },
      lotClose: { symbol: 'AAPL', qty: 2, price: 200, date: '2026-08-01', institution: 'IBKR' } }
  }

  it('dos ventas iguales el mismo dia dejan DOS filas SELL, cada una con sus cierres de lote estampados', async () => {
    const { store, hook } = bootStore(initial())
    await act(async () => { await Promise.resolve() })
    await act(async () => { await hook.result.current.executeSaleAtomic(sale(10)) })
    await act(async () => { await hook.result.current.executeSaleAtomic(sale(8)) })
    const txs = Object.values(store[P('transactions')])
    expect(txs.filter((t) => t.type === 'SELL')).toHaveLength(2)
    expect(store[P('items')].aapl.quantity).toBe(6)
    expect(txs.map((t) => t._lotCloses)).toEqual([
      [{ lotId: 'l1', closable: 2, whole: false, closedId: 'l1-closed-2026-08-01-1000000000' }],
      [{ lotId: 'l1', closable: 2, whole: false, closedId: 'l1-closed-2026-08-01-800000000' }],
    ])
  })

  it('vender y deshacer devuelve item, lotes, destino y filas al estado previo', async () => {
    const { store, hook } = bootStore(initial())
    await act(async () => { await Promise.resolve() })
    await act(async () => { await hook.result.current.executeSaleAtomic(sale(10)) })
    const [txId, sell] = Object.entries(store[P('transactions')])[0]
    const items = Object.entries(store[P('items')]).map(([id, d]) => ({ id, ...d }))
    const lots = Object.entries(store[P('lots')]).map(([id, d]) => ({ id, ...d }))
    const plan = saleReversalPlan({ id: txId, ...sell }, items, lots, [{ id: txId, ...sell }])
    expect(plan.refused).toBeNull()
    await act(async () => {
      await hook.result.current.reverseSaleAtomic({ itemId: plan.item.id, itemFields: plan.item.fields, lotWrites: plan.lots, deleteLotIds: plan.deleteLotIds, destId: plan.dest.id, destFields: plan.dest.fields, txIds: [txId, ...plan.companions] })
    })
    expect(store[P('items')].aapl.quantity).toBe(10)
    expect(store[P('items')].bank).toMatchObject({ currentPrice: 1000, purchasePrice: 1000 })
    expect(Object.keys(store[P('lots')])).toEqual(['l1'])
    expect(store[P('lots')].l1.quantity).toBe(10)
    expect(store[P('transactions')]).toEqual({})
  })

  it('vender TODO y deshacer restaura los precios que la venta puso en cero y reabre el lote', async () => {
    const { store, hook } = bootStore(initial())
    await act(async () => { await Promise.resolve() })
    const { transactions } = buildSaleTransactions({ item, qtySell: 10, price: 200, proceeds: 2000, saleDate: '2026-08-01', currency: 'USD',
      soldFully: true, prevItemFields: { quantity: 10, currentPrice: 200, purchasePrice: 100 }, destination: '__exit__' })
    await act(async () => { await hook.result.current.executeSaleAtomic({ itemId: 'aapl', itemFields: { quantity: 0, currentPrice: 0, purchasePrice: 0, saleDate: '2026-08-01', salePrice: 200, soldFully: true }, transactions,
      lotClose: { symbol: 'AAPL', qty: 10, price: 200, date: '2026-08-01', institution: 'IBKR' } }) })
    expect(store[P('lots')].l1).toMatchObject({ status: 'closed', closedDate: '2026-08-01' })
    expect(Object.keys(store[P('transactions')])).toHaveLength(2)
    const all = Object.entries(store[P('transactions')]).map(([id, d]) => ({ id, ...d }))
    const sell = all.find((t) => t.type === 'SELL')
    const items = Object.entries(store[P('items')]).map(([id, d]) => ({ id, ...d }))
    const lots = Object.entries(store[P('lots')]).map(([id, d]) => ({ id, ...d }))
    const plan = saleReversalPlan(sell, items, lots, all)
    expect(plan.refused).toBeNull()
    expect(plan.companions).toHaveLength(1)
    await act(async () => { await hook.result.current.reverseSaleAtomic({ itemId: plan.item.id, itemFields: plan.item.fields, lotWrites: plan.lots, deleteLotIds: plan.deleteLotIds, destId: null, destFields: null, txIds: [sell.id, ...plan.companions] }) })
    expect(store[P('items')].aapl).toMatchObject({ quantity: 10, currentPrice: 200, purchasePrice: 100, soldFully: null, saleDate: null })
    expect(store[P('lots')].l1).toMatchObject({ status: 'open', closedDate: null })
    expect(store[P('transactions')]).toEqual({})
  })
})
