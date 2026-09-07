// FASE OJ. Bajo un portafolio seleccionado, tres escritores creaban ítems SIN
// la etiqueta del portafolio (la cuenta destino "en línea", Ledger y
// Blockchain.com), mientras el alta manual, el importador y el sync de IBKR sí
// la ponían. Un ítem sin etiqueta cae al pseudo-portafolio `__default__` y es
// INVISIBLE en el portafolio donde el usuario lo acaba de crear: "agregado" en
// el toast y nada en pantalla. Reproducido con el hook REAL (useDashboardData)
// antes de tocar nada. Arnés de scopedView.test.js.
const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData, fakeFirestore

function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return {
    items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null,
    loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: noop, deleteItem: noop,
    deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop, deleteDemoData: noop,
    addTransaction: noop, updateTransaction: noop, deleteTransaction: noop, deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop,
    lots: [], addLot: noop, closeLotsFIFO: noop, transferFunds: noop,
    executeSaleAtomic: noop, executeContribution: noop, bulkImport: noop,
    bulkWriting: false, bulkWritingRef: { current: false }, deletionEpoch: 0,
    portfolios: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }], addPortfolio: noop, deletePortfolio: noop,
    financeTransactions: [], addFinanceTransaction: noop, updateFinanceTransaction: noop,
    deleteFinanceTransaction: noop, deleteAllFinanceTransactions: noop, deleteFinanceTransactionsByIds: noop,
    saveGoals: noop, saveSettings: jest.fn(async () => {}), saveProfile: noop,
    incomePlan: null, saveIncomePlan: noop,
    saveItemSnapshots: noop, loadItemSnapshots: jest.fn(async () => ({})),
    ...over,
  }
}

function setup(over = {}) {
  fakeFirestore = makeFirestore(over.firestore)
  const fakePrices = { enrichedItems: fakeFirestore.items, prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null, refresh: jest.fn() }
  const fakeRates = { rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0, loading: false, error: null, lastUpdate: null, refresh: jest.fn() }
  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({ useBenchmark: () => ({ benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500', loading: false, error: null, refetch: jest.fn() }) }))
  jest.doMock('../useTabCoordination', () => ({ useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }) }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async () => jsonResponse({})),
    safeJson: jest.fn(async (res) => res.json()),
  }))
  ;({ useDashboardData } = require('../useDashboardData'))
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__', ...over.opts }
  return renderHook(() => useDashboardData(opts))
}

beforeEach(() => { jest.resetModules(); pinReact() })

// La forma EXACTA que arma InlineCreateAccount (components/InlineCreateAccount.jsx).
const inlineDest = { type: 'Bank', subtype: 'checking', name: 'Fondo Líquido', symbol: 'IDC-CASH', institution: 'IDC', currency: 'USD', quantity: 1, purchasePrice: 500, currentPrice: 500, accountType: 'taxable', acquisitionDate: '2026-01-06' }
const bondA = { id: 'a1', name: 'Bono A', symbol: 'BONO-A', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, currency: 'USD', portfolioId: 'pA' }

describe('FASE OJ: la reproducción, con el filtro REAL del tablero', () => {
  it('un ítem creado sin etiqueta bajo "A" es INVISIBLE en "A" y visible en "Todos"', () => {
    const untagged = { id: 'dest', ...inlineDest }
    const scoped = setup({ firestore: { items: [bondA, untagged] }, opts: { activePortfolio: 'pA' } })
    expect(scoped.result.current.portfolioItems.map((it) => it.id)).toEqual(['a1'])
    const all = setup({ firestore: { items: [bondA, untagged] }, opts: { activePortfolio: '__all__' } })
    expect(all.result.current.portfolioItems.map((it) => it.id)).toEqual(['a1', 'dest'])
  })
  it('el mismo ítem CON la etiqueta sí aparece en "A"', () => {
    const tagged = { id: 'dest', ...inlineDest, portfolioId: 'pA' }
    const scoped = setup({ firestore: { items: [bondA, tagged] }, opts: { activePortfolio: 'pA' } })
    expect(scoped.result.current.portfolioItems.map((it) => it.id)).toEqual(['a1', 'dest'])
  })
})

describe('FASE OJ: addItemInScope (lo que el tablero cablea a los tres escritores)', () => {
  it('con "A" seleccionado escribe el ítem CON portfolioId y devuelve el id', async () => {
    const hook = setup({ opts: { activePortfolio: 'pA' } })
    let id
    await act(async () => { id = await hook.result.current.addItemInScope(inlineDest) })
    expect(id).toBe('new-id')
    expect(fakeFirestore.addItem).toHaveBeenCalledTimes(1)
    expect(fakeFirestore.addItem.mock.calls[0][0]).toEqual({ ...inlineDest, portfolioId: 'pA' })
  })
  it('con una entidad seleccionada también lleva entityId', async () => {
    const hook = setup({ opts: { activePortfolio: 'pA', activeEntity: 'ent1' } })
    await act(async () => { await hook.result.current.addItemInScope(inlineDest) })
    expect(fakeFirestore.addItem.mock.calls[0][0]).toEqual({ ...inlineDest, portfolioId: 'pA', entityId: 'ent1' })
  })
  it('con "Todos" el ítem sale byte-idéntico (regresión negativa: el caso común no cambia)', async () => {
    const hook = setup({ opts: { activePortfolio: '__all__', activeEntity: '__all__' } })
    await act(async () => { await hook.result.current.addItemInScope(inlineDest) })
    expect(fakeFirestore.addItem.mock.calls[0][0]).toEqual(inlineDest)
  })
  it('una etiqueta que el ítem ya trae no se pisa', async () => {
    const hook = setup({ opts: { activePortfolio: 'pA' } })
    await act(async () => { await hook.result.current.addItemInScope({ ...inlineDest, portfolioId: 'pB' }) })
    expect(fakeFirestore.addItem.mock.calls[0][0].portfolioId).toBe('pB')
  })
})
