import { parseAmount, parseImportDate } from '../numberParse'

describe('parseAmount — LatAm decimal comma (the 100x/1000x bug)', () => {
  it('reads a decimal comma correctly', () => {
    expect(parseAmount('150,25')).toBeCloseTo(150.25)
    expect(parseAmount('0,25')).toBeCloseTo(0.25)
    expect(parseAmount('0,00125')).toBeCloseTo(0.00125) // crypto qty: was 125
    expect(parseAmount('3,1416')).toBeCloseTo(3.1416)
  })

  it('reads dot-thousands + comma-decimal', () => {
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56)
    expect(parseAmount('5.000,00')).toBeCloseTo(5000)
    expect(parseAmount('12.345,67')).toBeCloseTo(12345.67)
  })

  it('still reads US format', () => {
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56)
    expect(parseAmount('1,234,567.89')).toBeCloseTo(1234567.89)
    expect(parseAmount('150.25')).toBeCloseTo(150.25)
  })

  it('treats a lone 3-digit group as thousands', () => {
    expect(parseAmount('12.345')).toBe(12345)
    expect(parseAmount('1,234')).toBe(1234)
  })

  it('keeps a 3-digit group starting with 0 as decimals', () => {
    expect(parseAmount('1,050')).toBeCloseTo(1.05)
  })

  it('handles currency symbols, spaces and accounting negatives', () => {
    expect(parseAmount('Q1,234.56')).toBeCloseTo(1234.56)
    expect(parseAmount('$ 1.234,56')).toBeCloseTo(1234.56)
    expect(parseAmount('(1.234,56)')).toBeCloseTo(-1234.56)
    expect(parseAmount('-150,25')).toBeCloseTo(-150.25)
  })

  it('handles K/M/B shorthand', () => {
    expect(parseAmount('1,5K')).toBeCloseTo(1500)
    expect(parseAmount('2M')).toBe(2000000)
  })

  it('passes numbers through and never returns NaN', () => {
    expect(parseAmount(1234.56)).toBeCloseTo(1234.56)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount(null)).toBe(0)
    expect(parseAmount(Infinity)).toBe(0)
  })
})

describe('parseImportDate', () => {
  it('converts an Excel serial (rows used to be rejected as year 45000)', () => {
    expect(parseImportDate(44576)).toBe('2022-01-15')
    expect(parseImportDate('44576')).toBe('2022-01-15')
  })

  it('reads ISO and YYYYMMDD', () => {
    expect(parseImportDate('2024-03-15')).toBe('2024-03-15')
    expect(parseImportDate('2024-03-15T10:00:00Z')).toBe('2024-03-15')
    expect(parseImportDate('20240315')).toBe('2024-03-15')
  })

  it('reads LatAm dd/mm/yyyy', () => {
    expect(parseImportDate('15/01/2024')).toBe('2024-01-15')
    expect(parseImportDate('15-01-2024')).toBe('2024-01-15')
    expect(parseImportDate('01/02/2024')).toBe('2024-02-01') // day-first, not Jan 2
    expect(parseImportDate('15/01/24')).toBe('2024-01-15')
  })

  it('falls back to month-first when the day slot cannot be a day', () => {
    expect(parseImportDate('01/15/2024')).toBe('2024-01-15')
  })

  it('accepts Date objects', () => {
    expect(parseImportDate(new Date(Date.UTC(2024, 0, 15)))).toBe('2024-01-15')
  })

  it('returns undefined for junk instead of a bogus date', () => {
    expect(parseImportDate('not a date')).toBeUndefined()
    expect(parseImportDate('')).toBeUndefined()
    expect(parseImportDate(null)).toBeUndefined()
    expect(parseImportDate('32/13/2024')).toBeUndefined()
  })

  it('does not mistake a plain price for a date', () => {
    expect(parseImportDate(150.25)).toBeUndefined()
    expect(parseImportDate(100)).toBeUndefined()
  })
})

describe('parseAmount con código de moneda ISO', () => {
  it('acepta el código donde iría el símbolo', () => {
    // Wallet y las alertas bancarias escriben así. Antes "GTQ 17.00" daba 0,
    // que el ingest rechaza como INVALID_AMOUNT: cada cobro del atajo fallaba.
    expect(parseAmount('GTQ 17.00')).toBe(17)
    expect(parseAmount('17.00 USD')).toBe(17)
    expect(parseAmount('USD 1,234.56')).toBe(1234.56)
    expect(parseAmount('EUR 0,25')).toBe(0.25)
  })

  it('no toca nada de lo que ya funcionaba', () => {
    // Las formas LatAm que este parser existe para no equivocar.
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('150,25')).toBe(150.25)
    expect(parseAmount('12.345')).toBe(12345)
    expect(parseAmount('(1.234,56)')).toBe(-1234.56)
    expect(parseAmount('Q1,234.56')).toBe(1234.56)
  })

  it('la K/M/B de una letra sobrevive: el recorte es de TRES letras', () => {
    expect(parseAmount('1.2K')).toBe(1200)
    expect(parseAmount('3M')).toBe(3000000)
  })

  it('no recorta letras pegadas a un número', () => {
    // Solo en los extremos y separado por espacio o dígito, para que nunca se
    // coma parte de la cifra.
    expect(parseAmount('ABC')).toBe(0)
    expect(parseAmount('')).toBe(0)
  })

  it('sin lookbehind, que Safari solo soporta desde 16.4', () => {
    // Un lookbehind no soportado es un error de PARSEO: tumbaría el bundle
    // entero, no solo esta llamada.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'numberParse.js'), 'utf8')
    expect(src).not.toMatch(/\(\?<[=!]/)
  })
})
