import { fingerprintStatement, describeFingerprint } from '@/lib/parsers/statementFingerprint'

// Un estado de cuenta sintético con forma de los que imprime la mitad de LatAm
// que usa coma decimal. No pretende ser de ningún banco real: lo que se prueba
// es que la HUELLA describe bien lo que ve, no que sepamos leerlo.
const CHILENO = `
BANCO DE CHILE
ESTADO DE CUENTA TARJETA DE CREDITO
Tarjeta terminada en 4821
Fecha de corte: 05/08/2026        Pago minimo: 45.000
LUGAR                                        MONTO
02/07  SUPERMERCADO JUMBO                  1.234,56
04/07  COPEC ESTACION                         28.900
09/07  FARMACIA CRUZ VERDE                    12.450
15/07  RESTAURANT LA PICADA                   38.700
21/07  NETFLIX.COM                             9.900
TOTAL CARGOS                               123.604,56
`.trim()

const MEXICANO = `
BBVA MEXICO
ESTADO DE CUENTA
Tarjeta terminada en 7745
Fecha de corte 05/08/2026     Pago minimo $1,200.00
02/07  OXXO GDL CENTRO                       1,234.56
04/07  UBER TRIP                               189.00
09/07  WALMART SUPERCENTER                   2,410.75
15/07  CFE SERVICIO                            890.00
21/07  SPOTIFY MX                              129.00
TOTAL CARGOS                                4,853.31
`.trim()

describe('huella de un estado que no reconocemos', () => {
  it('reconoce la forma de un estado, no solo la palabra', () => {
    const fp = fingerprintStatement(CHILENO)
    expect(fp.looksLikeStatement).toBe(true)
    expect(fp.dateRows).toBe(5)
    expect(fp.totalLines).toBeGreaterThanOrEqual(1)
  })

  it('lee la convención de números de cada mitad de la región', () => {
    expect(fingerprintStatement(CHILENO).convention).toBe('comma')
    expect(fingerprintStatement(MEXICANO).convention).toBe('dot')
  })

  it('nombra al emisor cuando lo conoce, sin pretender que sabe leerlo', () => {
    expect(fingerprintStatement(CHILENO).issuers).toContain('Banco de Chile')
    expect(fingerprintStatement(MEXICANO).issuers).toContain('BBVA')
  })

  it('saca los últimos cuatro dígitos, que es lo que separa dos tarjetas', () => {
    expect(fingerprintStatement(CHILENO).last4).toBe('4821')
    expect(fingerprintStatement(MEXICANO).last4).toBe('7745')
  })

  it('un documento cualquiera no es un estado de cuenta', () => {
    // Vocabulario sin filas: un contrato de tarjeta habla de estados de cuenta
    // y de pago mínimo, y no tiene un solo movimiento.
    expect(fingerprintStatement('CONTRATO DE TARJETA DE CREDITO\nEl pago minimo se calcula...').looksLikeStatement).toBe(false)
    // Filas sin vocabulario: un itinerario tiene fechas y montos.
    expect(fingerprintStatement('01/07 VUELO 120\n02/07 HOTEL 300\n03/07 TAXI 20\n04/07 CENA 40\n05/07 TREN 60').looksLikeStatement).toBe(false)
    expect(fingerprintStatement('').looksLikeStatement).toBe(false)
    expect(fingerprintStatement(null).looksLikeStatement).toBe(false)
  })
})

describe('el reporte que el usuario puede pegar en un mensaje', () => {
  it('describe la forma del documento', () => {
    const line = describeFingerprint(fingerprintStatement(CHILENO))
    expect(line).toContain('5 fila(s) con fecha')
    expect(line).toContain('1.234,56')
    expect(line).toContain('Banco de Chile')
    expect(line).toContain('••4821')
  })

  it('NO lleva ningún monto ni ningún nombre de comercio', () => {
    // El contenido es de quien recibió el estado. Lo que hace falta para
    // escribir un parser es la forma, y la forma no incluye cuánto gastó.
    const line = describeFingerprint(fingerprintStatement(CHILENO))
    for (const secreto of ['JUMBO', 'CRUZ VERDE', 'NETFLIX', '123.604', '28.900', '38.700']) {
      expect(line).not.toContain(secreto)
    }
  })

  it('dice cuándo no pudo determinar la convención en vez de inventarla', () => {
    const fp = { pages: 1, dateRows: 0, totalLines: 0, convention: null, currencies: [], issuers: [], last4: null }
    expect(describeFingerprint(fp)).toContain('sin determinar')
    expect(describeFingerprint(fp, 'en')).toContain('undetermined')
  })

  it('no revienta sin huella', () => {
    expect(describeFingerprint(null)).toBe('')
  })
})
