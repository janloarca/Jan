/** @jest-environment jsdom */
// FASE OE. Una alerta de precio se compara en la moneda de la COTIZACION y
// la pantalla la imprimia en la moneda BASE.
const React = require('react')
const { render } = require('@testing-library/react')
const { setBaseCurrency } = require('../../components/dashboard/utils')
const { quoteCurrencyOf, formatQuotePrice } = require('../priceAlertCurrency')
const { checkPriceAlerts } = require('../notifications')
const PriceAlerts = require('../../components/dashboard/PriceAlerts').default

const prices = { AAPL: { price: 200, currency: 'USD' }, 'SHEL.L': { price: 2650, currency: 'GBp' } }
const alerts = [
  { id: 'a1', symbol: 'AAPL', direction: 'above', targetPrice: 150 },
  { id: 'a2', symbol: 'SHEL.L', direction: 'below', targetPrice: 2500 },
]
afterEach(() => { setBaseCurrency('USD'); delete global.Notification })

describe('formatQuotePrice', () => {
  it('imprime en la moneda de la cotizacion, y los peniques como peniques', () => {
    expect(formatQuotePrice(200, 'USD')).toBe('$200.00')
    expect(formatQuotePrice(2650, 'GBp')).toBe('2,650.00 GBp')
    expect(formatQuotePrice(2650, 'GBX')).toBe('2,650.00 GBX')
    expect(formatQuotePrice(150, null)).toBe('150.00')
    expect(formatQuotePrice(null, 'USD')).toBe('-')
  })
  it('quoteCurrencyOf lee la moneda del mapa de precios', () => {
    expect(quoteCurrencyOf(prices, 'AAPL')).toBe('USD')
    expect(quoteCurrencyOf(prices, 'aapl')).toBe('USD')
    expect(quoteCurrencyOf(prices, 'NOPE')).toBeNull()
    expect(quoteCurrencyOf(null, 'AAPL')).toBeNull()
  })
})

describe('PriceAlerts (componente real)', () => {
  it('con base GTQ, AAPL se imprime en dolares y Shell en peniques: la moneda contra la que se compara', () => {
    setBaseCurrency('GTQ')
    const { container } = render(React.createElement(PriceAlerts, { items: [], alerts, marketPrices: prices, addAlert: async () => {}, deleteAlert: async () => {}, lang: 'es' }))
    const txt = container.textContent
    expect(txt).toContain('sube de $150.00')
    expect(txt).toContain('$200.00')
    expect(txt).toContain('baja de 2,500.00 GBp')
    expect(txt).toContain('2,650.00 GBp')
    expect(txt).not.toContain('GTQ')
  })
  it('el formulario dice en que moneda se compara el precio tecleado', () => {
    setBaseCurrency('GTQ')
    const { container } = render(React.createElement(PriceAlerts, { items: [], alerts: [], marketPrices: prices, addAlert: async () => {}, deleteAlert: async () => {}, lang: 'es', onClose: () => {} }))
    const symInput = container.querySelector('input[list="price-alert-symbols"]')
    const { fireEvent } = require('@testing-library/react')
    fireEvent.change(symInput, { target: { value: 'SHEL.L' } })
    const target = container.querySelector('input[placeholder^="Precio objetivo"]')
    expect(target.getAttribute('placeholder')).toBe('Precio objetivo en GBp')
  })
})

describe('checkPriceAlerts', () => {
  it('compara en la moneda de la cotizacion y la nombra en la notificacion', () => {
    const sent = []
    global.Notification = class { static permission = 'granted'; constructor(title, opts) { sent.push({ title, opts }) } }
    const hits = checkPriceAlerts(alerts, prices, () => {})
    expect(hits.map((h) => h.symbol)).toEqual(['AAPL'])
    expect(sent[0].title).toBe('AAPL > 150 USD')
    expect(sent[0].opts.body).toBe('AAPL is now at 200.00 USD')
  })
})
