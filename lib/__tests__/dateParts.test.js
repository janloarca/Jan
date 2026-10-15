import { ymOfDate } from '../dateParts'

describe('ymOfDate', () => {
  test('el día 1 no cae en el mes anterior (suite en America/Guatemala)', () => {
    expect(new Date('2026-10-01').getMonth()).toBe(8) // la lectura mala
    expect(ymOfDate('2026-10-01')).toEqual({ y: 2026, m: 9 })
    expect(ymOfDate('2027-01-01')).toEqual({ y: 2027, m: 0 })
  })
  test('ISO con hora y entradas inválidas', () => {
    expect(ymOfDate('2026-03-15T10:00:00Z')).toEqual({ y: 2026, m: 2 })
    expect(ymOfDate('')).toBeNull()
    expect(ymOfDate(null)).toBeNull()
    expect(ymOfDate('basura')).toBeNull()
  })
})
