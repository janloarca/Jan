import { detectNumberConvention, amountTokens, monthFromName } from '@/lib/parsers/latamNumbers'
import { parseAmount, detectCurrencyMarker, resolveCurrency } from '@/lib/numberParse'
import { parseBankAlert } from '@/lib/parsers/bankAlertParser'

// La mitad de LatAm escribe "1.234,56" y la otra "1,234.56". Ninguna es rara y
// ninguna puede leerse con el tokenizador de la otra.

describe('el fallo de mil veces que motivó este módulo', () => {
  const LINEA = '15/03  SUPERMERCADO JUMBO          1.234,56'

  it('el tokenizador de punto entrega 1.23 sobre una línea con coma decimal', () => {
    // Regresión NEGATIVA explícita: esto es lo que hacía el único tokenizador
    // que existía. No falla, no avisa, devuelve un monto con forma perfectamente
    // válida y mil veces menor. Se fija acá para que quede claro por qué la
    // convención tiene que elegirse y no asumirse.
    const malo = amountTokens(LINEA, 'dot')
    expect(malo).toHaveLength(1)
    expect(malo[0].value).toBe(1.23)
  })

  it('con la convención correcta entrega el monto real', () => {
    const bueno = amountTokens(LINEA, 'comma')
    expect(bueno).toHaveLength(1)
    expect(bueno[0].value).toBe(1234.56)
  })
})

describe('detectNumberConvention', () => {
  it('un solo número agrupado ya prueba la convención', () => {
    expect(detectNumberConvention('TOTAL 1.234,56')).toBe('comma')
    expect(detectNumberConvention('TOTAL 1,234.56')).toBe('dot')
  })

  it('sin agrupamiento decide por mayoría clara, no por un solo caso', () => {
    expect(detectNumberConvention('17,50\n8,90\n120,00')).toBe('comma')
    expect(detectNumberConvention('17.50\n8.90\n120.00')).toBe('dot')
  })

  it('devuelve null cuando el documento no dice lo bastante', () => {
    // Dos señales empatadas: cualquier respuesta sería un volado, y un volado
    // acá multiplica o divide por mil TODOS los montos del archivo.
    expect(detectNumberConvention('17,50 y 8.90')).toBeNull()
    expect(detectNumberConvention('ESTADO DE CUENTA')).toBeNull()
    expect(detectNumberConvention('')).toBeNull()
  })

  it('un número agrupado le gana a varios sueltos de la otra forma', () => {
    // "1.234,56" solo se puede leer de una manera; "17.50" tiene dos lecturas.
    expect(detectNumberConvention('17.50 8.90 120.00 TOTAL 9.876.543,21')).toBe('comma')
  })

  it('una fecha no se cuenta como evidencia de nada', () => {
    expect(detectNumberConvention('15/03/2026 20/04/2026 11/05/2026')).toBeNull()
  })
})

describe('amountTokens', () => {
  it('conserva la columna final, que es lo que identifica débito de crédito', () => {
    // Los números van alineados a la derecha, así que el FINAL es la columna.
    const [a, b] = amountTokens('CARGO                 100.00      250.00', 'dot')
    expect(a.end).toBeLessThan(b.end)
    expect([a.value, b.value]).toEqual([100, 250])
  })

  it('lee el menos final que usa BAC', () => {
    expect(amountTokens('PAGO RECIBIDO   1,185.00-', 'dot')[0]).toMatchObject({ value: 1185, negative: true })
    expect(amountTokens('PAGO RECIBIDO   1.185,00-', 'comma')[0]).toMatchObject({ value: 1185, negative: true })
  })

  it('no medio-matchea un número sin agrupar', () => {
    // "1234.56" no puede entregarse como "234.56".
    expect(amountTokens('COMPRA 1234.56', 'dot')[0].value).toBe(1234.56)
    expect(amountTokens('COMPRA 1234,56', 'comma')[0].value).toBe(1234.56)
  })

  it('la forma pelada exige espacio antes, o dispara dentro de una dirección', () => {
    // "2C.20-83" es una dirección guatemalteca real que hacía descartar la fila
    // entera por traer demasiados montos.
    expect(amountTokens('AVE 2C.20-83', 'dot')).toHaveLength(0)
    expect(amountTokens('TOTAL .06', 'dot')[0].value).toBe(0.06)
  })

  it('sin convención se comporta como siempre lo hizo', () => {
    expect(amountTokens('COMPRA 1,234.56')[0].value).toBe(1234.56)
  })

  it('es reentrante: la misma línea dos veces da lo mismo', () => {
    // El regex es global y vive a nivel de módulo, así que un lastIndex que no
    // se reinicie haría que la segunda llamada devolviera menos montos.
    const line = 'COMPRA 100.00 250.00'
    expect(amountTokens(line, 'dot')).toEqual(amountTokens(line, 'dot'))
  })
})

describe('meses de la región', () => {
  it('lee las abreviaturas en español, portugués e inglés', () => {
    expect(monthFromName('DIC')).toBe(12)
    expect(monthFromName('DEZ')).toBe(12) // Brasil
    expect(monthFromName('DEC')).toBe(12)
    expect(monthFromName('FEV')).toBe(2)
    expect(monthFromName('SET')).toBe(9)
    expect(monthFromName('OUT')).toBe(10)
    expect(monthFromName('MAI')).toBe(5)
  })

  it('lee nombres completos, con y sin cedilla', () => {
    expect(monthFromName('septiembre')).toBe(9)
    expect(monthFromName('setiembre')).toBe(9)
    expect(monthFromName('Março')).toBe(3)
    expect(monthFromName('marco')).toBe(3)
  })

  it('un mes que no existe es null, nunca un número inventado', () => {
    expect(monthFromName('XXX')).toBeNull()
    expect(monthFromName('')).toBeNull()
    expect(monthFromName(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('monedas de la región', () => {
  it('lee los símbolos de más de un carácter', () => {
    // Sin esto "R$ 1.234,56" perdía el $, quedaba "R1.234,56" y salía 0 — y 0 se
    // rechaza como INVALID_AMOUNT, así que el cobro fallaba entero.
    expect(parseAmount('R$ 1.234,56')).toBe(1234.56)
    expect(parseAmount('S/ 350.00')).toBe(350)
    expect(parseAmount('Gs 1.500.000')).toBe(1500000)
    expect(detectCurrencyMarker('R$ 1.234,56')).toEqual({ code: 'BRL', ambiguous: false })
  })

  it('un código ISO de la región ya no cae al default', () => {
    expect(detectCurrencyMarker('1.234,56 COP')).toEqual({ code: 'COP', ambiguous: false })
    expect(detectCurrencyMarker('45.000 CLP')).toEqual({ code: 'CLP', ambiguous: false })
  })

  it('un "$" no le gana a la moneda del usuario si esa moneda usa "$"', () => {
    // El corazón del asunto: en México, Colombia, Chile, Argentina y Uruguay el
    // peso local se escribe "$". Resolverlo a USD multiplica el cobro por el
    // tipo de cambio, en silencio.
    expect(resolveCurrency('MXN', detectCurrencyMarker('$1,234.00'))).toBe('MXN')
    expect(resolveCurrency('COP', detectCurrencyMarker('$45.000'))).toBe('COP')
    // Para una tarjeta guatemalteca sigue siendo dólar: lo local viene en Q.
    expect(resolveCurrency('GTQ', detectCurrencyMarker('$100.00'))).toBe('USD')
  })
})

describe('alertas de banco fuera de Guatemala', () => {
  const alerta = (text, defaultCurrency) => parseBankAlert({ text, defaultCurrency })

  it('un "$" se lee en la moneda del usuario, no en dólares', () => {
    expect(alerta('Comercio: OXXO\nMonto $1,234.00\nFecha: 2026-08-02', 'MXN'))
      .toMatchObject({ amount: 1234, currency: 'MXN' })
    // Mismo texto, usuario guatemalteco: ahí sí es dólar.
    expect(alerta('Comercio: OXXO\nMonto $1,234.00\nFecha: 2026-08-02', 'GTQ'))
      .toMatchObject({ amount: 1234, currency: 'USD' })
  })

  it('un código ISO explícito le gana a la moneda del usuario', () => {
    expect(alerta('Comercio: AMAZON\nMonto USD 49.99\nFecha: 2026-08-02', 'MXN'))
      .toMatchObject({ amount: 49.99, currency: 'USD' })
  })

  it('lee un monto brasileño con coma decimal y su símbolo', () => {
    expect(alerta('Compra em PADARIA\nValor R$ 1.234,56\nData: 2026-08-02', 'BRL'))
      .toMatchObject({ amount: 1234.56, currency: 'BRL' })
  })

  it('un número sin ninguna marca de moneda NO es una alerta', () => {
    // Deliberado y vale conservarlo: exigir una marca de moneda es lo que
    // impide que una promoción, un estado de cuenta o una respuesta automática
    // reenviada por error se conviertan en un gasto. La moneda del usuario
    // resuelve un símbolo ambiguo, no la ausencia total de uno.
    expect(alerta('Comercio: TIENDA\nMonto 350\nFecha: 2026-08-02', 'PEN')).toBeNull()
  })

  it('con símbolo local sí entra, en la moneda del usuario', () => {
    expect(alerta('Comercio: TIENDA\nMonto S/ 350.00\nFecha: 2026-08-02', 'PEN'))
      .toMatchObject({ amount: 350, currency: 'PEN' })
  })
})
