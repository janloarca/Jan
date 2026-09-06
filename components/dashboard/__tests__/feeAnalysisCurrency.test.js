/** @jest-environment jsdom */
// FASE OE. Una comision de gestion FIJA se teclea en la moneda del item y la
// card la sumaba cruda sobre un valor ya convertido a la base.
const React = require('react')
const { render } = require('@testing-library/react')
const { setBaseCurrency } = require('../utils')
const FeeAnalysis = require('../FeeAnalysis').default
const RATES = { USD: 1, GTQ: 7.7 }
const convert = (amt, from, to) => (!from || !to || from === to ? amt : amt / RATES[from] * RATES[to])
afterEach(() => setBaseCurrency('USD'))

it('con base GTQ, $50 fijos de un fondo en dolares cuentan como Q385, no Q50', () => {
  setBaseCurrency('GTQ')
  const fund = { id: 'f', type: 'Fund', quantity: 1, currentPrice: 77000, purchasePrice: 77000, currency: 'USD', _originalCurrency: 'USD', managementFee: 50, managementFeeType: 'fixed' }
  const { container } = render(React.createElement(FeeAnalysis, { items: [fund], netWorth: 77000, lang: 'es', convert, baseCurrency: 'GTQ' }))
  const txt = container.textContent.replace(/\u00a0/g, ' ')
  expect(txt).toContain('GTQ 385.00')
  expect(txt).not.toContain('GTQ 50.00')
})
it('sin convert (callers viejos) el comportamiento es el de siempre', () => {
  const fund = { id: 'f', type: 'Fund', quantity: 1, currentPrice: 10000, purchasePrice: 10000, currency: 'USD', managementFee: 50, managementFeeType: 'fixed' }
  const { container } = render(React.createElement(FeeAnalysis, { items: [fund], netWorth: 10000, lang: 'es' }))
  expect(container.textContent).toContain('$50.00')
})
