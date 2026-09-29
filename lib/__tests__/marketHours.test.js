import { nyDateParts, nySessionBounds, currentOrLastSession } from '../marketHours'

// Ancla a las 16:00 UTC para evitar ambigüedad de qué día de Nueva York
// representa (16:00 UTC cae DENTRO de la sesión regular tanto en EST como
// en EDT: 11am o 12pm ET, ninguno cruza medianoche NY). Camina en UTC puro
// sumando milisegundos, donde no hay horario de verano que pueda corromper
// el día — nunca se hace aritmética de fecha sensible a NY acá, por la
// misma razón que `marketHours.js` no la hace para caminar hacia atrás.
function nextWeekdayOnOrAfter(year, month, day, targetDow) {
  let d = new Date(Date.UTC(year, month - 1, day, 16, 0, 0))
  while (d.getUTCDay() !== targetDow) d = new Date(d.getTime() + 86400000)
  return d
}

describe('nySessionBounds', () => {
  it('enero: horario estándar, ET = UTC-5', () => {
    // Mediodía ET del 15 de enero de 2026 = 17:00 UTC en EST.
    const ts = Date.UTC(2026, 0, 15, 17, 0, 0)
    expect(nySessionBounds(ts)).toEqual({
      open: Date.UTC(2026, 0, 15, 14, 30, 0),
      close: Date.UTC(2026, 0, 15, 21, 0, 0),
    })
  })

  it('julio: horario de verano, ET = UTC-4', () => {
    // Mediodía ET del 15 de julio de 2026 = 16:00 UTC en EDT.
    const ts = Date.UTC(2026, 6, 15, 16, 0, 0)
    expect(nySessionBounds(ts)).toEqual({
      open: Date.UTC(2026, 6, 15, 13, 30, 0),
      close: Date.UTC(2026, 6, 15, 20, 0, 0),
    })
  })

  it('resuelve por el día CALENDARIO de Nueva York, no el de UTC', () => {
    // 23:50 ET del 14 de julio (madrugada del 15 en UTC) sigue siendo la
    // sesión del 14, no la del 15.
    const lateNyNight = Date.UTC(2026, 6, 15, 3, 50, 0) // 23:50 ET del 14-jul
    expect(nyDateParts(lateNyNight)).toEqual({ year: 2026, month: 7, day: 14 })
    expect(nySessionBounds(lateNyNight)).toEqual({
      open: Date.UTC(2026, 6, 14, 13, 30, 0),
      close: Date.UTC(2026, 6, 14, 20, 0, 0),
    })
  })
})

describe('currentOrLastSession', () => {
  // Un lunes a viernes real de agosto de 2026, encontrado en tiempo de
  // ejecución (nunca memorizado a mano: la lección de este mismo archivo
  // sobre construir fixtures de calendario a ojo).
  const tue = nextWeekdayOnOrAfter(2026, 8, 1, 2)
  const wed = new Date(tue.getTime() + 86400000)
  const sat = nextWeekdayOnOrAfter(2026, 8, 1, 6)
  const sun = new Date(sat.getTime() + 86400000)
  const mon = new Date(sun.getTime() + 86400000)
  const fri = new Date(sat.getTime() - 86400000)

  it('a mitad de sesión de un día hábil, es la sesión de ese mismo día', () => {
    const own = nySessionBounds(tue.getTime())
    const mid = own.open + 60 * 60 * 1000
    const { open, close } = currentOrLastSession(mid)
    expect(open).toBe(own.open)
    expect(close).toBe(own.close)
    expect(mid).toBeGreaterThanOrEqual(open)
    expect(mid).toBeLessThanOrEqual(close)
  })

  it('después del cierre de un día hábil, sigue siendo la sesión de HOY', () => {
    const own = nySessionBounds(tue.getTime())
    const afterClose = own.close + 60 * 60 * 1000
    const { open, close } = currentOrLastSession(afterClose)
    expect(open).toBe(own.open)
    expect(close).toBe(own.close)
  })

  it('antes de que abra un día hábil, cae al día hábil anterior', () => {
    const wedOwn = nySessionBounds(wed.getTime())
    const tueOwn = nySessionBounds(tue.getTime())
    const beforeOpen = wedOwn.open - 60 * 60 * 1000
    const { open, close } = currentOrLastSession(beforeOpen)
    expect(open).toBe(tueOwn.open)
    expect(close).toBe(tueOwn.close)
  })

  it('sábado cae a la sesión del viernes', () => {
    const friOwn = nySessionBounds(fri.getTime())
    const { open, close } = currentOrLastSession(sat.getTime())
    expect(open).toBe(friOwn.open)
    expect(close).toBe(friOwn.close)
  })

  it('domingo también cae al viernes', () => {
    const friOwn = nySessionBounds(fri.getTime())
    const { open, close } = currentOrLastSession(sun.getTime())
    expect(open).toBe(friOwn.open)
    expect(close).toBe(friOwn.close)
  })

  it('lunes antes de que abra camina atrás por todo el fin de semana hasta el viernes', () => {
    const monOwn = nySessionBounds(mon.getTime())
    const friOwn = nySessionBounds(fri.getTime())
    const beforeOpen = monOwn.open - 60 * 60 * 1000
    const { open, close } = currentOrLastSession(beforeOpen)
    expect(open).toBe(friOwn.open)
    expect(close).toBe(friOwn.close)
  })

  it('lunes en sesión es la sesión del lunes, no la del viernes', () => {
    const monOwn = nySessionBounds(mon.getTime())
    const mid = monOwn.open + 60 * 60 * 1000
    const { open, close } = currentOrLastSession(mid)
    expect(open).toBe(monOwn.open)
    expect(close).toBe(monOwn.close)
  })

  it('siempre devuelve un rango con apertura antes que cierre', () => {
    for (const ts of [tue.getTime(), sat.getTime(), sun.getTime(), mon.getTime()]) {
      const { open, close } = currentOrLastSession(ts)
      expect(open).toBeLessThan(close)
    }
  })
})
