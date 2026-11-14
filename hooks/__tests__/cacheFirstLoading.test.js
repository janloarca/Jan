// FASE SD (A3). Con el cache LRU en memoria (lib/firebase.js) un listener que
// se re-suscribe emite primero su foto de cache y despues la del servidor. La
// foto de cache se pinta, pero `loading` (la compuerta de los escritores de
// fondo: snapshot diario, backfill) solo baja con datos del SERVIDOR; sin
// servidor, a los 8 s se acepta lo ya emitido. Hook REAL sobre el doble.
const { renderHook, act, pinReact } = require('../../test-utils/hookHarness')
const { makeFake } = require('../../test-utils/fakeFirestore')

const UID = 'u1'; const P = (c) => `users/${UID}/${c}`
let serverFires

function boot(initial, { cacheFirst }) {
  jest.resetModules()
  pinReact()
  const fake = makeFake(initial)
  serverFires = []
  const onSnapshot = (target, cb) => {
    if (!cacheFirst) return fake.fs.onSnapshot(target, cb)
    let first = true
    return fake.fs.onSnapshot(target, (snap) => {
      if (first) {
        first = false
        cb({ ...snap, metadata: { fromCache: true } })
        serverFires.push(() => cb({ ...snap, metadata: { fromCache: false } }))
      } else cb({ ...snap, metadata: { fromCache: false } })
    })
  }
  jest.doMock('firebase/firestore', () => ({ __esModule: true, ...fake.fs, onSnapshot }))
  jest.doMock('../../lib/firebase', () => ({ __esModule: true, db: { __db: true }, auth: { currentUser: { uid: UID } } }))
  jest.doMock('firebase/auth', () => ({ __esModule: true, onAuthStateChanged: (a, cb) => { cb({ uid: UID }); return () => {} } }))
  const { useFirestoreItems } = require('../useFirestoreItems')
  return renderHook(() => useFirestoreItems())
}
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }
const data = () => ({ [P('items')]: { a: { name: 'A', symbol: 'A', type: 'Bank', quantity: 1, purchasePrice: 10, currency: 'USD' } } })

afterEach(() => jest.useRealTimers())

describe('FASE SD: la foto de cache se pinta pero no baja loading', () => {
  it('control: sin metadata (servidor) loading baja como siempre', async () => {
    const hook = boot(data(), { cacheFirst: false })
    await settle()
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.items).toHaveLength(1)
  })

  it('con foto de cache: items se pintan, loading sigue arriba hasta el servidor', async () => {
    const hook = boot(data(), { cacheFirst: true })
    await settle()
    expect(hook.result.current.items).toHaveLength(1)
    expect(hook.result.current.loading).toBe(true)
    await act(async () => { serverFires.forEach((f) => f()) })
    await settle()
    expect(hook.result.current.loading).toBe(false)
  })

  it('sin servidor, a los 8 s acepta lo ya emitido (no queda cargando para siempre)', async () => {
    jest.useFakeTimers()
    const hook = boot(data(), { cacheFirst: true })
    await settle()
    expect(hook.result.current.loading).toBe(true)
    await act(async () => { jest.advanceTimersByTime(8100) })
    await settle()
    expect(hook.result.current.loading).toBe(false)
  })
})
