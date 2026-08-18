/**
 * Qué correos consume el barrido, y cuáles deja como estaban.
 *
 * Existe porque el buzón de gastos pasó a ser el MISMO que manda los
 * recordatorios y los reportes: ahí también caen rebotes y respuestas
 * automáticas dirigidas a una persona. La versión anterior marcaba como leído
 * TODO lo que miraba, así que compartir el buzón habría hecho que un proceso de
 * fondo decidiera en silencio qué ya viste.
 *
 * Se prueba con un servidor IMAP falso porque la regla no vive en una función
 * pura: vive en qué mensajes recibe messageFlagsAdd.
 */

const TOKEN = 'a'.repeat(32)

// Mensajes de mentira. `source` es lo que mailparser recibiría; el mock de
// mailparser lo devuelve ya interpretado, así que acá solo importa el sobre.
const messages = {}
const flagged = []

jest.mock('imapflow', () => ({
  ImapFlow: class {
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async search() { return Object.keys(messages).map(Number) }
    async fetchOne(uid) { return { source: Buffer.from(String(uid)) } }
    async messageFlagsAdd(uid) { flagged.push(Number(uid)) }
    async logout() {}
    close() {}
  },
}), { virtual: true })

jest.mock('mailparser', () => ({
  simpleParser: async (source) => messages[Number(String(source))],
}), { virtual: true })

jest.mock('../ingestTokens', () => ({
  TOKEN_RE: /^[a-f0-9]{32}$/,
  resolveIngestToken: async (_db, token) => (token === 'a'.repeat(32) ? { uid: 'u1' } : null),
  readUserRules: async () => [],
  readUserBaseCurrency: async () => 'GTQ',
}))

jest.mock('../expenseIngest', () => ({
  normalizeExpenseInput: (x) => x,
  ingestExpense: async () => ({ status: 'created', id: 'x1' }),
}))

jest.mock('../parsers/bankAlertParser', () => ({
  parseBankAlert: () => ({ amount: 17, currency: 'GTQ', merchant: 'RALLY', date: '2026-08-03', kind: 'debit' }),
}))

const { sweepInbox } = require('../emailIngest')

const msg = (headers) => ({
  subject: 'Alerta', text: 'compra', html: '', date: new Date('2026-08-03T20:32:00Z'),
  headers: new Map(Object.entries(headers)), headerLines: [],
})

const seed = (map) => {
  for (const k of Object.keys(messages)) delete messages[k]
  Object.assign(messages, map)
  flagged.length = 0
}

beforeEach(() => {
  process.env.IMAP_HOST = 'imap.zoho.com'
  process.env.IMAP_USER = 'reminders@chispu.xyz'
  process.env.IMAP_PASS = 'secret'
})

describe('barrido de un buzón compartido', () => {
  it('un correo que NO trae token se deja sin leer', async () => {
    // El caso real: un rebote de un reporte que este mismo buzón envió. No es
    // nuestro, así que marcarlo leído sería esconderle al dueño su propio correo.
    seed({ 1: msg({ to: 'reminders@chispu.xyz', from: 'mailer-daemon@otro.com' }) })
    const out = await sweepInbox({ db: {} })
    expect(flagged).toEqual([])
    expect(out.ours).toBe(0)
    expect(out.scanned).toBe(1)
    expect(out.unmatched).toBe(1)
  })

  it('un correo con nuestro token sí se consume', async () => {
    seed({ 7: msg({ 'delivered-to': `reminders+${TOKEN}@chispu.xyz` }) })
    const out = await sweepInbox({ db: {} })
    expect(flagged).toEqual([7])
    expect(out.ours).toBe(1)
    expect(out.created).toBe(1)
  })

  it('un token que ya no existe también se consume, o se reprocesa para siempre', async () => {
    // Venía dirigido a nosotros: dejarlo sin leer lo haría volver en cada
    // barrido sin que nada pueda cambiar el resultado.
    seed({ 3: msg({ 'delivered-to': `reminders+${'b'.repeat(32)}@chispu.xyz` }) })
    const out = await sweepInbox({ db: {} })
    expect(flagged).toEqual([3])
    expect(out.ours).toBe(1)
    expect(out.unmatched).toBe(1)
  })

  it('mezclado: solo se tocan los nuestros', async () => {
    seed({
      1: msg({ to: 'reminders@chispu.xyz' }),
      2: msg({ 'delivered-to': `reminders+${TOKEN}@chispu.xyz` }),
      3: msg({ to: 'alguien@otro.com' }),
    })
    const out = await sweepInbox({ db: {} })
    expect(flagged).toEqual([2])
    expect(out.scanned).toBe(3)
    expect(out.ours).toBe(1)
  })

  it('recorre del más nuevo al más viejo', async () => {
    // Sin esto, en un buzón compartido una acumulación de correo ajeno se come
    // el presupuesto del lote y tapa las alertas de hoy.
    seed({
      1: msg({ 'delivered-to': `reminders+${TOKEN}@chispu.xyz` }),
      9: msg({ 'delivered-to': `reminders+${TOKEN}@chispu.xyz` }),
      5: msg({ 'delivered-to': `reminders+${TOKEN}@chispu.xyz` }),
    })
    await sweepInbox({ db: {}, limit: 2 })
    expect(flagged).toEqual([9, 5])
  })

  it('sin IMAP configurado es un no-op silencioso, no un error', async () => {
    delete process.env.IMAP_HOST
    seed({ 1: msg({ to: 'x@y.com' }) })
    await expect(sweepInbox({ db: {} })).resolves.toEqual({ skipped: 'IMAP not configured' })
    expect(flagged).toEqual([])
  })
})
