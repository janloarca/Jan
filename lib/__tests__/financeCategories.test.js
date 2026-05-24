import { categorizeTransaction, FINANCE_CATEGORIES, CATEGORY_COLORS } from '../financeCategories'

describe('categorizeTransaction', () => {
  test('categorizes salary keywords', () => {
    expect(categorizeTransaction('Pago nomina quincenal', 'INCOME')).toBe('Salario')
    expect(categorizeTransaction('Deposito salario', 'INCOME')).toBe('Salario')
    expect(categorizeTransaction('Pago planilla mayo', 'INCOME')).toBe('Salario')
  })

  test('categorizes food keywords', () => {
    expect(categorizeTransaction('Supermercado La Torre', 'EXPENSE')).toBe('Alimentación')
    expect(categorizeTransaction('Restaurante Don Pepe', 'EXPENSE')).toBe('Alimentación')
    expect(categorizeTransaction('Pollo Campero zona 10', 'EXPENSE')).toBe('Alimentación')
    expect(categorizeTransaction('Walmart compra', 'EXPENSE')).toBe('Alimentación')
  })

  test('categorizes transport keywords', () => {
    expect(categorizeTransaction('Gasolina Shell', 'EXPENSE')).toBe('Transporte')
    expect(categorizeTransaction('Uber viaje', 'EXPENSE')).toBe('Transporte')
    expect(categorizeTransaction('Parqueo centro', 'EXPENSE')).toBe('Transporte')
  })

  test('categorizes services', () => {
    expect(categorizeTransaction('Pago EEGSA luz', 'EXPENSE')).toBe('Servicios')
    expect(categorizeTransaction('Tigo internet mensual', 'EXPENSE')).toBe('Servicios')
    expect(categorizeTransaction('Claro telefono', 'EXPENSE')).toBe('Servicios')
  })

  test('categorizes entertainment', () => {
    expect(categorizeTransaction('Netflix suscripcion', 'EXPENSE')).toBe('Entretenimiento')
    expect(categorizeTransaction('Spotify premium', 'EXPENSE')).toBe('Entretenimiento')
  })

  test('categorizes health', () => {
    expect(categorizeTransaction('Farmacia Cruz Verde', 'EXPENSE')).toBe('Salud')
    expect(categorizeTransaction('Clinica dental', 'EXPENSE')).toBe('Salud')
  })

  test('categorizes investments income', () => {
    expect(categorizeTransaction('Dividendo AAPL', 'INCOME')).toBe('Inversiones')
    expect(categorizeTransaction('Interes plazo fijo', 'INCOME')).toBe('Inversiones')
  })

  test('respects type boundary - salary keywords only match INCOME', () => {
    expect(categorizeTransaction('Pago nomina', 'EXPENSE')).toBe('Otros Gastos')
  })

  test('respects type boundary - food keywords only match EXPENSE', () => {
    expect(categorizeTransaction('Supermercado reembolso', 'INCOME')).toBe('Otros Ingresos')
  })

  test('defaults to Otros for unknown descriptions', () => {
    expect(categorizeTransaction('Transaccion XYZ desconocida', 'INCOME')).toBe('Otros Ingresos')
    expect(categorizeTransaction('Pago ABC random', 'EXPENSE')).toBe('Otros Gastos')
  })

  test('defaults to Otros for null/empty description', () => {
    expect(categorizeTransaction(null, 'INCOME')).toBe('Otros Ingresos')
    expect(categorizeTransaction('', 'EXPENSE')).toBe('Otros Gastos')
    expect(categorizeTransaction(undefined, 'INCOME')).toBe('Otros Ingresos')
  })

  test('case insensitive', () => {
    expect(categorizeTransaction('GASOLINA TEXACO', 'EXPENSE')).toBe('Transporte')
    expect(categorizeTransaction('pago NOMINA', 'INCOME')).toBe('Salario')
  })
})

describe('FINANCE_CATEGORIES', () => {
  test('has INCOME and EXPENSE arrays', () => {
    expect(Array.isArray(FINANCE_CATEGORIES.INCOME)).toBe(true)
    expect(Array.isArray(FINANCE_CATEGORIES.EXPENSE)).toBe(true)
    expect(FINANCE_CATEGORIES.INCOME.length).toBeGreaterThan(0)
    expect(FINANCE_CATEGORIES.EXPENSE.length).toBeGreaterThan(0)
  })

  test('no duplicates across categories', () => {
    const all = [...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE]
    const unique = new Set(all)
    expect(unique.size).toBe(all.length)
  })
})

describe('CATEGORY_COLORS', () => {
  test('every category has a color', () => {
    const allCategories = [...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE]
    allCategories.forEach(cat => {
      expect(CATEGORY_COLORS[cat]).toBeDefined()
      expect(CATEGORY_COLORS[cat]).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})
