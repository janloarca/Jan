import { stampIngestResult, listIngestTokensWithUsage } from '../ingestTokens'

const TOKEN = 'a'.repeat(32)

// Un Firestore de mentira: solo lo que estas dos funciones tocan.
function fakeDb({ tokenDocs = {}, ingestDoc = null } = {}) {
  const writes = []
  const doc = (id) => ({
    id,
    async get() {
      const data = tokenDocs[id]
      return { exists: !!data, id, data: () => data }
    },
    async set(patch, opts) { writes.push({ id, patch, opts }) },
  })
  return {
    writes,
    collection: (name) => ({
      doc: (id) => (name === 'ingestTokens'
        ? doc(id)
        : { collection: () => ({ doc: () => ({ async get() { return { exists: !!ingestDoc, data: () => ingestDoc } }, async set() {} }) }) }),
    }),
    async getAll(...refs) {
      return Promise.all(refs.map((r) => r.get()))
    },
  }
}

describe('el resultado se guarda por TRANSPORTE', () => {
  it('escribe la rama de su transporte, no una sola global', async () => {
    const db = fakeDb()
    await stampIngestResult(db, TOKEN, 'created', 'email')
    const { patch, opts } = db.writes[0]
    expect(patch.lastResult).toBe('created')
    expect(patch.lastSource).toBe('email')
    expect(patch.usage).toEqual({ email: { at: expect.any(String), result: 'created' } })
    // Con merge, Firestore fusiona el mapa anidado campo a campo, así que esto
    // solo toca `usage.email` y deja las otras ramas intactas.
    expect(opts).toEqual({ merge: true })
  })

  it('un transporte inventado no crea una rama nueva', async () => {
    // La llave es una llave de DOCUMENTO: un valor libre dejaría que un cliente
    // escriba donde quiera dentro del mapa.
    const db = fakeDb()
    await stampIngestResult(db, TOKEN, 'created', 'telepatia')
    expect(db.writes[0].patch.usage).toBeUndefined()
    expect(db.writes[0].patch.lastSource).toBeNull()
  })

  it('sin transporte se comporta como siempre', async () => {
    const db = fakeDb()
    await stampIngestResult(db, TOKEN, 'duplicate')
    expect(db.writes[0].patch.lastResult).toBe('duplicate')
    expect(db.writes[0].patch.usage).toBeUndefined()
  })

  it('un token mal formado no escribe nada', async () => {
    const db = fakeDb()
    await stampIngestResult(db, 'nope', 'created', 'email')
    expect(db.writes).toHaveLength(0)
  })

  it('es best-effort: un fallo de la base no propaga', async () => {
    // Es telemetría de diagnóstico, y jamás puede tumbar el registro de un
    // gasto real.
    const db = { collection: () => { throw new Error('boom') } }
    await expect(stampIngestResult(db, TOKEN, 'created', 'email')).resolves.toBeUndefined()
  })
})

describe('la lista de tokens lleva ese historial hasta la pantalla', () => {
  it('expone usage, que es lo único que contesta "¿el correo ha llegado?"', async () => {
    // El atajo dispara con cada compra y pisa `lastUsedAt`, así que sin esta
    // rama "el reenvío nunca entregó nada" y "entregó y el atajo lo tapó" se ven
    // idénticos desde Ajustes.
    const db = fakeDb({
      ingestDoc: { tokens: [{ token: TOKEN, label: 'iPhone' }], rules: [] },
      tokenDocs: {
        [TOKEN]: {
          uid: 'u1',
          lastUsedAt: '2026-08-26T10:00:00.000Z',
          lastResult: 'created',
          lastSource: 'shortcut',
          usage: {
            shortcut: { at: '2026-08-26T10:00:00.000Z', result: 'created' },
            email: { at: '2026-08-20T08:00:00.000Z', result: 'created' },
          },
        },
      },
    })
    const { tokens } = await listIngestTokensWithUsage(db, 'u1')
    expect(tokens[0].usage.email.at).toBe('2026-08-20T08:00:00.000Z')
    expect(tokens[0].lastSource).toBe('shortcut')
  })

  it('un token sin historial no inventa uno', async () => {
    const db = fakeDb({
      ingestDoc: { tokens: [{ token: TOKEN, label: 'iPhone' }], rules: [] },
      tokenDocs: { [TOKEN]: { uid: 'u1' } },
    })
    const { tokens } = await listIngestTokensWithUsage(db, 'u1')
    expect(tokens[0].usage).toBeNull()
    expect(tokens[0].lastUsedAt).toBeNull()
  })
})
