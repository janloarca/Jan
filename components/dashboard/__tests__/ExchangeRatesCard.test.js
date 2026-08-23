// Primer test de COMPONENTE del repo, y usa el mismo arnés que los hooks.
//
// Se prueba el componente REAL, no una copia de su lógica: es la lección de
// FASE GQ3 (verificar props hechos a mano saltándose el código de verdad es
// justo cómo se coló un crash a producción).

const React = require('react')
const { render, screen } = require('@testing-library/react')
const ExchangeRatesCard = require('../ExchangeRatesCard').default

const item = (cur) => ({ id: `i-${cur}`, quantity: 1, currentPrice: 100, _originalCurrency: cur })
const RATES = { USD: 1, GTQ: 7.7, EUR: 0.92 }

function show(props = {}) {
  return render(React.createElement(ExchangeRatesCard, {
    items: [item('USD'), item('GTQ')],
    rates: RATES,
    baseCurrency: 'USD',
    ratesUpdate: '2026-08-23T14:30:00Z',
    lang: 'es',
    ...props,
  }))
}

describe('ExchangeRatesCard', () => {
  it('lista SOLO las monedas que el portafolio tiene', () => {
    show()
    expect(screen.getByText('USD')).toBeTruthy()
    expect(screen.getByText('GTQ')).toBeTruthy()
    // EUR está en el mapa de tasas pero el usuario no tiene euros: una tabla de
    // 60 monedas no informa nada sobre ESTE portafolio.
    expect(screen.queryByText('EUR')).toBeNull()
  })

  it('el dolar abre en 1 y marcado como ancla', () => {
    const { container } = show()
    expect(container.textContent).toContain('1.0000')
    expect(container.textContent).toContain('ancla')
  })

  it('la tasa se lee "1 USD = X"', () => {
    const { container } = show()
    expect(container.textContent).toContain('1 USD = 7.7000')
  })

  it('marca cual es la moneda base', () => {
    const { container } = show({ baseCurrency: 'GTQ' })
    expect(container.textContent).toContain('base')
  })

  // Con una sola moneda diría "1 USD = 1 USD": un control que no informa nada.
  it('no se renderiza con una sola moneda', () => {
    const { container } = show({ items: [item('USD')] })
    expect(container.firstChild).toBeNull()
  })

  it('con una sola moneda que NO es el dolar si se renderiza', () => {
    // Acá el ancla sí aporta: dice a cuánto entra el quetzal.
    const { container } = show({ items: [item('GTQ')], baseCurrency: 'GTQ' })
    expect(container.textContent).toContain('GTQ')
    expect(container.textContent).toContain('1 USD = 7.7000')
  })

  // ⛔ Lo más importante que esta tarjeta puede reportar: si no hay tasa,
  // `convert` devuelve el monto CRUDO y el patrimonio está sumando sin
  // convertir. Eso se DICE.
  it('una moneda sin tasa se nombra, y se explica la consecuencia', () => {
    const { container } = show({ items: [item('USD'), item('XYZ')] })
    expect(container.textContent).toContain('sin tasa')
    expect(container.textContent).toContain('XYZ')
    expect(container.textContent).toContain('SIN convertir')
  })

  it('una tasa de ayer se presenta como ultima conocida, no como fresca', () => {
    const { container } = show({ ratesStale: true })
    expect(container.textContent).toContain('Últimas conocidas')
    expect(container.textContent).not.toContain('Actualizado ')
  })

  it('una tasa fresca dice cuando se actualizo', () => {
    const { container } = show()
    expect(container.textContent).toContain('Actualizado')
  })

  it('sin fecha de actualizacion lo dice en vez de inventar una', () => {
    const { container } = show({ ratesUpdate: null })
    expect(container.textContent).toContain('Sin fecha')
  })

  it('en ingles no queda nada en espanol', () => {
    const { container } = show({ lang: 'en', ratesStale: true })
    expect(container.textContent).toContain('EXCHANGE RATES')
    expect(container.textContent).toContain('Last known')
    expect(container.textContent).not.toMatch(/Actualizado|Últimas|ancla/)
  })
})
