// FASE OA. El motor de dividendos corria UNA vez por montaje y por dia UTC
// (`dividendsProcessedRef`), y nada lo volvia a armar dentro de la sesion.
// Un bono agregado DESPUES de esa corrida, con calendario y pagos ya
// vencidos, no escribia sus cupones hasta la siguiente recarga: la Hoja los
// mostraba en cero y el usuario reporto, literal, "al agregar un bono
// pagadero semestral no lo leyo en el spreadsheet los dividendos".
//
// Corre el hook REAL con el arnes de FASE JB2 (nunca una copia de la logica).

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData
let fakeFirestore, fakePrices, fakeRates

function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return {
    items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null,
    loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: jest.fn(async () => {}), deleteItem: noop,
    deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop,
    deleteDemoData: noop,
    addTransaction: jest.fn(async () => {}), updateTransaction: noop, deleteTransaction: noop, deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop,
    lots: [], addLot: noop, closeLotsFIFO: noop, transferFunds: noop,
    executeSaleAtomic: noop, executeContribution: noop, bulkImport: noop,
    bulkWriting: false, bulkWritingRef: { current: false }, deletionEpoch: 0,
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

const TODAY = '2026-09-05'
const base = (o) => ({
  id: 'i1', name: 'Acme', symbol: 'ACME', type: 'Stock',
  quantity: 10, currentPrice: 100, purchasePrice: 80, _originalPrice: 100,
  currency: 'USD', _originalCurrency: 'USD', acquisitionDate: '2026-01-05', createdAt: '2026-01-05',
  ...o,
})
// Bono semestral con dos pagos ya vencidos desde su compra (mayo y noviembre
// de 2025 quedan atras; mayo 2026 tambien), en efectivo a una cuenta.
const bond = (o = {}) => base({
  id: 'b1', name: 'Bono Semestral', symbol: 'BONO-SEMESTRAL', type: 'Bond',
  quantity: 1, purchasePrice: 5000, currentPrice: 5000, _originalPrice: 5000,
  acquisitionDate: '2025-03-01', createdAt: `${TODAY}T10:00:00Z`, balanceAsOf: TODAY,
  incomeMode: 'fixed', incomeAmount: 200, incomeRate: 0, incomePayDay: 15, rateType: 'fixed',
  incomeMonths: [4, 10], incomeMonthsExplicit: true, paymentSchedule: 'monthly',
  dividendAction: 'cash', incomeDestination: 'dest1',
  ...o,
})
const dest = () => base({ id: 'dest1', name: 'Cuenta', symbol: 'BANCO-CUENTA', type: 'Bank', quantity: 1, purchasePrice: 1000, currentPrice: 1000, _originalPrice: 1000, acquisitionDate: TODAY, createdAt: TODAY, balanceAsOf: TODAY })

function setup(items) {
  fakeFirestore = makeFirestore({ items })
  fakePrices = {
    enrichedItems: items,
    prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null,
    refresh: jest.fn(),
  }
  fakeRates = {
    rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0,
    loading: false, error: null, lastUpdate: null, refresh: jest.fn(),
  }
  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({
    useBenchmark: () => ({ benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500', loading: false, error: null, refetch: jest.fn() }),
  }))
  jest.doMock('../useTabCoordination', () => ({
    useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }),
  }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async () => jsonResponse({})),
    safeJson: jest.fn(async () => ({})),
  }))
  ;({ useDashboardData } = require('../useDashboardData'))
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__' }
  return renderHook(() => useDashboardData(opts))
}

const settle = async () => { for (let i = 0; i < 25; i++) await act(async () => { await Promise.resolve() }) }
const writtenDates = () => fakeFirestore.addTransaction.mock.calls
  .map(([tx]) => tx).filter((tx) => tx.type === 'DIVIDEND' || tx.type === 'INTEREST').map((tx) => tx.date).sort()

beforeEach(() => {
  jest.resetModules()
  pinReact()
  jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})
afterEach(() => jest.useRealTimers())

describe('FASE OA: el motor de dividendos se re-arma cuando cambia la configuracion de ingreso', () => {
  it('un bono que aparece DESPUES de la corrida del dia escribe sus cupones en la misma sesion', async () => {
    // Sesion arranca con una cuenta sola: el motor corre y no hay nada programado.
    const { rerender, unmount } = setup([dest()])
    await settle()
    expect(writtenDates()).toEqual([])

    // El usuario agrega el bono (el listener entrega la lista nueva).
    const withBond = [dest(), bond()]
    fakeFirestore.items = withBond
    fakePrices.enrichedItems = withBond
    rerender()
    await settle()

    const dates = writtenDates()
    // Con la llave vieja (solo el dia) esto seguia vacio hasta recargar.
    expect(dates.length).toBeGreaterThan(0)
    expect(dates).toContain('2026-05-15')
    unmount()
  })

  it('control: un tick de PRECIO no vuelve a correr el motor (cero escrituras nuevas)', async () => {
    const items = [dest(), bond()]
    const { rerender, unmount } = setup(items)
    await settle()
    const before = fakeFirestore.addTransaction.mock.calls.length
    expect(before).toBeGreaterThan(0)

    const ticked = items.map((it) => ({ ...it, currentPrice: it.currentPrice * 1.01, _originalPrice: (it._originalPrice || 0) * 1.01 }))
    fakePrices.enrichedItems = ticked
    rerender()
    await settle()
    expect(fakeFirestore.addTransaction.mock.calls.length).toBe(before)
    unmount()
  })

  it('cambiar los meses de pago del bono re-corre el motor con el calendario nuevo', async () => {
    const items = [dest(), bond()]
    const { rerender, unmount } = setup(items)
    await settle()
    const first = writtenDates()
    expect(first).toContain('2026-05-15')
    expect(first).not.toContain('2026-08-15')
    // Primero se prueba que la corrida del dia YA quedo latcheada: la misma
    // configuracion (identidad nueva, mismo contenido) no escribe nada. Sin
    // este paso el test podia pasar por la razon equivocada (re-render antes
    // de que la primera corrida terminara).
    const same = [dest(), bond()]
    fakeFirestore.items = same
    fakePrices.enrichedItems = same
    rerender()
    await settle()
    expect(writtenDates()).toEqual(first)

    // El usuario edita: ahora paga en febrero y agosto.
    const edited = [dest(), bond({ incomeMonths: [1, 7] })]
    fakeFirestore.items = edited
    fakePrices.enrichedItems = edited
    rerender()
    await settle()
    expect(writtenDates()).toContain('2026-08-15')
    unmount()
  })
})
