// FASE KO. El rotulo del "dia" en la pantalla de Amigos. La cifra sale de
// change1d, que para una accion es la ultima sesion CERRADA: un sabado es el
// viernes. Decirle "hoy" comparaba a quien tiene acciones (congelado) contra
// quien tiene cripto (que si se movio) bajo la misma palabra.
import { dayLabel, sessionDayLabel } from '@/components/friends/friendsUi'

const TODAY = '2026-08-24'

describe('dayLabel', () => {
  it('una sesion ANTERIOR a hoy deja de llamarse "hoy"', () => {
    const d = dayLabel('2026-08-21', 'es', TODAY)
    expect(d.stale).toBe(true)
    expect(d.text).toBe('cierre')
    expect(d.date).toBe('2026-08-21')
  })

  it('la sesion de hoy si es hoy', () => {
    const d = dayLabel(TODAY, 'es', TODAY)
    expect(d.stale).toBe(false)
    expect(d.text).toBe('hoy')
  })

  // Cripto: ventana rodante de 24h, nunca congelada, no publica fecha.
  it('sin fecha se asume fresco (cripto, o un cliente viejo)', () => {
    expect(dayLabel(null, 'es', TODAY).stale).toBe(false)
    expect(dayLabel(undefined, 'es', TODAY).stale).toBe(false)
    expect(dayLabel('', 'es', TODAY).stale).toBe(false)
  })

  // Zonas horarias: quien publica desde una bolsa adelantada puede traer una
  // fecha POSTERIOR a la de quien mira. No es rancio.
  it('una sesion futura tampoco es rancia', () => {
    expect(dayLabel('2026-08-25', 'es', TODAY).stale).toBe(false)
  })

  it('traduce', () => {
    expect(dayLabel('2026-08-21', 'en', TODAY).text).toBe('close')
    expect(dayLabel(TODAY, 'en', TODAY).text).toBe('today')
  })
})

describe('sessionDayLabel', () => {
  // Se fecha a MEDIODIA UTC a proposito: new Date('2026-08-21') es medianoche
  // UTC y al oeste de UTC imprime el dia ANTERIOR.
  it('imprime el dia correcto sin correrse por la zona horaria', () => {
    expect(sessionDayLabel('2026-08-21', 'en')).toMatch(/21/)
    expect(sessionDayLabel('2026-01-01', 'en')).toMatch(/1/)
    expect(sessionDayLabel('2026-01-01', 'en')).not.toMatch(/31/)
  })

  it('vacio ante datos ilegibles, nunca revienta', () => {
    expect(sessionDayLabel(null, 'es')).toBe('')
    expect(sessionDayLabel('', 'es')).toBe('')
    expect(sessionDayLabel('no-es-fecha', 'es')).toBe('')
  })
})
