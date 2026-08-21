// FASE JX. La fecha CALENDARIO de la última sesión, en la zona del EXCHANGE.
//
// De acá sale la respuesta a "¿bajo qué horario corre 'mayores movimientos
// hoy'?": no hay un horario propio inventado, se usa la fecha que trae la
// propia cotización. Eso cubre fines de semana, feriados, medias sesiones y
// bolsas extranjeras sin una sola hora escrita a mano.
import { sessionDateOf } from '../marketPrices'

// Timestamps de Yahoo: segundos UTC. Con interval=1d, cada entrada es una sesión.
const sec = (iso) => Math.floor(Date.parse(iso) / 1000)

describe('sessionDateOf', () => {
  it('usa la ULTIMA barra, que es la sesion mas reciente', () => {
    const stamps = [sec('2026-08-19T13:30:00Z'), sec('2026-08-20T13:30:00Z'), sec('2026-08-21T13:30:00Z')]
    expect(sessionDateOf(stamps, { gmtoffset: -14400 })).toBe('2026-08-21')
  })

  it('la zona del exchange manda: Tokio cierra en OTRO dia calendario', () => {
    // Cierre de Tokio del 21 ago: 06:00 UTC. En UTC eso ya es el 21, pero el
    // caso interesante es el borde: 22:00 UTC del 20 es el 21 en Tokio (+9h).
    const tokyoClose = sec('2026-08-20T22:00:00Z')
    expect(sessionDateOf([tokyoClose], { gmtoffset: 32400 })).toBe('2026-08-21')
    // La misma marca sin offset (o sea leida en UTC) daria el dia ANTERIOR:
    // esa es exactamente la clase de error que el offset evita.
    expect(sessionDateOf([tokyoClose], {})).toBe('2026-08-20')
  })

  it('un cierre de Nueva York cae en su propio dia, no en el siguiente UTC', () => {
    // 16:00 ET del 21 ago = 20:00 UTC. Sin offset seria igual, pero un cierre
    // que cruza medianoche UTC no: 20:00 ET = 00:00 UTC del dia siguiente.
    const lateNy = sec('2026-08-22T00:00:00Z')
    expect(sessionDateOf([lateNy], { gmtoffset: -14400 })).toBe('2026-08-21')
  })

  it('sin timestamps cae a regularMarketTime', () => {
    expect(sessionDateOf([], { regularMarketTime: sec('2026-08-21T20:00:00Z'), gmtoffset: -14400 })).toBe('2026-08-21')
    expect(sessionDateOf(null, { regularMarketTime: sec('2026-08-21T20:00:00Z'), gmtoffset: 0 })).toBe('2026-08-21')
  })

  // Nunca puede tumbar una cotizacion: perder el precio por no poder fecharlo
  // seria peor que no saber la fecha.
  it('devuelve null ante datos ilegibles, nunca lanza', () => {
    expect(sessionDateOf([], {})).toBeNull()
    expect(sessionDateOf(null, null)).toBeNull()
    expect(sessionDateOf(['x'], {})).toBeNull()
    expect(sessionDateOf([0], {})).toBeNull()
    expect(sessionDateOf([-5], {})).toBeNull()
    expect(sessionDateOf('nope', undefined)).toBeNull()
  })

  it('ignora entradas no numericas y se queda con la ultima valida', () => {
    const stamps = [sec('2026-08-20T13:30:00Z'), null, sec('2026-08-21T13:30:00Z'), undefined]
    expect(sessionDateOf(stamps, { gmtoffset: 0 })).toBe('2026-08-21')
  })

  it('un gmtoffset ilegible degrada a UTC en vez de romper', () => {
    const ts = sec('2026-08-21T13:30:00Z')
    expect(sessionDateOf([ts], { gmtoffset: 'nope' })).toBe('2026-08-21')
    expect(sessionDateOf([ts], { gmtoffset: null })).toBe('2026-08-21')
  })
})
