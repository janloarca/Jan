import { projectWealth, suggestSavingsRate, annualizedReturnPct, savingsRateFromProfile } from '../wealthProjection'

describe('projectWealth', () => {
  const income = Array(12).fill(0)
  income[7] = 15000; income[8] = 15000; income[9] = 15000; income[10] = 19000; income[11] = 15000

  it('sin rendimiento, el patrimonio sube exactamente lo ahorrado', () => {
    const r = projectWealth({ startValue: 100000, monthlyIncome: income, defaultSavingsRate: 50, annualReturnPct: 0, fromMonth: 7 })
    // (15000 + 15000 + 15000 + 19000 + 15000) × 50% = 39,500
    expect(r.totalSaved).toBe(39500)
    expect(r.totalGrowth).toBe(0)
    expect(r.endValue).toBe(139500)
  })

  it('el aporte del mes NO rinde ese mismo mes', () => {
    // Un solo mes: el rendimiento se calcula sobre los 100,000 que ya estaban,
    // no sobre 100,000 + el aporte.
    const one = Array(12).fill(0); one[11] = 1200
    const r = projectWealth({ startValue: 100000, monthlyIncome: one, defaultSavingsRate: 100, annualReturnPct: 12, fromMonth: 11 })
    expect(r.points[0].growth).toBeCloseTo(1000, 9) // 100,000 × 12%/12
    expect(r.points[0].saved).toBe(1200)
    expect(r.endValue).toBeCloseTo(102200, 9)
  })

  it('el rendimiento compone mes a mes sobre lo ya aportado', () => {
    const two = Array(12).fill(0); two[10] = 1000; two[11] = 1000
    const r = projectWealth({ startValue: 1000, monthlyIncome: two, defaultSavingsRate: 100, annualReturnPct: 12, fromMonth: 10 })
    // m10: 1000 × 1% = 10 → 2010 ; m11: 2010 × 1% = 20.10 → 3030.10
    expect(r.points[0].value).toBeCloseTo(2010, 9)
    expect(r.points[1].growth).toBeCloseTo(20.1, 9)
    expect(r.endValue).toBeCloseTo(3030.1, 9)
  })

  it('el porcentaje por mes le gana al default, mes por mes', () => {
    const r = projectWealth({
      startValue: 0, monthlyIncome: income,
      savingsRate: { 7: 50, 8: 40, 9: 30 }, defaultSavingsRate: 10,
      annualReturnPct: 0, fromMonth: 7,
    })
    expect(r.points.map((p) => p.saved)).toEqual([7500, 6000, 4500, 1900, 1500])
  })

  it('un cero explícito es un cero, no "sin configurar"', () => {
    const r = projectWealth({ startValue: 0, monthlyIncome: income, savingsRate: { 7: 0 }, defaultSavingsRate: 80, annualReturnPct: 0, fromMonth: 7, toMonth: 7 })
    expect(r.points[0].saved).toBe(0)
  })

  it('un año ya cerrado no proyecta nada y devuelve el patrimonio intacto', () => {
    const r = projectWealth({ startValue: 50000, monthlyIncome: income, fromMonth: 12 })
    expect(r.points).toHaveLength(0)
    expect(r.endValue).toBe(50000)
    expect(r.totalChange).toBe(0)
  })

  it('la suma de aportes y rendimientos reconstruye el cambio total', () => {
    const r = projectWealth({ startValue: 23000, monthlyIncome: income, defaultSavingsRate: 35, annualReturnPct: 7, fromMonth: 7 })
    expect(r.totalSaved + r.totalGrowth).toBeCloseTo(r.totalChange, 6)
  })
})

describe('suggestSavingsRate', () => {
  const txs = [
    { type: 'INCOME', date: '2026-05-01', amount: 10000, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-05-10', amount: 6000, currency: 'GTQ' },
    { type: 'INCOME', date: '2026-06-01', amount: 10000, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-06-10', amount: 5000, currency: 'GTQ' },
    { type: 'INCOME', date: '2026-07-01', amount: 10000, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-07-10', amount: 4000, currency: 'GTQ' },
  ]

  it('sale de lo que de verdad se ahorró en los meses cerrados', () => {
    // 30,000 de ingreso, 15,000 de gasto → 50%
    expect(suggestSavingsRate(txs, { year: 2026, month: 7 })).toEqual({ pct: 50, months: 3 })
  })

  it('ignora el mes en curso: está a medias y distorsionaría todo', () => {
    const conMesEnCurso = [...txs, { type: 'INCOME', date: '2026-08-01', amount: 10000, currency: 'GTQ' }]
    expect(suggestSavingsRate(conMesEnCurso, { year: 2026, month: 7 })).toEqual({ pct: 50, months: 3 })
  })

  it('devuelve null sin meses utilizables, en vez de un número inventado', () => {
    expect(suggestSavingsRate([], { year: 2026, month: 7 })).toBeNull()
    expect(suggestSavingsRate([{ type: 'EXPENSE', date: '2026-07-01', amount: 500 }], { year: 2026, month: 7 })).toBeNull()
  })

  it('nunca devuelve un porcentaje fuera de 0..100 aunque el mes cierre en rojo', () => {
    const enRojo = [
      { type: 'INCOME', date: '2026-07-01', amount: 1000 },
      { type: 'EXPENSE', date: '2026-07-05', amount: 9000 },
    ]
    expect(suggestSavingsRate(enRojo, { year: 2026, month: 7 })).toEqual({ pct: 0, months: 1 })
  })

  it('convierte cada movimiento antes de sumar', () => {
    const mixto = [
      { type: 'INCOME', date: '2026-07-01', amount: 1000, currency: 'USD' },
      { type: 'EXPENSE', date: '2026-07-05', amount: 3850, currency: 'GTQ' },
    ]
    const convert = (a, f, t) => (f === 'USD' && t === 'GTQ' ? a * 7.7 : a)
    expect(suggestSavingsRate(mixto, { year: 2026, month: 7, convert })).toEqual({ pct: 50, months: 1 })
  })
})

describe('annualizedReturnPct', () => {
  it('anualiza el retorno acumulado del portafolio', () => {
    // +21% en dos años exactos → 10% anual (1.1² = 1.21)
    const now = new Date('2026-08-19T00:00:00Z')
    const start = new Date(now.getTime() - 2 * 365.25 * 86400000).toISOString()
    expect(annualizedReturnPct(21, start, now)).toBeCloseTo(10, 6)
  })

  it('no anualiza menos de un año: sería un número absurdo presentado como dato', () => {
    const now = new Date('2026-08-19T00:00:00Z')
    const start = new Date(now.getTime() - 60 * 86400000).toISOString()
    expect(annualizedReturnPct(6, start, now)).toBeNull()
  })

  it('sin fecha o sin retorno no inventa nada', () => {
    expect(annualizedReturnPct(10, null)).toBeNull()
    expect(annualizedReturnPct(null, '2020-01-01')).toBeNull()
  })

  it('una pérdida total no produce una raíz de un número negativo', () => {
    const now = new Date('2026-08-19T00:00:00Z')
    const start = new Date(now.getTime() - 3 * 365.25 * 86400000).toISOString()
    expect(annualizedReturnPct(-120, start, now)).toBeNull()
  })
})

describe('minMonths: una muestra chica no es una medición', () => {
  const dosMeses = [
    { type: 'INCOME', date: '2026-06-01', amount: 2842, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-06-10', amount: 9000, currency: 'GTQ' },
    { type: 'INCOME', date: '2026-07-01', amount: 4666, currency: 'GTQ' },
    { type: 'EXPENSE', date: '2026-07-10', amount: 9000, currency: 'GTQ' },
  ]

  it('con dos meses y un mínimo de tres, rehúsa en vez de reportar 0%', () => {
    // El caso real del usuario: ingreso a medio registrar produce "ahorraste
    // 0%", que se mostraba con la misma autoridad que un dato bueno.
    expect(suggestSavingsRate(dosMeses, { year: 2026, month: 7, minMonths: 1 })).toEqual({ pct: 0, months: 2 })
    expect(suggestSavingsRate(dosMeses, { year: 2026, month: 7, minMonths: 3 })).toBeNull()
  })

  it('con tres meses sí contesta', () => {
    const tres = [...dosMeses,
      { type: 'INCOME', date: '2026-05-01', amount: 10000, currency: 'GTQ' },
      { type: 'EXPENSE', date: '2026-05-10', amount: 5000, currency: 'GTQ' }]
    expect(suggestSavingsRate(tres, { year: 2026, month: 7, minMonths: 3 })?.months).toBe(3)
  })

  it('el default sigue siendo el de antes para los callers que no lo pasan', () => {
    expect(suggestSavingsRate(dosMeses, { year: 2026, month: 7 })).toEqual({ pct: 0, months: 2 })
  })
})

describe('savingsRateFromProfile', () => {
  it('sale de lo que la persona declaró en su perfil', () => {
    // Los números reales del usuario: Q8,400/mo de ingreso, Q4,500/mo de ahorro.
    expect(savingsRateFromProfile({ monthlyIncome: 8400, monthlySavings: 4500 })).toMatchObject({ pct: 54 })
  })

  it('es una razón, así que la moneda no importa mientras sea la misma', () => {
    const gtq = savingsRateFromProfile({ monthlyIncome: 8400, monthlySavings: 4200 })
    const usd = savingsRateFromProfile({ monthlyIncome: 1090.91, monthlySavings: 545.45 })
    expect(gtq.pct).toBe(usd.pct)
  })

  it('sin perfil, o sin ingreso, no inventa nada', () => {
    expect(savingsRateFromProfile(null)).toBeNull()
    expect(savingsRateFromProfile({ monthlySavings: 4500 })).toBeNull()
    expect(savingsRateFromProfile({ monthlyIncome: 0, monthlySavings: 100 })).toBeNull()
    expect(savingsRateFromProfile({ monthlyIncome: 8400 })).toBeNull()
  })

  it('un ahorro mayor que el ingreso se acota a 100 en vez de salir absurdo', () => {
    expect(savingsRateFromProfile({ monthlyIncome: 1000, monthlySavings: 5000 }).pct).toBe(100)
  })
})
