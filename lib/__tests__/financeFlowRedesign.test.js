// Lo que se le pide a la pantalla de Flujo después del rediseño (FASE JL):
// que las cifras que muestra signifiquen algo, y que las dos mitades de cada
// desglose cuadren entre sí.
//
// El caso que originó todo está fijado abajo palabra por palabra: la captura
// del usuario tenía CADA fila bajando (↓92, ↓99, ↓89, ↓88, ↓93, ↓100, ↓96,
// ↓100, ↓100) sobre 18 días de agosto contra 31 de julio.

import {
  computeMonthlyAnalysis, buildFinanceInsights, monthProgress,
} from '../financeMonth'
import {
  FINANCE_CATEGORIES, CATEGORY_LABELS_EN, categoryLabel,
  incomeGroupOfCategory, INCOME_GROUPS,
} from '../financeCategories'

const tx = (date, type, amount, category = 'Otros Gastos', currency = 'GTQ') =>
  ({ date, type, amount, category, currency })

// Un mes ya cerrado, para que `partialMonth` no interfiera salvo donde se prueba.
const CLOSED = new Date(2026, 8, 15) // 15 de septiembre, con agosto ya cerrado

describe('categoryLabel', () => {
  it('TODA categoría tiene inglés', () => {
    // Sin conteo fijo a propósito: el invariante es que ninguna se quede sin
    // traducir, no cuántas hay. Un número acá se rompe cada vez que se agrega
    // una categoría legítima y no dice nada sobre lo que importa.
    const all = [...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE]
    expect(all.length).toBeGreaterThan(0)
    for (const cat of all) {
      expect(typeof CATEGORY_LABELS_EN[cat]).toBe('string')
      expect(CATEGORY_LABELS_EN[cat].length).toBeGreaterThan(0)
    }
  })

  it('la LLAVE en español no cambia para ninguna: está guardada en Firestore', () => {
    for (const cat of [...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE]) {
      expect(categoryLabel(cat, 'es')).toBe(cat)
    }
  })

  it('una categoría desconocida se imprime tal cual, nunca vacía', () => {
    expect(categoryLabel('Categoría Nueva', 'en')).toBe('Categoría Nueva')
    expect(categoryLabel('', 'en')).toBe('')
    expect(categoryLabel(null, 'en')).toBe('')
  })

  it('toda categoría de ingreso cae en un grupo de ingreso', () => {
    const covered = new Set(INCOME_GROUPS.flatMap((g) => g.categories))
    for (const cat of FINANCE_CATEGORIES.INCOME) expect(covered.has(cat)).toBe(true)
    // Y una desconocida cae en "otros" en vez de desaparecer del desglose.
    expect(incomeGroupOfCategory('Algo Raro').key).toBe('otros-in')
  })
})

describe('monthProgress', () => {
  it('mes en curso a media ventana: parcial', () => {
    const p = monthProgress({ month: 7, year: 2026 }, new Date(2026, 7, 18))
    expect(p).toMatchObject({ isCurrentMonth: true, partialMonth: true, daysElapsed: 18, daysInMonth: 31, daysLeft: 13 })
  })

  it('el ÚLTIMO día ya es una ventana completa: la comparación vuelve a valer', () => {
    const p = monthProgress({ month: 7, year: 2026 }, new Date(2026, 7, 31))
    expect(p.partialMonth).toBe(false)
    expect(p.daysElapsed).toBe(31)
  })

  it('un mes pasado nunca es parcial', () => {
    const p = monthProgress({ month: 6, year: 2026 }, new Date(2026, 7, 18))
    expect(p).toMatchObject({ isCurrentMonth: false, partialMonth: false, daysElapsed: 31, daysLeft: 0 })
  })
})

describe('comparable: cuándo una variación significa algo', () => {
  const data = [
    tx('2026-08-03', 'EXPENSE', 400, 'Alimentación'),
    tx('2026-08-04', 'INCOME', 9000, 'Salario'),
    tx('2026-07-05', 'EXPENSE', 1200, 'Alimentación'),
    tx('2026-07-08', 'EXPENSE', 5683, 'Vivienda'),
    tx('2026-07-01', 'INCOME', 9000, 'Salario'),
  ]

  it('mes EN CURSO: ninguna fila muestra variación, ni el encabezado', () => {
    const a = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: new Date(2026, 7, 18) })
    expect(a.partialMonth).toBe(true)
    expect(a.momComparable).toBe(false)
    for (const g of a.groups) expect(g.comparable).toBe(false)
    // El porcentaje se sigue CALCULANDO: lo que cambia es si se dibuja.
    expect(a.groups.find((g) => g.key === 'alimentacion').momPct).toBeCloseTo(-66.67, 1)
  })

  it('mes CERRADO: la fila con monto en los dos meses sí compara', () => {
    const a = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED })
    expect(a.partialMonth).toBe(false)
    expect(a.momComparable).toBe(true)
    expect(a.groups.find((g) => g.key === 'alimentacion').comparable).toBe(true)
  })

  it('una fila en CERO hoy nunca compara: eso es "no hay datos", no "gasté menos"', () => {
    const a = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED })
    const vivienda = a.groups.find((g) => g.key === 'vivienda')
    expect(vivienda.amount).toBe(0)
    expect(vivienda.momPct).toBe(-100)      // el cálculo sigue ahí
    expect(vivienda.comparable).toBe(false) // y no se dibuja
  })

  it('sin mes anterior no hay base contra la cual medir', () => {
    const a = computeMonthlyAnalysis(
      [tx('2026-08-03', 'EXPENSE', 400, 'Alimentación')],
      { month: 7, year: 2026 }, null, { now: CLOSED },
    )
    expect(a.groups.find((g) => g.key === 'alimentacion').comparable).toBe(false)
  })
})

describe('los insights hablan del gasto, no del calendario', () => {
  // El caso REAL de la captura: agosto a medias contra un julio que traía la
  // prima anual de seguro. Los dos grupos grandes caen a cero y con el orden
  // viejo se quedaban con los dos cupos de "movers".
  const realCase = [
    tx('2026-08-03', 'EXPENSE', 600, 'Alimentación'),
    tx('2026-08-04', 'EXPENSE', 300, 'Transporte'),
    tx('2026-08-05', 'INCOME', 9000, 'Salario'),
    tx('2026-07-08', 'EXPENSE', 5683, 'Vivienda'),
    tx('2026-07-09', 'EXPENSE', 46330, 'Seguros'),
    tx('2026-07-10', 'EXPENSE', 1500, 'Alimentación'),
    tx('2026-07-11', 'EXPENSE', 900, 'Transporte'),
    tx('2026-07-01', 'INCOME', 9000, 'Salario'),
  ]

  it('un grupo sin datos este mes no puede tomar un cupo de mover', () => {
    const a = computeMonthlyAnalysis(realCase, { month: 7, year: 2026 }, null, { now: CLOSED })
    const ins = buildFinanceInsights(a, 'es')
    const text = ins.map((i) => i.textEs).join(' | ')
    expect(text).not.toContain('Vivienda')
    expect(text).not.toContain('Financiero')
    // Y lo que sí se movió de verdad sigue apareciendo.
    expect(text).toContain('Alimentación')
  })

  it('con el mes EN CURSO no se emite ningún mover ni el YoY', () => {
    const a = computeMonthlyAnalysis(realCase, { month: 7, year: 2026 }, null, { now: new Date(2026, 7, 18) })
    const text = buildFinanceInsights(a, 'es').map((i) => i.textEs).join(' | ')
    expect(text).not.toContain('vs el mes pasado')
  })

  it('el piso ya no se cumple con un movimiento de calderilla', () => {
    const small = [
      tx('2026-08-03', 'EXPENSE', 30, 'Alimentación'),
      tx('2026-08-04', 'INCOME', 9000, 'Salario'),
      tx('2026-07-03', 'EXPENSE', 10, 'Alimentación'),
      tx('2026-07-01', 'INCOME', 9000, 'Salario'),
    ]
    const a = computeMonthlyAnalysis(small, { month: 7, year: 2026 }, null, { now: CLOSED })
    // +200% pero solo Q20 movidos.
    expect(a.groups.find((g) => g.key === 'alimentacion').momPct).toBe(200)
    expect(buildFinanceInsights(a, 'es').map((i) => i.textEs).join(' ')).not.toContain('Alimentación subió')
  })

  it('el desempate lo gana el dinero movido, no la posición en el arreglo', () => {
    // Dos grupos con EXACTAMENTE el mismo -50%: gana el que movió más plata.
    const tie = [
      tx('2026-08-01', 'EXPENSE', 500, 'Alimentación'),
      tx('2026-08-02', 'EXPENSE', 10000, 'Seguros'),
      tx('2026-08-03', 'INCOME', 9000, 'Salario'),
      tx('2026-07-01', 'EXPENSE', 1000, 'Alimentación'),
      tx('2026-07-02', 'EXPENSE', 20000, 'Seguros'),
      tx('2026-07-03', 'INCOME', 9000, 'Salario'),
    ]
    const a = computeMonthlyAnalysis(tie, { month: 7, year: 2026 }, null, { now: CLOSED })
    const first = buildFinanceInsights(a, 'es')[0].textEs
    expect(first).toContain('Financiero')
  })
})

describe('el desglose cuadra consigo mismo', () => {
  const data = [
    tx('2026-08-01', 'EXPENSE', 1200, 'Alimentación'),
    tx('2026-08-02', 'EXPENSE', 800, 'Vivienda'),
    tx('2026-08-03', 'EXPENSE', 300, 'Servicios'),
    tx('2026-08-04', 'EXPENSE', 150, 'Suscripciones'),
    tx('2026-08-05', 'INCOME', 9000, 'Salario'),
    tx('2026-08-06', 'INCOME', 1500, 'Freelance'),
    tx('2026-08-07', 'INCOME', 400, 'Renta'),
  ]

  it('las categorías de un grupo suman exactamente el grupo', () => {
    const a = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED })
    for (const g of [...a.groups, ...a.incomeGroups]) {
      const sum = g.categories.reduce((s, c) => s + c.amount, 0)
      expect(sum).toBeCloseTo(g.amount, 6)
    }
    // Y el caso que lo hace no trivial: tres categorías en un solo grupo.
    const vivienda = a.groups.find((g) => g.key === 'vivienda')
    expect(vivienda.categories.map((c) => c.category)).toEqual(['Vivienda', 'Servicios', 'Suscripciones'])
  })

  it('los grupos suman exactamente el total de su lado', () => {
    const a = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED })
    expect(a.groups.reduce((s, g) => s + g.amount, 0)).toBeCloseTo(a.expenses, 6)
    expect(a.incomeGroups.reduce((s, g) => s + g.amount, 0)).toBeCloseTo(a.income, 6)
  })

  it('nada del portafolio se inyecta en el ingreso del mes', () => {
    // Flujo y Patrimonio son dos segmentos separados. Antes un cuarto argumento
    // (`extraIncome`) sumaba los dividendos del portafolio al ingreso y al
    // ahorro; se eliminó, así que pasarlo ya no puede mover ninguna cifra.
    const sin = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED })
    const con = computeMonthlyAnalysis(data, { month: 7, year: 2026 }, null, { now: CLOSED, extraIncome: 733 })
    expect(con.income).toBeCloseTo(sin.income, 6)
    expect(con.savings).toBeCloseTo(sin.savings, 6)
    expect(con.income).toBeCloseTo(9000 + 1500 + 400, 6)
    expect(con.incomeGroups.find((g) => g.key === 'inversion')).toBeUndefined()
  })

  it('un depósito registrado como "Inversiones" sí cuenta: es dinero de Flujo', () => {
    // La categoría se queda para el dividendo que cayó en la cuenta bancaria y
    // entró por el estado de cuenta. Eso es movimiento de efectivo real; lo que
    // no entra es el número que el portafolio calcula por su cuenta.
    const a = computeMonthlyAnalysis(
      [...data, tx('2026-08-08', 'INCOME', 250, 'Inversiones')],
      { month: 7, year: 2026 }, null, { now: CLOSED },
    )
    const inv = a.incomeGroups.find((g) => g.key === 'inversion')
    expect(inv.amount).toBe(250)
    expect(inv.categories.reduce((s, c) => s + c.amount, 0)).toBe(250)
    expect(a.incomeGroups.reduce((s, g) => s + g.amount, 0)).toBeCloseTo(a.income, 6)
  })
})

describe('el ingreso sin cargar se nombra en vez de salir como -245%', () => {
  it('gastos sin ningún ingreso recurrente: se marca', () => {
    const a = computeMonthlyAnalysis(
      [tx('2026-08-01', 'EXPENSE', 1400, 'Alimentación'), tx('2026-08-02', 'INCOME', 407, 'Otros Ingresos')],
      { month: 7, year: 2026 }, null, { now: CLOSED },
    )
    expect(a.incomeLooksUnlogged).toBe(true)
    // Y el insight de "gastaste de más" se calla, para no culpar al gasto de un
    // problema que está del lado del ingreso.
    expect(buildFinanceInsights(a, 'es').map((i) => i.textEs).join(' ')).not.toContain('más de lo que ingresó')
  })

  it('con salario registrado NO se marca, aunque el mes cierre en rojo', () => {
    const a = computeMonthlyAnalysis(
      [tx('2026-08-01', 'EXPENSE', 12000, 'Alimentación'), tx('2026-08-02', 'INCOME', 9000, 'Salario')],
      { month: 7, year: 2026 }, null, { now: CLOSED },
    )
    expect(a.incomeLooksUnlogged).toBe(false)
    expect(buildFinanceInsights(a, 'es').map((i) => i.textEs).join(' ')).toContain('más de lo que ingresó')
  })

  it('un mes sin gastos nunca se marca', () => {
    const a = computeMonthlyAnalysis(
      [tx('2026-08-02', 'INCOME', 100, 'Otros Ingresos')],
      { month: 7, year: 2026 }, null, { now: CLOSED },
    )
    expect(a.incomeLooksUnlogged).toBe(false)
  })
})
