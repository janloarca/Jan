import { searchGlobal, normalizeSearch, symbolActivity, zeroUnitsNote } from '../globalSearch'

const ACTIONS = [
  { id: 'settings', label: 'Configuración' },
  { id: 'export', label: 'Exportar Excel' },
]

const items = [
  { id: 'a1', symbol: 'AAPL', name: 'Apple Inc.', institution: 'Interactive Brokers', quantity: 10 },
  { id: 'v1', symbol: 'VITALI', name: 'Bono Vitali', institution: 'IDC', quantity: 1 },
  { id: 't0', symbol: 'TSLA', name: 'Tesla', institution: 'Interactive Brokers', quantity: 0 },
]
const lots = [
  { symbol: 'SPCX', quantity: 5, status: 'closed' },
  { symbol: 'spcx', quantity: 3, status: 'closed' },
  { symbol: 'TSLA', quantity: 2, status: 'closed' },
]
const transactions = [
  { id: 'x1', symbol: 'SPCX', type: 'BUY', date: '2026-01-10', description: 'Compra SPCX' },
  { id: 'x2', symbol: 'SPCX', type: 'SELL', date: '2026-03-10' },
  { id: 'x3', symbol: 'TSLA', type: 'SELL', date: '2026-04-01' },
  { id: 'x4', symbol: 'CASH', type: 'DEPOSIT', date: '2026-02-01', description: 'Depósito de nómina' },
  { id: 'x5', type: 'DIVIDEND', date: '2026-05-15', _linkedItemId: 'v1', description: 'Cupón Vitali' },
]

describe('normalizeSearch', () => {
  it('ignora mayúsculas y acentos', () => {
    expect(normalizeSearch('  Acción ')).toBe('accion')
    expect(normalizeSearch('DEPÓSITO')).toBe('deposito')
  })
})

describe('searchGlobal', () => {
  it('encuentra SPCX con 0 unidades y SIN ítem, por sus lotes y movimientos', () => {
    const r = searchGlobal({ query: 'spcx', items, lots, transactions, actions: ACTIONS })
    const sym = r.find((x) => x.type === 'symbol' && x.symbol === 'SPCX')
    expect(sym).toBeTruthy()
    expect(sym.txCount).toBe(2)
    expect(sym.lotCount).toBe(2)
    // El primer resultado es el símbolo, no "Sin resultados".
    expect(r[0].type).toBe('symbol')
    expect(zeroUnitsNote(sym, 'es')).toBe('0 unidades · 2 movimientos · 2 lotes')
  })

  it('una posición viva con 0 unidades sale como ítem marcado, no duplicada como símbolo', () => {
    const r = searchGlobal({ query: 'TSLA', items, lots, transactions, actions: ACTIONS })
    const it = r.find((x) => x.type === 'item')
    expect(it.item.id).toBe('t0')
    expect(it.zeroUnits).toBe(true)
    expect(it.txCount).toBe(1)
    expect(r.filter((x) => x.type === 'symbol')).toHaveLength(0)
  })

  it('es insensible a mayúsculas y acentos en descripciones', () => {
    const r = searchGlobal({ query: 'DEPOSITO', items, lots, transactions, actions: ACTIONS })
    const tx = r.find((x) => x.type === 'transaction')
    expect(tx.tx.id).toBe('x4')
    // CASH no se presenta como símbolo ni como posición.
    expect(r.some((x) => x.type === 'symbol')).toBe(false)
  })

  it('un movimiento sin símbolo hereda el del ítem vinculado', () => {
    const r = searchGlobal({ query: 'vitali', items, lots, transactions, actions: ACTIONS })
    const tx = r.find((x) => x.type === 'transaction' && x.tx.id === 'x5')
    expect(tx).toBeTruthy()
    expect(tx.symbol).toBe('VITALI')
    expect(tx.item.id).toBe('v1')
  })

  it('encuentra cuentas (instituciones) con sus posiciones', () => {
    const r = searchGlobal({ query: 'interactive', items, lots, transactions, actions: ACTIONS })
    const acc = r.find((x) => x.type === 'account')
    expect(acc.name).toBe('Interactive Brokers')
    expect(acc.items.map((i) => i.id).sort()).toEqual(['a1', 't0'])
  })

  it('encuentra acciones sin acentos', () => {
    const r = searchGlobal({ query: 'configuracion', items, lots, transactions, actions: ACTIONS })
    expect(r.map((x) => x.id)).toContain('settings')
  })

  it('sin consulta devuelve solo las acciones', () => {
    const r = searchGlobal({ query: '  ', items, lots, transactions, actions: ACTIONS })
    expect(r.every((x) => x.type === 'action')).toBe(true)
    expect(r).toHaveLength(2)
  })

  it('respeta los límites por tipo y el total', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, symbol: `ZZ${i}`, name: `Zeta ${i}`, quantity: 1 }))
    const txs = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, symbol: `ZQ${i}`, type: 'BUY', date: '2026-01-01' }))
    const r = searchGlobal({ query: 'z', items: many, transactions: txs, limits: { items: 3, symbols: 2, transactions: 4, total: 7 } })
    expect(r.filter((x) => x.type === 'item')).toHaveLength(3)
    expect(r).toHaveLength(7)
    const def = searchGlobal({ query: 'z', items: many, transactions: txs })
    expect(def.length).toBeLessThanOrEqual(25)
    expect(def.filter((x) => x.type === 'item')).toHaveLength(8)
  })

  it('ordena la coincidencia exacta antes que la parcial', () => {
    const r = searchGlobal({ query: 'aa', items: [
      { id: '1', symbol: 'BAAX', quantity: 1 },
      { id: '2', symbol: 'AA', quantity: 1 },
      { id: '3', symbol: 'AAB', quantity: 1 },
    ] })
    expect(r.map((x) => x.item.id)).toEqual(['2', '3', '1'])
  })
})

describe('symbolActivity', () => {
  it('cuenta lotes y movimientos por símbolo en mayúsculas', () => {
    const a = symbolActivity({ items, lots, transactions })
    expect(a.get('SPCX')).toEqual({ txCount: 2, lotCount: 2 })
    expect(a.has('CASH')).toBe(false)
    expect(a.get('VITALI')).toEqual({ txCount: 1, lotCount: 0 })
  })
})
