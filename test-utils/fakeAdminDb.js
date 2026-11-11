// Doble en memoria del Firestore del Admin SDK, lo justo para probar
// lib/institutional/store.js: doc/collection, get/set(merge)/update/delete,
// where('==')/limit, getAll, batch y runTransaction (lecturas y escrituras
// aplicadas juntas al terminar, o ninguna si la función lanza).
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v) }
function deepMerge(a, b) {
  const out = { ...(isObj(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v)
  return out
}

export function makeFakeAdminDb(seed = {}) {
  const store = new Map(Object.entries(clone(seed)))
  let auto = 0
  const writes = []

  const snapOf = (path) => ({
    id: path.split('/').pop(), exists: store.has(path), ref: docRef(path),
    data: () => (store.has(path) ? clone(store.get(path)) : undefined),
  })
  const apply = (op) => {
    writes.push({ type: op.type, path: op.path })
    if (op.type === 'delete') store.delete(op.path)
    else if (op.type === 'set') store.set(op.path, op.merge ? deepMerge(store.get(op.path), op.data) : clone(op.data))
    else if (op.type === 'update') {
      if (!store.has(op.path)) throw new Error(`NOT_FOUND ${op.path}`)
      store.set(op.path, { ...store.get(op.path), ...clone(op.data) })
    }
  }
  function docRef(path) {
    return {
      path, id: path.split('/').pop(),
      get: async () => snapOf(path),
      set: async (data, opts) => apply({ type: 'set', path, data, merge: !!opts?.merge }),
      update: async (data) => apply({ type: 'update', path, data }),
      delete: async () => apply({ type: 'delete', path }),
      collection: (name) => colRef(`${path}/${name}`),
    }
  }
  function colRef(path, filters = [], max = null) {
    const depth = path.split('/').length + 1
    const run = () => {
      let docs = [...store.keys()].filter((k) => k.startsWith(`${path}/`) && k.split('/').length === depth).sort()
      docs = docs.filter((k) => filters.every(([f, v]) => store.get(k)?.[f] === v))
      if (max != null) docs = docs.slice(0, max)
      const snaps = docs.map(snapOf)
      return { docs: snaps, empty: snaps.length === 0, size: snaps.length }
    }
    return {
      path, _run: run,
      doc: (id) => docRef(`${path}/${id || `auto${++auto}`}`),
      where: (f, op, v) => { if (op !== '==') throw new Error('fake: only =='); return colRef(path, [...filters, [f, v]], max) },
      limit: (n) => colRef(path, filters, n),
      get: async () => run(),
    }
  }
  const writer = (queue) => ({
    set: (ref, data, opts) => { queue.push({ type: 'set', path: ref.path, data, merge: !!opts?.merge }) },
    update: (ref, data) => { queue.push({ type: 'update', path: ref.path, data }) },
    delete: (ref) => { queue.push({ type: 'delete', path: ref.path }) },
  })
  return {
    __store: store, __writes: writes,
    __get: (path) => clone(store.get(path)),
    __paths: (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)).sort(),
    doc: docRef,
    collection: (path) => colRef(path),
    getAll: async (...refs) => refs.map((r) => snapOf(r.path)),
    batch: () => { const q = []; return { ...writer(q), commit: async () => { q.forEach(apply) } } },
    runTransaction: async (fn) => {
      const q = []
      let wrote = false
      const tx = {
        get: async (ref) => { if (wrote) throw new Error('fake: read after write in transaction'); return ref._run ? ref._run() : snapOf(ref.path) },
        ...Object.fromEntries(Object.entries(writer(q)).map(([k, f]) => [k, (...a) => { wrote = true; f(...a) }])),
      }
      const out = await fn(tx)
      q.forEach(apply)
      return out
    },
  }
}
