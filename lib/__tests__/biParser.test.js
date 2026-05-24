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
