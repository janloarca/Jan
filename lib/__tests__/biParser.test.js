import { detectBI, parseBI } from '../parsers/biParser'

describe('detectBI', () => {
  test('detects BI format with débito + crédito', () => {
    expect(detectBI(['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo'])).toBe(true)
  })

  test('detects BI format with debito + credito (no accents)', () => {
    expect(detectBI(['Fecha', 'Concepto', 'Debito', 'Credito', 'Saldo'])).toBe(true)
  })

  test('detects BI format with cargo + abono', () => {
    expect(detectBI(['Fecha', 'Descripción', 'Cargo', 'Abono'])).toBe(false)
  })

  test('rejects non-BI headers', () => {
    expect(detectBI(['Symbol', 'Price', 'Quantity'])).toBe(false)
    expect(detectBI(['Date', 'Amount', 'Category'])).toBe(false)
  })

  test('requires fecha + descripcion', () => {
    expect(detectBI(['Débito', 'Crédito', 'Saldo'])).toBe(false)
  })

  test('handles null/empty headers', () => {
    expect(detectBI([null, '', undefined, 'Fecha', 'Descripción', 'Débito', 'Crédito'])).toBe(true)
    expect(detectBI([])).toBe(false)
  })
})

describe('parseBI', () => {
  const headers = ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']

  test('parses credit as INCOME', () => {
    const rows = [
      ['15/05/2026', 'Pago nomina empresa', '', '15000', '20000'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].type).toBe('INCOME')
    expect(result.transactions[0].amount).toBe(15000)
    expect(result.transactions[0].date).toBe('2026-05-15')
    expect(result.transactions[0].category).toBe('Salario')
  })

  test('parses debit as EXPENSE', () => {
    const rows = [
      ['20/05/2026', 'Supermercado La Torre', '500', '', '19500'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].type).toBe('EXPENSE')
    expect(result.transactions[0].amount).toBe(500)
    expect(result.transactions[0].category).toBe('Alimentación')
  })

  test('captures final balance from last row saldo', () => {
    const rows = [
      ['01/05/2026', 'Deposito', '', '10000', '10000'],
      ['15/05/2026', 'Pago luz EEGSA', '200', '', '9800'],
      ['20/05/2026', 'Uber', '50', '', '9750'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions).toHaveLength(3)
    expect(result.finalBalance).toBe(9750)
  })

  test('skips rows with no date', () => {
    const rows = [
      [null, 'Header row', '', '', ''],
      ['10/05/2026', 'Real transaction', '100', '', '9900'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions).toHaveLength(1)
  })

  test('skips rows with zero amounts', () => {
    const rows = [
      ['10/05/2026', 'Nothing happened', '0', '0', '10000'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions).toHaveLength(0)
  })

  test('handles YYYY-MM-DD date format', () => {
    const rows = [
      ['2026-05-10', 'Test', '100', '', '9900'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions[0].date).toBe('2026-05-10')
  })

  test('preserves negative balance in saldo', () => {
    const rows = [
      ['01/05/2026', 'Withdrawal', '15000', '', '-5000'],
    ]
    const result = parseBI(rows, headers)
    expect(result.finalBalance).toBe(-5000)
  })

  test('all transactions have GTQ currency and bi_import source', () => {
    const rows = [
      ['10/05/2026', 'Something', '100', '', '9900'],
      ['11/05/2026', 'Something else', '', '200', '10100'],
    ]
    const result = parseBI(rows, headers)
    result.transactions.forEach(tx => {
      expect(tx.currency).toBe('GTQ')
      expect(tx.source).toBe('bi_import')
    })
    expect(result.currency).toBe('GTQ')
  })

  test('auto-categorizes known expenses', () => {
    const rows = [
      ['10/05/2026', 'Gasolina Shell', '300', '', '9700'],
      ['11/05/2026', 'Netflix mensualidad', '80', '', '9620'],
      ['12/05/2026', 'Farmacia Galeno', '150', '', '9470'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions[0].category).toBe('Transporte')
    // Netflix esperaba 'Entretenimiento' y ahora da 'Suscripciones'. NO es una
    // regresión: es lo que el import de TARJETA, el atajo y el correo ya
    // decían para el mismo cargo (`matchedBy: 'netflix'`). El valor viejo
    // documentaba la divergencia entre los dos clasificadores, o sea el mismo
    // cobro caía en una categoría u otra según qué archivo subieras.
    expect(result.transactions[1].category).toBe('Suscripciones')
    expect(result.transactions[2].category).toBe('Salud')
  })

  test('falls back to Otros Gastos for unknown expenses', () => {
    const rows = [
      ['10/05/2026', 'Pago misterioso XYZ', '500', '', '9500'],
    ]
    const result = parseBI(rows, headers)
    expect(result.transactions[0].category).toBe('Otros Gastos')
  })
})

// FASE JA. `finalBalance` se escribe como el saldo ACTUAL de la cuenta del
// usuario, así que elegir la fila equivocada retrocede su saldo en silencio.
describe('parseBI: el saldo final sale de la fecha más reciente, no del orden del archivo', () => {
  const headers = ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']

  test('banco que exporta de VIEJO a nuevo: el saldo es el de la última fila', () => {
    const rows = [
      ['01/05/2026', 'Deposito', '', '1000', '5000'],
      ['15/05/2026', 'Compra super', '200', '', '4800'],
      ['28/05/2026', 'Deposito', '', '500', '5300'],
    ]
    expect(parseBI(rows, headers).finalBalance).toBe(5300)
  })

  test('banco que exporta de NUEVO a viejo: el saldo sigue siendo el del 28, no el del 1', () => {
    const rows = [
      ['28/05/2026', 'Deposito', '', '500', '5300'],
      ['15/05/2026', 'Compra super', '200', '', '4800'],
      ['01/05/2026', 'Deposito', '', '1000', '5000'],
    ]
    // Comportamiento viejo (última fila del archivo) fijado como regresión: daba
    // 5000, el saldo de casi un mes antes, escrito como el saldo de hoy.
    expect(parseBI(rows, headers).finalBalance).toBe(5300)
    expect(parseBI(rows, headers).finalBalance).not.toBe(5000)
  })

  test('una fila sin saldo no borra el que ya se conocía', () => {
    const rows = [
      ['28/05/2026', 'Deposito', '', '500', '5300'],
      ['29/05/2026', 'Nota del banco', '', '', ''],
    ]
    expect(parseBI(rows, headers).finalBalance).toBe(5300)
  })

  test('dos filas del MISMO día: gana la última leída, que es el saldo tras ambos movimientos', () => {
    const rows = [
      ['28/05/2026', 'Compra', '100', '', '4900'],
      ['28/05/2026', 'Deposito', '', '500', '5400'],
    ]
    expect(parseBI(rows, headers).finalBalance).toBe(5400)
  })
})

// FASE JA2. Las filas que el parser NO entendió se descartaban sin contarse, y
// la pantalla mostraba el conteo ya post-descarte: 43 de 58 se leía como "el
// estado tiene 43 movimientos". Es lo que vuelve invisible un cambio PARCIAL de
// formato del banco.
describe('parseBI: reporta lo que no pudo leer', () => {
  const headers = ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']

  test('una fila sin fecha legible se cuenta, no se traga', () => {
    const rows = [
      ['15/05/2026', 'Compra', '200', '', '4800'],
      ['SALDO ANTERIOR', '', '', '', '5000'],
    ]
    const r = parseBI(rows, headers)
    expect(r.transactions).toHaveLength(1)
    expect(r.skipped.noDate).toBe(1)
  })

  test('una fila con fecha pero sin monto legible se cuenta aparte', () => {
    const rows = [
      ['15/05/2026', 'Compra', '200', '', '4800'],
      ['16/05/2026', 'Nota del banco', '', '', '4800'],
    ]
    const r = parseBI(rows, headers)
    expect(r.transactions).toHaveLength(1)
    expect(r.skipped.noAmount).toBe(1)
    expect(r.skipped.noDate).toBe(0)
  })

  test('las filas en blanco del final del archivo NO se reportan como descarte', () => {
    const rows = [
      ['15/05/2026', 'Compra', '200', '', '4800'],
      ['', '', '', '', ''],
      [null, null, null, null, null],
    ]
    const r = parseBI(rows, headers)
    expect(r.transactions).toHaveLength(1)
    expect(r.skipped.noDate).toBe(0)
  })

  test('un archivo entendido por completo no reporta nada', () => {
    const rows = [
      ['15/05/2026', 'Compra', '200', '', '4800'],
      ['16/05/2026', 'Deposito', '', '500', '5300'],
    ]
    const r = parseBI(rows, headers)
    expect(r.skipped.noDate + r.skipped.noAmount).toBe(0)
  })
})

// El estado de BANCO era el único importador que clasificaba con
// `categorizeTransaction`, una tabla de palabras clave ciega a las reglas que
// el usuario enseñó — mientras la tarjeta, el atajo y el correo usan
// `categorizeExpense`. La app aprendía de una fila de banco y reclasificaba
// filas de banco con reglas, pero el import mismo nunca las aplicaba.
describe('el import de banco usa el MISMO clasificador que el resto', () => {
  const headers = ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']
  const gasto = (desc) => [['15/05/2026', desc, '250', '', '5000']]

  test('aplica una regla que el usuario enseñó desde otra pantalla', () => {
    const rules = [{ match: 'fridas la estacion', category: 'Alimentación' }]
    // Sin la regla el comercio no lo reconoce nadie: ese es el punto.
    expect(parseBI(gasto('FRIDAS LA ESTACION GT'), headers).transactions[0].category)
      .toBe('Otros Gastos')
    expect(parseBI(gasto('FRIDAS LA ESTACION GT'), headers, { rules }).transactions[0].category)
      .toBe('Alimentación')
  })

  test('la tabla de comercios compartida es más rica que la vieja', () => {
    // Los dos caían en "Otros Gastos" con el clasificador anterior.
    expect(parseBI(gasto('SEGUROS UNIVERSALES'), headers).transactions[0].category).toBe('Seguros')
    expect(parseBI(gasto('RALLY PADEL'), headers).transactions[0].category).toBe('Entretenimiento')
  })

  test('sin reglas y sin comercio conocido, cae al de siempre', () => {
    // Aditivo por construcción: lo que ya se clasificaba bien no puede empeorar.
    expect(parseBI(gasto('SUPERMERCADO LA TORRE'), headers).transactions[0].category)
      .toBe('Alimentación')
    expect(parseBI(gasto('XKCD 9931 ZZ'), headers).transactions[0].category).toBe('Otros Gastos')
  })

  test('un INGRESO no pasa por el clasificador de comercios', () => {
    // No tiene comercio que leer, misma razón por la que recategorize devuelve
    // null para INCOME. Una regla de gasto no puede recategorizar tu sueldo.
    const rows = [['15/05/2026', 'Pago nomina empresa', '', '15000', '20000']]
    const rules = [{ match: 'pago nomina', category: 'Alimentación' }]
    expect(parseBI(rows, headers, { rules }).transactions[0].category).toBe('Salario')
  })
})
