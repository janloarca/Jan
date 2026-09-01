import { todayLocalISO } from '@/lib/localDate'

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
