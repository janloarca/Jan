// FASE OB. Las tres reglas del cierre de lotes que tres escritores tenian
// copiadas (y divergidas) a mano. Ver la cabecera de lib/lotClose.js.
import { qtyEpsilon, closesWholeLot, exceedsHolding, closedLotDocId, roundQty, formatQtyPlain } from '../lotClose'

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

describe('formatQtyPlain', () => {
  it('nunca notacion cientifica, sin ceros de cola', () => {
    expect(formatQtyPlain(0.00000015)).toBe('0.00000015')
    expect(formatQtyPlain(1.5e-7)).toBe('0.00000015')
    expect(formatQtyPlain(10)).toBe('10')
    expect(formatQtyPlain(2.5)).toBe('2.5')
    expect(formatQtyPlain(null)).toBe('0')
  })
})
