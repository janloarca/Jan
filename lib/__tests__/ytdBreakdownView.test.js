import { buildYtdBreakdownView, sortRowsByImpact, internalTransfers, reconcileRows, signOf } from '../ytdBreakdownView'

const groups = [
  { key: 'idc', name: 'IDC', gain: 379.66, ret: 5.29, internal: -223.97 },
  { key: 'ibkr', name: 'Interactive Brokers', gain: 581.06, ret: 7.39, internal: 0 },
  { key: 'aixen', name: 'AIXEN', gain: 0, ret: 0, internal: 223.97 },
  { key: 'osmo', name: 'OSMO', gain: -26.65, ret: -18.1, internal: 0 },
]

describe('ytdBreakdownView', () => {
  it('ordena por impacto absoluto descendente y deja las cuentas en cero visibles', () => {
    const rows = sortRowsByImpact(groups)
    expect(rows.map((r) => r.name)).toEqual(['Interactive Brokers', 'IDC', 'OSMO', 'AIXEN'])
  })

  it('el residuo "Sin atribuir" va siempre al final, aunque sea el mayor', () => {
    const rows = sortRowsByImpact([...groups, { key: '__unexplained__', name: null, isUnexplained: true, gain: 9000, ret: null }])
    expect(rows[rows.length - 1].isUnexplained).toBe(true)
    expect(rows[0].name).toBe('Interactive Brokers')
  })

  it('lista las transferencias internas con su signo y omite el ruido', () => {
    expect(internalTransfers([...groups, { key: 'x', name: 'X', gain: 1, internal: 0.4 }]))
      .toEqual([{ name: 'IDC', amount: -223.97 }, { name: 'AIXEN', amount: 223.97 }])
  })

  it('cuadra: las filas suman el YTD del encabezado', () => {
    const r = reconcileRows(groups, 934.07)
    expect(r.matches).toBe(true)
    expect(r.status).toBe('exact')
  })

  it('es "estimado" con una fila Sin atribuir o con un arranque estimado, aunque cuadre', () => {
    const withResidual = [...groups, { key: '__unexplained__', isUnexplained: true, gain: 59.11, ret: null }]
    expect(reconcileRows(withResidual, 993.18).status).toBe('estimated')
    expect(reconcileRows(groups, 934.07, { degradedAccounts: ['LEGDER'] }).status).toBe('estimated')
  })

  it('es "incompleto" cuando las filas NO suman lo que se muestra arriba', () => {
    const r = reconcileRows(groups, 1200)
    expect(r.matches).toBe(false)
    expect(r.status).toBe('incomplete')
  })

  it('sin YTD no puede cuadrar', () => {
    expect(reconcileRows(groups, null).status).toBe('incomplete')
  })

  it('buildYtdBreakdownView arma las tres piezas y tolera un breakdown nulo', () => {
    const v = buildYtdBreakdownView({ breakdown: { groups }, ytdChange: 934.07 })
    expect(v.rows).toHaveLength(4)
    expect(v.internal).toHaveLength(2)
    expect(v.reconciliation.status).toBe('exact')
    const empty = buildYtdBreakdownView({ breakdown: null, ytdChange: null })
    expect(empty.rows).toEqual([])
    expect(empty.internal).toEqual([])
  })

  it('signOf: signo y flecha, y -0 se normaliza', () => {
    expect(signOf(12.5)).toMatchObject({ sign: '+', arrow: '▲', tone: 'positive' })
    expect(signOf(-3)).toMatchObject({ sign: '−', arrow: '▼', tone: 'negative' })
    expect(signOf(-0)).toEqual({ value: 0, sign: '', arrow: '', tone: 'neutral' })
    expect(Object.is(signOf(-0).value, 0)).toBe(true)
    expect(signOf(NaN).tone).toBe('neutral')
  })
})
