// FASE OB. Borrar una cuenta desde el editor (deleteItem) y desde Ajustes
// (deleteItemGroup) eran dos cascadas distintas; ahora es una. Corre el hook
// REAL (useFirestoreItems) sobre un doble de Firestore en memoria y aserta
// QUE documentos quedan.

const { renderHook, act, pinReact } = require('../../test-utils/hookHarness')
const { makeFake } = require('../../test-utils/fakeFirestore')

const UID = 'u1'
const P = (c) => `users/${UID}/${c}`
let store

function boot(initial) {
  jest.resetModules()
  pinReact()
  const fake = makeFake(initial)
  store = fake.store
  jest.doMock('firebase/firestore', () => ({ __esModule: true, ...fake.fs }))
  jest.doMock('../../lib/firebase', () => ({ __esModule: true, db: { __db: true }, auth: { currentUser: { uid: UID } } }))
  jest.doMock('firebase/auth', () => ({ __esModule: true, onAuthStateChanged: (a, cb) => { cb({ uid: UID }); return () => {} } }))
  const { useFirestoreItems } = require('../useFirestoreItems')
  return renderHook(() => useFirestoreItems())
}

const base = () => ({
  [P('items')]: {
    cash: { name: 'Caja', symbol: 'CAJA', type: 'Bank', institution: 'Banco Caja', quantity: 1, purchasePrice: 1000, currentPrice: 1000, currency: 'USD', _source: 'manual' },
    fund: { name: 'Fondo', symbol: 'FONDO', type: 'Fund', quantity: 1, purchasePrice: 500, currentPrice: 500, currency: 'USD', _source: 'manual', incomeDestination: 'cash' },
    casa: { name: 'Casa', symbol: 'CASA', type: 'Real Estate', quantity: 1, purchasePrice: 100000, currentPrice: 120000, currency: 'USD', linkedDebtId: 'hipoteca' },
    hipoteca: { name: 'Hipoteca', symbol: 'HIPOTECA', type: 'Debt', isDebt: true, quantity: 1, purchasePrice: 40000, currentPrice: 40000, currency: 'USD' },
    acmeA: { name: 'Acme (IBKR)', symbol: 'ACME', type: 'Stock', institution: 'IBKR', quantity: 10, purchasePrice: 50, currentPrice: 60, currency: 'USD' },
    acmeB: { name: 'Acme (Schwab)', symbol: 'ACME', type: 'Stock', institution: 'Schwab', quantity: 5, purchasePrice: 55, currentPrice: 60, currency: 'USD' },
  },
  [P('transactions')]: {
    t1: { type: 'TRANSFER', date: '2026-03-01', symbol: 'CAJA', totalAmount: 300, currency: 'USD', _originItemId: 'cash', _linkedItemId: 'fund', _toAmount: 300, _toCurrency: 'USD' },
    t2: { type: 'DEPOSIT', date: '2026-01-01', symbol: 'CAJA', totalAmount: 1000, currency: 'USD', _linkedItemId: 'cash', _source: 'manual_new_account' },
    t3: { type: 'TRANSFER', date: '2026-04-01', symbol: 'CAJA', totalAmount: 500, currency: 'USD', _originItemId: 'cash', _debtItemId: 'hipoteca' },
    t4: { type: 'FEE', date: '2026-05-01', symbol: 'CASA', totalAmount: 120, currency: 'USD', _linkedItemId: 'casa', _paidFromItemId: 'cash' },
    t5: { type: 'TRANSFER', date: '2026-02-01', symbol: 'CAJA', totalAmount: 40000, currency: 'USD', _linkedItemId: 'cash', _loanItemId: 'hipoteca', _source: 'manual_loan_proceeds' },
    t6: { type: 'DEPOSIT', date: '2026-01-05', symbol: 'FONDO', totalAmount: 500, currency: 'USD', _linkedItemId: 'fund' },
  },
  [P('snapshots')]: {
    // Un ancla por cuenta lleva en `_account` la llave de INSTITUCION
    // (accountKeyOfItem: la institucion en minusculas), nunca el id del item:
    // es lo que escribe CalibrateReturnModal y lo que orphanedAccountSnapshotIds
    // compara. `cash` es el UNICO item de 'banco caja', asi que borrarlo deja
    // el ancla sin nadie que la explique.
    '2026-01-01~cal~banco-caja': { date: '2026-01-01', _account: 'banco caja', netWorthUSD: 1000, _source: 'manual', _calibrated: true },
    '2026-01-01': { date: '2026-01-01', netWorthUSD: 141500, _source: 'daily' },
  },
  [P('lots')]: {
    lotA: { symbol: 'ACME', quantity: 10, costBasis: 50, acquisitionDate: '2026-01-01', status: 'open', institution: 'IBKR', itemId: 'acmeA' },
    lotB: { symbol: 'ACME', quantity: 5, costBasis: 55, acquisitionDate: '2026-01-01', status: 'open', institution: 'Schwab', itemId: 'acmeB' },
    lotOld: { symbol: 'FONDO', quantity: 1, costBasis: 500, acquisitionDate: '2026-01-05', status: 'open' },
  },
  [P('itemSnapshots')]: {
    '2026-02': { monthKey: '2026-02', items: { cash: { value: 1000 }, fund: { value: 500 }, acmeA: { value: 600 } } },
  },
})

const tick = async () => { await act(async () => { await Promise.resolve() }) }

beforeEach(() => { jest.resetModules(); pinReact() })

describe('FASE OB: deleteItem (el editor) cascadea igual que deleteItemGroup', () => {
  it('se lleva las filas que la nombran por CUALQUIER campo, su ancla, su mes cacheado y limpia las referencias', async () => {
    const r = boot(base())
    await tick()
    const epoch = r.result.current.deletionEpoch
    await act(async () => { await r.result.current.deleteItem('cash') })
    const txLeft = Object.keys(store[P('transactions')]).sort()
    // t1 (origen), t2 (linked), t3 (origen del pago), t4 (pagado desde), t5 (destino del prestamo) se van; t6 queda.
    expect(txLeft).toEqual(['t6'])
    expect(Object.keys(store[P('snapshots')]).sort()).toEqual(['2026-01-01'])
    expect(Object.keys(store[P('itemSnapshots')]['2026-02'].items).sort()).toEqual(['acmeA', 'fund'])
    expect(store[P('items')].fund.incomeDestination).toBe('')
    expect(r.result.current.deletionEpoch).toBe(epoch + 1)
  })

  it('borrar el PRESTAMO se lleva sus pagos y el desembolso, y limpia el vinculo del inmueble', async () => {
    const r = boot(base())
    await tick()
    await act(async () => { await r.result.current.deleteItem('hipoteca') })
    expect(Object.keys(store[P('transactions')]).sort()).toEqual(['t1', 't2', 't4', 't6'])
    expect(store[P('items')].casa.linkedDebtId).toBe('')
  })

  it('un lote con DUENO se va con su posicion y el del hermano del mismo simbolo se queda', async () => {
    const r = boot(base())
    await tick()
    await act(async () => { await r.result.current.deleteItem('acmeA') })
    expect(Object.keys(store[P('lots')]).sort()).toEqual(['lotB', 'lotOld'])
    expect(store[P('items')].acmeB).toBeTruthy()
  })

  it('un lote SIN dueno conserva la regla por simbolo: se va solo si ningun hermano lo tiene', async () => {
    const r = boot(base())
    await tick()
    await act(async () => { await r.result.current.deleteItem('fund') })
    expect(store[P('lots')].lotOld).toBeUndefined()
  })

  it('las dos puertas producen el mismo archivo', async () => {
    const r1 = boot(base())
    await tick()
    await act(async () => { await r1.result.current.deleteItem('cash') })
    const viaEditor = JSON.stringify(store)
    const r2 = boot(base())
    await tick()
    await act(async () => { await r2.result.current.deleteItemGroup(['cash']) })
    expect(JSON.stringify(store)).toBe(viaEditor)
  })
})
