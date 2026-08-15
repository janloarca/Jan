import { computeYtdInvested } from '../ytdInvested'

// Tasa fija GTQ→USD para que los casos sean verificables a mano.
const convert = (amt, from, to) => {
  if (from === to) return amt
  if (from === 'GTQ' && to === 'USD') return amt / 7.7
  if (from === 'USD' && to === 'GTQ') return amt * 7.7
  return amt
}

const YEAR = 2026

describe('computeYtdInvested', () => {
  test('el caso VITALI: el deposito de apertura trae la comision adentro y se resta una vez (6,095.78 invierte 6,000)', () => {
    const items = [{ id: 'vitali', entryFee: 95.78, entryFeeMode: 'separate', currency: 'USD', acquisitionDate: '2026-01-06' }]
    const transactions = [{
      type: 'DEPOSIT', date: '2026-01-06', totalAmount: 6095.78, currency: 'USD',
      _linkedItemId: 'vitali', _source: 'manual_new_account',
    }]
    const r = computeYtdInvested({ transactions, items, year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.deposits).toBeCloseTo(6095.78, 2)
    expect(r.fees).toBeCloseTo(95.78, 2)
    expect(r.invested).toBeCloseTo(6000, 2)
  })

  test('modo deducted: la comision salio del monto enviado, tambien se resta una vez', () => {
    const items = [{ id: 'a', entryFee: 95.78, entryFeeMode: 'deducted', currency: 'USD', acquisitionDate: '2026-02-01' }]
    const transactions = [{
      type: 'DEPOSIT', date: '2026-02-01', totalAmount: 6000, currency: 'USD',
      _linkedItemId: 'a', _source: 'manual_new_account',
    }]
    const r = computeYtdInvested({ transactions, items, year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(5904.22, 2)
  })

  test('netea depositos menos retiros y convierte cada movimiento con SU moneda', () => {
    const transactions = [
      { type: 'DEPOSIT', date: '2026-03-01', totalAmount: 1000, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-04-10', totalAmount: 770, currency: 'GTQ' }, // = 100 USD
      { type: 'WITHDRAWAL', date: '2026-05-02', totalAmount: 200, currency: 'USD' },
    ]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.deposits).toBeCloseTo(1100, 2)
    expect(r.withdrawals).toBeCloseTo(200, 2)
    expect(r.invested).toBeCloseTo(900, 2)
  })

  test('TRANSFER, DIVIDEND, INTEREST, BUY y SELL no son aportes y no entran', () => {
    const transactions = [
      { type: 'TRANSFER', date: '2026-03-01', totalAmount: 500, currency: 'USD', _originItemId: 'x', _linkedItemId: 'y' },
      { type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD' },
      { type: 'INTEREST', date: '2026-06-01', totalAmount: 12, currency: 'USD' },
      { type: 'BUY', date: '2026-06-02', totalAmount: 300, currency: 'USD' },
      { type: 'SELL', date: '2026-06-03', totalAmount: 300, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-06-04', totalAmount: 100, currency: 'USD' },
    ]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(100, 2)
  })

  test('fuera del anio calendario no cuenta, dentro de los bordes si', () => {
    const transactions = [
      { type: 'DEPOSIT', date: '2025-12-31', totalAmount: 999, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-01-01', totalAmount: 10, currency: 'USD' },
      { type: 'DEPOSIT', date: '2026-12-31', totalAmount: 20, currency: 'USD' },
      { type: 'DEPOSIT', date: '2027-01-01', totalAmount: 888, currency: 'USD' },
    ]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(30, 2)
  })

  test('una correccion de saldo (manual_edit_adjustment) no es un aporte', () => {
    const transactions = [
      { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 150, currency: 'USD', _source: 'manual_edit_adjustment' },
      { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 100, currency: 'USD', _source: 'manual_contribution' },
    ]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(100, 2)
  })

  test('los flujos del broker (ibkr) y los inferidos aceptados cuentan: son dinero externo real', () => {
    const transactions = [
      { type: 'DEPOSIT', date: '2026-01-27', totalAmount: 1450, currency: 'USD', symbol: 'CASH', _source: 'ibkr' },
      { type: 'DEPOSIT', date: '2026-02-26', totalAmount: 1350, currency: 'USD', symbol: 'CASH', _source: 'inferred_flow' },
      { type: 'WITHDRAWAL', date: '2026-04-10', totalAmount: 100, currency: 'USD', symbol: 'CASH', _source: 'ibkr' },
    ]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(2700, 2)
  })

  test('sin deposito de apertura contado, la comision no se resta (cuenta fondeada desde otra cuenta propia)', () => {
    const items = [{ id: 'b', entryFee: 50, entryFeeMode: 'separate', currency: 'USD', acquisitionDate: '2026-03-01' }]
    const transactions = [
      { type: 'DEPOSIT', date: '2026-03-05', totalAmount: 100, currency: 'USD', _source: 'manual_contribution', _linkedItemId: 'b' },
    ]
    const r = computeYtdInvested({ transactions, items, year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.fees).toBe(0)
    expect(r.invested).toBeCloseTo(100, 2)
  })

  test('un agregar-a-posicion de este anio no se trae la comision de una compra de un anio viejo', () => {
    const items = [{ id: 'c', entryFee: 80, entryFeeMode: 'separate', currency: 'USD', acquisitionDate: '2025-06-01' }]
    const transactions = [
      // El merge escribe manual_new_account vinculado al mismo item, pero la
      // comision pertenece a la compra original de 2025.
      { type: 'DEPOSIT', date: '2026-04-01', totalAmount: 500, currency: 'USD', _linkedItemId: 'c', _source: 'manual_new_account' },
    ]
    const r = computeYtdInvested({ transactions, items, year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.fees).toBe(0)
    expect(r.invested).toBeCloseTo(500, 2)
  })

  test('la comision se convierte con la moneda del item, no con la base', () => {
    const items = [{ id: 'q', entryFee: 77, currency: 'GTQ', acquisitionDate: '2026-02-01' }] // = 10 USD
    const transactions = [
      { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 7777, currency: 'GTQ', _linkedItemId: 'q', _source: 'manual_new_account' },
    ]
    const r = computeYtdInvested({ transactions, items, year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.deposits).toBeCloseTo(1010, 1)
    expect(r.fees).toBeCloseTo(10, 2)
    expect(r.invested).toBeCloseTo(1000, 1)
  })

  test('sin convert, los montos crudos (mismo respaldo que el resto de la app)', () => {
    const transactions = [{ type: 'DEPOSIT', date: '2026-02-01', totalAmount: 100, currency: 'GTQ' }]
    const r = computeYtdInvested({ transactions, items: [], year: YEAR, baseCurrency: 'USD' })
    expect(r.invested).toBe(100)
  })

  test('un anio sin movimientos no tiene nada que mostrar (hasActivity false)', () => {
    const r = computeYtdInvested({ transactions: [], items: [], year: YEAR, convert, baseCurrency: 'USD' })
    expect(r.invested).toBe(0)
    expect(r.hasActivity).toBe(false)
  })
})
