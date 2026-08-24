import { computePropertyEquity, linkedDebtOf, isProperty, debtOptions } from '../propertyEquity'
import { getItemValue } from '../../components/dashboard/utils'

// El caso que pidió el usuario: una propiedad con enganche y su hipoteca.
const casa = {
  id: 'casa', type: 'RealEstate', name: '120 street miami', quantity: 1,
  purchasePrice: 85000, currentPrice: 85000, currency: 'USD',
  downPayment: 20000, linkedDebtId: 'hipo',
  adminFeeMonthly: 150, propertyTaxAnnual: 1200,
}
const hipoteca = {
  id: 'hipo', type: 'Debt', name: 'Hipoteca casa', isDebt: true, subtype: 'mortgage',
  quantity: 1, purchasePrice: 65000, currentPrice: 40000, currency: 'USD',
  monthlyPayment: 520, installmentsTotal: 240, installmentsRemaining: 180,
}

describe('computePropertyEquity', () => {
  test('las cifras que el usuario nombró, cada una derivada de un dato que ya existe', () => {
    const r = computePropertyEquity(casa, hipoteca)
    expect(r.downPayment).toBe(20000)
    expect(r.originalLoan).toBe(65000)   // 85,000 - 20,000
    expect(r.remaining).toBe(40000)      // el saldo de hoy de la deuda
    expect(r.paidOnLoan).toBe(25000)     // 65,000 - 40,000
    expect(r.totalPaid).toBe(45000)      // enganche + lo pagado del préstamo
    expect(r.equity).toBe(45000)         // valor de hoy - lo que falta
    expect(r.monthlyPayment).toBe(520)
    expect(r.installmentsRemaining).toBe(180)
    expect(r.installmentsTotal).toBe(240)
    expect(r.refusal).toBeNull()
  })

  test('el costo anual de tenerla', () => {
    const r = computePropertyEquity(casa, hipoteca)
    expect(r.carryingAnnual).toBe(150 * 12 + 1200) // 3,000
  })

  test('sin costos declarados no inventa un cero: dice que no sabe', () => {
    const r = computePropertyEquity({ ...casa, adminFeeMonthly: 0, propertyTaxAnnual: 0 }, hipoteca)
    expect(r.carryingAnnual).toBeNull()
    expect(r.adminMonthly).toBeNull()
  })

  test('sin deuda vinculada solo se sabe lo declarado, el resto es null y no cero', () => {
    const r = computePropertyEquity(casa, null)
    expect(r.hasDebt).toBe(false)
    expect(r.downPayment).toBe(20000)
    expect(r.carryingAnnual).toBe(3000)
    expect(r.remaining).toBeNull()
    expect(r.equity).toBeNull()
    expect(r.paidOnLoan).toBeNull()
  })

  test('el valor de hoy cae al precio de compra cuando no se declaró', () => {
    const r = computePropertyEquity({ ...casa, currentPrice: 0 }, hipoteca)
    expect(r.currentValue).toBe(85000)
    expect(r.equity).toBe(45000)
  })

  test('una hipoteca ya pagada da capital propio igual al valor', () => {
    const r = computePropertyEquity(casa, { ...hipoteca, currentPrice: 0, purchasePrice: 0 })
    expect(r.remaining).toBe(0)
    expect(r.equity).toBe(85000)
    expect(r.paidOnLoan).toBe(65000)
    expect(r.totalPaid).toBe(85000)
  })

  // Rehusar antes que inventar, la regla de siempre en este repo.
  test('un enganche mayor al precio rehúsa en vez de imprimir un negativo', () => {
    const r = computePropertyEquity({ ...casa, downPayment: 90000 }, hipoteca)
    expect(r.refusal).toBe('down-exceeds-price')
    expect(r.paidOnLoan).toBeNull()
    expect(r.totalPaid).toBeNull()
  })

  test('una deuda mayor al préstamo original rehúsa: el precio o el enganche están mal', () => {
    const r = computePropertyEquity(casa, { ...hipoteca, currentPrice: 90000 })
    expect(r.refusal).toBe('debt-exceeds-loan')
    expect(r.paidOnLoan).toBeNull()
  })

  test('monedas distintas SIN converter: se reporta, jamás se suma crudo', () => {
    const r = computePropertyEquity(casa, { ...hipoteca, currency: 'GTQ' })
    expect(r.debtCurrencyMismatch).toBe(true)
    expect(r.refusal).toBe('currency')
    expect(r.equity).toBeNull()
  })

  test('monedas distintas CON converter: se convierte y cuadra', () => {
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD' ? amt / 7.7 : amt)
    const r = computePropertyEquity(casa, { ...hipoteca, currency: 'GTQ', currentPrice: 77000, monthlyPayment: 3850 }, convert)
    expect(r.debtCurrencyMismatch).toBe(false)
    expect(r.remaining).toBeCloseTo(10000, 6)
    expect(r.equity).toBeCloseTo(75000, 6)
    expect(r.monthlyPayment).toBeCloseTo(500, 6)
  })

  test('sin propiedad no revienta', () => {
    const r = computePropertyEquity(null, null)
    expect(r.hasDebt).toBe(false)
    expect(r.equity).toBeNull()
  })
})

// ⛔ EL invariante del módulo. El vínculo es de SOLO LECTURA: el patrimonio no
// puede moverse un centavo por vincular una propiedad con su hipoteca. Si
// alguien sumara `equity` al patrimonio, la deuda quedaría contada dos veces.
describe('el vínculo NO toca el patrimonio', () => {
  const netWorth = (items) => items.reduce((s, it) => s + getItemValue(it), 0)

  test('vincular no cambia el patrimonio total', () => {
    const sinVinculo = [{ ...casa, linkedDebtId: '' }, hipoteca]
    const conVinculo = [casa, hipoteca]
    expect(netWorth(conVinculo)).toBe(netWorth(sinVinculo))
    expect(netWorth(conVinculo)).toBe(85000 - 40000)
  })

  test('los campos nuevos declarados tampoco lo mueven', () => {
    const pelada = { id: 'casa', type: 'RealEstate', quantity: 1, purchasePrice: 85000, currentPrice: 85000 }
    const conCampos = { ...pelada, downPayment: 20000, adminFeeMonthly: 150, propertyTaxAnnual: 1200, linkedDebtId: 'hipo' }
    expect(getItemValue(conCampos)).toBe(getItemValue(pelada))
  })

  test('el capital propio NO es el valor del ítem: es una cifra aparte', () => {
    const r = computePropertyEquity(casa, hipoteca)
    expect(r.equity).toBe(45000)
    expect(getItemValue(casa)).toBe(85000) // el ítem sigue valiendo lo que vale
  })
})

describe('linkedDebtOf', () => {
  test('resuelve la deuda por id', () => {
    expect(linkedDebtOf(casa, [casa, hipoteca])).toBe(hipoteca)
  })

  test('un vínculo a un ítem borrado se lee como sin deuda, no revienta', () => {
    expect(linkedDebtOf(casa, [casa])).toBeNull()
  })

  test('un vínculo a algo que NO es deuda se descarta', () => {
    expect(linkedDebtOf(casa, [casa, { id: 'hipo', isDebt: false }])).toBeNull()
  })

  test('sin vínculo devuelve null', () => {
    expect(linkedDebtOf({ ...casa, linkedDebtId: '' }, [casa, hipoteca])).toBeNull()
  })
})

describe('debtOptions', () => {
  test('las hipotecas primero: es el caso común', () => {
    const items = [
      { id: 'a', isDebt: true, subtype: 'credit_card', name: 'Visa' },
      { id: 'b', isDebt: true, subtype: 'mortgage', name: 'Hipoteca' },
      { id: 'c', type: 'Stock', name: 'AAPL' },
    ]
    const out = debtOptions(items)
    expect(out.map(o => o.id)).toEqual(['b', 'a'])
  })

  test('una cuenta por cobrar no es una deuda que se pueda vincular', () => {
    expect(debtOptions([{ id: 'r', isDebt: true, isReceivable: true }])).toEqual([])
  })

  test('sin deudas devuelve lista vacía', () => {
    expect(debtOptions([{ id: 'x', type: 'Stock' }])).toEqual([])
    expect(debtOptions(null)).toEqual([])
  })
})

describe('isProperty', () => {
  test('reconoce las dos formas que usa la app', () => {
    expect(isProperty({ type: 'RealEstate' })).toBe(true)
    expect(isProperty({ type: 'Inmueble' })).toBe(true)
    expect(isProperty({ type: 'Stock' })).toBe(false)
    expect(isProperty(null)).toBe(false)
  })
})
