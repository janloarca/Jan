import { detectCurrency, INSTITUTION_CURRENCY } from '../institutionCurrency'

describe('detectCurrency', () => {
  test('reconoce los bancos guatemaltecos, incluida la sigla de dos letras', () => {
    expect(detectCurrency('Banco Industrial')).toBe('GTQ')
    expect(detectCurrency('BI')).toBe('GTQ')
    expect(detectCurrency('Banco BI')).toBe('GTQ')
    expect(detectCurrency('BAM')).toBe('GTQ')
    expect(detectCurrency('G&T Continental')).toBe('GTQ')
    expect(detectCurrency('Banrural')).toBe('GTQ')
  })

  // REGRESION. `bi` (Banco Industrial) es de dos letras, y con un `includes`
  // pelado aparecia DENTRO de "bancolombia" (banColomBIa), asi que el banco
  // mas grande de Colombia resolvia a quetzales y su propia entrada COP, mas
  // abajo en el mapa, nunca se alcanzaba.
  test('una clave corta no matchea dentro de otra palabra', () => {
    expect(detectCurrency('Bancolombia')).toBe('COP')
    expect(detectCurrency('bancolombia')).toBe('COP')
    expect(detectCurrency('Banco Bice')).toBeNull()
    expect(detectCurrency('Bital')).toBeNull()
  })

  // Una clave larga SI puede matchear dentro de una palabra: si no,
  // "Citibanamex" (el nombre real del banco mexicano) se quedaria sin moneda.
  test('la clave mas especifica gana', () => {
    expect(detectCurrency('Citibanamex')).toBe('MXN')
    expect(detectCurrency('BBVA Colombia')).toBe('COP')
    expect(detectCurrency('Nubank')).toBe('BRL')
  })

  test('sin coincidencia devuelve null en vez de adivinar', () => {
    expect(detectCurrency('')).toBeNull()
    expect(detectCurrency(null)).toBeNull()
    expect(detectCurrency('Banco de Bogota')).toBeNull()
  })

  // El mapa es datos que se editan a mano: toda entrada tiene que ser
  // alcanzable, o es una linea que miente sobre lo que el codigo hace.
  test('toda clave del mapa se resuelve a su propia moneda', () => {
    for (const [key, currency] of Object.entries(INSTITUTION_CURRENCY)) {
      expect([key, detectCurrency(key)]).toEqual([key, currency])
    }
  })
})
