import { buildReceivedByMonth, projectNext12, yoySamePeriod, monthKey } from '../incomeBreakdown'

const items = [
  { id: 'a', name: 'Bono A', type: 'Bond', currency: 'USD' },
  { id: 'b', name: 'Fondo B', type: 'Fund', currency: 'USD', dividendAction: 'reinvest' },
  { id: 'c', name: 'Banco C', type: 'Bank', currency: 'USD' },
]
const tx = (o) => ({ type: 'DIVIDEND', currency: 'USD', ...o })

describe('buildReceivedByMonth', () => {
  const txs = [
    tx({ date: '2026-10-01', totalAmount: 100, _linkedItemId: 'a', _destinationItemId: 'c' }),
    tx({ date: '2026-10-15', totalAmount: 50, _linkedItemId: 'a' }),
    tx({ date: '2026-10-01', totalAmount: 30, _linkedItemId: 'b', _reinvested: true }),
    tx({ date: '2026-09-01', totalAmount: 20, _linkedItemId: 'c' }),
  ]
  const r = buildReceivedByMonth({ transactions: txs, items, baseCurrency: 'USD' })

  it('agrupa por activo y suma el total del mes sin lo reinvertido', () => {
    const oct = r['2026-09']
    expect(oct.total).toBe(150)
    expect(oct.rows).toHaveLength(1)
    expect(oct.rows[0]).toMatchObject({ label: 'Bono A', amount: 150, count: 2, incomeType: 'coupon', destLabel: 'Banco C' })
    expect(oct.rows[0].dates).toEqual(['2026-10-01', '2026-10-15'])
  })
  it('lo reinvertido va aparte', () => {
    expect(r['2026-09'].reinvestedTotal).toBe(30)
    expect(r['2026-09'].reinvestedRows[0].label).toBe('Fondo B')
  })
  it('el total del popup es el de la barra (suma de filas)', () => {
    const m = r['2026-08']
    expect(m.rows.reduce((s, x) => s + x.amount, 0)).toBe(m.total)
  })
  it('la fecha del dia 1 no cae en el mes anterior', () => {
    expect(r['2026-09'].month).toBe(9)
  })
})

describe('projectNext12', () => {
  const sources = [
    { id: 'a', label: 'A', annual: 1200, months: [0, 9, 10], payDay: 31, incomeType: 'coupon', destLabel: null },
    { id: 'b', label: 'B', annual: 120, months: [9], payDay: 5, incomeType: 'dividend', reinvest: true },
  ]
  const now = new Date(2026, 9, 17)
  const out = projectNext12(sources, new Set(['b']), now)
  it('empieza en el mes actual y cruza de ano', () => {
    expect(out[0].key).toBe(monthKey(2026, 9))
    expect(out[3].key).toBe(monthKey(2027, 0))
    expect(out).toHaveLength(12)
  })
  it('descuenta lo ya cobrado este mes', () => {
    expect(out[0].rows.map((r) => r.id)).toEqual(['a'])
    expect(out[0].paidCount).toBe(1)
  })
  it('recorta el dia de pago al fin de mes', () => {
    expect(out[1].rows[0].day).toBe(30)
  })
})

describe('yoySamePeriod', () => {
  const now = new Date(2026, 9, 17)
  it('compara contra el mismo tramo del ano pasado', () => {
    const txs = [
      tx({ date: '2025-03-01', totalAmount: 100 }),
      tx({ date: '2025-12-01', totalAmount: 300 }),
      tx({ date: '2026-03-01', totalAmount: 200 }),
    ]
    const r = yoySamePeriod({ transactions: txs, items, baseCurrency: 'USD', now })
    expect(r).toMatchObject({ thisYear: 200, lastYear: 100, lastYearFull: 400, samePeriod: true })
    expect(r.growth).toBe(100)
  })
  it('sin base comparable muestra el ano completo y sin porcentaje', () => {
    const r = yoySamePeriod({ transactions: [tx({ date: '2025-12-01', totalAmount: 300 })], items, baseCurrency: 'USD', now })
    expect(r.samePeriod).toBe(false)
    expect(r.lastYear).toBe(300)
    expect(r.growth).toBeNull()
  })
})
