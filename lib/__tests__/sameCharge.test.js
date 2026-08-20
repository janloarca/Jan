import { chargeInstant, sameChargeByTime, resolveOccurredAt, instantFromLocalTime, zoneOffsetFromDateHeader } from '../sameCharge'

const at = (iso, source) => ({ occurredAt: iso, ...(source ? { timeSource: source } : {}) })

describe('chargeInstant', () => {
  it('reads a reported instant as exact', () => {
    expect(chargeInstant(at('2026-08-03T20:32:00.000Z', 'reported'))).toEqual({ ms: Date.parse('2026-08-03T20:32:00.000Z'), exact: true })
  })

  it('marks an arrival instant as not exact', () => {
    expect(chargeInstant(at('2026-08-03T20:32:00.000Z', 'received')).exact).toBe(false)
  })

  it('refuses a bare date', () => {
    // 'YYYY-MM-DD' is a day label, not an instant. Reading it as midnight would
    // make every two captures of the same day look like the same second.
    expect(chargeInstant({ occurredAt: '2026-08-03' })).toBeNull()
  })

  it('refuses a row with no time at all', () => {
    expect(chargeInstant({ date: '2026-08-03' })).toBeNull()
    expect(chargeInstant(null)).toBeNull()
  })
})

describe('sameChargeByTime', () => {
  it('says unknown when either side has no time', () => {
    // A card statement never carries one, so this is the normal answer there.
    expect(sameChargeByTime(at('2026-08-03T20:32:00Z', 'reported'), { date: '2026-08-03' })).toBe('unknown')
  })

  it('two reported instants seconds apart are the same charge', () => {
    expect(sameChargeByTime(
      at('2026-08-03T20:32:00Z', 'reported'),
      at('2026-08-03T20:32:12Z', 'reported')
    )).toBe('same')
  })

  it('two reported instants three minutes apart are TWO charges', () => {
    // A bank reports the real instant, so a genuine gap means genuinely two
    // authorizations. Widening this to the approximate margin would merge them.
    expect(sameChargeByTime(
      at('2026-08-03T20:32:00Z', 'reported'),
      at('2026-08-03T20:35:00Z', 'reported')
    )).toBe('different')
  })

  it('an arrival instant gets the wider margin, for the forwarded email lag', () => {
    expect(sameChargeByTime(
      at('2026-08-03T20:32:00Z', 'reported'),
      at('2026-08-03T20:35:00Z', 'received')
    )).toBe('same')
  })

  it('beyond the wide margin they are two charges even when approximate', () => {
    expect(sameChargeByTime(
      at('2026-08-03T20:32:00Z', 'received'),
      at('2026-08-03T20:50:00Z', 'received')
    )).toBe('different')
  })

  it('the same charge across the UTC midnight boundary still matches', () => {
    // Guatemala is UTC-6, so a 7pm purchase lands on the next UTC day. The two
    // captures can end up with different date labels for one charge; comparing
    // instants is what makes that a non-issue.
    const a = at('2026-08-04T01:00:10Z', 'reported') // 2026-08-03 19:00 local
    const b = at('2026-08-04T01:00:40Z', 'reported')
    expect(sameChargeByTime(a, b)).toBe('same')
  })

  it('is symmetric', () => {
    const a = at('2026-08-03T20:32:00Z', 'reported')
    const b = at('2026-08-03T20:35:00Z', 'received')
    expect(sameChargeByTime(a, b)).toBe(sameChargeByTime(b, a))
  })
})

describe('resolveOccurredAt', () => {
  it('prefers the reported instant over the arrival one', () => {
    expect(resolveOccurredAt({
      reported: '2026-08-03T20:32:00Z',
      received: '2026-08-03T20:40:00Z',
    })).toEqual({ occurredAt: '2026-08-03T20:32:00.000Z', timeSource: 'reported' })
  })

  it('falls back to arrival when nothing was reported', () => {
    expect(resolveOccurredAt({ received: new Date('2026-08-03T20:40:00Z') }))
      .toEqual({ occurredAt: '2026-08-03T20:40:00.000Z', timeSource: 'received' })
  })

  it('skips a reported value that is only a date', () => {
    // The Shortcut sending just a day must not shadow a usable arrival time.
    expect(resolveOccurredAt({ reported: '2026-08-03', received: '2026-08-03T20:40:00Z' }))
      .toEqual({ occurredAt: '2026-08-03T20:40:00.000Z', timeSource: 'received' })
  })

  it('returns null when there is no usable time anywhere', () => {
    expect(resolveOccurredAt({ reported: '2026-08-03', received: '2026-08-03' })).toBeNull()
    expect(resolveOccurredAt({})).toBeNull()
    expect(resolveOccurredAt()).toBeNull()
  })

  it('ignores an unparseable value instead of throwing', () => {
    expect(resolveOccurredAt({ reported: 'ayer a las 20:32', received: '2026-08-03T20:40:00Z' }))
      .toEqual({ occurredAt: '2026-08-03T20:40:00.000Z', timeSource: 'received' })
  })
})

describe('zoneOffsetFromDateHeader', () => {
  it('lee un desfase numérico', () => {
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 -0600')).toBe(-360)
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 +0530')).toBe(330)
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 +0000')).toBe(0)
  })

  it('tolera el nombre de zona entre paréntesis que agregan algunos clientes', () => {
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 -0600 (CST)')).toBe(-360)
  })

  it('acepta las zonas cero de RFC 5322', () => {
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 GMT')).toBe(0)
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 UT')).toBe(0)
  })

  it('NO adivina una zona nombrada', () => {
    // "EST" es -0500 en invierno y no existe en verano. Adivinarla es
    // exactamente el supuesto que este módulo evita.
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 EST')).toBeNull()
    expect(zoneOffsetFromDateHeader('')).toBeNull()
    expect(zoneOffsetFromDateHeader(null)).toBeNull()
  })

  it('rechaza un desfase imposible en vez de recortarlo', () => {
    expect(zoneOffsetFromDateHeader('Mon, 3 Aug 2026 14:35:00 +9900')).toBeNull()
  })
})

describe('instantFromLocalTime', () => {
  it('aplica el desfase que trae el propio mensaje', () => {
    // Compra 14:32 en Guatemala (UTC-6) = 20:32Z. Leerla como UTC daría 14:32Z,
    // seis horas corridas del instante que manda el atajo.
    expect(instantFromLocalTime({
      date: '2026-08-03', time: '14:32:00', offsetMinutes: -360,
      near: new Date('2026-08-03T20:35:00Z'),
    })).toBe('2026-08-03T20:32:00.000Z')
  })

  it('funciona igual al otro lado de UTC y con desfases de media hora', () => {
    expect(instantFromLocalTime({ date: '2026-08-03', time: '14:32:00', offsetMinutes: 120 }))
      .toBe('2026-08-03T12:32:00.000Z')
    expect(instantFromLocalTime({ date: '2026-08-03', time: '14:32:00', offsetMinutes: 330 }))
      .toBe('2026-08-03T09:02:00.000Z')
  })

  it('cruza la medianoche sin problema', () => {
    // 23:50 en UTC-6 = 05:50Z del día siguiente.
    expect(instantFromLocalTime({ date: '2026-08-03', time: '23:50:00', offsetMinutes: -360 }))
      .toBe('2026-08-04T05:50:00.000Z')
  })

  it('se rinde cuando la hora impresa no describe a este mensaje', () => {
    expect(instantFromLocalTime({
      date: '2026-08-03', time: '14:32:00', offsetMinutes: -360,
      near: new Date('2026-08-06T20:35:00Z'),
    })).toBeNull()
  })

  it('sin desfase no inventa uno', () => {
    // Es el caso que devuelve el control al reloj de llegada.
    expect(instantFromLocalTime({ date: '2026-08-03', time: '14:32:00' })).toBeNull()
    expect(instantFromLocalTime({ date: '2026-08-03', offsetMinutes: -360 })).toBeNull()
    expect(instantFromLocalTime({ time: '14:32:00', offsetMinutes: -360 })).toBeNull()
    expect(instantFromLocalTime()).toBeNull()
  })
})
