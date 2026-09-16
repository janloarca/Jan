/** @jest-environment jsdom */
// FASE OE. El "Retorno total" de AccountReviewModal era la única superficie
// MONTADA con su propia fórmula: sumaba dividendos por símbolo y crudos,
// restaba la comisión de entrada del numerador (el error #1 de la spec
// congelada: 2.4% sobre VITALI) y descontaba un año de comisión de gestión
// como si ya se hubiera pagado. Se prueba el componente REAL.
const React = require('react')
const { render } = require('@testing-library/react')
const { setBaseCurrency } = require('../utils')
const AccountReviewModal = require('../AccountReviewModal').default

const RATES = { USD: 1, GTQ: 7.7 }
const convert = (amt, from, to) => (!from || !to || from === to ? amt : amt / RATES[from] * RATES[to])
const vitali = (base, over = {}) => ({
  id: 'bond', name: 'VITALI', symbol: 'VITALI', type: 'Bond', quantity: 1, currency: 'USD', entryFee: 98, entryFeeMode: 'separate',
  acquisitionDate: '2026-01-06', institution: 'IDC',
  purchasePrice: convert(6000, 'USD', base), currentPrice: convert(6000, 'USD', base),
  _originalPrice: 6000, _originalPurchasePrice: 6000, _originalCurrency: 'USD', ...over,
})
const coupon = (over = {}) => ({ id: 'c1', type: 'DIVIDEND', symbol: 'VITALI', date: '2026-05-15', totalAmount: 240, currency: 'USD', _linkedItemId: 'bond', ...over })

function show({ base = 'USD', items, transactions }) {
  setBaseCurrency(base)
  return render(React.createElement(AccountReviewModal, {
    items, transactions, onClose: () => {}, onEditItem: () => {}, lang: 'es', findings: [], convert, baseCurrency: base,
  })).container.textContent.replace(/\u00a0/g, ' ') // Intl separa codigo y numero con NBSP
}
afterEach(() => setBaseCurrency('USD'))

describe('AccountReviewModal: retorno total con la formula congelada', () => {
  it('VITALI con base USD imprime +$240.00 (+3.94%), nunca 2.4% ni 4.00%', () => {
    const txt = show({ items: [vitali('USD')], transactions: [coupon()] })
    expect(txt).toContain('+$240.00 (+3.94%)')
    expect(txt).not.toContain('2.4%')
    expect(txt).not.toContain('4.00%')
    expect(txt).toContain('Dividendos: +$240.00')
    // La comision se dice en la moneda del item y se DICE que ya vive en el
    // costo (denominador), no como un costo aparte que la restaria dos veces.
    expect(txt).toContain('Comisión de entrada: $98.00 (ya en el costo)')
    expect(txt).not.toContain('Costos: -')
  })
  it('con base GTQ el cupon de $240 se convierte (Q1,848), no se imprime como Q240', () => {
    const txt = show({ base: 'GTQ', items: [vitali('GTQ')], transactions: [coupon()] })
    expect(txt).toContain('Dividendos: +GTQ 1,848.00')
    expect(txt).not.toContain('GTQ 240.00')
    // La ganancia es la misma, convertida. El % sale 3.99 y no 3.94 porque la
    // comision de entrada NO se convierte con base en quetzales (el hallazgo
    // congelado A/E de FASE OB, que espera OK del usuario): esta superficie
    // hereda exactamente lo que dicen las tarjetas, ni mas ni menos.
    expect(txt).toContain('+GTQ 1,848.00 (+3.99%)')
    expect(txt).toContain('Comisión de entrada: $98.00')
  })
  it('un dividendo de OTRA posicion con el mismo simbolo no se le acredita (atribucion por vinculo, como las tarjetas)', () => {
    const other = coupon({ id: 'c2', _linkedItemId: 'bond-2', totalAmount: 1000 })
    const txt = show({ items: [vitali('USD')], transactions: [coupon(), other] })
    expect(txt).toContain('+$240.00 (+3.94%)')
    expect(txt).toContain('(1x)')
  })
  it('un dividendo reinvertido no es efectivo cobrado: no entra al ingreso', () => {
    const txt = show({ items: [vitali('USD', { dividendAction: 'reinvest' })], transactions: [coupon()] })
    expect(txt).not.toContain('Dividendos:')
  })
})
