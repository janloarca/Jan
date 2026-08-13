import { computeInvestedByYear, calendarYearGain } from '../investedByYear'

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
