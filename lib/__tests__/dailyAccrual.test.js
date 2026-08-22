import {
  isDailyAccrual, daysInYear, daysInMonth, accrualPayDate,
  accrualDaysInMonth, monthlyAccrual, ACCRUAL_DAILY,
} from '../dailyAccrual'

describe('daysInYear', () => {
  it('bisiestos', () => {
    expect(daysInYear(2026)).toBe(365)
    expect(daysInYear(2024)).toBe(366)
    expect(daysInYear(2000)).toBe(366) // divisible entre 400
    expect(daysInYear(1900)).toBe(365) // divisible entre 100 pero no 400
  })
})

describe('accrualPayDate', () => {
  it('siempre el ultimo dia real del mes', () => {
    expect(accrualPayDate(2026, 0)).toBe('2026-01-31')
    expect(accrualPayDate(2026, 1)).toBe('2026-02-28')
    expect(accrualPayDate(2024, 1)).toBe('2024-02-29')
    expect(accrualPayDate(2026, 3)).toBe('2026-04-30')
    expect(accrualPayDate(2026, 11)).toBe('2026-12-31')
  })
})

describe('accrualDaysInMonth', () => {
  it('sin fecha de compra devenga el mes entero', () => {
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 7 })).toBe(31)
  })

  it('un mes posterior a la compra devenga entero', () => {
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 8, acquisitionDay: '2026-08-20' })).toBe(30)
  })

  it('un mes anterior a la compra devenga cero', () => {
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 6, acquisitionDay: '2026-08-20' })).toBe(0)
    expect(accrualDaysInMonth({ year: 2025, monthIndex: 11, acquisitionDay: '2026-08-20' })).toBe(0)
  })

  // El mes de la compra se PRORRATEA. Es el arreglo que el reparto mensual
  // plano no tenia: comprar el 20 de agosto acreditaba un mes COMPLETO.
  it('el mes de la compra solo devenga los dias que de verdad tuviste el activo', () => {
    // Agosto tiene 31 dias, comprado el 20 => quedan 11 (del 21 al 31).
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 7, acquisitionDay: '2026-08-20' })).toBe(11)
  })

  it('comprar el ultimo dia del mes no devenga nada ese mes', () => {
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 7, acquisitionDay: '2026-08-31' })).toBe(0)
  })

  it('comprar el primero devenga casi el mes entero, pero no el dia de la compra', () => {
    expect(accrualDaysInMonth({ year: 2026, monthIndex: 7, acquisitionDay: '2026-08-01' })).toBe(30)
  })
})

describe('monthlyAccrual', () => {
  // LA propiedad del modulo, y hay que enunciarla con cuidado: los factores
  // MULTIPLICAN, no suman. Con el interes REINVERTIDO el saldo crece cada mes
  // y los doce factores cierran el anio en la tasa exacta.
  const anioReinvirtiendo = (year, ratePct, balance0 = 5000) => {
    let bal = balance0
    for (let m = 0; m < 12; m++) {
      bal += monthlyAccrual({ balance: bal, annualRatePct: ratePct, year, monthIndex: m })
    }
    return bal - balance0
  }

  it('reinvirtiendo, doce meses cierran en la tasa anual EXACTA', () => {
    expect(anioReinvirtiendo(2026, 4)).toBeCloseTo(5000 * 0.04, 6)
  })

  it('tambien en anio bisiesto (la base es ACT/ACT, no 365 fijo)', () => {
    expect(anioReinvirtiendo(2024, 4)).toBeCloseTo(5000 * 0.04, 6)
  })

  // Y el otro lado de la misma moneda: cobrando en efectivo el saldo no crece,
  // asi que el anio cierra un poco POR DEBAJO de la tasa. No es redondeo: el
  // dinero que sacaste no compuso.
  it('cobrando en efectivo el anio cierra apenas por debajo de la tasa', () => {
    let acc = 0
    for (let m = 0; m < 12; m++) {
      acc += monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: m })
    }
    expect(acc).toBeLessThan(5000 * 0.04)
    expect(acc).toBeGreaterThan(5000 * 0.039) // y muy cerca, no roto
  })

  // El caso del reporte: $5,000 comprados el 20 de agosto al 4%.
  it('el mes de la compra se prorratea, no acredita un mes entero', () => {
    const parcial = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 7, acquisitionDay: '2026-08-20' })
    const entero = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 7 })
    // 11 dias de 365, no 31.
    expect(parcial).toBeCloseTo(5000 * (Math.pow(1.04, 11 / 365) - 1), 8)
    expect(parcial).toBeLessThan(entero)
    // Y muy lejos del mes plano que escribia el motor viejo (5000*0.04/12 = 16.67).
    expect(parcial).toBeLessThan(16.67 / 2)
  })

  // El mes NO es la doceava parte: pesa por sus dias reales. Febrero (28/365 =
  // 0.0767) recibe menos que un doceavo (0.0833); enero (31/365 = 0.0849),
  // mas. Ese es justo el efecto que el reparto plano viejo no tenia.
  it('cada mes pesa por sus dias reales, no un doceavo parejo', () => {
    const lineal = 5000 * 0.04 / 12
    const feb = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 1 })
    const ene = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 0 })
    expect(feb).toBeLessThan(lineal)
    expect(ene).toBeGreaterThan(lineal)
  })

  // Y componer hace que un mes valga MENOS que su fraccion lineal de la tasa
  // (~1.8% menos con 4%): el interes que falta se genera despues, sobre si
  // mismo. La banda es amplia a proposito: lo que se fija es la direccion, no
  // el numero, que ya lo fija el test de que el anio cierra exacto.
  it('compone: un mes vale menos que su fraccion lineal de la tasa', () => {
    const ene = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 0 })
    const fraccionLineal = 5000 * 0.04 * (31 / 365)
    expect(ene).toBeLessThan(fraccionLineal)
    expect(ene).toBeGreaterThan(fraccionLineal * 0.95)
  })

  // La prueba de que compone de verdad, sin depender de la formula: acumular
  // enero y despues febrero sobre el saldo ya crecido tiene que dar lo mismo
  // que un solo tramo de 59 dias.
  it('dos meses encadenados equivalen a un solo tramo de sus dias juntos', () => {
    const bal = 5000
    const ene = monthlyAccrual({ balance: bal, annualRatePct: 4, year: 2026, monthIndex: 0 })
    const feb = monthlyAccrual({ balance: bal + ene, annualRatePct: 4, year: 2026, monthIndex: 1 })
    const tramoUnico = bal * (Math.pow(1.04, 59 / 365) - 1)
    expect(ene + feb).toBeCloseTo(tramoUnico, 8)
  })

  it('un mes mas largo devenga mas que uno corto', () => {
    const ene = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 0 }) // 31
    const feb = monthlyAccrual({ balance: 5000, annualRatePct: 4, year: 2026, monthIndex: 1 }) // 28
    expect(ene).toBeGreaterThan(feb)
  })

  it('rehusa antes que inventar: sin saldo, sin tasa o con basura devuelve 0', () => {
    expect(monthlyAccrual({ balance: 0, annualRatePct: 4, year: 2026, monthIndex: 0 })).toBe(0)
    expect(monthlyAccrual({ balance: 5000, annualRatePct: 0, year: 2026, monthIndex: 0 })).toBe(0)
    expect(monthlyAccrual({ balance: 5000, year: 2026, monthIndex: 0 })).toBe(0)
    expect(monthlyAccrual({})).toBe(0)
    expect(monthlyAccrual({ balance: -100, annualRatePct: 4, year: 2026, monthIndex: 0 })).toBe(0)
  })

  it('una tasa negativa resta (un fondo puede perder)', () => {
    const v = monthlyAccrual({ balance: 5000, annualRatePct: -2, year: 2026, monthIndex: 0 })
    expect(v).toBeLessThan(0)
  })
})

describe('isDailyAccrual', () => {
  it('solo la marca explicita cuenta; ausente = mensual, como siempre', () => {
    expect(isDailyAccrual({ accrual: ACCRUAL_DAILY })).toBe(true)
    expect(isDailyAccrual({ accrual: 'monthly' })).toBe(false)
    expect(isDailyAccrual({})).toBe(false)
    expect(isDailyAccrual(null)).toBe(false)
  })
})
