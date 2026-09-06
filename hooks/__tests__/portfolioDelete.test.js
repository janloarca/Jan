// FASE OH. Borrar un portafolio dejaba a sus ítems y lotes con un
// `portfolioId` MUERTO (invisibles en todo portafolio seleccionable, visibles
// solo en "Todos"), a diferencia de deleteEntity, que re-ubica ANTES de borrar.
// Se prueba con el hook REAL (useFirestoreItems) sobre el doble de Firestore.
const { renderHook, act, pinReact } = require('../../test-utils/hookHarness')
const { makeFake } = require('../../test-utils/fakeFirestore')

const UID = 'u1'; const P = (c) => `users/${UID}/${c}`
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
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }

const base = () => ({
  [P('portfolios')]: { pA: { name: 'A' }, pB: { name: 'B' } },
  [P('items')]: {
    a1: { name: 'Bono A', symbol: 'BONO-A', type: 'Bond', quantity: 1, purchasePrice: 20000, currentPrice: 20000, currency: 'USD', portfolioId: 'pA' },
    b1: { name: 'Bono B', symbol: 'BONO-B', type: 'Bond', quantity: 1, purchasePrice: 10000, currentPrice: 10000, currency: 'USD', portfolioId: 'pB' },
    b2: { name: 'Caja B', symbol: 'CAJA-B', type: 'Bank', quantity: 1, purchasePrice: 500, currentPrice: 500, currency: 'USD', portfolioId: 'pB' },
    d1: { name: 'Caja default', symbol: 'CAJA', type: 'Bank', quantity: 1, purchasePrice: 100, currentPrice: 100, currency: 'USD' },
  },
  [P('lots')]: {
    lb: { symbol: 'BONO-B', quantity: 1, costBasis: 10000, status: 'open', itemId: 'b1', portfolioId: 'pB' },
    la: { symbol: 'BONO-A', quantity: 1, costBasis: 20000, status: 'open', itemId: 'a1', portfolioId: 'pA' },
  },
  [P('transactions')]: {
    t1: { type: 'DEPOSIT', date: '2026-01-05', symbol: 'BONO-B', totalAmount: 10000, currency: 'USD', _linkedItemId: 'b1', _source: 'manual_new_account' },
  },
})

describe('FASE OH: deletePortfolio re-ubica lo que quedaba adentro', () => {
  it('los ítems y lotes del portafolio borrado pierden su etiqueta (vuelven al default) y el doc se va', async () => {
    const hook = boot(base())
    await settle()
    await act(async () => { await hook.result.current.deletePortfolio('pB') })
    expect(store[P('portfolios')].pB).toBeUndefined()
    expect(store[P('items')].b1.portfolioId).toBeUndefined()
    expect(store[P('items')].b2.portfolioId).toBeUndefined()
    expect(store[P('lots')].lb.portfolioId).toBeUndefined()
    // Nada más de esos docs se movió: siguen existiendo con sus números.
    expect(store[P('items')].b1.currentPrice).toBe(10000)
    expect(store[P('transactions')].t1).toBeDefined()
  })
  it('borrar B no toca A ni lo que ya era del default', async () => {
    const hook = boot(base())
    await settle()
    await act(async () => { await hook.result.current.deletePortfolio('pB') })
    expect(store[P('items')].a1.portfolioId).toBe('pA')
    expect(store[P('lots')].la.portfolioId).toBe('pA')
    expect(store[P('items')].d1.portfolioId).toBeUndefined()
    expect(store[P('portfolios')].pA).toEqual({ name: 'A' })
  })
  it('borrar "Todos" o el default implícito no escribe NADA', async () => {
    const hook = boot(base())
    await settle()
    const before = JSON.stringify(store)
    await act(async () => { await hook.result.current.deletePortfolio('__all__') })
    await act(async () => { await hook.result.current.deletePortfolio('__default__') })
    expect(JSON.stringify(store)).toBe(before)
  })
})
