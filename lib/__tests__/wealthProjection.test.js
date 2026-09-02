import { projectWealth, suggestSavingsRate, annualizedReturnPct, savingsRateFromProfile, projectToGoal, savingsRateForGoal } from '../wealthProjection'

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

// El plan REAL del usuario: BAM Q15,000 mensual desde septiembre, mas UFM
// Q4,000 y bono Q7,000 en diciembre. El anio en curso arranca en septiembre
// (indice 8) porque los meses ya cerrados no se proyectan.
const planEsteAnio = (() => { const a = Array(12).fill(0); a[8]=15000; a[9]=15000; a[10]=15000; a[11]=26000; return a })()
// Un anio COMPLETO del mismo plan, que es lo que se repite hacia adelante.
const planAnioLleno = (() => { const a = Array(12).fill(15000); a[11]=26000; return a })()

describe('projectToGoal', () => {
  const base = {
    startValue: 100000,
    currentYearIncome: planEsteAnio,
    futureYearIncome: planAnioLleno,
    defaultSavingsRate: 50,
    annualReturnPct: 0,
    fromMonth: 8,
    currentYear: 2026,
    throughYear: 2028,
  }

  it('sin rendimiento ni crecimiento, cada anio suma exactamente lo ahorrado', () => {
    const r = projectToGoal(base)
    // 2026 arranca en septiembre: 15+15+15+26 = 71,000 al 50% = 35,500
    expect(r.years[0]).toMatchObject({ year: 2026 })
    expect(r.years[0].saved).toBeCloseTo(35500, 6)
    expect(r.years[0].value).toBeCloseTo(135500, 6)
    // 2027 y 2028 son anios completos: 15x11 + 26 = 191,000 al 50% = 95,500
    expect(r.years[1].value).toBeCloseTo(231000, 6)
    expect(r.years[2].value).toBeCloseTo(326500, 6)
    expect(r.endValue).toBeCloseTo(326500, 6)
    expect(r.totalGrowth).toBe(0)
  })

  it('el anio en curso arranca en su mes, los futuros son completos', () => {
    // Ojo de metodo: el fixture del plan real arranca en septiembre, asi que
    // mover fromMonth sobre EL no prueba nada (enero a agosto valen cero de
    // todos modos). Se compara con un anio completo, que es donde el corte
    // por mes se puede observar.
    const conAnioLleno = { ...base, currentYearIncome: planAnioLleno }
    expect(projectToGoal({ ...conAnioLleno, fromMonth: 0 }).years[0].saved).toBeCloseTo(95500, 6)
    expect(projectToGoal({ ...conAnioLleno, fromMonth: 8 }).years[0].saved).toBeCloseTo(35500, 6)
  })

  it('el crecimiento del ingreso aplica desde el primer anio FUTURO, nunca al anio en curso', () => {
    const r = projectToGoal({ ...base, incomeGrowthPct: 10 })
    // Ojo: esto fija el CONTRATO, no tiene dientes contra un solo cambio de
    // linea, porque en el anio en curso el exponente del crecimiento es cero
    // y el factor sale 1 por construccion. Es lo que hace que el codigo no
    // necesite una rama para ese caso.
    // 2026 no se toca: su plan ya esta escrito mes por mes.
    expect(r.years[0].saved).toBeCloseTo(35500, 6)
    // 2027 = 191,000 x 1.10 al 50%; 2028 = 191,000 x 1.21 al 50%
    expect(r.years[1].saved).toBeCloseTo(105050, 6)
    expect(r.years[2].saved).toBeCloseTo(115555, 6)
    expect(r.endValue).toBeCloseTo(356105, 6)
  })

  it('los ajustes por mes solo mandan en el anio en curso', () => {
    // Septiembre al 100% y el resto al default de 50.
    const r = projectToGoal({ ...base, savingsRate: { 8: 100 } })
    expect(r.years[0].saved).toBeCloseTo(35500 + 7500, 6)
    // El anio siguiente ignora ese override: es una decision sobre ESTE anio.
    expect(r.years[1].saved).toBeCloseTo(95500, 6)
  })

  it('el rendimiento corre sobre el patrimonio que ya estaba, nunca sobre el aporte del mes', () => {
    const r = projectToGoal({ ...base, annualReturnPct: 12, throughYear: 2026 })
    // Cuatro meses al 1% mensual, con el aporte entrando DESPUES del interes.
    let v = 100000
    for (const inc of [15000, 15000, 15000, 26000]) v = v * 1.01 + inc * 0.5
    expect(r.endValue).toBeCloseTo(v, 6)
  })

  it('reachedYear es el primer anio que cruza la meta, y gap dice cuanto falta', () => {
    const r = projectToGoal({ ...base, goalValue: 250000 })
    expect(r.reachedYear).toBe(2028)
    expect(r.gap).toBeCloseTo(250000 - 326500, 6)
    const lejos = projectToGoal({ ...base, goalValue: 3000000 })
    expect(lejos.reachedYear).toBeNull()
    expect(lejos.gap).toBeCloseTo(3000000 - 326500, 6)
  })

  it('una meta ya alcanzada se declara alcanzada de entrada, no al final', () => {
    const r = projectToGoal({ ...base, startValue: 400000, goalValue: 300000 })
    expect(r.reachedYear).toBe(2026)
  })

  it('sin anios que proyectar devuelve el patrimonio de hoy, jamas un numero inventado', () => {
    const r = projectToGoal({ ...base, throughYear: 2025 })
    expect(r.years).toEqual([])
    expect(r.endValue).toBe(100000)
  })
})

describe('savingsRateForGoal', () => {
  const base = {
    startValue: 100000,
    currentYearIncome: planEsteAnio,
    futureYearIncome: planAnioLleno,
    defaultSavingsRate: 50,
    annualReturnPct: 0,
    fromMonth: 8,
    currentYear: 2026,
    throughYear: 2028,
  }

  it('la tasa que devuelve DE VERDAD alcanza la meta, y un poco menos no', () => {
    const goalValue = 400000
    const pct = savingsRateForGoal({ ...base, goalValue })
    expect(pct).not.toBeNull()
    expect(projectToGoal({ ...base, defaultSavingsRate: pct, goalValue }).endValue).toBeGreaterThanOrEqual(goalValue)
    expect(projectToGoal({ ...base, defaultSavingsRate: pct - 1, goalValue }).endValue).toBeLessThan(goalValue)
  })

  it('no propone nada cuando la meta ya se alcanza con lo que hay', () => {
    expect(savingsRateForGoal({ ...base, goalValue: 200000 })).toBeNull()
  })

  it('una meta inalcanzable se DICE, en vez de inventar una tasa de 340%', () => {
    expect(savingsRateForGoal({ ...base, goalValue: 3000000 })).toBeNull()
  })

  it('respeta los meses que el usuario ya ajusto a mano: mueve el default y nada mas', () => {
    const savingsRate = { 8: 0 }
    const goalValue = 400000
    const pct = savingsRateForGoal({ ...base, savingsRate, goalValue })
    const r = projectToGoal({ ...base, savingsRate, defaultSavingsRate: pct, goalValue })
    // Septiembre sigue en cero pese a que subir esa tasa habria ayudado.
    expect(r.years[0].saved).toBeCloseTo((15000 + 15000 + 26000) * (pct / 100), 6)
    expect(r.endValue).toBeGreaterThanOrEqual(goalValue)
  })

  it('sin meta no hay nada que resolver', () => {
    expect(savingsRateForGoal(base)).toBeNull()
    expect(savingsRateForGoal({ ...base, goalValue: 0 })).toBeNull()
  })
})
