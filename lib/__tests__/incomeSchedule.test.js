import { getScheduledPayDates, estimateIncomeAmount, clampPayDay, payDateFor, impossiblePayDateFixes, isPayDateExcluded, acquisitionDayISO, monthlyIncomeAmount, periodFraction, previousPayDate } from '../incomeSchedule'

// FASE KS. Un pago no puede ser anterior al dia en que compraste el activo.
// El guard viejo comparaba contra el PRIMERO DEL MES de la compra, asi que
// cualquier dia de pago anterior dentro de ese mismo mes pasaba.
describe('un pago nunca precede a la compra', () => {
  // El caso REPORTADO, con captura: $5,000 comprados el 20 de agosto al 4%,
  // dia de pago 1. La app ofrecia "~USD 16.67 el 1 ago 2026", un mes entero de
  // interes fechado ONCE DIAS antes de tener el activo.
  it('comprar el 20 de agosto con dia de pago 1 no genera el pago del 1 de agosto', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-08-20', incomeMonths: [0,1,2,3,4,5,6,7,8,9,10,11], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-22T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('el mismo dia de la compra si cuenta: solo se excluye lo ANTERIOR', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-08-01', incomeMonths: [7], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-22T12:00:00Z')
    )
    expect(dates).toEqual(['2026-08-01'])
  })

  it('los meses POSTERIORES a la compra siguen pagando normal', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-06-20', incomeMonths: [0,1,2,3,4,5,6,7,8,9,10,11], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-22T12:00:00Z')
    )
    // Junio queda fuera (el 1 es anterior al 20); julio y agosto entran.
    expect(dates).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('sin fecha de compra el comportamiento no cambia', () => {
    const dates = getScheduledPayDates(
      { incomeMonths: [6, 7], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-22T12:00:00Z')
    )
    expect(dates).toEqual(['2026-07-01', '2026-08-01'])
  })
})

describe('acquisitionDayISO', () => {
  it('recorta una fecha ISO al dia, sin tocar zonas horarias', () => {
    expect(acquisitionDayISO('2026-08-20')).toBe('2026-08-20')
    expect(acquisitionDayISO('2026-08-20T00:00:00Z')).toBe('2026-08-20')
  })

  it('null ante lo que no es una fecha', () => {
    expect(acquisitionDayISO(null)).toBeNull()
    expect(acquisitionDayISO('')).toBeNull()
    expect(acquisitionDayISO('no-es-fecha')).toBeNull()
  })

  // El orden lexicografico de 'YYYY-MM-DD' ES el cronologico: esa es la
  // propiedad que hace segura la comparacion contra la fecha de pago.
  it('las cadenas ISO se comparan cronologicamente como texto', () => {
    expect('2026-08-01' < '2026-08-20').toBe(true)
    expect('2026-09-01' < '2026-08-20').toBe(false)
    expect('2026-08-20' < '2026-08-20').toBe(false)
  })
})

describe('getScheduledPayDates', () => {
  it('returns past pay dates that already fell due since acquisition', () => {
    // Bought in January, pays May + December, "today" is August: only May
    // has fallen due.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-15', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-05-15'])
  })

  it('excludes the current month if the pay day has not arrived yet', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 20, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('includes the current month once the pay day has passed', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-08-01'])
  })

  it('never returns dates before acquisition', () => {
    // Bought in June; the only configured months (Jan-Apr) are all before
    // acquisition, so none of them ever fell due for this holder.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-06-01', incomeMonths: [0, 1, 2, 3], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing for continuous compounding (no discrete pay dates)', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [], incomePayDay: 1, rateType: 'continuous' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing when the acquisition date is in the future', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2027-01-01', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('handles a missing/invalid acquisition date without throwing', () => {
    expect(() => getScheduledPayDates(
      { acquisitionDate: '', incomeMonths: [4], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )).not.toThrow()
  })
})

describe('estimateIncomeAmount', () => {
  it('computes a percent-of-balance payment split across pay months', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'percent', incomeRate: 8 }, 2)
    expect(amt).toBeCloseTo(400) // 10000 * 8% / 2 payments
  })

  it('computes a fixed per-payment amount regardless of balance', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'fixed', incomeAmount: 50 })
    expect(amt).toBe(50)
  })

  it('multiplies fixed amount by quantity for per-share assets', () => {
    const amt = estimateIncomeAmount({ incomeMode: 'fixed', incomeAmount: 2, isPerShare: true, qty: 10 })
    expect(amt).toBe(20)
  })

  it('averages a variable rate range', () => {
    const amt = estimateIncomeAmount({ balance: 10000, rateType: 'variable', rateMin: 4, rateMax: 6 }, 12)
    expect(amt).toBeCloseTo((10000 * 0.05) / 12)
  })

  it('returns 0 when nothing is configured', () => {
    expect(estimateIncomeAmount({ balance: 10000 })).toBe(0)
  })
})

// FASE HV2. El día de pago que no cabe en el mes. El usuario lo reportó con la
// captura de un movimiento fechado "2026-02-31", un día que no existe: la fecha
// se armaba pegando el número tal cual, y JavaScript lo DESBORDA en silencio al
// 3 de marzo, así que el pago terminaba en un mes y su registro en otro.

describe('clampPayDay / payDateFor', () => {
  it('31 significa el último día del mes, sea cual sea ese mes', () => {
    expect(payDateFor(2026, 0, 31)).toBe('2026-01-31')  // enero: 31
    expect(payDateFor(2026, 1, 31)).toBe('2026-02-28')  // febrero
    expect(payDateFor(2026, 3, 31)).toBe('2026-04-30')  // abril: 30
    expect(payDateFor(2024, 1, 31)).toBe('2024-02-29')  // bisiesto
  })

  it('un día normal no se toca', () => {
    expect(payDateFor(2026, 1, 15)).toBe('2026-02-15')
    expect(clampPayDay(15, 2026, 1)).toBe(15)
  })

  it('un valor fuera de rango o basura no produce una fecha imposible', () => {
    expect(payDateFor(2026, 1, 45)).toBe('2026-02-28')
    expect(payDateFor(2026, 1, 0)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, -3)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, undefined)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, 'abc')).toBe('2026-02-01')
  })

  it('la fecha que produce SIEMPRE es real: nunca desborda de mes', () => {
    for (let m = 0; m < 12; m++) {
      const iso = payDateFor(2026, m, 31)
      expect(new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10)).toBe(iso)
    }
  })
})

describe('getScheduledPayDates con día 31', () => {
  it('no propone ninguna fecha inexistente', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2025-01-01', incomeMonths: [0,1,2,3,4,5,6,7,8,9,10,11], incomePayDay: 31 },
      new Date('2026-08-11T00:00:00Z')
    )
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) {
      expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d)
    }
    expect(dates).toContain('2026-02-28')
    expect(dates).toContain('2026-04-30')
    expect(dates).not.toContain('2026-02-31')
  })

  it('el mes en curso paga cuando ya pasó su último día recortado', () => {
    // El 31 de septiembre no existe: el pago de septiembre cae el 30, así que
    // el 30 ya cuenta como vencido. Antes, `todayDay < 31` lo bloqueaba siempre.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-09-01', incomeMonths: [8], incomePayDay: 31 },
      new Date('2026-09-30T00:00:00Z')
    )
    expect(dates).toContain('2026-09-30')
  })
})

describe('impossiblePayDateFixes', () => {
  it('corrige lo que la app escribió con un día que no existe', () => {
    const txs = [
      { id: 'a', date: '2026-02-31', _source: 'auto' },
      { id: 'b', date: '2026-04-31', _source: 'auto' },
      { id: 'c', date: '2026-01-31', _source: 'auto' },
    ]
    expect(impossiblePayDateFixes(txs)).toEqual([
      { id: 'a', date: '2026-02-28' },
      { id: 'b', date: '2026-04-30' },
    ])
  })

  it('no toca filas del usuario ni fechas con otro formato', () => {
    const txs = [
      { id: 'm', date: '2026-02-31' },
      { id: 'n', date: '2026-02-31', _source: 'manual_new_account' },
      { id: 'o', date: '2026-02-31T00:00:00Z', _source: 'auto' },
      { id: 'p', _source: 'auto' },
    ]
    expect(impossiblePayDateFixes(txs)).toEqual([])
  })
})

// FASE HV9. La exclusión se compara por MES. El bug que arregla, reportado tres
// veces como "borro el pago y no se guarda": un pago automático se guarda con un
// id determinista (fecha+símbolo+tipo+monto), así que al regenerarse reaparece
// IDÉNTICO y es indistinguible de un borrado que no persistió.
describe('isPayDateExcluded', () => {
  it('excluye el mes entero, no solo el día exacto que se borró', () => {
    // El caso real: la fila borrada estaba fechada el 28 y el calendario de hoy
    // genera el 31, así que la comparación exacta no matcheaba y el pago volvía.
    expect(isPayDateExcluded(['2024-08-28'], '2024-08-31')).toBe(true)
    expect(isPayDateExcluded(['2024-08-31'], '2024-08-28')).toBe(true)
  })

  it('sigue honrando una exclusión de fecha exacta, como antes', () => {
    expect(isPayDateExcluded(['2026-05-15'], '2026-05-15')).toBe(true)
  })

  it('no toca otros meses ni otros años', () => {
    expect(isPayDateExcluded(['2024-08-28'], '2024-09-28')).toBe(false)
    expect(isPayDateExcluded(['2024-08-28'], '2025-08-28')).toBe(false)
    expect(isPayDateExcluded(['2024-08-28'], '2024-12-18')).toBe(false)
  })

  it('sin exclusiones, o con basura, no bloquea nada', () => {
    expect(isPayDateExcluded(undefined, '2024-08-28')).toBe(false)
    expect(isPayDateExcluded([], '2024-08-28')).toBe(false)
    expect(isPayDateExcluded(['2024-08-28'], '')).toBe(false)
    expect(isPayDateExcluded([null, ''], '2024-08-28')).toBe(false)
  })

  it('el caso completo del usuario: los dos meses de 2024 quedan excluidos', () => {
    const excl = ['2024-08-28', '2024-12-18']
    // Da igual qué día produzca el calendario de hoy para esos meses.
    for (const d of ['2024-08-28', '2024-08-31', '2024-08-01', '2024-12-18', '2024-12-31']) {
      expect(isPayDateExcluded(excl, d)).toBe(true)
    }
    // Y 2025 en adelante sigue pagando normal.
    for (const d of ['2025-02-28', '2025-08-28', '2026-02-28']) {
      expect(isPayDateExcluded(excl, d)).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FASE KY. El primer pago tras la compra se prorratea.
//
// El caso literal de FASE KS: comprar el 20 de agosto con dia de pago 1
// acreditaba un mes COMPLETO el 1 de septiembre por ONCE dias de tenencia.
// FASE KT lo cerro solo para devengo diario; estas son las otras ramas.
describe('periodFraction', () => {
  const mensual = [0,1,2,3,4,5,6,7,8,9,10,11]

  test('sin fecha de compra la fraccion es 1', () => {
    expect(periodFraction({ payDate: '2026-09-01', acquisitionDay: null, incomeMonths: mensual, incomePayDay: 1 })).toBe(1)
  })

  test('comprado ANTES del inicio del periodo: periodo completo', () => {
    // Compra en junio, pago del 1 de septiembre: el periodo (1 ago -> 1 sep)
    // se tuvo entero.
    expect(periodFraction({ payDate: '2026-09-01', acquisitionDay: '2026-06-15', incomeMonths: mensual, incomePayDay: 1 })).toBe(1)
  })

  test('comprado EXACTAMENTE al inicio del periodo: periodo completo', () => {
    expect(periodFraction({ payDate: '2026-09-01', acquisitionDay: '2026-08-01', incomeMonths: mensual, incomePayDay: 1 })).toBe(1)
  })

  // El caso del reporte, calculado a mano: el periodo es 1 ago -> 1 sep = 31
  // dias, y del 20 de agosto al 1 de septiembre hay 12.
  test('comprado a mitad del periodo: la fraccion son los dias tenidos', () => {
    const f = periodFraction({ payDate: '2026-09-01', acquisitionDay: '2026-08-20', incomeMonths: mensual, incomePayDay: 1 })
    expect(f).toBeCloseTo(12 / 31, 10)
    expect(f).toBeLessThan(0.5)
  })

  test('trimestral: el periodo son tres meses, no uno', () => {
    // Pago 1 jul, anterior 1 abr = 91 dias. Compra el 1 de junio: 30 dias.
    const f = periodFraction({ payDate: '2026-07-01', acquisitionDay: '2026-06-01', incomeMonths: [0, 3, 6, 9], incomePayDay: 1 })
    expect(f).toBeCloseTo(30 / 91, 10)
  })

  test('calendario irregular: el periodo anterior es el que de verdad toca', () => {
    // Meses de pago ene, feb y jun. El anterior al de junio es FEBRERO.
    const prev = previousPayDate('2026-06-01', [0, 1, 5], 1)
    expect(prev).toBe('2026-02-01')
    // 1 feb -> 1 jun = 120 dias; compra el 1 de mayo = 31 dias.
    expect(periodFraction({ payDate: '2026-06-01', acquisitionDay: '2026-05-01', incomeMonths: [0, 1, 5], incomePayDay: 1 }))
      .toBeCloseTo(31 / 120, 10)
  })

  test('pagador ANUAL: el periodo anterior esta un ano atras', () => {
    expect(previousPayDate('2026-06-15', [5], 15)).toBe('2025-06-15')
  })

  test('el dia de pago se recorta al ultimo dia real del mes', () => {
    // Con 31 configurado, el anterior a marzo es el ULTIMO de febrero.
    expect(previousPayDate('2026-03-31', [0,1,2,3,4,5,6,7,8,9,10,11], 31)).toBe('2026-02-28')
  })
})

describe('monthlyIncomeAmount: que prorratea y que no', () => {
  const mensual = [0,1,2,3,4,5,6,7,8,9,10,11]
  const base = { balance: 5000, incomeMonths: mensual, incomePayDay: 1, payDate: '2026-09-01' }
  const comprado20ago = { ...base, acquisitionDay: '2026-08-20' }

  test('% del saldo: el primer pago es la fraccion, no el mes entero', () => {
    const completo = monthlyIncomeAmount({ ...base, incomeMode: 'percent', incomeRate: 12 }, 12)
    expect(completo).toBeCloseTo(50, 10)  // 5000 * 12% / 12
    const parcial = monthlyIncomeAmount({ ...comprado20ago, incomeMode: 'percent', incomeRate: 12 }, 12)
    expect(parcial).toBeCloseTo(50 * (12 / 31), 10)
  })

  test('tasa variable: idem, sobre el punto medio', () => {
    const completo = monthlyIncomeAmount({ ...base, rateType: 'variable', rateMin: 4, rateMax: 8 }, 12)
    expect(completo).toBeCloseTo(25, 10)  // 5000 * 6% / 12
    expect(monthlyIncomeAmount({ ...comprado20ago, rateType: 'variable', rateMin: 4, rateMax: 8 }, 12))
      .toBeCloseTo(25 * (12 / 31), 10)
  })

  test('capitalizacion continua: idem', () => {
    const completo = monthlyIncomeAmount({ ...base, rateType: 'continuous', incomeRate: 6 }, 12)
    expect(completo).toBeCloseTo((5000 * (Math.exp(0.06) - 1)) / 12, 10)
    expect(monthlyIncomeAmount({ ...comprado20ago, rateType: 'continuous', incomeRate: 6 }, 12))
      .toBeCloseTo(completo * (12 / 31), 10)
  })

  // ⛔ REGRESION A PROPOSITO. Un monto fijo es CONTRACTUAL: un cupon de bono se
  // paga entero sin importar cuando compraste, y el usuario tecleo "esto es lo
  // que recibo por pago". Prorratearlo contradiria lo que declaro.
  test('monto FIJO: NO se prorratea, aunque la compra sea de ayer', () => {
    const completo = monthlyIncomeAmount({ ...base, incomeAmount: 240 }, 12)
    expect(completo).toBe(240)
    expect(monthlyIncomeAmount({ ...comprado20ago, incomeAmount: 240 }, 12)).toBe(240)
  })

  test('un monto fijo POR ACCION escala con la cantidad, sin fraccion', () => {
    expect(monthlyIncomeAmount({ ...comprado20ago, incomeAmount: 2, isPerShare: true, qty: 10 }, 12)).toBe(20)
  })

  // Los pagos POSTERIORES no se tocan: la compra queda antes del inicio de su
  // periodo, asi que la fraccion da 1 sola, sin preguntarle a nadie "es este el
  // primero?".
  test('el segundo pago ya es completo', () => {
    expect(monthlyIncomeAmount({ ...comprado20ago, payDate: '2026-10-01', incomeMode: 'percent', incomeRate: 12 }, 12))
      .toBeCloseTo(50, 10)
  })

  test('sin payDate (callers viejos) el reparto es el de siempre', () => {
    expect(monthlyIncomeAmount({ balance: 5000, incomeMode: 'percent', incomeRate: 12, acquisitionDay: '2026-08-20' }, 12))
      .toBeCloseTo(50, 10)
  })
})
