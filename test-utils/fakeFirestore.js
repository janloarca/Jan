// Doble de `firebase/firestore` para probar los caminos de ESCRITURA de
// useFirestoreItems (cascadas de borrado, lotes, batches) con el hook REAL.
//
// Es un mapa en memoria de `ruta -> { id -> doc }` con getDocs/onSnapshot/
// setDoc/updateDoc/deleteDoc/writeBatch. `query`/`where` NO filtran (devuelven
// la colección entera), así que sirve para asertar QUÉ documentos quedan, no
// para probar filtros de consulta. Se monta con jest.doMock('firebase/firestore').
// Precedente: test-utils/hookHarness.js.

function makeFake(initial) {
  const store = JSON.parse(JSON.stringify(initial || {}))
  const listeners = []
  const ensure = (p) => (store[p] = store[p] || {})
  const notify = () => listeners.forEach((l) => l())
  const snapOf = (path) => ({
    docs: Object.entries(ensure(path)).map(([id, data]) => ({
      id, data: () => ({ ...data }), ref: { __path: path, __id: id },
    })),
  })
  const fs = {
    collection: (db, path) => ({ __coll: path }),
    doc: (db, path, id) => ({ __path: path, __id: id }),
    query: (coll) => coll,
    orderBy: () => ({}),
    where: () => ({}),
    getDocs: async (c) => snapOf(c.__coll || c.__path),
    getDoc: async (r) => {
      const d = ensure(r.__path)[r.__id]
      return { exists: () => d !== undefined, data: () => ({ ...d }), id: r.__id }
    },
    deleteDoc: async (r) => { delete ensure(r.__path)[r.__id]; notify() },
    setDoc: async (r, data, opts) => {
      const cur = ensure(r.__path)[r.__id]
      ensure(r.__path)[r.__id] = opts && opts.merge && cur ? { ...cur, ...data } : { ...data }
      notify()
    },
    updateDoc: async (r, data) => {
      const cur = ensure(r.__path)[r.__id]
      if (cur === undefined) throw new Error('not-found:' + r.__path + '/' + r.__id)
      ensure(r.__path)[r.__id] = { ...cur, ...data }
      notify()
    },
    writeBatch: () => {
      const ops = []
      return {
        set: (r, d, o) => ops.push(['set', r, d, o]),
        update: (r, d) => ops.push(['update', r, d]),
        delete: (r) => ops.push(['delete', r]),
        commit: async () => {
          for (const [kind, r, d, o] of ops) {
            if (kind === 'delete') delete ensure(r.__path)[r.__id]
            else if (kind === 'update') ensure(r.__path)[r.__id] = { ...(ensure(r.__path)[r.__id] || {}), ...d }
            else ensure(r.__path)[r.__id] = o && o.merge ? { ...(ensure(r.__path)[r.__id] || {}), ...d } : { ...d }
          }
          notify()
        },
      }
    },
    onSnapshot: (target, cb) => {
      const path = target.__coll || target.__path
      const fire = () => cb(snapOf(path))
      listeners.push(fire)
      fire()
      return () => {}
    },
  }
  return { store, fs }
}
module.exports = { makeFake }
