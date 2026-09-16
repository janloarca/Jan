// FASE OL. `addItem` con un id que YA existe (el merge de "Agregar a posición"
// pasa `item.id = existente.id`) escribía `createdAt: hoy` encima del doc,
// borrando cuándo nació de verdad: `effectiveAcqDate` (lib/historicalValues.js)
// y el respaldo sin snapshot de la Hoja caen a `createdAt` cuando no hay
// fecha de adquisición, así que un merge movía el "existe desde" a hoy. Hook
// REAL (useFirestoreItems) sobre el doble de Firestore.
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

const BORN = '2026-01-06T15:00:00.000Z'
const base = () => ({
  [P('items')]: {
    b1: { name: 'Bono IDC', symbol: 'BONO-IDC', type: 'Bond', quantity: 1, purchasePrice: 5000, currentPrice: 5000, currency: 'USD', createdAt: BORN, incomeDestination: 'caja' },
  },
})

describe('FASE OL: addItem sobre un doc existente conserva createdAt', () => {
  it('un merge (mismo id) suma el monto y deja createdAt como estaba', async () => {
    const hook = boot(base())
    await settle()
    await act(async () => {
      await hook.result.current.addItem({ id: 'b1', name: 'Bono IDC', symbol: 'BONO-IDC', type: 'Bond', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD' })
    })
    const doc = store[P('items')].b1
    expect(doc.purchasePrice).toBe(6000)
    expect(doc.createdAt).toBe(BORN)
    // El merge sigue siendo merge: lo que el form no manda sobrevive.
    expect(doc.incomeDestination).toBe('caja')
  })
  it('un ítem NUEVO sí recibe createdAt de hoy', async () => {
    const hook = boot(base())
    await settle()
    let id
    await act(async () => {
      id = await hook.result.current.addItem({ name: 'Otro', symbol: 'OTRO', type: 'Bond', quantity: 1, purchasePrice: 1, currency: 'USD' })
    })
    const doc = store[P('items')][id]
    expect(typeof doc.createdAt).toBe('string')
    expect(doc.createdAt).not.toBe(BORN)
  })
})
