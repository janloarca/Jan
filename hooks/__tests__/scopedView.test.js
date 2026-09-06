// ⛔ FASE OG. El tablero con un portafolio (o una entidad) seleccionados.
//
// El archivo de snapshots es ÚNICO por usuario y guarda el patrimonio COMPLETO
// (el escritor diario y el backfill recorren `enrichedItems` a propósito), así
// que con un portafolio seleccionado `totalAssets` medía el subconjunto y el
// ancla del año medía el todo. Reproducido acá con el hook REAL antes de tocar
// nada: dos portafolios que ganaron +10% cada uno imprimían -26.67% y -63.33%.
//
// Se falsean los cinco hooks hermanos (el arnés de useDashboardData.test.js);
// la ruta de historial se falsea con una reconstrucción POR ÍTEM, que es lo
// que la ruta real devuelve, para que el test mida qué ítems se le PIDEN.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData, fakeFirestore, fakePrices, fakeRates, authFetch

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

const yr = new Date().getUTCFullYear()
const jan1 = Date.UTC(yr, 0, 1)
// Valor de arranque por ítem: lo que la ruta real reconstruye para el 1 de
// enero. El ancla del portafolio completo (30,000) coincide con la suma, así
// que si el hook la usara por error el YTD de "todos" seguiría bien y el de
// cada portafolio sería el que se reporta.
const START = { a1: 20000, b1: 10000 }

// La ruta devuelve la suma de los ítems que le PIDIERON, con desglose por id.
function historyRoute(body) {
  const ids = (body.items || []).map((it) => it.id)
  const total = ids.reduce((s, id) => s + (START[id] || 0), 0)
  const byKey = Object.fromEntries(ids.map((id) => [id, START[id] || 0]))
  return { dataPoints: [{ ts: jan1, total, byKey }], transactional: true }
}

function setup(over = {}) {
  fakeFirestore = makeFirestore(over.firestore)
  fakePrices = { enrichedItems: fakeFirestore.items, prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null, refresh: jest.fn() }
  fakeRates = { rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0, loading: false, error: null, lastUpdate: null, refresh: jest.fn() }
  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({ useBenchmark: () => ({ benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500', loading: false, error: null, refetch: jest.fn() }) }))
  jest.doMock('../useTabCoordination', () => ({ useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }) }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async (url, opts) => {
      if (String(url).includes('portfolio-history')) return jsonResponse(historyRoute(JSON.parse(opts.body)))
      return jsonResponse({})
    }),
    safeJson: jest.fn(async (res) => res.json()),
  }))
  ;({ authFetch } = require('../../lib/authFetch'))
  ;({ useDashboardData } = require('../useDashboardData'))
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__', ...over.opts }
  return renderHook(() => useDashboardData(opts))
}

beforeEach(() => { jest.resetModules(); pinReact() })

const bankA = { id: 'a1', name: 'Banco A', symbol: 'BANKA', type: 'Bank', quantity: 1, currentPrice: 22000, purchasePrice: 20000, currency: 'USD', acquisitionDate: '2025-01-05', createdAt: '2025-01-05', portfolioId: 'pA' }
const bankB = { id: 'b1', name: 'Banco B', symbol: 'BANKB', type: 'Bank', quantity: 1, currentPrice: 11000, purchasePrice: 10000, currency: 'USD', acquisitionDate: '2025-01-05', createdAt: '2025-01-05', portfolioId: 'pB', entityId: 'e2' }
// Snapshots del patrimonio COMPLETO (30,000 el 1 de enero), como los escribe el
// tablero: la misma serie que hacía leer -63% a un portafolio que ganó 10%.
const snaps = [
  { id: `${yr}-01-01`, date: `${yr}-01-01`, netWorthUSD: 30000, totalActivosUSD: 30000, totalDebtUSD: 0, _source: 'daily' },
  { id: `${yr}-06-01`, date: `${yr}-06-01`, netWorthUSD: 31500, totalActivosUSD: 31500, totalDebtUSD: 0, _source: 'daily' },
]

async function run(opts, transactions = []) {
  const { result, unmount } = setup({ firestore: { items: [bankA, bankB], snapshots: snaps, transactions }, opts })
  await act(async () => {})
  await act(async () => {})
  const r = result.current
  const out = {
    totalAssets: r.totalAssets, ytdChange: r.ytdChange, returnYTD: r.returnYTD, returnMTD: r.returnMTD,
    ytdStartValue: r.ytdStartValue, scopedView: r.scopedView,
    augmentedLen: r.augmentedSnapshots.length, chartLen: r.chartSnapshots.length,
    viewTx: r.viewTransactions.map((t) => t.id),
  }
  const historyCalls = authFetch.mock.calls.filter(([u]) => String(u).includes('portfolio-history'))
  out.askedItems = historyCalls.length ? JSON.parse(historyCalls[historyCalls.length - 1][1].body).items.map((it) => it.id) : []
  unmount()
  return out
}

describe('FASE OG: con un portafolio seleccionado el YTD mide ESE portafolio', () => {
  it('control: sin scope, el ancla del año sigue siendo el snapshot y el YTD +10%', async () => {
    const all = await run({ activePortfolio: '__all__' })
    expect(all.scopedView).toBe(false)
    expect(all.totalAssets).toBe(33000)
    expect(all.ytdStartValue).toBe(30000)
    expect(all.returnYTD).toBeCloseTo(10, 6)
    expect(all.augmentedLen).toBe(2)
    expect(all.chartLen).toBe(2)
  })

  it('portafolio A: 20,000 → 22,000 es +10%, no -26.67% contra el ancla del todo', async () => {
    const a = await run({ activePortfolio: 'pA' })
    expect(a.scopedView).toBe(true)
    expect(a.totalAssets).toBe(22000)
    // El ancla sale de la reconstrucción de ESTE subconjunto...
    expect(a.askedItems).toEqual(['a1'])
    expect(a.ytdStartValue).toBe(20000)
    expect(a.ytdChange).toBeCloseTo(2000, 6)
    expect(a.returnYTD).toBeCloseTo(10, 6)
    // ...y el archivo del patrimonio completo NO llega a ningún consumidor.
    expect(a.augmentedLen).toBe(0)
    expect(a.chartLen).toBe(0)
  })

  it('portafolio B: +10%, no -63.33%', async () => {
    const b = await run({ activePortfolio: 'pB' })
    expect(b.totalAssets).toBe(11000)
    expect(b.askedItems).toEqual(['b1'])
    expect(b.returnYTD).toBeCloseTo(10, 6)
  })

  it('una entidad seleccionada es la misma vista escopada', async () => {
    const e = await run({ activeEntity: 'e2' })
    expect(e.scopedView).toBe(true)
    expect(e.totalAssets).toBe(11000)
    expect(e.returnYTD).toBeCloseTo(10, 6)
  })

  it('los flujos se escopan por VÍNCULO: un depósito al otro portafolio no netea este', async () => {
    const mid = new Date(jan1 + (Date.now() - jan1) / 2).toISOString().slice(0, 10)
    const txs = [
      { id: 'depB', type: 'DEPOSIT', _linkedItemId: 'b1', totalAmount: 5000, currency: 'USD', date: mid, _source: 'manual_contribution' },
    ]
    const a = await run({ activePortfolio: 'pA' }, txs)
    expect(a.viewTx).toEqual([])
    expect(a.returnYTD).toBeCloseTo(10, 6)
    const b = await run({ activePortfolio: 'pB' }, txs)
    expect(b.viewTx).toEqual(['depB'])
    // 11,000 hoy con 10,000 de arranque y 5,000 que entraron: el retorno NO es +10%.
    expect(b.ytdChange).toBeCloseTo(-4000, 6)
  })

  it('lo que solo se mide contra el archivo se declara no disponible (MTD null)', async () => {
    const a = await run({ activePortfolio: 'pA' })
    expect(a.returnMTD).toBeNull()
  })
})

describe('FASE OG: desde una vista escopada no se publica a Amigos', () => {
  it('con un portafolio seleccionado la publicación se bloquea; sin scope, sale', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const settings = { friendsEnabled: true, _lastFriendsPublish: yesterday }
    for (const [scope, expected] of [['pA', 0], ['__all__', 1]]) {
      const { result, unmount } = setup({
        firestore: { items: [bankA, bankB], snapshots: snaps, settings },
        opts: { activePortfolio: scope, publishFriends: true },
      })
      await act(async () => {})
      await act(async () => {})
      await act(async () => {})
      const syncCalls = authFetch.mock.calls.filter(([u, o]) => String(u).includes('/api/friends') && String(o?.body || '').includes('"sync"'))
      expect(syncCalls.length).toBe(expected)
      expect(result.current.scopedView).toBe(scope !== '__all__')
      unmount()
    }
  })
})
