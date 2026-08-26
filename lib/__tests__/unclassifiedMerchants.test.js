import { unclassifiedMerchants } from '../unclassifiedMerchants'

const row = (id, merchant, amount, extra = {}) => ({
  id, type: 'EXPENSE', amount, currency: 'GTQ', date: '2026-07-10',
  merchant, description: merchant, category: 'Otros Gastos', source: 'card_import',
  ...extra,
})

describe('unclassifiedMerchants', () => {
  it('agrupa el MISMO comercio con colas distintas de banco en una sola fila', () => {
    // La normalizacion de merchantRuleKey: "FINCA FELIZ GT" y "FINCA FELIZ
    // ZONA 10" son el mismo lugar escrito por dos bancos.
    const r = unclassifiedMerchants([
      row('a', 'FINCA FELIZ GT', 100),
      row('b', 'FINCA FELIZ ZONA 10', 250),
    ])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].total).toBeCloseTo(350)
    expect(r.rows[0].count).toBe(2)
    expect(r.rows[0].txIds.sort()).toEqual(['a', 'b'])
  })

  it('solo filas de maquina en "Otros Gastos": lo tecleado a mano y lo decidido no entran', () => {
    const r = unclassifiedMerchants([
      row('a', 'HOSTAL X', 100),
      row('mano', 'ALGO MIO', 500, { source: undefined }),                 // tecleada a mano
      row('user', 'YA DECIDIDO', 500, { _categorySetByUser: true }),       // decision del usuario
      row('cat', 'RESTAURANTE Y', 500, { category: 'Alimentación' }),      // ya clasificada
      row('fee', 'MEMBRESIA CLUB', 500, { kind: 'fee' }),                  // el kind no es comercio
      row('sinid', 'SIN ID', 500, { id: undefined }),
    ])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].merchant).toBe('HOSTAL X')
  })

  it('ordena por dinero acumulado y reporta el resumen honesto', () => {
    const rows = []
    for (let i = 0; i < 8; i++) rows.push(row(`x${i}`, `LUGAR ${String.fromCharCode(65 + i)}Q`, (i + 1) * 100))
    const r = unclassifiedMerchants(rows, { top: 3 })
    expect(r.rows.map((x) => x.total)).toEqual([800, 700, 600])
    expect(r.moreCount).toBe(5)
    expect(r.coveredTotal).toBeCloseTo(2100)
    expect(r.totalAll).toBeCloseTo(3600)
  })

  it('las capturas del atajo (_source auto_*) tambien entran', () => {
    const r = unclassifiedMerchants([
      row('a', 'DONALD', 350, { source: undefined, _source: 'auto_shortcut' }),
    ])
    expect(r.rows).toHaveLength(1)
  })

  it('convierte a GTQ con el convert del caller', () => {
    const conv = (v, from, to) => (from === 'USD' && to === 'GTQ' ? v * 7.7 : v)
    const r = unclassifiedMerchants([row('a', 'PLACE USD', 10, { currency: 'USD' })], { convert: conv })
    expect(r.rows[0].total).toBeCloseTo(77)
  })

  it('se queda con el texto MAS CORTO como etiqueta (el nombre sin la cola)', () => {
    const r = unclassifiedMerchants([
      row('a', 'FINCA FELIZ ZONA 10', 100),
      row('b', 'FINCA FELIZ', 100),
    ])
    expect(r.rows[0].merchant).toBe('FINCA FELIZ')
  })
})
