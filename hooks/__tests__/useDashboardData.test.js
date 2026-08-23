// El hook grande, y el punto NO es probar sus fórmulas: esas ya viven en
// módulos puros de `lib/` con sus propios tests. Lo que no tenía forma de
// probarse es la CAPA DE COMPOSICIÓN, que es donde estuvieron los bugs.
//
// Por eso se falsean los cinco hooks hermanos en vez de mockear Firestore
// entero: el límite del mock es exactamente el límite donde viven los defectos
// (un campo que no se re-exporta, un semáforo que no protege lo que debería,
// un ref que no se re-arma).
//
// Las trampas del arnés están en test-utils/hookHarness.js.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData
let fakeFirestore, fakePrices, fakeRates, authFetch

// --- el doble de useFirestoreItems ------------------------------------------
// Se declaran TODAS las llaves que el hook desestructura. Una que falte llega
// como `undefined` sin ruido, que es precisamente la clase de bug que este
// archivo existe para atrapar.
function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return {
    items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null,
    loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: noop, deleteItem: noop,
    deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop,
    deleteDemoData: noop,
    addTransaction: noop, updateTransaction: noop, deleteTransaction: noop, deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop,
    lots: [], addLot: noop, closeLotsFIFO: noop, transferFunds: noop,
    executeSaleAtomic: noop, executeContribution: noop, bulkImport: noop,
    bulkWriting: false, deletionEpoch: 0,
    portfolios: [], addPortfolio: noop, deletePortfolio: noop,
    financeTransactions: [], addFinanceTransaction: noop, updateFinanceTransaction: noop,
    deleteFinanceTransaction: noop, deleteAllFinanceTransactions: noop,
    deleteFinanceTransactionsByIds: noop,
    saveGoals: noop, saveSettings: jest.fn(async () => {}), saveProfile: noop,
    incomePlan: null, saveIncomePlan: noop,
    saveItemSnapshots: noop, loadItemSnapshots: jest.fn(async () => ({})),
    ...over,
  }
}

const item = (o) => ({
  id: 'i1', name: 'Acme', symbol: 'ACME', type: 'Stock',
  quantity: 10, currentPrice: 100, purchasePrice: 80,
  currency: 'USD', acquisitionDate: '2026-01-05', createdAt: '2026-01-05',
  ...o,
})

function setup(over = {}) {
  fakeFirestore = makeFirestore(over.firestore)
  fakePrices = {
    enrichedItems: fakeFirestore.items,
    prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null,
    refresh: jest.fn(),
    ...over.prices,
  }
  fakeRates = {
    rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0,
    loading: false, error: null, lastUpdate: null, refresh: jest.fn(),
    ...over.rates,
  }

  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({
    useBenchmark: () => ({
      benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500',
      loading: false, error: null, refetch: jest.fn(),
    }),
  }))
  jest.doMock('../useTabCoordination', () => ({
    useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }),
  }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async () => jsonResponse({})),
    safeJson: jest.fn(async () => ({})),
  }))
  ;({ authFetch } = require('../../lib/authFetch'))
  ;({ useDashboardData } = require('../useDashboardData'))
  // El hook recibe la sesion por parametro, y `user` gatea TODOS los efectos
  // que escriben: sin sesion no se archiva nada (hay un test que lo fija).
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__', ...over.opts }
  return renderHook(() => useDashboardData(opts))
}

beforeEach(() => {
  jest.resetModules()
  pinReact()
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})

// ⛔ FASE JS. El bug que este archivo existe para hacer imposible.
//
// `useDashboardData` envuelve a `useFirestoreItems` y re-exporta una lista
// EXPLÍCITA de campos. `incomePlan` no estaba en esa lista, así que la tarjeta
// de proyección recibía `undefined`, mostraba "no hay ingresos planeados"
// sobre un plan que sí existía, y su `onSave` tampoco existía: las ediciones
// no se guardaban. Ni el build ni los tests lo veían — desestructurar un campo
// inexistente es JavaScript válido y devuelve undefined en silencio.
describe('el contrato del return: nada se pierde al re-exportar', () => {
  it('un plan de ingresos guardado LLEGA al consumidor', async () => {
    const plan = { chips: [{ id: 'c1', kind: 'monthly', amount: 15000 }], returnRate: 7 }
    const { result, unmount } = setup({ firestore: { incomePlan: plan } })
    await act(async () => {})

    expect(result.current.incomePlan).toBe(plan)
    expect(typeof result.current.saveIncomePlan).toBe('function')
    unmount()
  })

  it('toda funcion de escritura de Firestore sigue alcanzable', async () => {
    const { result, unmount } = setup()
    await act(async () => {})

    // La lista es explícita a propósito: si alguien quita una del re-export,
    // el consumidor la recibe como undefined y falla al invocarla, en runtime
    // y solo en la pantalla que la use.
    for (const fn of [
      'addItem', 'updateItem', 'deleteItem', 'deleteItemGroup', 'bulkImport',
      'addTransaction', 'deleteTransaction', 'saveSnapshot', 'saveSettings',
      'saveGoals', 'saveProfile', 'saveIncomePlan', 'addLot', 'closeLotsFIFO',
      'transferFunds', 'executeSaleAtomic', 'addFinanceTransaction',
      'saveItemSnapshots', 'loadItemSnapshots',
    ]) {
      expect(typeof result.current[fn]).toBe('function')
    }
    unmount()
  })

  // ⛔ FASE JA3. Un fallo de LECTURA de Firestore se veia como cuenta vacia: el
  // handler de error solo logueaba, `items` quedaba en [] y `loading` pasaba a
  // false igual, asi que un usuario con 40 cuentas veia la pantalla de
  // bienvenida invitandolo a crear cuentas que ya existen. `loadError` es lo
  // que permite distinguir "no tenes nada" de "no pudimos leer".
  it('un fallo de lectura llega como error, no como cuenta vacia', async () => {
    const { result, unmount } = setup({ firestore: { items: [], loadError: 'unavailable' } })
    await act(async () => {})

    expect(result.current.loadError).toBe('unavailable')
    expect(result.current.items).toEqual([])
    unmount()
  })

  it('los datos crudos tambien pasan, no solo lo derivado', async () => {
    const it1 = item()
    const { result, unmount } = setup({ firestore: { items: [it1], transactions: [{ id: 't1' }] } })
    await act(async () => {})

    expect(result.current.items).toEqual([it1])
    expect(result.current.transactions).toHaveLength(1)
    unmount()
  })
})

// ⛔ FASE FE + FASE GB. Los semaforos que protegen lo que se ESCRIBE.
//
// El snapshot diario es permanente: con broker conectado no se corrige el
// resto del día. Escribirlo con precios a medio llegar, o a mitad de un import
// masivo (que entrega estados intermedios con items duplicados), deja un total
// inflado archivado para siempre. Eso produjo el diente de sierra.
describe('ningun escritor corre con los datos a medio asentar', () => {
  const withItems = { items: [item()] }

  // CONTROL POSITIVO, y no es opcional: sin el, los cuatro tests de "no
  // escribe" de abajo podrian estar pasando vaciamente (el efecto nunca
  // dispara por otra razon y el test da verde sin probar nada). Con este,
  // cada negativo significa "la compuerta lo detuvo", no "nunca hubo nada
  // que detener".
  it('con todas las compuertas abiertas SI archiva el dia', async () => {
    const enriched = [item()]
    const { unmount } = setup({ firestore: { items: enriched }, prices: { enrichedItems: enriched } })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('no escribe mientras los precios estan en vuelo', async () => {
    const { result, unmount } = setup({
      firestore: withItems,
      prices: { enrichedItems: [item()], isFetching: true },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('no escribe durante un import masivo', async () => {
    const { result, unmount } = setup({
      firestore: { ...withItems, bulkWriting: true },
      prices: { enrichedItems: [item()] },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('no escribe mientras los datos cargan', async () => {
    const { result, unmount } = setup({
      firestore: { ...withItems, loading: true },
      prices: { enrichedItems: [item()] },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('sin ningun activo tampoco escribe', async () => {
    const { unmount } = setup()
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })
})

// El patrimonio: no la formula (vive en utils, ya testeada) sino que el hook la
// alimente con lo correcto.
describe('el patrimonio sale de los items ENRIQUECIDOS', () => {
  it('usa el precio vivo, no el de compra', async () => {
    const { result, unmount } = setup({
      firestore: { items: [item()] },
      prices: { enrichedItems: [item({ currentPrice: 150 })] },
    })
    await act(async () => {})
    expect(result.current.netWorth).toBe(1500)
    unmount()
  })

  it('la deuda RESTA', async () => {
    const enriched = [item({ currentPrice: 100 }), item({ id: 'd1', symbol: 'CARD', isDebt: true, quantity: 1, currentPrice: 400, type: 'Deuda' })]
    const { result, unmount } = setup({
      firestore: { items: enriched },
      prices: { enrichedItems: enriched },
    })
    await act(async () => {})
    expect(result.current.netWorth).toBe(1000 - 400)
    expect(result.current.totalAssets).toBe(1000)
    unmount()
  })
})
