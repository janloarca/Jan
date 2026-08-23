import { currencyOfItem, usedCurrencies, buildRateRows, rateDecimals, formatRate, ANCHOR } from '../currencyRates'

const item = (o) => ({ id: 'i', quantity: 1, currentPrice: 100, ...o })

describe('currencyOfItem', () => {
  it('manda la moneda ORIGINAL sobre la del item ya convertido', () => {
    // Tras el enriquecimiento, `currency` puede haber quedado con la base.
    expect(currencyOfItem({ _originalCurrency: 'GTQ', currency: 'USD' })).toBe('GTQ')
  })

  it('cae a `currency` para un item que nunca paso por el enriquecimiento', () => {
    expect(currencyOfItem({ currency: 'eur' })).toBe('EUR')
  })

  it('sin nada, dolar', () => {
    expect(currencyOfItem({})).toBe('USD')
    expect(currencyOfItem(null)).toBe('USD')
  })
})

describe('usedCurrencies', () => {
  it('devuelve las monedas presentes, sin repetir', () => {
    const out = usedCurrencies([
      item({ _originalCurrency: 'USD' }),
      item({ _originalCurrency: 'GTQ' }),
      item({ _originalCurrency: 'GTQ' }),
    ])
    expect(out.sort()).toEqual(['GTQ', 'USD'])
  })

  it('la DEUDA cuenta: se convierte con la misma tasa y hay que verla', () => {
    const out = usedCurrencies([item({ _originalCurrency: 'GTQ', isDebt: true, currentPrice: 5000 })])
    expect(out).toEqual(['GTQ'])
  })

  it('sin items, lista vacia', () => {
    expect(usedCurrencies([])).toEqual([])
    expect(usedCurrencies(null)).toEqual([])
  })
})

describe('buildRateRows', () => {
  const rates = { USD: 1, GTQ: 7.7, EUR: 0.92 }

  it('el dolar va PRIMERO y en 1, siempre', () => {
    const rows = buildRateRows({ currencies: ['GTQ'], rates, baseCurrency: 'USD' })
    expect(rows[0]).toMatchObject({ code: 'USD', rate: 1, isAnchor: true })
  })

  it('el dolar aparece aunque el portafolio no tenga un solo activo en dolares', () => {
    const rows = buildRateRows({ currencies: ['GTQ'], rates, baseCurrency: 'GTQ' })
    expect(rows.map((r) => r.code)).toEqual(['USD', 'GTQ'])
    // Y se marca cual es la base, que puede no ser el ancla.
    expect(rows.find((r) => r.code === 'GTQ').isBase).toBe(true)
    expect(rows.find((r) => r.code === 'USD').isBase).toBe(false)
  })

  it('la tasa es la del mapa TAL CUAL: cuantas unidades hay en un dolar', () => {
    const rows = buildRateRows({ currencies: ['GTQ', 'EUR'], rates, baseCurrency: 'USD' })
    expect(rows.find((r) => r.code === 'GTQ').rate).toBe(7.7)
    expect(rows.find((r) => r.code === 'EUR').rate).toBe(0.92)
  })

  it('el resto va alfabetico: es una tabla de referencia, no un ranking', () => {
    const rows = buildRateRows({ currencies: ['MXN', 'EUR', 'GTQ'], rates: { ...rates, MXN: 17 }, baseCurrency: 'USD' })
    expect(rows.map((r) => r.code)).toEqual(['USD', 'EUR', 'GTQ', 'MXN'])
  })

  it('una moneda SIN tasa sale en null, nunca con un numero inventado', () => {
    // Es el caso en que `convert` devuelve el monto crudo, o sea el patrimonio
    // esta sumando sin convertir. Callarlo seria peor que decirlo.
    const rows = buildRateRows({ currencies: ['XYZ'], rates, baseCurrency: 'USD' })
    expect(rows.find((r) => r.code === 'XYZ').rate).toBeNull()
  })

  it('una tasa invalida se trata como ausente', () => {
    const bad = { USD: 1, A: 0, B: -3, C: 'x', D: NaN, E: Infinity }
    const rows = buildRateRows({ currencies: ['A', 'B', 'C', 'D', 'E'], rates: bad, baseCurrency: 'USD' })
    for (const code of ['A', 'B', 'C', 'D', 'E']) {
      expect(rows.find((r) => r.code === code).rate).toBeNull()
    }
  })

  it('no repite el ancla si ya venia en la lista', () => {
    const rows = buildRateRows({ currencies: ['USD', 'USD', 'GTQ'], rates, baseCurrency: 'USD' })
    expect(rows.filter((r) => r.code === ANCHOR)).toHaveLength(1)
  })

  it('sin mapa de tasas, todo lo que no sea el ancla queda en null', () => {
    const rows = buildRateRows({ currencies: ['GTQ'], rates: null, baseCurrency: 'USD' })
    expect(rows[0].rate).toBe(1)
    expect(rows[1].rate).toBeNull()
  })
})

describe('rateDecimals: una precision fija miente en los extremos', () => {
  it('una tasa chica no se redondea a cero', () => {
    // Con 2 decimales esto seria "0.00", que se lee como que no hay tasa.
    expect(formatRate(0.00047, 'en')).toBe('0.000470')
  })

  it('una tasa normal se lee con la precision de siempre', () => {
    expect(rateDecimals(7.7)).toBe(4)
    expect(formatRate(7.7, 'en')).toBe('7.7000')
  })

  it('una tasa enorme no arrastra decimales que nadie usa', () => {
    expect(rateDecimals(15800)).toBe(0)
    expect(formatRate(15800, 'en')).toBe('15,800')
  })

  it('una tasa invalida no se formatea, devuelve null', () => {
    expect(formatRate(null)).toBeNull()
    expect(formatRate(0)).toBeNull()
    expect(formatRate(NaN)).toBeNull()
  })
})
