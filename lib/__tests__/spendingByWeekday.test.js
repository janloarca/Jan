import {
  weekdayOf, weekStartOf, addDaysISO, windowRange, monthKeysBetween,
  buildSpendingRhythm, MIN_WEEKS_OBSERVED,
} from '@/lib/spendingByWeekday'
import { computeMonthlyAnalysis } from '@/lib/financeMonth'

const tx = (date, amount, extra = {}) => ({
  id: `${date}-${amount}-${extra.merchant || ''}`,
  date, amount, type: 'EXPENSE', currency: 'GTQ',
  category: 'Alimentación', merchant: 'TIENDA', ...extra,
})

describe('aritmética de calendario', () => {
  // META-TEST. Todo lo de abajo depende de que la suite NO corra en UTC: con el
  // runner en UTC, `new Date('2026-09-01').getDay()` y la lectura correcta dan
  // lo mismo y estos tests pasarían sin probar nada. jest.config.js la fija en
  // America/Guatemala (FASE LF) justamente por esto.
  it('la suite corre al oeste de UTC, o estos tests no prueban nada', () => {
    expect(new Date('2026-09-01T00:00:00Z').getTimezoneOffset()).toBeGreaterThan(0)
  })

  it('el día de la semana sale de la cadena, no del instante', () => {
    // 1 de septiembre de 2026 es MARTES. Leído como instante en UTC-6 sería el
    // 31 de agosto (lunes): ese es exactamente el bug que esto previene.
    expect(weekdayOf('2026-09-01')).toBe(1)
    expect(new Date('2026-09-01').getDay()).toBe(1) // lunes: la lectura MALA
  })

  it('cubre la semana entera con lunes en 0', () => {
    const got = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
      .map(weekdayOf)
    expect(got).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('la semana arranca en lunes y el domingo cae al final de su fila', () => {
    expect(weekStartOf('2026-09-13')).toBe('2026-09-07') // domingo
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07') // lunes
  })

  it('suma días cruzando meses y años bisiestos', () => {
    expect(addDaysISO('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('la ventana termina HOY, nunca a fin de mes', () => {
    // Los días que no ocurrieron serían ocurrencias en cero y arrastrarían
    // hacia abajo el promedio de cada día de la semana.
    expect(windowRange(3, '2026-09-10')).toEqual({ fromDate: '2026-07-01', toDate: '2026-09-10' })
    expect(windowRange(1, '2026-09-10')).toEqual({ fromDate: '2026-09-01', toDate: '2026-09-10' })
    expect(windowRange(6, '2026-01-15')).toEqual({ fromDate: '2025-08-01', toDate: '2026-01-15' })
  })

  it('enumera los meses de la ventana cruzando el año', () => {
    expect(monthKeysBetween('2025-11-01', '2026-01-15')).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('paridad con el total del mes', () => {
  // La garantía que hace que esta card no pueda contradecir al encabezado del
  // mes: las dos suman con la MISMA definición de gasto.
  it('los cubos diarios de un mes suman exactamente el gasto de ese mes', () => {
    const txs = [
      tx('2026-09-01', 100),
      tx('2026-09-15', 250.55),
      tx('2026-09-15', -40, { merchant: 'DEVOLUCION' }),
      { ...tx('2026-09-20', 900), category: 'Transferencia Enviada' },
      { ...tx('2026-09-21', 500), type: 'INCOME', category: 'Salario' },
    ]
    const analysis = computeMonthlyAnalysis(txs, { month: 8, year: 2026 }, null)
    const r = buildSpendingRhythm(txs, { fromDate: '2026-09-01', toDate: '2026-09-30' })
    expect(r.spent).toBeCloseTo(analysis.expenses, 6)
    expect(r.spent).toBeCloseTo(310.55, 6)
  })

  it('un reembolso resta de su día y el día puede cerrar en negativo', () => {
    // No se filtra con `> 0`: si se filtrara, las partes dejarían de sumar el
    // todo (la lección de FASE MK).
    const txs = [tx('2026-09-15', -40, { merchant: 'DEVOLUCION' })]
    const r = buildSpendingRhythm(txs, { fromDate: '2026-09-01', toDate: '2026-09-30' })
    const day = r.days.find((d) => d.date === '2026-09-15')
    expect(day.total).toBe(-40)
    expect(r.spent).toBe(-40)
  })
})

describe('la rejilla semanal', () => {
  it('siempre da siete celdas y marca las que caen fuera de la ventana', () => {
    // Del jueves 10 al martes 15: la primera semana arranca el lunes 7, así que
    // lunes-miércoles quedan fuera y NO pueden dibujarse como días de cero.
    const r = buildSpendingRhythm([tx('2026-09-10', 100)], { fromDate: '2026-09-10', toDate: '2026-09-15' })
    expect(r.weeks).toHaveLength(2)
    expect(r.weeks[0].days).toHaveLength(7)
    expect(r.weeks[0].days.slice(0, 3).every((d) => d.inWindow === false)).toBe(true)
    expect(r.weeks[0].days[3].inWindow).toBe(true)
    expect(r.weeks[0].total).toBe(100)
  })

  it('marca el día con un pago anual sin sacarlo del total', () => {
    const txs = [tx('2026-09-08', 39782, { merchant: 'SEGUROS' })]
    const r = buildSpendingRhythm(txs, {
      fromDate: '2026-09-01', toDate: '2026-09-30', annualDates: new Set(['2026-09-08']),
    })
    const day = r.days.find((d) => d.date === '2026-09-08')
    expect(day.hasAnnual).toBe(true)
    expect(day.total).toBe(39782)
    expect(r.spent).toBe(39782)
  })
})

describe('el perfil por día de la semana', () => {
  // Doce semanas de lunes a domingo: los lunes caros, el resto parejo.
  const manyWeeks = () => {
    const out = []
    for (let w = 0; w < 12; w++) {
      const monday = addDaysISO('2026-06-01', w * 7)
      out.push(tx(monday, 400, { merchant: 'RALLY PADEL GT', category: 'Entretenimiento' }))
      for (let i = 1; i < 7; i++) out.push(tx(addDaysISO(monday, i), 100))
    }
    return out
  }

  it('promedia por OCURRENCIA y no por total', () => {
    // Del 1 jun al 24 ago (lunes a lunes) hay 13 lunes y 12 martes. Con totales
    // el lunes ganaría por calendario aunque se gaste lo mismo cada día.
    const txs = []
    for (let w = 0; w < 13; w++) txs.push(tx(addDaysISO('2026-06-01', w * 7), 100))
    for (let w = 0; w < 12; w++) txs.push(tx(addDaysISO('2026-06-02', w * 7), 100))
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-08-24' })
    const lunes = r.profile[0]
    const martes = r.profile[1]
    expect(lunes.occurrences).toBe(13)
    expect(martes.occurrences).toBe(12)
    expect(lunes.total).toBeGreaterThan(martes.total)
    expect(lunes.avg).toBeCloseTo(martes.avg, 6)
  })

  it('sin día típico nombra el día caro pero calla el porcentaje', () => {
    // Se gasta solo lunes y martes: la mediana de los siete promedios es cero,
    // así que "X% más que un día normal" sería una división entre cero con cara
    // de dato. El hecho (cuál es el día más caro) sigue siendo afirmable.
    const txs = []
    for (let w = 0; w < 13; w++) txs.push(tx(addDaysISO('2026-06-01', w * 7), 300))
    for (let w = 0; w < 12; w++) txs.push(tx(addDaysISO('2026-06-02', w * 7), 100))
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-08-24' })
    expect(r.typical).toBe(0)
    expect(r.claim.status).toBe('ok')
    expect(r.claim.overPct).toBeNull()
    expect(r.claim.top.weekday).toBe(0)
  })

  it('nombra el día caro y el comercio cuando se lo gana', () => {
    const r = buildSpendingRhythm(manyWeeks(), { fromDate: '2026-06-01', toDate: '2026-08-23' })
    expect(r.claim.status).toBe('ok')
    expect(r.claim.top.weekday).toBe(0)
    expect(r.claim.bottom.avg).toBeLessThan(r.claim.top.avg)
    expect(r.profile[0].merchant.label).toBe('RALLY PADEL GT')
    expect(r.claim.overPct).toBeGreaterThan(100)
  })

  it('agrupa el comercio con la llave compartida y muestra el rótulo del usuario', () => {
    // "RALLY PADEL GT" y "RALLY PADEL" son el MISMO comercio (merchantRuleKey),
    // y el rótulo que el usuario escribió gana sobre la cadena del banco.
    const txs = manyWeeks().map((t, i) => (
      t.merchant === 'RALLY PADEL GT' && i % 2 ? { ...t, merchant: 'RALLY PADEL' } : t
    ))
    const index = new Map([['rally padel', 'padel']])
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-08-23', labelIndex: index })
    expect(r.profile[0].merchant.label).toBe('padel')
    expect(r.profile[0].merchant.days).toBeGreaterThanOrEqual(6)
  })

  it('no afirma nada con menos de las semanas mínimas', () => {
    const txs = []
    for (let w = 0; w < 2; w++) {
      txs.push(tx(addDaysISO('2026-09-07', w * 7), 5000))
      txs.push(tx(addDaysISO('2026-09-08', w * 7), 10))
    }
    const r = buildSpendingRhythm(txs, { fromDate: '2026-09-07', toDate: '2026-09-20' })
    expect(r.claim.status).toBe('insufficient')
    expect(r.claim.weeksObserved).toBeLessThan(MIN_WEEKS_OBSERVED)
    expect(r.claim.top).toBeNull()
    // La rejilla SÍ se puede mostrar: es un hecho, no un patrón.
    expect(r.days.some((d) => d.total === 5000)).toBe(true)
  })

  it('con días parejos lo dice en vez de inventar un día caro', () => {
    const txs = []
    for (let w = 0; w < 12; w++) {
      for (let i = 0; i < 7; i++) txs.push(tx(addDaysISO('2026-06-01', w * 7 + i), 100 + i))
    }
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-08-23' })
    expect(r.claim.status).toBe('flat')
    expect(r.claim.top).not.toBeNull()
  })

  it('caza el promedio jalado por un solo cargo y lo nombra', () => {
    // Doce martes de Q80 y uno con la prima anual de Q39,782: el promedio dice
    // Q3,140 y la mediana Q80. La card lo dice, no lo esconde.
    const txs = []
    for (let w = 0; w < 12; w++) {
      const monday = addDaysISO('2026-06-01', w * 7)
      for (let i = 0; i < 7; i++) txs.push(tx(addDaysISO(monday, i), 80))
    }
    txs.push(tx('2026-07-07', 39782, { merchant: 'SEGUROS UNIVERSALES' }))
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-08-23' })
    const martes = r.profile[1]
    expect(martes.pulledBy).not.toBeNull()
    expect(martes.pulledBy.amount).toBe(39782)
    expect(martes.pulledBy.date).toBe('2026-07-07')
    expect(martes.median).toBeLessThan(martes.avg / 2)
    // El dinero sigue entero en el día y en el total.
    expect(r.days.find((d) => d.date === '2026-07-07').total).toBe(39862)
  })

  it('un día sin nada gastado cuenta como ocurrencia, no como hueco', () => {
    const txs = []
    for (let w = 0; w < 8; w++) txs.push(tx(addDaysISO('2026-06-01', w * 7), 700))
    const r = buildSpendingRhythm(txs, { fromDate: '2026-06-01', toDate: '2026-07-26' })
    expect(r.profile[0].occurrences).toBe(8)
    expect(r.profile[1].occurrences).toBe(8)
    expect(r.profile[1].avg).toBe(0)
    expect(r.profile[0].avg).toBe(700)
  })
})

describe('la ventana se recorta al primer dato', () => {
  it('no promedia sobre meses de los que no hay ni un movimiento', () => {
    const txs = []
    for (let w = 0; w < 6; w++) txs.push(tx(addDaysISO('2026-08-03', w * 7), 210))
    // Se pide medio año pero el archivo empieza en agosto.
    const r = buildSpendingRhythm(txs, { fromDate: '2026-03-01', toDate: '2026-09-07' })
    expect(r.fromDate).toBe('2026-08-03')
    expect(r.profile[0].avg).toBe(210)
  })

  it('sin un solo gasto no afirma nada y no revienta', () => {
    const r = buildSpendingRhythm([], { fromDate: '2026-09-01', toDate: '2026-09-30' })
    expect(r.spent).toBe(0)
    expect(r.claim.status).toBe('insufficient')
    expect(r.weeks.length).toBeGreaterThan(0)
  })

  it('una ventana inválida devuelve vacío en vez de romper', () => {
    expect(buildSpendingRhythm([], { fromDate: 'x', toDate: '2026-09-30' }).days).toEqual([])
    expect(buildSpendingRhythm([], { fromDate: '2026-09-30', toDate: '2026-09-01' }).days).toEqual([])
  })
})
