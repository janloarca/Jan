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
    expect(result.transactions[1].category).toBe('Entretenimiento')
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
