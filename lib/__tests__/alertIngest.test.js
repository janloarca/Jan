import { expenseFromAlert } from '@/lib/alertIngest'

// El camino de Android: la app de automatización lee el push del banco y manda
// el texto tal cual. El parseo pasa en el servidor, con el MISMO módulo que ya
// usa el correo — que es el punto de este archivo.

const RECIBIDO = '2026-08-19T14:06:00.000Z'

describe('el push real de un banco guatemalteco', () => {
  // Texto EXACTO del push que el usuario capturó en su pantalla. No es un
  // fixture inventado: es lo que Banco G&T mostró para un cobro de verdad.
  const push = () => expenseFromAlert({
    subject: 'Banco GyT Continental',
    text: "McDonald's, Guatemala City, Guatemala\nGTQ 18.00",
    receivedAt: RECIBIDO,
    defaultCurrency: 'GTQ',
    source: 'android',
  })

  it('saca monto, moneda, comercio y ubicación sin ninguna regla nueva', () => {
    const { input } = push()
    expect(input).toMatchObject({
      amount: 18,
      currency: 'GTQ',
      merchant: "McDonald's",
      location: 'Guatemala City, Guatemala',
      source: 'android',
      type: 'EXPENSE',
    })
  })

  it('usa la hora de LLEGADA como instante del cobro', () => {
    // El push llega en segundos, así que la llegada es el mejor dato que hay.
    // Y no trae zona horaria, así que una hora de pared impresa no se podría
    // colocar: preferir una hora aproximada pero real sobre una precisa y
    // corrida (la lección de FASE JR).
    const { input } = push()
    expect(input.occurredAt).toBe(RECIBIDO)
    expect(input.timeSource).toBe('received')
  })
})

describe('lo que NO se guarda, y no es un fallo', () => {
  it('un reverso no es un gasto', () => {
    // Registrarlo como gasto infla el mes. Queda para el estado de cuenta, que
    // sí distingue el lado del movimiento.
    const out = expenseFromAlert({
      text: 'Reverso aplicado a su tarjeta\nGTQ 250.00',
      receivedAt: RECIBIDO,
      source: 'android',
    })
    expect(out.skip).toBe('credit')
    expect(out.input).toBeUndefined()
  })

  it('una notificación que no es un cobro se descarta', () => {
    // Exigir una marca de moneda es lo que impide que un aviso de saldo, una
    // promoción o un mensaje del banco se conviertan en gasto.
    expect(expenseFromAlert({ text: 'Tu estado de cuenta ya está disponible', source: 'android' }).skip)
      .toBe('not-an-alert')
    expect(expenseFromAlert({ text: '', source: 'android' }).skip).toBe('not-an-alert')
  })
})

describe('la moneda sale de quien recibe, no del símbolo', () => {
  it('un "$" en un push mexicano son pesos, no dólares', () => {
    // Sin esto un cobro de $1,234 mexicanos se guardaría como mil doscientos
    // DÓLARES: dieciocho veces de más, y en silencio.
    const { input } = expenseFromAlert({
      text: 'Compra en OXXO\n$1,234.00',
      receivedAt: RECIBIDO,
      defaultCurrency: 'MXN',
      source: 'android',
    })
    expect(input).toMatchObject({ amount: 1234, currency: 'MXN' })
  })

  it('un código ISO explícito le gana a la moneda del usuario', () => {
    const { input } = expenseFromAlert({
      text: 'Compra en AMAZON\nUSD 49.99',
      receivedAt: RECIBIDO,
      defaultCurrency: 'GTQ',
      source: 'android',
    })
    expect(input).toMatchObject({ amount: 49.99, currency: 'USD' })
  })
})

describe('el mismo módulo sirve a los dos transportes', () => {
  const texto = 'Comercio: RALLY PADEL\nMonto: GTQ 17.00\nHora: 14:32'

  it('con zona (correo) coloca la hora impresa; sin zona (push) usa la llegada', () => {
    // Es la ÚNICA diferencia entre los dos caminos, y por eso son un solo
    // módulo: el correo saca el offset de su cabecera Date, un push no tiene
    // de dónde sacarlo y no lo necesita.
    const correo = expenseFromAlert({
      text: texto, receivedAt: '2026-08-19T20:35:00.000Z',
      offsetMinutes: -360, source: 'email',
    })
    expect(correo.input.occurredAt).toBe('2026-08-19T20:32:00.000Z')
    expect(correo.input.timeSource).toBe('reported')

    const android = expenseFromAlert({
      text: texto, receivedAt: RECIBIDO, source: 'android',
    })
    expect(android.input.occurredAt).toBe(RECIBIDO)
    expect(android.input.timeSource).toBe('received')
  })

  it('todo lo demás sale idéntico por los dos caminos', () => {
    const campos = (o) => ({ amount: o.amount, currency: o.currency, merchant: o.merchant, date: o.date })
    const correo = expenseFromAlert({ text: texto, receivedAt: RECIBIDO, offsetMinutes: -360, source: 'email' })
    const android = expenseFromAlert({ text: texto, receivedAt: RECIBIDO, source: 'android' })
    expect(campos(android.input)).toEqual(campos(correo.input))
  })
})
