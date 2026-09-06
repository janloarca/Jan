// FASE OF. El motor de dividendos podía acreditar DOS veces el mismo cupón, y
// dependía de la suerte del orden de los ecos de Firestore que no lo hiciera.
//
// El mecanismo: `addToDestination` escribe el destino con `updateItem`, que es
// OPTIMISTA, así que `enrichedItems` (dep del efecto) cambia a mitad de la
// corrida; el cleanup marca `cancelled` y el efecto arranca OTRA corrida de
// inmediato, con `dividendsProcessedRef` todavía sin estampar. Esa segunda
// corrida deduplica por mes leyendo `transactions`, y `addTransaction` NO es
// optimista: la fila recién escrita solo está ahí si el eco del listener ya
// llegó. Este test hace que el eco NO llegue (el mock de `addTransaction`
// jamás alimenta `transactions`) y que `updateItem` sí re-renderice, que es el
// peor caso. Corre el hook REAL con el arnés de FASE JB2.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData
let fakeFirestore, fakePrices, fakeRates
let rerenderRef = { current: null }

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
// Bono semestral con TRES pagos vencidos (may 2025, nov 2025 y may 2026) en
// EFECTIVO a una cuenta cuyo `balanceAsOf` es anterior a todos: los tres
// ACREDITAN, y cada crédito re-dispara el efecto.
const bond = (o = {}) => base({
  id: 'b1', name: 'Bono Semestral', symbol: 'BONO-SEMESTRAL', type: 'Bond',
  quantity: 1, purchasePrice: 5000, currentPrice: 5000, _originalPrice: 5000,
  acquisitionDate: '2025-03-01', createdAt: `${TODAY}T10:00:00Z`, balanceAsOf: TODAY,
  incomeMode: 'fixed', incomeAmount: 200, incomeRate: 0, incomePayDay: 15, rateType: 'fixed',
  incomeMonths: [4, 10], incomeMonthsExplicit: true, paymentSchedule: 'monthly',
  dividendAction: 'cash', incomeDestination: 'dest1',
  ...o,
})
const dest = (o = {}) => base({
  id: 'dest1', name: 'Cuenta', symbol: 'BANCO-CUENTA', type: 'Bank', quantity: 1,
  purchasePrice: 1000, currentPrice: 1000, _originalPrice: 1000,
  acquisitionDate: '2025-01-01', createdAt: '2025-01-01', balanceAsOf: '2025-01-01',
  ...o,
})

// `updateItem` OPTIMISTA: muta la lista y deja PENDIENTE un re-render que
// `settle` aplica en el nivel superior ANTES de resolver la promesa. Eso es lo
// que reproduce el mecanismo real: el efecto se re-ejecuta (cleanup + corrida
// nueva) mientras la corrida en vuelo sigue detenida dentro de `updateItem`.
//
// Ojo del arnés: llamar `rerender()` DENTRO del mock no sirve. Es un `act`
// anidado, y React 18 difiere su trabajo hasta que el `act` externo termina,
// así que la re-ejecución caía en un orden aleatorio respecto de la corrida
// (a veces después de que terminó) y el test pasaba sin ejercitar nada.
const pendingUpdates = []
function optimisticUpdateItem() {
  return jest.fn((id, patch) => new Promise((resolve) => {
    const next = fakePrices.enrichedItems.map((it) => (it.id === id
      ? { ...it, ...patch, _originalPrice: patch.currentPrice ?? it._originalPrice }
      : it))
    fakeFirestore.items = next
    fakePrices.enrichedItems = next
    pendingUpdates.push(resolve)
  }))
}

function setup(items, over = {}) {
  fakeFirestore = makeFirestore({ items, updateItem: optimisticUpdateItem(), ...over })
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
  const r = renderHook(() => useDashboardData(opts))
  rerenderRef.current = r.rerender
  return r
}

// Se asienta hasta que el motor deja de escribir: cada crédito re-dispara el
// efecto (esa es la prueba), así que el número de microtareas que hace falta
// crece con los cupones, y un conteo fijo dependería de él.
//
// Ojo del arnés: la re-corrida se pide con un setState desde un `.finally`,
// FUERA de `act`, así que React la manda al scheduler y con los timers
// falsos ese trabajo no se drena solo. Hay que darle una macrotarea REAL
// (capturada antes de instalar los timers falsos) y avanzar el reloj; sin
// eso el motor se veía "atascado" a mitad y era el arnés, no el producto.
const realSetImmediate = jest.requireActual('timers').setImmediate
const macrotask = () => new Promise((r) => realSetImmediate(r))
const settle = async () => {
  let quiet = 0
  let last = -1
  for (let i = 0; i < 2000 && quiet < 60; i++) {
    // Un updateItem en vuelo: primero el re-render (la re-ejecución del
    // efecto, en el nivel superior), DESPUÉS se le devuelve el control a la
    // corrida que estaba esperando.
    if (pendingUpdates.length) {
      const resolve = pendingUpdates.shift()
      await act(async () => { rerenderRef.current(); await Promise.resolve() })
      await act(async () => { resolve(); await Promise.resolve() })
    }
    await act(async () => { await Promise.resolve(); jest.advanceTimersByTime(5); await macrotask() })
    const n = fakeFirestore.addTransaction.mock.calls.length + fakeFirestore.updateItem.mock.calls.length
    if (n === last) quiet++
    else { quiet = 0; last = n }
  }
}
const dividendDates = () => fakeFirestore.addTransaction.mock.calls
  .map(([tx]) => tx).filter((tx) => tx.type === 'DIVIDEND').map((tx) => tx.date).sort()
const destCredits = () => fakeFirestore.updateItem.mock.calls.filter(([id]) => id === 'dest1')

beforeEach(() => {
  jest.resetModules()
  pinReact()
  jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})
afterEach(() => { jest.useRealTimers(); rerenderRef.current = null; pendingUpdates.length = 0 })

describe('FASE OF: el motor no acredita dos veces aunque el eco de transactions no llegue', () => {
  it('con el eco ausente y updateItem optimista, cada cupón se escribe UNA vez y el destino se acredita UNA vez por cupón', async () => {
    const { unmount } = setup([dest(), bond()])
    await settle()

    const dates = dividendDates()
    // Los tres cupones vencidos, y ninguno repetido.
    expect(dates).toEqual(['2025-05-15', '2025-11-15', '2026-05-15'])
    // Un crédito por cupón: el saldo del destino termina en 1000 + 3×200.
    const credits = destCredits()
    expect(credits).toHaveLength(3)
    const last = credits[credits.length - 1][1]
    expect(last.currentPrice).toBeCloseTo(1600, 2)
    unmount()
  })

  it('control positivo: el motor SÍ escribió y SÍ acreditó (sin esto, "una vez" podría ser "ninguna")', async () => {
    const { unmount } = setup([dest(), bond()])
    await settle()
    expect(dividendDates().length).toBeGreaterThan(0)
    expect(destCredits().length).toBeGreaterThan(0)
    unmount()
  })

  it('la corrida interrumpida se RETOMA: dos bonos al mismo destino, ninguno queda sin pagar', async () => {
    // El crédito del primer bono cancela la corrida a mitad; sin re-corrida el
    // segundo bono quedaría sin cupones hasta mañana (la llave se estamparía
    // igual). Y con dos corridas a la vez, el segundo crédito se duplicaría.
    const bond2 = bond({ id: 'b2', name: 'Bono Dos', symbol: 'BONO-DOS', incomeAmount: 50 })
    const { unmount } = setup([dest(), bond(), bond2])
    await settle()

    const byItem = {}
    for (const [tx] of fakeFirestore.addTransaction.mock.calls) {
      if (tx.type !== 'DIVIDEND') continue
      byItem[tx._linkedItemId] = (byItem[tx._linkedItemId] || []).concat(tx.date)
    }
    expect((byItem.b1 || []).sort()).toEqual(['2025-05-15', '2025-11-15', '2026-05-15'])
    expect((byItem.b2 || []).sort()).toEqual(['2025-05-15', '2025-11-15', '2026-05-15'])
    // 1000 + 3×200 + 3×50, ni un centavo más.
    const credits = destCredits()
    expect(credits).toHaveLength(6)
    expect(credits[credits.length - 1][1].currentPrice).toBeCloseTo(1750, 2)
    unmount()
  })

  it('control: cuando el eco SÍ llega el resultado es el mismo (el guard no cambia el caso feliz)', async () => {
    const { unmount } = setup([dest(), bond()], {
      addTransaction: jest.fn(async (tx) => {
        fakeFirestore.transactions = [...fakeFirestore.transactions, { ...tx, id: `${tx.date}-x` }]
      }),
    })
    await settle()
    expect(dividendDates()).toEqual(['2025-05-15', '2025-11-15', '2026-05-15'])
    expect(destCredits()).toHaveLength(3)
    unmount()
  })
})

describe('FASE OF: la limpieza de cupones sobrantes tampoco resta dos veces', () => {
  // Un cupón automático fuera del calendario (marzo, con pagos en mayo y
  // noviembre) se borra y su crédito se REVIERTE del destino. El borrado no es
  // optimista y el eco puede tardar: una corrida retomada volvía a encontrar
  // la fila vieja y a restar la reversa otra vez.
  const stale = () => ({
    id: 'stale-mar', type: 'DIVIDEND', date: '2026-03-15', symbol: 'BONO-SEMESTRAL',
    totalAmount: 200, currency: 'USD', _source: 'auto', _linkedItemId: 'b1',
  })
  // Los tres cupones del calendario ya están en el archivo: el motor no paga nada nuevo.
  const paid = (date) => ({
    id: `paid-${date}`, type: 'DIVIDEND', date, symbol: 'BONO-SEMESTRAL',
    totalAmount: 200, currency: 'USD', _source: 'auto', _linkedItemId: 'b1', _destinationCredited: true,
  })

  it('la reversa del cupón sobrante se aplica UNA vez aunque el eco del borrado no llegue', async () => {
    const { unmount } = setup([dest(), bond()], {
      transactions: [stale(), paid('2025-05-15'), paid('2025-11-15'), paid('2026-05-15')],
    })
    await settle()
    expect(dividendDates()).toEqual([])
    expect(fakeFirestore.deleteTransaction.mock.calls.map(([id]) => id)).toEqual(['stale-mar'])
    const credits = destCredits()
    expect(credits).toHaveLength(1)
    // 1000 − 200, y nunca 1000 − 400.
    expect(credits[0][1].currentPrice).toBeCloseTo(800, 2)
    unmount()
  })
})
