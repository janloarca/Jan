import { normalizeExpenseInput, expenseDocId, findNearDuplicate, explainIngestError } from '../expenseIngest'
import { extractIngestToken } from '../emailIngest'

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

describe('normalizeExpenseInput', () => {
  it('normalizes a Shortcut payload', () => {
    const input = normalizeExpenseInput({
      amount: '17.00', currency: 'gtq', merchant: '  Rally  Padel Guatemala ',
      date: '2026-08-03', lat: 14.57, lon: -90.48, source: 'shortcut',
    })
    expect(input).toMatchObject({
      amount: 17, currency: 'GTQ', merchant: 'Rally Padel Guatemala',
      date: '2026-08-03', source: 'shortcut', type: 'EXPENSE',
      coords: { lat: 14.57, lon: -90.48 },
    })
  })

  it('rejects amounts that are not real money', () => {
    expect(normalizeExpenseInput({ amount: 0 }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: -5 }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: 'abc' }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: 99_999_999 }).error).toBe('AMOUNT_TOO_LARGE')
  })

  it('parses a decimal comma the same way every import path does', () => {
    expect(normalizeExpenseInput({ amount: '150,25' }).amount).toBe(150.25)
  })

  it('clamps a future date to today instead of dropping the expense', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(normalizeExpenseInput({ amount: 10, date: '2099-01-01' }).date).toBe(today)
  })

  it('defaults to today when the date is junk', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(normalizeExpenseInput({ amount: 10, date: 'not a date' }).date).toBe(today)
  })

  it('drops out-of-range coordinates', () => {
    expect(normalizeExpenseInput({ amount: 10, lat: 999, lon: -90 }).coords).toBeNull()
    expect(normalizeExpenseInput({ amount: 10 }).coords).toBeNull()
  })

  it('only accepts a known source', () => {
    expect(normalizeExpenseInput({ amount: 10, source: 'hacker' }).source).toBe('shortcut')
    expect(normalizeExpenseInput({ amount: 10, source: 'email' }).source).toBe('email')
  })

  it('keeps a 4-digit card tail and ignores anything else', () => {
    expect(normalizeExpenseInput({ amount: 10, last4: '4821' }).last4).toBe('4821')
    expect(normalizeExpenseInput({ amount: 10, last4: '482100' }).last4).toBeNull()
  })
})

describe('expenseDocId', () => {
  it('is stable for the same event, so a retry is a no-op', () => {
    const input = normalizeExpenseInput({ amount: 17, merchant: 'Rally Padel', date: '2026-08-03' })
    expect(expenseDocId(input)).toBe(expenseDocId({ ...input }))
  })

  it('changes when the amount changes', () => {
    const a = normalizeExpenseInput({ amount: 17, merchant: 'Rally Padel', date: '2026-08-03' })
    const b = normalizeExpenseInput({ amount: 18, merchant: 'Rally Padel', date: '2026-08-03' })
    expect(expenseDocId(a)).not.toBe(expenseDocId(b))
  })

  it('honors a client-supplied id over the derived key', () => {
    const a = normalizeExpenseInput({ amount: 17, merchant: 'A', date: '2026-08-03', clientId: 'abc' })
    const b = normalizeExpenseInput({ amount: 99, merchant: 'B', date: '2026-01-01', clientId: 'abc' })
    expect(expenseDocId(a)).toBe(expenseDocId(b))
  })
})

describe('findNearDuplicate', () => {
  const input = normalizeExpenseInput({
    amount: 17, currency: 'GTQ', merchant: 'RALLY PADEL GUATEMALA', date: '2026-08-03', source: 'email',
  })

  it('catches the same charge captured by the other path', () => {
    // Path A saw the Apple Pay event, path C then sees the forwarded alert.
    const existing = [{ id: 'x', date: '2026-08-03', amount: 17, currency: 'GTQ', type: 'EXPENSE', merchant: 'Rally Padel', _source: 'auto_shortcut' }]
    expect(findNearDuplicate(input, existing)).toBeTruthy()
  })

  it('catches an expense the user already typed by hand', () => {
    const existing = [{ id: 'm', date: '2026-08-03', amount: 17, currency: 'GTQ', type: 'EXPENSE', description: 'Rally Padel Guatemala' }]
    expect(findNearDuplicate(input, existing)).toBeTruthy()
  })

  it('does not merge two different charges of the same amount', () => {
    const existing = [{ id: 'y', date: '2026-08-03', amount: 17, currency: 'GTQ', type: 'EXPENSE', merchant: 'Panaderia San Martin' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('does not merge across currencies', () => {
    const existing = [{ id: 'z', date: '2026-08-03', amount: 17, currency: 'USD', type: 'EXPENSE', merchant: 'Rally Padel' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('does not merge an expense into an income', () => {
    const existing = [{ id: 'i', date: '2026-08-03', amount: 17, currency: 'GTQ', type: 'INCOME', merchant: 'Rally Padel' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('matches on amount alone when neither side names a merchant', () => {
    const blind = normalizeExpenseInput({ amount: 17, currency: 'GTQ', date: '2026-08-03' })
    expect(findNearDuplicate(blind, [{ id: 'q', date: '2026-08-03', amount: 17, currency: 'GTQ', type: 'EXPENSE' }])).toBeTruthy()
  })
})

describe('extractIngestToken', () => {
  it('reads the token from the forwarding header, not from To:', () => {
    // Gmail auto-forwarding leaves the original To: intact and records the real
    // recipient in Delivered-To. Reading To: here would find nothing.
    const headers = new Map([
      ['to', 'janmarcof@gmail.com'],
      ['delivered-to', `reminders+${TOKEN}@chispu.xyz`],
    ])
    expect(extractIngestToken(headers)).toBe(TOKEN)
  })

  it('falls back to To: for a manual forward', () => {
    expect(extractIngestToken({ to: `Chispudo <reminders+${TOKEN}@chispu.xyz>` })).toBe(TOKEN)
  })

  it('is case insensitive on the token', () => {
    expect(extractIngestToken({ to: `reminders+${TOKEN.toUpperCase()}@chispu.xyz` })).toBe(TOKEN)
  })

  it('returns null for an address with no token', () => {
    expect(extractIngestToken({ to: 'reminders@chispu.xyz' })).toBeNull()
    expect(extractIngestToken({})).toBeNull()
  })

  // Esta propiedad es la que sostiene toda la decisión de reusar el buzón que ya
  // manda los recordatorios en vez de crear uno aparte: lo que identifica al
  // usuario es el token, y el nombre del buzón no participa. Si alguien alguna
  // vez ata el match a un local part concreto, se rompe acá y no en producción.
  it('no le importa cuál es el buzón, solo el token', () => {
    for (const mailbox of ['reminders', 'gastos', 'expenses', 'lo.que.sea']) {
      expect(extractIngestToken({ to: `${mailbox}+${TOKEN}@chispu.xyz` })).toBe(TOKEN)
    }
  })

  it('rejects a malformed token instead of half-matching it', () => {
    expect(extractIngestToken({ to: 'reminders+notatoken@chispu.xyz' })).toBeNull()
    expect(extractIngestToken({ to: 'reminders+abc123@chispu.xyz' })).toBeNull()
  })
})

describe('la hora decide, cuando las dos filas la tienen', () => {
  const at = (iso, source = 'reported') => ({ occurredAt: iso, timeSource: source })
  const parking = (over) => ({
    id: 'p', date: '2026-08-03', amount: 20, currency: 'GTQ', type: 'EXPENSE',
    merchant: 'PARQUEO FONTABELLA', ...over,
  })
  const capture = (over) => normalizeExpenseInput({
    amount: 20, currency: 'GTQ', merchant: 'PARQUEO FONTABELLA', date: '2026-08-03', source: 'email', ...over,
  })

  it('mismo monto y misma hora: es duplicado, sin preguntar', () => {
    const input = capture({ occurredAt: '2026-08-03T20:32:00Z' })
    expect(findNearDuplicate(input, [parking(at('2026-08-03T20:32:20Z'))])).toBeTruthy()
  })

  it('mismo monto, mismo comercio, HORAS distintas: son dos cobros', () => {
    // Dos parqueos de Q20 el mismo día en el mismo lugar. Sin la hora, el
    // parecido del comercio los fusionaba y el segundo se perdía.
    const input = capture({ occurredAt: '2026-08-03T20:32:00Z' })
    expect(findNearDuplicate(input, [parking(at('2026-08-03T14:05:00Z'))])).toBeNull()
  })

  it('la hora le gana al comercio: mismo instante aunque el nombre no se parezca', () => {
    const input = capture({ occurredAt: '2026-08-03T20:32:00Z' })
    expect(findNearDuplicate(input, [parking({ merchant: 'ZZQX 4471', ...at('2026-08-03T20:32:10Z') })])).toBeTruthy()
  })

  it('el mismo cobro cruzando la medianoche UTC sigue siendo uno solo', () => {
    // Guatemala es UTC-6: una compra a las 7pm cae al día siguiente en UTC, así
    // que las dos capturas pueden quedar con etiquetas de fecha distintas.
    const input = capture({ date: '2026-08-04', occurredAt: '2026-08-04T01:00:10Z' })
    expect(findNearDuplicate(input, [parking({ date: '2026-08-03', ...at('2026-08-04T01:00:40Z') })])).toBeTruthy()
  })

  it('con hora en un solo lado cae al comercio, y solo el MISMO día', () => {
    const input = capture({ occurredAt: '2026-08-03T20:32:00Z' })
    expect(findNearDuplicate(input, [parking()])).toBeTruthy()
    expect(findNearDuplicate(input, [parking({ date: '2026-08-04' })])).toBeNull()
  })

  it('la ventana de ±1 día ya no se traga una compra repetida al día siguiente', () => {
    // Regresión explícita: antes esto devolvía la fila del día anterior y el
    // cobro del día 4 nunca se guardaba.
    const input = capture({ date: '2026-08-04' })
    expect(findNearDuplicate(input, [parking({ date: '2026-08-03' })])).toBeNull()
  })

  it('la hora de llegada lleva margen más ancho que la reportada', () => {
    const input = capture({ occurredAt: '2026-08-03T20:32:00Z' })
    // Tres minutos: dos instantes REPORTADOS son dos cobros...
    expect(findNearDuplicate(input, [parking(at('2026-08-03T20:35:00Z'))])).toBeNull()
    // ...pero contra una hora de llegada, tres minutos es la demora del correo.
    expect(findNearDuplicate(input, [parking(at('2026-08-03T20:35:00Z', 'received'))])).toBeTruthy()
  })
})

describe('el atajo puede mandar solo occurredAt', () => {
  it('deriva el día de occurredAt, en la hora de PARED', () => {
    // Vale para las instrucciones del atajo: una acción "Formatear fecha"
    // menos, y un lugar menos donde `date` y `occurredAt` puedan discrepar.
    const input = normalizeExpenseInput({
      amount: 20, currency: 'GTQ', merchant: 'PARQUEO',
      occurredAt: '2026-08-03T23:50:00-06:00',
    })
    // 23:50 en Guatemala es el 3 de agosto, aunque en UTC ya sea el 4.
    expect(input.date).toBe('2026-08-03')
    expect(input.timeSource).toBe('reported')
    expect(input.occurredAt).toBe('2026-08-04T05:50:00.000Z')
  })

  it('un date explícito sigue mandando sobre el de occurredAt', () => {
    const input = normalizeExpenseInput({
      amount: 20, currency: 'GTQ', merchant: 'PARQUEO',
      date: '2026-08-01', occurredAt: '2026-08-03T14:32:00-06:00',
    })
    expect(input.date).toBe('2026-08-01')
  })
})

describe('una compra en otra moneda no se guarda como quetzales', () => {
  it('el monto le gana al currency fijo del atajo', () => {
    // El atajo manda `currency: GTQ` siempre, porque es una constante que se
    // escribe una vez. Sin esto, USD 100 se guardaba como Q100: ~7.7x menos.
    const input = normalizeExpenseInput({
      amount: '$100.00', currency: 'GTQ', merchant: 'AMAZON', source: 'shortcut',
    })
    expect(input.currency).toBe('USD')
    expect(input.amount).toBe(100)
  })

  it('un código ISO en el monto manda igual', () => {
    expect(normalizeExpenseInput({ amount: '100.00 USD', currency: 'GTQ', merchant: 'X' }).currency).toBe('USD')
  })

  it('un monto en quetzales sigue siendo quetzales', () => {
    expect(normalizeExpenseInput({ amount: 'Q17.00', currency: 'GTQ', merchant: 'X' }).currency).toBe('GTQ')
    expect(normalizeExpenseInput({ amount: 17, currency: 'GTQ', merchant: 'X' }).currency).toBe('GTQ')
    expect(normalizeExpenseInput({ amount: '17.00', currency: 'GTQ', merchant: 'X' }).currency).toBe('GTQ')
  })

  it('dos monedas distintas nunca se toman por el mismo cobro', () => {
    // El dedup ya comparaba moneda; lo que cambia es que ahora la moneda que
    // compara es la correcta.
    const usd = normalizeExpenseInput({ amount: '$100.00', currency: 'GTQ', merchant: 'AMAZON', date: '2026-08-03' })
    const gtq = { id: 'g', date: '2026-08-03', amount: 100, currency: 'GTQ', type: 'EXPENSE', merchant: 'AMAZON' }
    expect(findNearDuplicate(usd, [gtq])).toBeNull()
  })
})

describe('un fallo del atajo tiene que poder leerse en una notificación', () => {
  it('separa "no mandó monto" de "mandó un monto malo"', () => {
    // Correr la automatización de Wallet A MANO desde Atajos no puede funcionar:
    // no hay ninguna transacción, así que la variable Monto llega vacía. Salía
    // con el mismo código que un monto corrupto, y las dos cosas se arreglan de
    // formas distintas.
    expect(normalizeExpenseInput({ amount: '' }).error).toBe('MISSING_AMOUNT')
    expect(normalizeExpenseInput({ amount: '   ' }).error).toBe('MISSING_AMOUNT')
    expect(normalizeExpenseInput({}).error).toBe('MISSING_AMOUNT')
    expect(normalizeExpenseInput({ amount: 'abc' }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: '0' }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: '-5' }).error).toBe('INVALID_AMOUNT')
  })

  it('un monto válido sigue pasando igual que siempre', () => {
    expect(normalizeExpenseInput({ amount: '17.00', currency: 'GTQ' }).amount).toBe(17)
  })

  it('la frase nombra la causa más probable, no solo el código', () => {
    const msg = explainIngestError('MISSING_AMOUNT')
    expect(msg).toMatch(/a mano|Atajos/i)
    expect(msg).toMatch(/Apple Pay/i)
    // Nunca deja al usuario sin frase: un código desconocido igual dice algo.
    expect(explainIngestError('LO_QUE_SEA')).toBeTruthy()
  })
})
