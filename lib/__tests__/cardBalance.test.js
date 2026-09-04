import { cardBalanceSummary } from '../cardBalance'
import { parseCardStatement } from '../parsers/guateCardStatements'

describe('cardBalanceSummary', () => {
  it('separa las dos monedas y NUNCA las suma', () => {
    const s = cardBalanceSummary({ closingBalance: { GTQ: 2431.18, USD: 315.4 } })
    expect(s.ok).toBe(true)
    expect(s.lines.map((l) => l.currency)).toEqual(['GTQ', 'USD'])
    expect(s.lines.map((l) => l.text)).toEqual(['Q2,431.18', '$315.40'])
    // El invariante: no existe ninguna cifra combinada que alguien pueda
    // renderizar por accidente. Sumar necesita una tasa, y una tasa faltante
    // devuelve el monto crudo en silencio.
    expect(s).not.toHaveProperty('total')
  })

  it('la moneda local va primero, sin importar el orden de las llaves', () => {
    const s = cardBalanceSummary({ closingBalance: { USD: 10, GTQ: 20 } })
    expect(s.lines.map((l) => l.currency)).toEqual(['GTQ', 'USD'])
  })

  it('un saldo en CERO es un hecho y se muestra: la tarjeta esta pagada', () => {
    const s = cardBalanceSummary({ closingBalance: { GTQ: 500, USD: 0 } })
    expect(s.ok).toBe(true)
    expect(s.lines).toHaveLength(2)
    expect(s.lines[1].text).toBe('$0.00')
    expect(s.owes).toBe(true)
  })

  it('todo en cero se lee como "no debes nada", no como "no se pudo leer"', () => {
    const s = cardBalanceSummary({ closingBalance: { GTQ: 0, USD: 0 } })
    expect(s.ok).toBe(true)
    expect(s.owes).toBe(false)
  })

  // El caso que motiva el modulo: sin saldo legible NO se inventa un cero, que
  // afirmaria que no debes nada.
  it('sin saldo legible rehusa en vez de devolver cero', () => {
    for (const cb of [null, undefined, {}, { GTQ: null, USD: undefined }, { GTQ: NaN }, 'Q500']) {
      const s = cardBalanceSummary({ closingBalance: cb })
      expect(s.ok).toBe(false)
      expect(s.lines).toEqual([])
      expect(s.owes).toBe(false)
    }
  })

  it('sin estado devuelve la forma vacia, no revienta', () => {
    expect(cardBalanceSummary(null).ok).toBe(false)
    expect(cardBalanceSummary(undefined).lines).toEqual([])
  })

  it('acarrea la fecha de corte y la etiqueta de la tarjeta', () => {
    const s = cardBalanceSummary({
      closingBalance: { GTQ: 100 },
      cutDate: '2026-08-09',
      bankLabel: 'G&T Continental',
      cardLast4: '9876',
    })
    expect(s.cutDate).toBe('2026-08-09')
    expect(s.cardLabel).toBe('G&T Continental ·9876')
  })

  it('un saldo negativo (a favor) se muestra por su magnitud', () => {
    // Un estado puede cerrar a favor tras una devolucion grande. Se muestra la
    // magnitud; el signo no se pierde en silencio porque `owes` lo distingue de
    // un cero.
    const s = cardBalanceSummary({ closingBalance: { GTQ: -250 } })
    expect(s.lines[0].text).toBe('Q250.00')
  })
})

// El modulo tiene que funcionar sobre lo que los parsers de verdad emiten, no
// sobre un objeto hecho a mano: verificar una copia de la forma es el atajo que
// deja pasar un cambio del parser.
describe('sobre la salida REAL de los parsers', () => {
  const GYT = [
    '  Banco G&T Continental                RESUMEN DE ESTADO DE CUENTA',
    '                                    FECHA DE CORTE                             09-AUG-2026',
    '                                    FECHA MÁXIMA DE PAGO                       04-SEP-2026',
    '                  SALDO ANTERIOR                             510.35            0.00',
    '                  SALDO TOTAL                             3,953.98              0.00',
    ' 5183-22XX-XXXX-9876   FULANO DE TAL',
    '      19-07-2026            20-07-2026   PARQUEO CENTRO                Q     20.00',
    '                                            Sub - total Quetzales     Q      20.00      Q 0.00',
    'www.gtc.com.gt      1718',
  ].join('\n')

  it('lee el saldo de un estado de G&T de punta a punta', () => {
    const s = cardBalanceSummary(parseCardStatement(GYT))
    expect(s.ok).toBe(true)
    expect(s.lines.map((l) => l.text)).toEqual(['Q3,953.98', '$0.00'])
    expect(s.cutDate).toBe('2026-08-09')
    expect(s.cardLabel).toContain('9876')
  })
})
