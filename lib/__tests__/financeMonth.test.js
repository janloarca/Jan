import { monthKeyOf, getMonthStatus, computeMonthlyAnalysis, buildFinanceInsights, investmentIncomeOfMonth } from '../financeMonth'

const tx = (date, type, amount, category = 'Otros Gastos', currency = 'GTQ') => ({ date, type, amount, category, currency })

describe('getMonthStatus', () => {
  it('empty / partial / complete', () => {
    expect(getMonthStatus([], '2026-07')).toBe('empty')
    expect(getMonthStatus([tx('2026-07-05', 'EXPENSE', 100)], '2026-07')).toBe('partial')
    expect(getMonthStatus([tx('2026-07-05', 'EXPENSE', 100), tx('2026-07-01', 'INCOME', 5000, 'Salario')], '2026-07')).toBe('complete')
    expect(getMonthStatus([tx('2026-06-05', 'EXPENSE', 100)], '2026-07')).toBe('empty')
  })
})

describe('computeMonthlyAnalysis', () => {
  const data = [
    // Julio 2026 (current)
    tx('2026-07-01', 'INCOME', 10000, 'Salario'),
    tx('2026-07-03', 'EXPENSE', 2000, 'Alimentación'),
    tx('2026-07-10', 'EXPENSE', 1000, 'Servicios'),
    tx('2026-07-12', 'EXPENSE', 50, 'Compras'),
    // Junio 2026 (prev)
    tx('2026-06-01', 'INCOME', 10000, 'Salario'),
    tx('2026-06-05', 'EXPENSE', 1000, 'Alimentación'),
    tx('2026-06-15', 'EXPENSE', 1000, 'Servicios'),
    // Julio 2025 (YoY)
    tx('2025-07-02', 'INCOME', 8000, 'Salario'),
    tx('2025-07-05', 'EXPENSE', 2500, 'Alimentación'),
  ]

  it('totals, savings rate, group breakdown', () => {
    const a = computeMonthlyAnalysis(data, { month: 6, year: 2026 })
    expect(a.income).toBe(10000)
    expect(a.expenses).toBe(3050)
    expect(a.savings).toBe(6950)
    expect(a.savingsRate).toBeCloseTo(69.5)
    const food = a.groups.find((g) => g.key === 'alimentacion')
    expect(food.amount).toBe(2000)
    const vivienda = a.groups.find((g) => g.key === 'vivienda')
    expect(vivienda.amount).toBe(1000)
  })

  it('MoM deltas per group and total', () => {
    const a = computeMonthlyAnalysis(data, { month: 6, year: 2026 })
    const food = a.groups.find((g) => g.key === 'alimentacion')
    expect(food.momPct).toBeCloseTo(100) // 1000 → 2000
    expect(a.momExpensesPct).toBeCloseTo(((3050 - 2000) / 2000) * 100)
  })

  it('YoY present when data exists, null otherwise', () => {
    const a = computeMonthlyAnalysis(data, { month: 6, year: 2026 })
    expect(a.yoy).not.toBeNull()
    expect(a.yoyExpensesPct).toBeCloseTo(((3050 - 2500) / 2500) * 100)
    const b = computeMonthlyAnalysis(data, { month: 5, year: 2026 })
    expect(b.yoy).toBeNull()
    expect(b.yoyExpensesPct).toBeNull()
  })

  it('january looks at december of the previous year for MoM', () => {
    const jan = [
      tx('2026-01-10', 'EXPENSE', 500, 'Transporte'),
      tx('2025-12-10', 'EXPENSE', 1000, 'Transporte'),
    ]
    const a = computeMonthlyAnalysis(jan, { month: 0, year: 2026 })
    const tr = a.groups.find((g) => g.key === 'transporte')
    expect(tr.momPct).toBeCloseTo(-50)
  })

  it('converts foreign-currency txs', () => {
    const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.8 : a)
    const a = computeMonthlyAnalysis([tx('2026-07-01', 'EXPENSE', 100, 'Compras', 'USD')], { month: 6, year: 2026 }, convert)
    expect(a.expenses).toBeCloseTo(780)
  })

  it('counts ant expenses (< Q75)', () => {
    const ants = Array.from({ length: 12 }, (_, i) => tx(`2026-07-${String(i + 1).padStart(2, '0')}`, 'EXPENSE', 40, 'Compras'))
    const a = computeMonthlyAnalysis(ants, { month: 6, year: 2026 })
    expect(a.hormigaCount).toBe(12)
    expect(a.hormigaSum).toBe(480)
  })
})

describe('buildFinanceInsights', () => {
  it('emits mover, savings and ant insights in Spanish', () => {
    const data = [
      tx('2026-07-01', 'INCOME', 10000, 'Salario'),
      tx('2026-07-03', 'EXPENSE', 2000, 'Alimentación'),
      ...Array.from({ length: 12 }, (_, i) => tx(`2026-07-${String(i + 10).padStart(2, '0')}`, 'EXPENSE', 40, 'Compras')),
      tx('2026-06-01', 'INCOME', 10000, 'Salario'),
      tx('2026-06-05', 'EXPENSE', 1000, 'Alimentación'),
    ]
    const a = computeMonthlyAnalysis(data, { month: 6, year: 2026 })
    const insights = buildFinanceInsights(a, 'es')
    expect(insights.length).toBeGreaterThan(0)
    expect(insights.some((i) => i.textEs.includes('Alimentación'))).toBe(true)
    expect(insights.some((i) => i.textEs.includes('hormiga'))).toBe(true)
    expect(insights.some((i) => i.textEs.includes('ahorro'))).toBe(true)
  })

  it('returns empty for an empty month', () => {
    const a = computeMonthlyAnalysis([], { month: 6, year: 2026 })
    expect(buildFinanceInsights(a, 'es')).toEqual([])
  })
})

describe('investmentIncomeOfMonth', () => {
  const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.8 : a)
  it('sums cash dividends of the month, excluding reinvested', () => {
    const portfolio = [
      { type: 'DIVIDEND', date: '2026-07-15', totalAmount: 100, currency: 'USD' },
      { type: 'DIVIDEND', date: '2026-07-20', totalAmount: 50, currency: 'USD', _reinvested: true },
      { type: 'DIVIDEND', date: '2026-06-15', totalAmount: 999, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-07-01', totalAmount: 1000, currency: 'USD' },
    ]
    const r = investmentIncomeOfMonth(portfolio, { month: 6, year: 2026 }, convert)
    expect(r.total).toBeCloseTo(780)
    expect(r.count).toBe(1)
  })
})
