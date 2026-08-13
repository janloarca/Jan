import { makeConvert, enrichItemsServerSide, weeklyMovers, incomeInWindow, netWorthFromItems } from '../serverPortfolio'
import { getItemValue, isExcludedFromNetWorth } from '../../components/dashboard/utils'

const RATES = { USD: 1, GTQ: 7.7 }

describe('convert del servidor: espejo del cliente', () => {
  const convert = makeConvert(RATES, 'USD')
  test('convierte con la misma fórmula (amount / from) * to', () => {
    expect(convert(770, 'GTQ', 'USD')).toBeCloseTo(100, 6)
    expect(convert(100, 'USD', 'GTQ')).toBeCloseTo(770, 6)
  })
  test('misma moneda no toca el monto', () => {
    expect(convert(500, 'USD', 'USD')).toBe(500)
  })
  test('sin tasa devuelve el monto CRUDO, nunca cero', () => {
    expect(convert(500, 'JPY', 'USD')).toBe(500)
    expect(makeConvert(null, 'USD')(500, 'GTQ', 'USD')).toBe(500)
  })
})

describe('enriquecimiento server-side', () => {
  const convert = makeConvert(RATES, 'USD')

  test('aplica la cotización a un activo de mercado y la convierte a base', () => {
    const items = [{ id: 'a', symbol: 'AAPL', type: 'Stock', quantity: 10, purchasePrice: 150, currency: 'USD' }]
    const prices = { AAPL: { price: 180, change7d: 2.5, change1d: 0.4, currency: 'USD' } }
    const [out] = enrichItemsServerSide(items, prices, convert, 'USD')
    expect(out.currentPrice).toBe(180)
    expect(out.change7d).toBe(2.5)
    expect(out._originalPrice).toBe(180)
    expect(getItemValue(out)).toBeCloseTo(1800, 6)
  })

  test('una cotización en otra moneda se convierte a la base', () => {
    const items = [{ id: 'b', symbol: 'XYZ', type: 'Stock', quantity: 2, currency: 'USD' }]
    const prices = { XYZ: { price: 770, change7d: 1, change1d: 0, currency: 'GTQ' } }
    const [out] = enrichItemsServerSide(items, prices, convert, 'USD')
    expect(out.currentPrice).toBeCloseTo(100, 6)
    expect(out._originalCurrency).toBe('GTQ')
  })

  // La regla que impide que un bono codificado "TE" tome el precio de un
  // ticker real: sin ella el patrimonio del correo saldría inventado.
  test('un item que NO cotiza jamás recibe una cotización, aunque el símbolo coincida', () => {
    const items = [{ id: 'c', symbol: 'TE', type: 'Bond', quantity: 1, purchasePrice: 6000, currency: 'USD' }]
    const prices = { TE: { price: 42, change7d: 9, change1d: 1, currency: 'USD' } }
    const [out] = enrichItemsServerSide(items, prices, convert, 'USD')
    expect(out.currentPrice).toBe(6000)
    expect(out.change7d).toBeUndefined()
  })

  test('un saldo en quetzales se convierte a la base', () => {
    const items = [{ id: 'd', name: 'Fondo', type: 'Bank', quantity: 1, purchasePrice: 770, currency: 'GTQ' }]
    const [out] = enrichItemsServerSide(items, {}, convert, 'USD')
    expect(getItemValue(out)).toBeCloseTo(100, 6)
  })
})

describe('patrimonio y movers', () => {
  const convert = makeConvert(RATES, 'USD')
  const helpers = { isExcluded: isExcludedFromNetWorth, getValue: getItemValue }

  test('la deuda resta y el por-cobrar excluido no suma', () => {
    const items = enrichItemsServerSide([
      { id: 'a', type: 'Stock', symbol: 'AAPL', quantity: 10, purchasePrice: 100, currency: 'USD' },
      { id: 'b', type: 'Debt', isDebt: true, quantity: 1, purchasePrice: 200, currency: 'USD' },
      { id: 'c', type: 'Receivable', isReceivable: true, countInNetWorth: false, quantity: 1, purchasePrice: 999, currency: 'USD' },
    ], {}, convert, 'USD')
    const { netWorth, totalDebt } = netWorthFromItems(items, helpers)
    expect(netWorth).toBeCloseTo(800, 6)
    expect(totalDebt).toBeCloseTo(200, 6)
  })

  test('los movers se ordenan por IMPACTO en el portafolio, no por % del papel', () => {
    const items = enrichItemsServerSide([
      { id: 'big', symbol: 'BIG', type: 'Stock', quantity: 100, currency: 'USD' },
      { id: 'tiny', symbol: 'TINY', type: 'Stock', quantity: 1, currency: 'USD' },
    ], {
      BIG: { price: 100, change7d: 2, change1d: 0, currency: 'USD' },   // impacto 200
      TINY: { price: 50, change7d: 30, change1d: 0, currency: 'USD' },  // impacto 15
    }, convert, 'USD')
    const movers = weeklyMovers(items)
    expect(movers[0].symbol).toBe('BIG')
    expect(movers[1].symbol).toBe('TINY')
  })

  test('un item sin cotización no puede ser mover', () => {
    const items = enrichItemsServerSide([{ id: 'x', symbol: 'VITALI', type: 'Bond', quantity: 1, purchasePrice: 6000, currency: 'USD' }], {}, convert, 'USD')
    expect(weeklyMovers(items)).toEqual([])
  })
})

describe('ingreso cobrado en la ventana', () => {
  const convert = makeConvert(RATES, 'USD')
  const from = Date.parse('2026-08-10T00:00:00Z')
  const to = Date.parse('2026-08-16T23:59:59Z')

  test('suma dividendos e intereses de la ventana, convertidos a base', () => {
    const txs = [
      { type: 'DIVIDEND', date: '2026-08-12', totalAmount: 240, currency: 'USD' },
      { type: 'INTEREST', date: '2026-08-14', totalAmount: 77, currency: 'GTQ' },
      { type: 'DIVIDEND', date: '2026-07-01', totalAmount: 999, currency: 'USD' }, // fuera
    ]
    const { total, count } = incomeInWindow(txs, { fromTs: from, toTs: to, convert, baseCurrency: 'USD' })
    expect(total).toBeCloseTo(250, 6)
    expect(count).toBe(2)
  })

  test('lo reinvertido no cuenta: nunca salió del activo', () => {
    const items = [{ id: 'r', dividendAction: 'reinvest' }]
    const txs = [
      { type: 'DIVIDEND', date: '2026-08-12', totalAmount: 100, currency: 'USD', _reinvested: true },
      { type: 'DIVIDEND', date: '2026-08-13', totalAmount: 50, currency: 'USD', _linkedItemId: 'r' },
    ]
    const { total, count } = incomeInWindow(txs, { fromTs: from, toTs: to, convert, baseCurrency: 'USD', items })
    expect(total).toBe(0)
    expect(count).toBe(0)
  })
})
