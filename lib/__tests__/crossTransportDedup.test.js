// La MISMA compra capturada por los DOS transportes.
//
// Es el caso que está a punto de volverse real: hoy solo corre el atajo del
// iPhone, y en cuanto se prendan las variables IMAP el correo va a capturar
// esas mismas compras por segunda vez. Todo lo que impide que se guarden dos
// veces vive en la COMPOSICIÓN de tres piezas (normalizar → resolver el
// instante → buscar el casi-duplicado), y cada una se probaba por su lado.
//
// Se ejercitan las rutas REALES de cada transporte: el atajo entra por
// `normalizeExpenseInput` con el cuerpo que manda Shortcuts, y el correo por
// `expenseFromAlert` con el texto de una alerta y la cabecera Date del mensaje.
import { normalizeExpenseInput, ingestExpense } from '../expenseIngest'
import { expenseFromAlert } from '../alertIngest'
import { zoneOffsetFromDateHeader } from '../sameCharge'

// Un Firestore de mentira con lo justo: doc().get()/set() y la consulta por
// rango de fecha que usa el dedup.
function fakeDb() {
  const docs = new Map()
  const col = {
    doc: (id) => ({
      async get() { return { exists: docs.has(id), data: () => docs.get(id) } },
      async set(v) { docs.set(id, v) },
    }),
    where(field, op, value) {
      const preds = [...(this._preds || []), { op, value }]
      return { ...col, _preds: preds, where: col.where, get: col.get }
    },
    async get() {
      const preds = this._preds || []
      const rows = [...docs.entries()]
        .filter(([, v]) => preds.every((p) => (p.op === '>=' ? v.date >= p.value : v.date <= p.value)))
      return { docs: rows.map(([id, v]) => ({ id, data: () => v })) }
    },
  }
  return { collection: () => col, _docs: docs }
}

// La compra: Q18.00 en McDonald's, 19 ago 2026 a las 08:06 hora de Guatemala
// (UTC-6). Los números son los de la captura real que confirmó el atajo.
const LOCAL_DATE = '2026-08-19'
const UTC_INSTANT = '2026-08-19T14:06:05.000Z' // 08:06:05 en UTC-6

// Lo que manda la automatización de Wallet.
const shortcutInput = (over = {}) => normalizeExpenseInput({
  amount: 18,
  currency: 'GTQ',
  merchant: 'Mcdonalds 50 Bancos',
  date: LOCAL_DATE,
  occurredAt: UTC_INSTANT,
  source: 'shortcut',
  ...over,
})

// La alerta del banco, reenviada por correo. La hora va en PARED sin zona, que
// es como la imprimen, y la zona sale de la cabecera Date del propio mensaje.
const ALERTA = [
  'Estimado cliente,',
  'Se ha realizado una compra con su tarjeta terminacion 9856.',
  'Monto: Q18.00',
  'Comercio: MCDONALDS 50 BANCOS',
  'Fecha: 19/08/2026',
  'Hora: 08:06',
].join('\n')

function emailInput({ dateHeader = 'Wed, 19 Aug 2026 08:07:00 -0600', text = ALERTA } = {}) {
  const { input, skip } = expenseFromAlert({
    subject: 'Alerta de compra',
    text,
    receivedAt: new Date(Date.parse(dateHeader)),
    defaultCurrency: 'GTQ',
    source: 'email',
    offsetMinutes: zoneOffsetFromDateHeader(dateHeader),
  })
  if (skip) throw new Error(`la alerta se descartó: ${skip}`)
  return input
}

const write = (db, input) => ingestExpense({ db, uid: 'u1', input, rules: [] })

describe('la misma compra por los dos transportes se guarda UNA vez', () => {
  it('atajo primero, correo después', async () => {
    const db = fakeDb()
    const a = await write(db, shortcutInput())
    expect(a.status).toBe('created')

    const b = await write(db, emailInput())
    expect(b.status).toBe('duplicate')
    expect(b.reason).toBe('cross-source')
    expect(db._docs.size).toBe(1)
  })

  it('correo primero, atajo después', async () => {
    // El orden no lo decide nadie: el barrido corre una vez al día, así que un
    // correo viejo puede aterrizar después de una compra nueva.
    const db = fakeDb()
    expect((await write(db, emailInput())).status).toBe('created')
    expect((await write(db, shortcutInput())).status).toBe('duplicate')
    expect(db._docs.size).toBe(1)
  })

  it('el mismo evento reintentado tampoco duplica', async () => {
    const db = fakeDb()
    await write(db, shortcutInput())
    const again = await write(db, shortcutInput())
    expect(again.reason).toBe('same-event')
    expect(db._docs.size).toBe(1)
  })
})

describe('dos compras REALES iguales siguen siendo dos', () => {
  it('mismo monto y comercio, a distinta hora del mismo día', async () => {
    // Dos cafés de Q18 en el mismo local: la hora es lo único que los separa,
    // y tragarse uno es perder un cobro que nadie puede recuperar.
    const db = fakeDb()
    await write(db, shortcutInput())
    const tarde = await write(db, shortcutInput({ occurredAt: '2026-08-19T20:40:00.000Z' }))
    expect(tarde.status).toBe('created')
    expect(db._docs.size).toBe(2)
  })

  it('mismo monto y comercio en días distintos', async () => {
    const db = fakeDb()
    await write(db, shortcutInput())
    const otroDia = await write(db, shortcutInput({
      date: '2026-08-21', occurredAt: '2026-08-21T14:06:05.000Z',
    }))
    expect(otroDia.status).toBe('created')
    expect(db._docs.size).toBe(2)
  })
})

describe('la compra de la NOCHE, que cruza el día en UTC', () => {
  it('se sigue reconociendo aunque las dos capturas lleven fecha distinta', async () => {
    // 19:30 en UTC-6 es el día SIGUIENTE en UTC, así que las dos capturas del
    // mismo cobro pueden terminar con etiquetas de día distintas. El instante
    // manda sobre el rótulo, y por eso la consulta abre ±1 día.
    const db = fakeDb()
    const noche = '2026-08-20T01:30:00.000Z'
    await write(db, shortcutInput({ date: '2026-08-19', occurredAt: noche }))

    const correo = await write(db, shortcutInput({
      source: 'email',
      date: '2026-08-20',
      occurredAt: '2026-08-20T01:30:20.000Z',
    }))
    expect(correo.status).toBe('duplicate')
    expect(db._docs.size).toBe(1)
  })
})

// El id determinístico existe para que un reintento sea idempotente. Meterle la
// hora lo arregla para dos cobros reales, pero solo si la hora es ESTABLE entre
// reintentos: la reportada viaja en el cuerpo, la de llegada no.
describe('la hora en el id no puede romper la idempotencia', () => {
  it('un reintento con hora de LLEGADA sigue dando el mismo documento', async () => {
    const db = fakeDb()
    // Sin zona en `occurredAt`, se cae a la hora de llegada, que cambia en cada
    // intento. Si esa entrara al id, un reintento de red escribiría un segundo
    // gasto por un cobro que ya está.
    const sinZona = (recibido) => normalizeExpenseInput({
      amount: 18, currency: 'GTQ', merchant: 'Mcdonalds 50 Bancos',
      date: LOCAL_DATE, occurredAt: '2026-08-19T08:06:05', receivedAt: recibido,
      source: 'shortcut',
    })
    const primero = sinZona('2026-08-19T14:06:05.000Z')
    const reintento = sinZona('2026-08-19T14:06:23.000Z')
    expect(primero.timeSource).toBe('received')

    expect((await write(db, primero)).status).toBe('created')
    expect((await write(db, reintento)).reason).toBe('same-event')
    expect(db._docs.size).toBe(1)
  })

  it('un reintento con la MISMA hora reportada también', async () => {
    const db = fakeDb()
    await write(db, shortcutInput())
    expect((await write(db, shortcutInput())).reason).toBe('same-event')
    expect(db._docs.size).toBe(1)
  })
})
