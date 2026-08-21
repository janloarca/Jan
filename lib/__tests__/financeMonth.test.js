import { monthKeyOf, getMonthStatus, computeMonthlyAnalysis, buildFinanceInsights, formatFinanceDate } from '../financeMonth'

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

  it('nada del portafolio entra al ingreso ni al ahorro', () => {
    // Flujo y Patrimonio son dos segmentos separados. Un cuarto argumento con
    // los dividendos del portafolio ya no puede mover ninguna cifra: la
    // regresión que esto fija es que alguien lo vuelva a conectar.
    const a = computeMonthlyAnalysis(data, { month: 6, year: 2026 }, null, {
      extraIncome: 1000, prevExtraIncome: 500, yoyExtraIncome: 0,
    })
    expect(a.income).toBe(10000)
    expect(a.savings).toBe(10000 - 3050)
    expect(a.prev.income).toBe(10000)
  })

  it('un mes de puros gastos se lee como lo que es', () => {
    // El precio aceptado de la separación: sin ninguna fila de ingreso, el mes
    // muestra ahorro negativo. Eso es la verdad de Flujo, y la pantalla ya
    // nombra el caso ("el ingreso no está cargado") en vez de taparlo con un
    // número que el usuario nunca registró.
    const onlyExpenses = [tx('2026-07-03', 'EXPENSE', 500, 'Alimentación')]
    const a = computeMonthlyAnalysis(onlyExpenses, { month: 6, year: 2026 }, null, { extraIncome: 1000 })
    expect(a.income).toBe(0)
    expect(a.savings).toBe(-500)
    expect(a.incomeLooksUnlogged).toBe(true)
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

describe('un reembolso netea contra su propia categoría', () => {
  // La propiedad que hace que la cifra diga la verdad: las dos patas de un ida
  // y vuelta caen en la misma categoría (salen del mismo nombre de comercio) y
  // se cancelan sin ninguna regla que nombre al comercio.
  const roundTrip = [
    tx('2026-07-01', 'INCOME', 10000, 'Salario'),
    tx('2026-07-04', 'EXPENSE', 770, 'Entretenimiento'),
    tx('2026-07-05', 'EXPENSE', -740, 'Entretenimiento'), // el reembolso
    tx('2026-07-06', 'EXPENSE', 500, 'Alimentación'),
  ]
  const a = computeMonthlyAnalysis(roundTrip, { month: 6, year: 2026 })

  it('el gasto del mes cuenta el neto, no lo bruto', () => {
    expect(a.expenses).toBeCloseTo(530, 2) // 770 - 740 + 500
  })

  it('el reembolso no aparece como ingreso', () => {
    expect(a.income).toBeCloseTo(10000, 2)
  })

  it('el ahorro sube por el dinero que volvió', () => {
    expect(a.savings).toBeCloseTo(9470, 2)
  })

  it('la categoría reporta gasto NETO', () => {
    const personal = a.groups.find((g) => g.key === 'personal')
    expect(personal.amount).toBeCloseTo(30, 2)
  })

  it('las categorías siguen sumando exactamente su grupo', () => {
    const personal = a.groups.find((g) => g.key === 'personal')
    const sum = (personal.categories || []).reduce((s, c) => s + c.amount, 0)
    expect(sum).toBeCloseTo(personal.amount, 2)
  })

  it('un reembolso mayor que lo gastado deja la categoría en negativo, y no desaparece', () => {
    const over = [
      tx('2026-07-04', 'EXPENSE', 100, 'Entretenimiento'),
      tx('2026-07-20', 'EXPENSE', -400, 'Entretenimiento'),
    ]
    const b = computeMonthlyAnalysis(over, { month: 6, year: 2026 })
    const personal = b.groups.find((g) => g.key === 'personal')
    expect(personal.amount).toBeCloseTo(-300, 2)
    expect(b.expenses).toBeCloseTo(-300, 2)
    // La fila sigue en el desglose: una categoría escondida y una categoría
    // rota se ven igual desde afuera.
    expect(personal.categories.find((c) => c.category === 'Entretenimiento').amount).toBeCloseTo(-300, 2)
  })
})

describe('formatFinanceDate: DD/MM/YYYY solo en pantalla', () => {
  it('convierte el ISO guardado', () => {
    expect(formatFinanceDate('2026-07-05')).toBe('05/07/2026')
    expect(formatFinanceDate('2026-12-31')).toBe('31/12/2026')
  })

  it('recorta texto, nunca new Date(): en UTC-6 eso corre la fecha un dia', () => {
    // La prueba de la trampa: leido como Date, '2026-07-05' es medianoche UTC
    // y getDate() local (al oeste de UTC) da 4. El helper tiene que dar 05.
    expect(formatFinanceDate('2026-07-05')).toContain('05/')
  })

  it('tolera una fecha con hora pegada', () => {
    expect(formatFinanceDate('2026-07-05T14:32:00Z')).toBe('05/07/2026')
  })

  it('devuelve tal cual lo que no es una fecha, en vez de inventar', () => {
    expect(formatFinanceDate('')).toBe('')
    expect(formatFinanceDate(null)).toBe('')
    expect(formatFinanceDate('sin fecha')).toBe('sin fecha')
  })
})
