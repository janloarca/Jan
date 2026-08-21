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

describe('expense groups (the 6 main groups)', () => {
  const { EXPENSE_GROUPS, OTHER_GROUP, groupOfCategory, INCOME_GROUPS, MANUAL_INCOME_BLOCKED, FINANCE_CATEGORIES } = require('../financeCategories')

  test('exactly 6 main groups, each with icon/color/label', () => {
    expect(EXPENSE_GROUPS).toHaveLength(6)
    for (const g of EXPENSE_GROUPS) {
      expect(g.key).toBeTruthy()
      expect(g.label).toBeTruthy()
      expect(g.color).toMatch(/^#/)
      expect(g.categories.length).toBeGreaterThan(0)
    }
  })

  test('every expense category maps to exactly one group (or Otros)', () => {
    const seen = new Set()
    for (const g of [...EXPENSE_GROUPS, OTHER_GROUP]) {
      for (const cat of g.categories) {
        expect(seen.has(cat)).toBe(false)
        seen.add(cat)
      }
    }
    for (const cat of FINANCE_CATEGORIES.EXPENSE) {
      expect(groupOfCategory(cat)).toBeTruthy()
    }
  })

  test('groupOfCategory resolves known and unknown categories', () => {
    expect(groupOfCategory('Servicios').key).toBe('vivienda')
    expect(groupOfCategory('Compras').key).toBe('personal')
    expect(groupOfCategory('Categoria Inexistente').key).toBe('otros')
  })

  test('income groups cover all income categories', () => {
    const covered = INCOME_GROUPS.flatMap((g) => g.categories)
    for (const cat of FINANCE_CATEGORIES.INCOME) expect(covered).toContain(cat)
    expect(INCOME_GROUPS.find((g) => g.key === 'inversion').categories).toContain('Inversiones')
  })

  test('ningún grupo de ingreso se alimenta solo del portafolio', () => {
    // Flujo y Patrimonio son dos segmentos separados: acá no puede quedar un
    // grupo marcado para recibir un monto que no salga de una transacción de
    // Flujo, ni una categoría bloqueada por esa razón.
    expect(INCOME_GROUPS.some((g) => g.autoOnly)).toBe(false)
    expect(MANUAL_INCOME_BLOCKED).not.toContain('Inversiones')
  })
})
