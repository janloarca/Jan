import { categorizeExpense, ruleFromCorrection, MERCHANT_RULES } from '../expenseCategorize'
import { FINANCE_CATEGORIES } from '../financeCategories'

describe('categorizeExpense', () => {
  it('classifies the notification that started this feature', () => {
    const { category, confidence } = categorizeExpense('Rally Padel Guatemala')
    expect(category).toBe('Entretenimiento')
    expect(confidence).toBe('rule')
  })

  it('matches regardless of case and accents', () => {
    expect(categorizeExpense('FARMACIA GALENO ZONA 10').category).toBe('Salud')
    expect(categorizeExpense('Panadería San Martín').category).toBe('Alimentación')
  })

  it('classifies common merchants into their group', () => {
    const cases = [
      ['UBER TRIP HELP.UBER.COM', 'Transporte'],
      ['NETFLIX.COM 866-579-7172', 'Suscripciones'],
      ['WALMART LOS PROCERES', 'Alimentación'],
      ['GASOLINERA PUMA CALZADA', 'Transporte'],
      ['EEGSA PAGO EN LINEA', 'Servicios'],
      ['CINEPOLIS OAKLAND', 'Entretenimiento'],
      ['AMAZON MKTPLACE PMTS', 'Compras'],
    ]
    for (const [merchant, expected] of cases) {
      expect([merchant, categorizeExpense(merchant).category]).toEqual([merchant, expected])
    }
  })

  it('falls back to Otros Gastos and flags it as unknown', () => {
    const res = categorizeExpense('ZZQX 4471')
    expect(res.category).toBe('Otros Gastos')
    expect(res.confidence).toBe('unknown')
  })

  it('handles an empty merchant without throwing', () => {
    expect(categorizeExpense('').category).toBe('Otros Gastos')
    expect(categorizeExpense(null).confidence).toBe('unknown')
  })

  it('word-boundary needles do not fire on substrings', () => {
    // 'uno ' (the fuel brand) must not match 'desayuno', 'bar ' not 'barberia'.
    expect(categorizeExpense('Desayuno sorpresa').category).not.toBe('Transporte')
    expect(categorizeExpense('Barberia Central').category).not.toBe('Alimentación')
  })

  it('user rules beat built-in rules', () => {
    const rules = [{ match: 'rally padel', category: 'Salud' }]
    const res = categorizeExpense('Rally Padel Guatemala', { rules })
    expect(res.category).toBe('Salud')
    expect(res.confidence).toBe('user')
  })

  it('the most specific user rule wins', () => {
    const rules = [
      { match: 'super', category: 'Alimentación' },
      { match: 'super mall entretenimiento', category: 'Entretenimiento' },
    ]
    expect(categorizeExpense('SUPER MALL ENTRETENIMIENTO ZONA 4', { rules }).category).toBe('Entretenimiento')
  })

  it('ignores malformed user rules instead of throwing', () => {
    const rules = [null, {}, { match: '' }, { category: 'Salud' }]
    expect(categorizeExpense('Uber trip', { rules }).category).toBe('Transporte')
  })

  it('every built-in rule targets a real expense category', () => {
    for (const rule of MERCHANT_RULES) {
      expect(FINANCE_CATEGORIES.EXPENSE).toContain(rule.category)
    }
  })
})

describe('ruleFromCorrection', () => {
  it('builds a normalized rule from a correction', () => {
    const rule = ruleFromCorrection('Rally Pádel Guatemala', 'Salud')
    expect(rule.match).toBe('rally padel guatemala')
    expect(rule.category).toBe('Salud')
  })

  it('returns null when there is nothing to learn', () => {
    expect(ruleFromCorrection('', 'Salud')).toBeNull()
    expect(ruleFromCorrection('Uber', '')).toBeNull()
  })
})
