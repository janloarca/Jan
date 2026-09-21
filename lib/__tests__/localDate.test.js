import { todayLocalISO, chargeDayISO, payerOffsetFromTimestamp } from '@/lib/localDate'

// ⛔ FASE MJ. La suite corre fijada en America/Guatemala (UTC-6, sin horario de
// verano) desde FASE LF, justo para que un supuesto de hora local falle de forma
// OBSERVABLE. Estos tests dependen de eso: en UTC el bug es invisible porque
// las dos lecturas coinciden.
describe('todayLocalISO: el día que el usuario vivió', () => {
  const realTZ = Intl.DateTimeFormat().resolvedOptions().timeZone

  it('meta-test: la suite NO corre en UTC, o estos tests no prueban nada', () => {
    expect(realTZ).not.toBe('UTC')
  })

  // El caso que corrompe un mes entero: 7pm del 31 de agosto en Guatemala ya es
  // el 1 de septiembre en UTC.
  it('a las 7pm del último día del mes NO salta al mes siguiente', () => {
    const instante = new Date('2026-09-01T01:00:00Z')
    expect(instante.toISOString().split('T')[0]).toBe('2026-09-01') // lo que hacía
    expect(todayLocalISO(instante)).toBe('2026-08-31')              // lo que vivió
  })

  it('rota a medianoche LOCAL, no a las 6 de la tarde', () => {
    // 23:59 local del 30 de agosto (= 05:59Z del 31).
    expect(todayLocalISO(new Date('2026-08-31T05:59:00Z'))).toBe('2026-08-30')
    // 00:01 local del 31 de agosto (= 06:01Z del 31).
    expect(todayLocalISO(new Date('2026-08-31T06:01:00Z'))).toBe('2026-08-31')
  })

  it('también cruza el año', () => {
    expect(todayLocalISO(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-31')
  })

  it('de mañana, cuando UTC y local coinciden, da lo mismo que antes', () => {
    const instante = new Date('2026-08-30T15:00:00Z') // 9am en Guatemala
    expect(todayLocalISO(instante)).toBe('2026-08-30')
    expect(todayLocalISO(instante)).toBe(instante.toISOString().split('T')[0])
  })

  it('ceros a la izquierda en mes y día', () => {
    expect(todayLocalISO(new Date('2026-03-05T18:00:00Z'))).toBe('2026-03-05')
  })

  it('sin argumento usa el reloj', () => {
    const now = new Date()
    const esperado = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(todayLocalISO()).toBe(esperado)
  })
})

// ⛔ FASE OT. La mitad de ESCRITURA del bug de la fecha que FASE OP dejó medido
// y sin tocar, porque mueve dinero entre meses.
//
// A diferencia de los tests de arriba, estos NO dependen de la zona del runner:
// el desfase es explícito. Eso es a propósito y es la diferencia entre las dos
// funciones — `todayLocalISO` contesta con el reloj de QUIEN CORRE (el
// navegador del usuario) y `chargeDayISO` con el desfase que viaja EN EL DATO,
// porque quien la llama es una función serverless en UTC que no tiene forma de
// saber dónde estaba el pagador.
describe('payerOffsetFromTimestamp: qué declara la marca de tiempo', () => {
  it('lee el desfase con y sin dos puntos', () => {
    expect(payerOffsetFromTimestamp('2026-08-31T20:05:00-06:00')).toBe(-360)
    expect(payerOffsetFromTimestamp('2026-08-31T20:05:00-0600')).toBe(-360)
    expect(payerOffsetFromTimestamp('2026-08-31T20:05:00+05:30')).toBe(330)
  })

  // ⛔ El caso que define la función. Un Zulu es el instante YA normalizado, o
  // sea el que perdió la zona del pagador; contestar cero afirmaría que vive en
  // Greenwich, que es justo el error que esto existe para no cometer.
  it('un Zulu NO declara dónde estaba el pagador', () => {
    expect(payerOffsetFromTimestamp('2026-09-01T02:05:00Z')).toBeNull()
    expect(payerOffsetFromTimestamp('2026-09-01T02:05:00.000Z')).toBeNull()
  })

  it('una fecha pelada no declara nada, y un desfase imposible tampoco', () => {
    expect(payerOffsetFromTimestamp('2026-08-31')).toBeNull()
    expect(payerOffsetFromTimestamp('2026-08-31T20:05:00+99:00')).toBeNull()
    expect(payerOffsetFromTimestamp('')).toBeNull()
    expect(payerOffsetFromTimestamp(null)).toBeNull()
  })
})

describe('chargeDayISO: el día visto desde donde estaba quien pagó', () => {
  // El caso real, y el único que de verdad mueve dinero de mes: 8:05pm del 31
  // de agosto en Guatemala ya es el 1 de septiembre en UTC.
  it('un Zulu con desfase conocido se resuelve al día LOCAL', () => {
    const instante = '2026-09-01T02:05:00Z'
    expect(instante.slice(0, 10)).toBe('2026-09-01')       // lo que hacía
    expect(chargeDayISO(instante, -360)).toBe('2026-08-31') // lo que vivió
  })

  it('un objeto Date se trata como el instante que es', () => {
    expect(chargeDayISO(new Date('2026-09-01T02:05:00Z'), -360)).toBe('2026-08-31')
  })

  // La regresión NEGATIVA: sin desfase no se inventa una zona, se deja el
  // comportamiento de siempre. Es lo que hace que este cambio solo pueda
  // mejorar un caso y nunca empeorar uno que ya estaba bien.
  it('sin desfase conocido devuelve EXACTAMENTE lo de antes', () => {
    const instante = '2026-09-01T02:05:00Z'
    expect(chargeDayISO(instante, null)).toBe('2026-09-01')
    expect(chargeDayISO(instante, undefined)).toBe('2026-09-01')
    expect(chargeDayISO(new Date(instante), null)).toBe('2026-09-01')
  })

  // ⛔ Las tres formas que YA traen su día y que desplazar corrompería.
  it('una fecha pelada NUNCA se desplaza', () => {
    expect(chargeDayISO('2026-08-31', -360)).toBe('2026-08-31')
    expect(chargeDayISO('2026-08-31', 330)).toBe('2026-08-31')
  })

  it('un instante con su zona escrita ya trae su día local', () => {
    expect(chargeDayISO('2026-08-31T20:05:00-06:00', -360)).toBe('2026-08-31')
    // Y no se re-desplaza aunque el caller declare otra zona: el dato manda.
    expect(chargeDayISO('2026-08-31T20:05:00-06:00', 330)).toBe('2026-08-31')
  })

  it('una hora de pared sin zona es su propio día', () => {
    expect(chargeDayISO('2026-08-31T20:05:00', -360)).toBe('2026-08-31')
  })

  // Al ESTE del meridiano el error va para el otro lado: en Tokio las nueve de
  // la mañana del 1 de septiembre todavía son 31 de agosto en UTC.
  it('también resuelve hacia adelante para un desfase al este', () => {
    expect(chargeDayISO('2026-08-31T00:00:00Z', 540)).toBe('2026-08-31')
    expect(chargeDayISO('2026-08-31T15:05:00Z', 540)).toBe('2026-09-01')
  })

  it('un desfase imposible se ignora en vez de producir una fecha inventada', () => {
    expect(chargeDayISO('2026-09-01T02:05:00Z', 99999)).toBe('2026-09-01')
  })

  it('sigue leyendo lo que parseImportDate lee, no un slice propio', () => {
    expect(chargeDayISO('31/08/2026', -360)).toBe('2026-08-31')
    expect(chargeDayISO(44576, -360)).toBe('2022-01-15')
  })

  it('basura y vacío no producen fecha', () => {
    expect(chargeDayISO('', -360)).toBeUndefined()
    expect(chargeDayISO(null, -360)).toBeUndefined()
    expect(chargeDayISO('no es una fecha', -360)).toBeUndefined()
  })
})
