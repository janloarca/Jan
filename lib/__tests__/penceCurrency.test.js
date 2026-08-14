// FASE ID. El caso real: un amigo del usuario agregó SHEL.L (Shell, Bolsa de
// Londres). Yahoo cotiza en PENIQUES con código 'GBp' (3,288.00 = £32.88), y
// todo convert del repo upper-caseaba el código: 'GBp' colisionaba con 'GBP'
// y la tasa de la libra se aplicaba al monto en peniques. Una acción de ~$44
// quedó registrada como $4,440: cien veces inflada.

import { normalizeCurrency, convertWithRates, resolvePriceCurrency } from '../penceCurrency'

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

// FASE IE. El caso REAL que quedó tras FASE ID: el item se guardó con currency
// 'GBP' (libras: la lista fija del select no tenía 'GBp') y un precio en
// PENIQUES. Valor y costo del mismo activo se convertían por caminos distintos
// y quedaban separados 100x: "-99.00%" sobre una acción que no se movió.
describe('resolvePriceCurrency', () => {
  it('misma divisa, distinta unidad: manda la del quote', () => {
    expect(resolvePriceCurrency('GBP', 'GBp')).toBe('GBp')
    expect(resolvePriceCurrency('GBp', 'GBP')).toBe('GBP')
  })

  it('divisas distintas: se respeta la guardada (dato deliberado del usuario)', () => {
    expect(resolvePriceCurrency('USD', 'GBp')).toBe('USD')
    expect(resolvePriceCurrency('EUR', 'GBP')).toBe('EUR')
  })

  it('sin moneda de mercado (activo que no cotiza) no cambia nada', () => {
    expect(resolvePriceCurrency('GTQ', null)).toBe('GTQ')
    expect(resolvePriceCurrency('GTQ', undefined)).toBe('GTQ')
  })

  it('el caso Shell completo: valor y costo dejan de estar separados por 100x', () => {
    // Lo observado: qty 1.0088, precio 3288 (peniques), guardado como 'GBP'.
    const qty = 1.0088
    const price = 3288
    const value = qty * convertWithRates(price, 'GBp', 'USD', RATES)
    // ANTES (regresión negativa): el costo se convertía con la guardada.
    const costBefore = qty * convertWithRates(price, 'GBP', 'USD', RATES)
    expect((value - costBefore) / costBefore).toBeCloseTo(-0.99, 2)
    // AHORA: la unidad la decide el quote y el activo quieto reporta 0%.
    const costNow = qty * convertWithRates(price, resolvePriceCurrency('GBP', 'GBp'), 'USD', RATES)
    expect(costNow).toBeCloseTo(value, 9)
    expect((value - costNow) / costNow).toBeCloseTo(0, 9)
  })
})
