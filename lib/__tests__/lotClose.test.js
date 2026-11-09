// FASE OB. Las tres reglas del cierre de lotes que tres escritores tenian
// copiadas (y divergidas) a mano. Ver la cabecera de lib/lotClose.js.
import { qtyEpsilon, closesWholeLot, exceedsHolding, closedLotDocId, openLotDocId, roundQty, formatQtyPlain } from '../lotClose'

describe('epsilon relativo', () => {
  it('un polvo de cripto no se declara vendido entero por vender la mitad', () => {
    // Con el 0.0001 absoluto de antes, 0.00005 - 0.000025 < 0.0001 => "todo vendido".
    expect(closesWholeLot(0.000025, 0.00005)).toBe(false)
    expect(closesWholeLot(0.00005, 0.00005)).toBe(true)
  })
  it('vender exactamente lo que se tiene no es sobreventa, ni en polvo ni en ruido', () => {
    expect(exceedsHolding(0.00005, 0.00005)).toBe(false)
    expect(exceedsHolding(10.0000000001, 10)).toBe(false)
    expect(exceedsHolding(0.00006, 0.00005)).toBe(true)
    expect(exceedsHolding(11, 10)).toBe(true)
  })
  it('el epsilon escala con la magnitud y tiene piso en el ultimo decimal', () => {
    expect(qtyEpsilon(0)).toBe(1e-8)
    expect(qtyEpsilon(1_000_000)).toBe(1)
    // Una accion: 1e-6 de 100 = 0.0001, o sea el viejo absoluto para el caso comun.
    expect(qtyEpsilon(100)).toBeCloseTo(0.0001, 10)
  })
  it('roundQty conserva ocho decimales (antes cuatro: un polvo se iba a cero)', () => {
    expect(roundQty(0.00005)).toBe(0.00005)
    expect(roundQty(1.123456789)).toBe(1.12345679)
  })
})

describe('closedLotDocId', () => {
  it('dos cierres parciales del mismo lote el mismo dia NO comparten id', () => {
    const lot = { id: 'BTC-2026-01-01-100000000-5000', quantity: 1 }
    const first = closedLotDocId(lot, '2026-06-01')
    // Tras el primer cierre el lote queda con menos cantidad.
    const second = closedLotDocId({ ...lot, quantity: 0.6 }, '2026-06-01')
    expect(first).not.toBe(second)
  })
  it('es deterministico: un reintento de la transaccion produce el mismo id', () => {
    const lot = { id: 'L', quantity: 3 }
    expect(closedLotDocId(lot, '2026-06-01')).toBe(closedLotDocId({ ...lot }, '2026-06-01'))
    expect(closedLotDocId(lot, '2026-06-01')).not.toMatch(/\d{13}/) // nunca Date.now()
  })
})

describe('openLotDocId', () => {
  it('es deterministico: el mismo lote produce el mismo id', () => {
    const lot = { symbol: 'AAPL', acquisitionDate: '2026-06-01', quantity: 10, costBasis: 150, institution: 'IBKR', itemId: 'item1' }
    expect(openLotDocId(lot)).toBe(openLotDocId({ ...lot }))
  })
  it('cantidad, costo, simbolo, fecha, institucion o dueño distintos producen ids distintos', () => {
    const base = { symbol: 'AAPL', acquisitionDate: '2026-06-01', quantity: 10, costBasis: 150, institution: 'IBKR', itemId: 'item1' }
    const id = openLotDocId(base)
    expect(openLotDocId({ ...base, quantity: 11 })).not.toBe(id)
    expect(openLotDocId({ ...base, costBasis: 151 })).not.toBe(id)
    expect(openLotDocId({ ...base, symbol: 'MSFT' })).not.toBe(id)
    expect(openLotDocId({ ...base, acquisitionDate: '2026-06-02' })).not.toBe(id)
    expect(openLotDocId({ ...base, institution: 'IDC' })).not.toBe(id)
    expect(openLotDocId({ ...base, itemId: 'item2' })).not.toBe(id)
  })
})

describe('formatQtyPlain', () => {
  it('nunca notacion cientifica, sin ceros de cola', () => {
    expect(formatQtyPlain(0.00000015)).toBe('0.00000015')
    expect(formatQtyPlain(1.5e-7)).toBe('0.00000015')
    expect(formatQtyPlain(10)).toBe('10')
    expect(formatQtyPlain(2.5)).toBe('2.5')
    expect(formatQtyPlain(null)).toBe('0')
  })
})

import { orderLotsForClose } from '../lotClose'
describe('orderLotsForClose (FASE RF)', () => {
  const lots = [
    { id: 'a', itemId: 'A', acquisitionDate: '2002-05-06' },
    { id: 'b', itemId: 'B', acquisitionDate: '2026-02-02' },
    { id: 'c', acquisitionDate: '2026-02-02' },
    { id: 'd', acquisitionDate: '2010-01-01' },
  ]
  it('primero los lotes de la posicion y nunca los de otra', () => {
    expect(orderLotsForClose(lots, { itemId: 'B' }).map((l) => l.id)).toEqual(['b', 'd', 'c'])
    expect(orderLotsForClose(lots, { itemId: 'B' }).map((l) => l.id)).not.toContain('a')
  })
  it('sin dueno, la fecha de compra decide', () => {
    expect(orderLotsForClose(lots, { itemId: 'Z', acquisitionDate: '2026-02-02' })[0].id).toBe('c')
  })
})
