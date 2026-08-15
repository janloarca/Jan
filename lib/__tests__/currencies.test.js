// FASE IG. La lista de monedas es ahora una sola para toda la app. Estos tests
// fijan las dos propiedades que hacen que el bug original no pueda volver:
//   1. Ninguna moneda que la validación acepta queda fuera del menú (era el
//      caso: 45 válidas contra 14 ofrecidas).
//   2. Lo que el <select> muestra es siempre lo que se va a guardar, aunque la
//      moneda detectada de una cotización no esté en la lista.

import { CURRENCIES, EXTRA_VALID_CURRENCIES, currencyOptions } from '../currencies'
import { sanitizeImportItem, validateItem } from '../validation'

// Las 14 que el menú ofrecía antes de esta fase: ninguna puede desaparecer.
const LEGACY = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'CLP', 'ARS', 'BRL', 'PEN', 'CAD', 'CHF', 'JPY', 'CNY']
// Las que la validación YA aceptaba pero el menú nunca ofreció: el hueco que
// dejaba a un usuario en Australia, India o Corea sin poder elegir su moneda.
const WAS_VALID_BUT_UNOFFERED = [
  'HKD', 'KRW', 'AUD', 'NZD', 'SGD', 'INR', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'HUF', 'TRY', 'ZAR', 'ILS', 'THB', 'TWD', 'PHP', 'IDR', 'MYR', 'VND', 'CRC',
  'UYU', 'PYG', 'BOB', 'DOP', 'HNL', 'NIO', 'PAB',
]

describe('CURRENCIES', () => {
  it('conserva las 14 de siempre, en su orden original', () => {
    expect(CURRENCIES.slice(0, LEGACY.length)).toEqual(LEGACY)
  })

  it('ofrece todas las que la validación ya aceptaba', () => {
    for (const c of WAS_VALID_BUT_UNOFFERED) expect(CURRENCIES).toContain(c)
  })

  it('no tiene duplicados', () => {
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length)
  })

  it('son códigos ISO 4217 bien formados (3 letras mayúsculas)', () => {
    for (const c of CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/)
  })

  it('la cripto queda fuera del menú: el proveedor de FX no la cotiza', () => {
    for (const c of EXTRA_VALID_CURRENCIES) expect(CURRENCIES).not.toContain(c)
  })
})

describe('validación', () => {
  it('acepta TODA moneda que el menú ofrece (antes podían divergir)', () => {
    for (const c of CURRENCIES) {
      const errors = validateItem({ name: 'x', quantity: 1, purchasePrice: 1, currency: c })
      expect(errors.filter((e) => e.includes('currency'))).toEqual([])
    }
  })

  it('sigue aceptando la cripto de un import y rechazando lo inventado', () => {
    for (const c of EXTRA_VALID_CURRENCIES) {
      expect(validateItem({ name: 'x', currency: c }).some((e) => e.includes('currency'))).toBe(false)
    }
    expect(validateItem({ name: 'x', currency: 'XYZ' }).some((e) => e.includes('Unknown currency'))).toBe(true)
  })

  it('el sanitizador de imports sigue normalizando a mayúsculas', () => {
    expect(sanitizeImportItem({ currency: 'aud' }).currency).toBe('AUD')
  })
})

describe('currencyOptions', () => {
  it('devuelve la lista tal cual cuando la moneda ya está en ella', () => {
    expect(currencyOptions('GTQ')).toBe(CURRENCIES)
    expect(currencyOptions('')).toBe(CURRENCIES)
    expect(currencyOptions(null)).toBe(CURRENCIES)
  })

  it('antepone la moneda detectada que no está en la lista', () => {
    // El caso real: una cotización de la Bolsa de Londres llega como 'GBp'. Sin
    // esto, el <select> pintaba la PRIMERA opción (USD) sobre un activo que se
    // guardaba en otra moneda, y se leía como que la app la leía mal.
    const opts = currencyOptions('GBp')
    expect(opts[0]).toBe('GBp')
    expect(opts).toHaveLength(CURRENCIES.length + 1)
    // La lista compartida no se muta: el siguiente caller la recibe limpia.
    expect(CURRENCIES).not.toContain('GBp')
  })
})
