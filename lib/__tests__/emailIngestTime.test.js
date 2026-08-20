import { ingestParsedEmail } from '../emailIngest'

// Integration over the REAL path an alert takes: parseBankAlert →
// normalizeExpenseInput → ingestExpense. What it is here to prove is the wiring
// that unit tests cannot see — that the alert's hour actually reaches the stored
// document, and that when the alert has none it is the MESSAGE's Date header
// that stands in, never the sweep's clock (the sweep runs once a day, so "now"
// there would be up to 24 hours after the purchase).

const UID = 'user-1'
const TOKEN = 'a'.repeat(32)

// Minimal Admin-SDK shape: enough for resolveIngestToken, readUserRules and
// ingestExpense. Keyed by FULL path, because the token doc and the transactions
// live in different collections and a single shared map would let them collide.
function fakeDb({ existing = [] } = {}) {
  const written = []
  const store = new Map([
    [`ingestTokens/${TOKEN}`, { uid: UID }],
    ...existing.map((d) => [`users/${UID}/financeTransactions/${d.id}`, d]),
  ])

  const makeDoc = (path) => {
    const ref = {
      get: async () => ({
        exists: store.has(path),
        data: () => store.get(path),
        // resolveIngestToken stamps lastUsedAt through snap.ref; omitting it
        // made every call throw and every test read as 'unmatched'.
        ref,
      }),
      set: async (data) => { store.set(path, data); written.push({ path, data }) },
    }
    return ref
  }

  const collection = (path) => ({
    // readIngestDoc addresses nested paths as collection().doc().collection(),
    // so a doc has to be able to open a sub-collection.
    doc: (id) => Object.assign(makeDoc(`${path}/${id}`), {
      collection: (sub) => collection(`${path}/${id}/${sub}`),
    }),
    where: () => collection(path),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`))
        .map(([k, data]) => ({ id: k.slice(path.length + 1), data: () => data })),
    }),
  })

  return {
    store,
    collection,
    doc: (path) => makeDoc(path),
    // Only the writes into the user's ledger; the token's lastUsedAt touch is
    // bookkeeping and would otherwise show up as a transaction.
    get written() { return written.filter((w) => w.path.includes('/financeTransactions/')) },
  }
}

// `headerLines` keeps the Date exactly as written, offset and all. mailparser
// resolves `parsed.date` to an absolute Date, which loses the sender's zone —
// and that zone is what places the wall time the alert prints.
const mail = ({ text, date, dateHeader }) => ({
  subject: 'Alerta de consumo',
  text,
  html: '',
  date,
  headerLines: dateHeader ? [{ key: 'date', line: `Date: ${dateHeader}` }] : [],
})
// The plus-address token is what routes the mail to an account; the From header
// is never used for that, since it is trivially spoofed.
const HEADERS = new Map([['delivered-to', `gastos+${TOKEN}@chispu.xyz`]])

describe('la hora del correo llega hasta el documento', () => {
  it('usa la hora que la alerta imprime', async () => {
    const db = fakeDb()
    const res = await ingestParsedEmail({
      db,
      headers: HEADERS,
      parsed: mail({
        text: 'Compra por Q17.00 en RALLY PADEL\nFecha: 03/08/2026\nHora: 14:32',
        // El reenvío se demoró ocho minutos.
        date: new Date('2026-08-03T20:40:00Z'),
        dateHeader: 'Mon, 3 Aug 2026 14:33:00 -0600',
      }),
    })
    expect(res.status).toBe('created')
    const stored = db.written[0].data
    expect(stored.timeSource).toBe('reported')
    // 14:32 en UTC-6, o sea 20:32Z. Leerlo como UTC daría 14:32Z: seis horas
    // corridas, y el mismo cobro dejaría de emparejar con lo que vio el atajo.
    expect(stored.occurredAt).toBe('2026-08-03T20:32:00.000Z')
    expect(stored.date).toBe('2026-08-03')
  })

  it('sin hora en la alerta cae a la cabecera Date del mensaje', async () => {
    const db = fakeDb()
    await ingestParsedEmail({
      db,
      headers: HEADERS,
      parsed: mail({
        text: 'Compra por Q17.00 en RALLY PADEL\nFecha: 03/08/2026',
        date: new Date('2026-08-03T20:35:00Z'),
        dateHeader: 'Mon, 3 Aug 2026 14:35:00 -0600',
      }),
    })
    const stored = db.written[0].data
    expect(stored.timeSource).toBe('received')
    expect(stored.occurredAt).toBe('2026-08-03T20:35:00.000Z')
  })

  it('el mismo cobro que el atajo ya capturó no se guarda dos veces', async () => {
    // El atajo lo vio a las 20:32; el correo llega y trae la misma hora.
    const db = fakeDb({
      existing: [{
        id: 'ftx-auto-shortcut',
        type: 'EXPENSE', amount: 17, currency: 'GTQ', date: '2026-08-03',
        merchant: 'Rally Padel Guatemala', _source: 'auto_shortcut',
        occurredAt: '2026-08-03T20:32:05.000Z', timeSource: 'reported',
      }],
    })
    const res = await ingestParsedEmail({
      db,
      headers: HEADERS,
      parsed: mail({
        text: 'Compra por Q17.00 en RALLY PADEL\nFecha: 03/08/2026\nHora: 14:32',
        date: new Date('2026-08-03T20:40:00Z'),
        dateHeader: 'Mon, 3 Aug 2026 14:33:00 -0600',
      }),
    })
    expect(res.status).toBe('duplicate')
    expect(db.written).toHaveLength(0)
  })

  it('dos cobros iguales a horas distintas SÍ se guardan los dos', async () => {
    // Dos parqueos de Q17 el mismo día en el mismo lugar. Antes el parecido del
    // comercio los fusionaba y el segundo se perdía.
    const db = fakeDb({
      existing: [{
        id: 'ftx-auto-shortcut',
        type: 'EXPENSE', amount: 17, currency: 'GTQ', date: '2026-08-03',
        merchant: 'Rally Padel Guatemala', _source: 'auto_shortcut',
        occurredAt: '2026-08-03T14:05:00.000Z', timeSource: 'reported',
      }],
    })
    const res = await ingestParsedEmail({
      db,
      headers: HEADERS,
      parsed: mail({
        text: 'Compra por Q17.00 en RALLY PADEL\nFecha: 03/08/2026\nHora: 14:32',
        date: new Date('2026-08-03T20:40:00Z'),
        dateHeader: 'Mon, 3 Aug 2026 14:33:00 -0600',
      }),
    })
    expect(res.status).toBe('created')
  })
})
