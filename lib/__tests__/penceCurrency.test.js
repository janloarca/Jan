// FASE ID. El caso real: un amigo del usuario agregó SHEL.L (Shell, Bolsa de
// Londres). Yahoo cotiza en PENIQUES con código 'GBp' (3,288.00 = £32.88), y
// todo convert del repo upper-caseaba el código: 'GBp' colisionaba con 'GBP'
// y la tasa de la libra se aplicaba al monto en peniques. Una acción de ~$44
// quedó registrada como $4,440: cien veces inflada.

import { normalizeCurrency, convertWithRates } from '../penceCurrency'

// Convención real del mapa de tasas: unidades de cada moneda por 1 USD.
// 0.7405 GBP/USD es la inversa del "1 GBP = 1.3504 USD" que el Spreadsheet
// imprimió en la captura del bug.
const RATES = { USD: 1, GBP: 0.7405, GTQ: 7.7 }

describe('normalizeCurrency', () => {
  it('GBp (peniques, la p minúscula es la señal) es libra por 0.01', () => {
    expect(normalizeCurrency('GBp')).toEqual({ code: 'GBP', factor: 0.01 })
  })

  it('GBX en cualquier caja también es peniques', () => {
    expect(normalizeCurrency('GBX')).toEqual({ code: 'GBP', factor: 0.01 })
    expect(normalizeCurrency('gbx')).toEqual({ code: 'GBP', factor: 0.01 })
  })

  it('GBP y gbp de verdad son libras, jamás peniques', () => {
    expect(normalizeCurrency('GBP')).toEqual({ code: 'GBP', factor: 1 })
    expect(normalizeCurrency('gbp')).toEqual({ code: 'GBP', factor: 1 })
  })

  it('todo lo demás solo se upper-casea; vacío cae a USD', () => {
    expect(normalizeCurrency('gtq')).toEqual({ code: 'GTQ', factor: 1 })
    expect(normalizeCurrency('')).toEqual({ code: 'USD', factor: 1 })
    expect(normalizeCurrency(null)).toEqual({ code: 'USD', factor: 1 })
  })
})

describe('convertWithRates', () => {
  it('el caso Shell: 3,288 GBp son ~$44, nunca ~$4,440', () => {
    const usd = convertWithRates(3288, 'GBp', 'USD', RATES)
    expect(usd).toBeCloseTo(44.4, 1)
    // Regresión negativa explícita: el comportamiento viejo (tasa de libra
    // sobre peniques) daba 100x. Si esto vuelve a acercarse a 4,440, el bug
    // del uppercase volvió.
    expect(usd).toBeLessThan(100)
  })

  it('las libras de verdad no cambian: 32.88 GBP son los mismos ~$44', () => {
    expect(convertWithRates(32.88, 'GBP', 'USD', RATES)).toBeCloseTo(44.4, 1)
  })

  it('peniques a libras es un factor fijo y no necesita ninguna tasa', () => {
    expect(convertWithRates(3288, 'GBp', 'GBP', null)).toBeCloseTo(32.88, 9)
    expect(convertWithRates(32.88, 'GBP', 'GBp', null)).toBeCloseTo(3288, 6)
  })

  it('sin tasa devuelve el monto crudo (nunca cero) y reporta el código normalizado', () => {
    let missing = null
    expect(convertWithRates(100, 'CHF', 'USD', RATES, { warn: (c) => { missing = c } })).toBe(100)
    expect(missing).toBe('CHF')
  })

  it('las monedas normales siguen byte-idénticas a la fórmula de siempre', () => {
    expect(convertWithRates(770, 'GTQ', 'USD', RATES)).toBeCloseTo(100, 9)
    expect(convertWithRates(100, 'usd', 'gtq', RATES)).toBeCloseTo(770, 9)
    expect(convertWithRates(50, 'USD', 'USD', RATES)).toBe(50)
  })
})
