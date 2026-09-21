import { expenseFromAlert } from '@/lib/alertIngest'
import { normalizeExpenseInput } from '@/lib/expenseIngest'
import { zoneOffsetFromDateHeader } from '@/lib/sameCharge'

// ⛔ FASE OT. El día de un gasto capturado automáticamente, de punta a punta.
//
// Por qué importa más que un día: `date` es lo que decide en qué MES cae el
// movimiento en Flujo, así que equivocarse mueve dinero entre meses — cambia el
// total, el desglose por categoría y la tasa de ahorro de DOS meses a la vez.
//
// El caso: una compra de las 8:05pm del 31 de agosto en Guatemala (UTC-6). En
// UTC eso ya es el 1 de septiembre, y tomar los diez primeros caracteres del
// instante la archivaba en septiembre.
const COMPRA_LOCAL = '2026-08-31 20:05 en Guatemala'
const LLEGADA = new Date('2026-09-01T02:05:00Z')
const CABECERA = 'Mon, 31 Aug 2026 20:05:00 -0600'

describe(`correo: ${COMPRA_LOCAL}`, () => {
  // Una alerta que NO imprime fecha: el día sale de la llegada, que es donde
  // vivía el defecto. Cuando la alerta SÍ la imprime, esa siempre ganó.
  const SIN_FECHA = 'Compra por Q75.00 en DONALD EXPRESS GT'

  const correo = (extra = {}) => expenseFromAlert({
    subject: 'Alerta de compra',
    text: SIN_FECHA,
    receivedAt: LLEGADA,
    source: 'email',
    ...extra,
  })

  it('el desfase de la cabecera Date es el de Guatemala', () => {
    expect(zoneOffsetFromDateHeader(CABECERA)).toBe(-360)
  })

  it('con el desfase de su propia cabecera, el gasto queda en AGOSTO', () => {
    const { input } = correo({ offsetMinutes: zoneOffsetFromDateHeader(CABECERA) })
    expect(input.date).toBe('2026-08-31')
    expect(input.date.slice(0, 7)).toBe('2026-08')
  })

  // La regresión NEGATIVA, que es la que fija el defecto: sin desfase el
  // comportamiento es EXACTAMENTE el de antes, así que el arreglo solo puede
  // mejorar un caso y nunca empeorar uno que ya estaba bien.
  it('sin desfase conocido se comporta igual que antes (el día UTC)', () => {
    const { input } = correo()
    expect(input.date).toBe('2026-09-01')
  })

  it('una alerta que SÍ imprime su fecha manda sobre la llegada', () => {
    const { input } = expenseFromAlert({
      subject: 'Alerta de compra',
      text: 'Fecha: 31/08/2026\nCompra por Q75.00 en DONALD EXPRESS GT',
      receivedAt: LLEGADA,
      source: 'email',
    })
    expect(input.date).toBe('2026-08-31')
  })

  // Segundo orden, y es el que protege el dedup: `occurredAt` se arma pegando
  // la hora de pared impresa a la FECHA del alert, así que un día corrido
  // producía un instante corrido un día entero. Con eso, la misma compra
  // capturada por el atajo y por el correo quedaba a 24 horas y se guardaba
  // dos veces (lib/sameCharge.js).
  it('la hora de pared impresa aterriza en el instante REAL de la compra', () => {
    const { input } = expenseFromAlert({
      subject: 'Alerta de compra',
      text: 'Compra por Q75.00 en DONALD EXPRESS GT\nHora: 20:05',
      receivedAt: LLEGADA,
      source: 'email',
      offsetMinutes: zoneOffsetFromDateHeader(CABECERA),
    })
    expect(input.occurredAt).toBe('2026-09-01T02:05:00.000Z')
    expect(new Date(input.occurredAt).getTime()).toBe(LLEGADA.getTime())
  })
})

describe(`atajo del iPhone: ${COMPRA_LOCAL}`, () => {
  const base = { amount: 75, currency: 'GTQ', merchant: 'DONALD EXPRESS GT' }

  // El formato que la documentación pide (`yyyy-MM-dd'T'HH:mm:ssZ`, que en iOS
  // es el desfase numérico y no una "Z" literal) ya trae la zona escrita, así
  // que este camino sale gratis.
  it('un occurredAt con su desfase queda en AGOSTO', () => {
    const input = normalizeExpenseInput({ ...base, occurredAt: '2026-08-31T20:05:00-0600' })
    expect(input.date).toBe('2026-08-31')
  })

  it('y también con dos puntos en el desfase', () => {
    const input = normalizeExpenseInput({ ...base, occurredAt: '2026-08-31T20:05:00-06:00' })
    expect(input.date).toBe('2026-08-31')
  })

  // El hueco que queda nombrado: un instante Zulu sin ninguna zona declarada no
  // dice dónde estaba el pagador, y adivinarla es justo lo que no se hace.
  it('un occurredAt Zulu sin desfase declarado se comporta como antes', () => {
    const input = normalizeExpenseInput({ ...base, occurredAt: '2026-09-01T02:05:00Z' })
    expect(input.date).toBe('2026-09-01')
  })

  it('pero el caller puede declararlo, y entonces sí se resuelve', () => {
    const input = normalizeExpenseInput(
      { ...base, occurredAt: '2026-09-01T02:05:00Z' },
      { offsetMinutes: -360 }
    )
    expect(input.date).toBe('2026-08-31')
  })

  it('una fecha que el cliente ya resolvió se respeta tal cual', () => {
    const input = normalizeExpenseInput({ ...base, date: '2026-08-31', occurredAt: '2026-09-01T02:05:00Z' })
    expect(input.date).toBe('2026-08-31')
  })
})

describe('el tope de "no puede ser futuro" también es del pagador', () => {
  // Al ESTE del meridiano el error va para el otro lado, y el tope era quien lo
  // cometía: a las 8:30 de la mañana del 1 de septiembre en Tokio (UTC+9) en
  // UTC todavía es 31 de agosto, así que un "hoy" leído en UTC declaraba FUTURA
  // una fecha local perfectamente correcta y la arrastraba un día hacia atrás.
  //
  // El instante de la compra tiene su zona escrita, así que el día ya salía
  // bien: lo que lo rompía era el tope, y por eso este test es el único que
  // muerde si `normalizeExpenseInput` deja de derivar el desfase.
  const TOKIO_MANANA = new Date('2026-08-31T23:30:00Z') // 8:30am del 1 de septiembre en Tokio
  const compra = (extra) => {
    jest.useFakeTimers().setSystemTime(TOKIO_MANANA)
    try {
      return normalizeExpenseInput({ amount: 1200, currency: 'JPY', merchant: 'KONBINI', ...extra })
    } finally {
      jest.useRealTimers()
    }
  }

  it('el día UTC va por detrás del local, que es lo que hacía fallar al tope', () => {
    expect(TOKIO_MANANA.toISOString().slice(0, 10)).toBe('2026-08-31')
  })

  it('una fecha local por delante de UTC no se arrastra hacia atrás', () => {
    expect(compra({ occurredAt: '2026-09-01T08:05:00+09:00' }).date).toBe('2026-09-01')
  })

  it('una fecha de verdad futura se sigue recortando a hoy', () => {
    const input = compra({ date: '2027-01-01', occurredAt: '2026-09-01T08:05:00+09:00' })
    expect(input.date).toBe('2026-09-01')
  })
})
