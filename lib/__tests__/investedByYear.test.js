import {
  computeInvestedByYear, calendarYearGain,
  UNALLOCATED_MIN_ABS, UNALLOCATED_MIN_RATIO,
} from '../investedByYear'

const convert = (amt, from, to) => {
  if (from === to) return amt
  if (from === 'GTQ' && to === 'USD') return amt / 7.7
  if (from === 'USD' && to === 'GTQ') return amt * 7.7
  return amt
}

// Serie con anclas reales en los bordes de 2024 y 2025 (timestamps locales,
// la misma convencion de new Date(year,0,1) que usa el motor).
const series = [
  { ts: new Date(2024, 0, 1).getTime(), value: 1000 },
  { ts: new Date(2024, 11, 30).getTime(), value: 1300 },
  { ts: new Date(2025, 11, 30).getTime(), value: 1400 },
]

const NOW = new Date(2026, 7, 13).getTime()

describe('calendarYearGain', () => {
  test('un anio cerrado con anclas en ambos bordes mide su Dietz (sin flujos: 30%)', () => {
    const g = calendarYearGain({ series, year: 2024, transactions: [], convert, baseCurrency: 'USD' })
    expect(g.abs).toBeCloseTo(300, 2)
    expect(g.pct).toBeCloseTo(30, 1)
  })

  test('la ganancia en dolares neta los flujos del anio: un deposito no es ganancia', () => {
    const txs = [{ type: 'DEPOSIT', date: '2024-06-01', totalAmount: 100, currency: 'USD' }]
    const g = calendarYearGain({ series, year: 2024, transactions: txs, convert, baseCurrency: 'USD' })
    expect(g.abs).toBeCloseTo(200, 2) // 1300 - 1000 - 100
  })

  test('sin ancla de arranque o cierre devuelve null, nunca un numero inventado', () => {
    expect(calendarYearGain({ series, year: 2023, transactions: [], convert, baseCurrency: 'USD' })).toBeNull()
    const soloArranque = [{ ts: new Date(2024, 0, 1).getTime(), value: 1000 }]
    expect(calendarYearGain({ series: soloArranque, year: 2024, transactions: [], convert, baseCurrency: 'USD' })).toBeNull()
  })
})

describe('computeInvestedByYear', () => {
  test('una fila por anio con su invertido, ordenadas del mas reciente al mas viejo', () => {
    const txs = [
      { type: 'DEPOSIT', date: '2024-02-01', totalAmount: 500, currency: 'USD' },
      { type: 'DEPOSIT', date: '2025-03-01', totalAmount: 300, currency: 'USD' },
      { type: 'WITHDRAWAL', date: '2025-06-01', totalAmount: 50, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-01-10', totalAmount: 100, currency: 'USD' },
    ]
    const r = computeInvestedByYear({ transactions: txs, items: [], series: [], convert, baseCurrency: 'USD', nowTs: NOW })
    expect(r.rows.map((x) => x.year)).toEqual([2026, 2025, 2024])
    expect(r.rows[0].invested).toBeCloseTo(100, 2)
    expect(r.rows[1].invested).toBeCloseTo(250, 2)
    expect(r.rows[2].invested).toBeCloseTo(500, 2)
    expect(r.totalInvested).toBeCloseTo(850, 2)
  })

  test('el anio en curso usa el YTD del hook tal cual, jamas lo recalcula', () => {
    const txs = [{ type: 'DEPOSIT', date: '2026-01-10', totalAmount: 100, currency: 'USD' }]
    const r = computeInvestedByYear({
      transactions: txs, items: [], series, convert, baseCurrency: 'USD',
      returnYTD: 7.39, ytdChange: 611.12, nowTs: NOW,
    })
    const cur = r.rows.find((x) => x.year === 2026)
    expect(cur.partial).toBe(true)
    expect(cur.gainPct).toBe(7.39)
    expect(cur.gainAbs).toBe(611.12)
  })

  test('un anio con datos de valor pero cero aportes igual aparece (invertido 0, ganancia real)', () => {
    const r = computeInvestedByYear({ transactions: [], items: [], series, convert, baseCurrency: 'USD', nowTs: NOW })
    const y2024 = r.rows.find((x) => x.year === 2024)
    expect(y2024).toBeDefined()
    expect(y2024.invested).toBe(0)
    expect(y2024.gainAbs).toBeCloseTo(300, 2)
  })

  test('un anio sin actividad y sin ganancia medible no aparece', () => {
    // La serie cubre 2024-2025; 2025 no tiene ancla de arranque cercana al
    // 1 de enero (el punto previo es del 30 dic 2024, dentro de la ventana de
    // 10 dias, asi que 2025 SI mide). 2026 sin returnYTD ni aportes: fuera.
    const r = computeInvestedByYear({ transactions: [], items: [], series, convert, baseCurrency: 'USD', nowTs: NOW })
    expect(r.rows.find((x) => x.year === 2026)).toBeUndefined()
  })

  test('el total de ganancias solo existe cuando TODOS los anios listados tienen dato', () => {
    const txs = [
      { type: 'DEPOSIT', date: '2023-05-01', totalAmount: 200, currency: 'USD' }, // 2023: sin anclas, ganancia null
      { type: 'DEPOSIT', date: '2024-02-01', totalAmount: 500, currency: 'USD' },
    ]
    const r = computeInvestedByYear({ transactions: txs, items: [], series, convert, baseCurrency: 'USD', nowTs: NOW })
    expect(r.rows.find((x) => x.year === 2023).gainAbs).toBeNull()
    expect(r.totalGain).toBeNull()
    // El total de invertido si suma siempre: sale del ledger, no de anclas.
    expect(r.totalInvested).toBeCloseTo(700, 2)
  })

  test('la comision de entrada se descuenta en el anio de su compra, no en otro', () => {
    const items = [{ id: 'vitali', entryFee: 95.78, entryFeeMode: 'separate', currency: 'USD', acquisitionDate: '2026-01-06' }]
    const txs = [
      { type: 'DEPOSIT', date: '2026-01-06', totalAmount: 6095.78, currency: 'USD', _linkedItemId: 'vitali', _source: 'manual_new_account' },
      { type: 'DEPOSIT', date: '2025-03-01', totalAmount: 300, currency: 'USD' },
    ]
    const r = computeInvestedByYear({ transactions: txs, items, series: [], convert, baseCurrency: 'USD', nowTs: NOW })
    expect(r.rows.find((x) => x.year === 2026).invested).toBeCloseTo(6000, 2)
    expect(r.rows.find((x) => x.year === 2025).invested).toBeCloseTo(300, 2)
  })

  test('sin transacciones ni serie no hay nada que mostrar', () => {
    const r = computeInvestedByYear({ transactions: [], items: [], series: [], convert, baseCurrency: 'USD', nowTs: NOW })
    expect(r.hasData).toBe(false)
    expect(r.rows).toEqual([])
  })
})

// El % de una fila es su Dietz, o sea mide contra el VALOR de arranque del
// anio. Sin ese valor a la vista, el unico denominador que el lector tiene
// enfrente es la columna "invertido" de al lado, y da un numero completamente
// distinto: el caso real que lo destapo imprimia +35.31% sobre una fila de
// $760.46 invertidos y +$2,905.76 ganados (2905/760 = 382%).
describe('el valor de arranque viaja con la fila', () => {
  test('calendarYearGain devuelve las dos anclas que acaba de usar', () => {
    const g = calendarYearGain({ series, year: 2024, transactions: [], convert, baseCurrency: 'USD' })
    expect(g.startValue).toBe(1000)
    expect(g.endValue).toBe(1300)
    // El pct que reporta es reconciliable con esas anclas, no con lo aportado.
    expect(g.abs / g.startValue * 100).toBeCloseTo(g.pct, 6)
  })

  test('cada fila cerrada lleva su arranque y su cierre', () => {
    const r = computeInvestedByYear({ transactions: [], items: [], series, convert, baseCurrency: 'USD', nowTs: NOW })
    const y2024 = r.rows.find((x) => x.year === 2024)
    expect(y2024.startValue).toBe(1000)
    expect(y2024.endValue).toBe(1300)
  })

  test('el anio en curso usa el ancla del hook y el patrimonio de hoy', () => {
    const txs = [{ type: 'DEPOSIT', date: '2026-01-10', totalAmount: 100, currency: 'USD' }]
    const r = computeInvestedByYear({
      transactions: txs, items: [], series, convert, baseCurrency: 'USD',
      returnYTD: 2.93, ytdChange: 627.22, ytdStartValue: 21406, netWorth: 28622.18, nowTs: NOW,
    })
    const cur = r.rows.find((x) => x.year === 2026)
    expect(cur.startValue).toBe(21406)
    expect(cur.endValue).toBeCloseTo(28622.18, 2)
    // Y sigue sin recalcular nada del hook.
    expect(cur.gainPct).toBe(2.93)
    expect(cur.gainAbs).toBe(627.22)
  })

  test('un anio sin ganancia medible no inventa un arranque', () => {
    const txs = [{ type: 'DEPOSIT', date: '2022-05-01', totalAmount: 500, currency: 'USD' }]
    const r = computeInvestedByYear({ transactions: txs, items: [], series, convert, baseCurrency: 'USD', nowTs: NOW })
    const y2022 = r.rows.find((x) => x.year === 2022)
    expect(y2022.gainAbs).toBeNull()
    expect(y2022.startValue).toBeNull()
    expect(y2022.endValue).toBeNull()
  })
})

// El pie de la tabla imprimia un guion suelto cuando faltaba UN anio, tirando
// a la basura dos cosas reales: la suma de los anios que SI se midieron, y el
// residuo, que es calculable exacto contra el patrimonio de hoy.
describe('el pie deja de ser un guion', () => {
  // Cinco anios, tres medibles: la forma exacta de la captura del usuario.
  const txs = [
    { type: 'DEPOSIT', date: '2022-05-01', totalAmount: 500, currency: 'USD' },
    { type: 'DEPOSIT', date: '2023-05-01', totalAmount: 200, currency: 'USD' },
    { type: 'DEPOSIT', date: '2024-06-01', totalAmount: 100, currency: 'USD' },
    { type: 'DEPOSIT', date: '2025-06-01', totalAmount: 50, currency: 'USD' },
    { type: 'DEPOSIT', date: '2026-01-10', totalAmount: 1000, currency: 'USD' },
  ]
  const run = (netWorth) => computeInvestedByYear({
    transactions: txs, items: [], series, convert, baseCurrency: 'USD',
    returnYTD: 5, ytdChange: 300, ytdStartValue: 1450, netWorth, nowTs: NOW,
  })

  test('suma lo medido y dice cuantos anios son', () => {
    const r = run(2800)
    expect(r.rows.length).toBe(5)
    expect(r.measuredYears).toBe(3)
    expect(r.unmeasuredYears).toBe(2)
    // 200 (2024) + 50 (2025) + 300 (2026 del hook)
    expect(r.measuredGain).toBeCloseTo(550, 2)
    // El contrato viejo no se movio: totalGain sigue siendo null si falta uno.
    expect(r.totalGain).toBeNull()
  })

  test('invertido + medido + sin repartir = patrimonio de hoy, exacto', () => {
    const r = run(2800)
    expect(r.totalInvested).toBeCloseTo(1850, 2)
    expect(r.unallocated).toBeCloseTo(400, 2)
    expect(r.totalInvested + r.measuredGain + r.unallocated).toBeCloseTo(2800, 6)
  })

  test('un residuo de redondeo no se imprime: seria ruido, no informacion', () => {
    // 1850 + 550 + 5 = 2405; el piso es 0.5% de 2405 = 12.03, asi que 5 calla.
    const r = run(2405)
    expect(r.unallocated).toBeNull()
    expect(Math.max(UNALLOCATED_MIN_ABS, 2405 * UNALLOCATED_MIN_RATIO)).toBeGreaterThan(5)
  })

  test('sin patrimonio no hay residuo que calcular (callers viejos, igual que antes)', () => {
    const r = computeInvestedByYear({
      transactions: txs, items: [], series, convert, baseCurrency: 'USD',
      returnYTD: 5, ytdChange: 300, nowTs: NOW,
    })
    expect(r.unallocated).toBeNull()
    expect(r.measuredGain).toBeCloseTo(550, 2)
  })

  test('con TODOS los anios medidos el residuo se acerca a cero', () => {
    // Solo anios con anclas: 2024, 2025 y el anio en curso.
    const soloMedibles = [
      { type: 'DEPOSIT', date: '2024-06-01', totalAmount: 100, currency: 'USD' },
      { type: 'DEPOSIT', date: '2025-06-01', totalAmount: 50, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-01-10', totalAmount: 1000, currency: 'USD' },
    ]
    const r = computeInvestedByYear({
      transactions: soloMedibles, items: [], series, convert, baseCurrency: 'USD',
      returnYTD: 5, ytdChange: 300, ytdStartValue: 1450, netWorth: 1150 + 550, nowTs: NOW,
    })
    expect(r.unmeasuredYears).toBe(0)
    expect(r.unallocated).toBeNull()
  })

  // Los numeros LITERALES de la captura del usuario.
  test('el caso reportado: $539.76 sin repartir sobre un patrimonio de $28,622.18', () => {
    const invertido = 16303.62 + 760.46 + 3276.86 + 878.66 + 602.15
    const medido = 627.22 + 2905.76 + 2727.69
    expect(invertido).toBeCloseTo(21821.75, 2)
    expect(28622.18 - invertido - medido).toBeCloseTo(539.76, 2)
  })
})
