// FASE LT: el motor de deuda. El caso ancla es el préstamo real que lo obligó:
// USD 4,000 al 1.5% MENSUAL, 3 cuotas restantes, interés sobre saldo.

import { debtMonthlyRate, debtScheme, monthlyInterestOn, frenchPayment, splitPayment, debtBreakdown } from '../debtMath'

const AIXEN = {
  isDebt: true, type: 'Debt', currency: 'USD',
  quantity: 1, currentPrice: 4000, purchasePrice: 4000,
  interestRate: 1.5, ratePeriod: 'monthly',
  installmentsRemaining: 3, maturityDate: '2026-12-31',
  debtScheme: 'interest_only',
}

describe('la tasa lleva PERÍODO', () => {
  it('1.5% mensual es 0.015 al mes, no 0.00125', () => {
    expect(debtMonthlyRate(AIXEN)).toBeCloseTo(0.015, 10)
  })

  it('sin período, una tasa se lee como anual (toda deuda guardada antes del campo)', () => {
    expect(debtMonthlyRate({ interestRate: 7.5 })).toBeCloseTo(0.075 / 12, 10)
    expect(debtMonthlyRate({ interestRate: 7.5, ratePeriod: 'annual' })).toBeCloseTo(0.075 / 12, 10)
  })

  it('el interés del mes del caso real es 60, no 5', () => {
    expect(monthlyInterestOn(AIXEN)).toBeCloseTo(60, 6)
    // Regresión negativa: la lectura vieja (siempre anual) daba 12x menos.
    expect(monthlyInterestOn({ ...AIXEN, ratePeriod: undefined })).toBeCloseTo(5, 6)
  })
})

describe('el esquema de pago', () => {
  it('explícito manda', () => {
    expect(debtScheme(AIXEN)).toBe('interest_only')
    expect(debtScheme({ ...AIXEN, debtScheme: 'amortizing' })).toBe('amortizing')
  })

  it('una tarjeta es revolvente por defecto', () => {
    expect(debtScheme({ subtype: 'credit_card' })).toBe('revolving')
  })

  it('con cuota o cuotas configuradas se asume cuota fija (los bancos son la mayoría)', () => {
    expect(debtScheme({ monthlyPayment: 500 })).toBe('amortizing')
    expect(debtScheme({ installmentsRemaining: 18 })).toBe('amortizing')
  })

  it('sin cuota ni plazo es interés sobre saldo', () => {
    expect(debtScheme({ interestRate: 2 })).toBe('interest_only')
  })
})

describe('interés sobre saldo (el préstamo familiar)', () => {
  it('el caso real: ~60/mes de intereses, 3 meses, total 4,180', () => {
    const bd = debtBreakdown(AIXEN)
    expect(bd.scheme).toBe('interest_only')
    expect(bd.monthlyInterest).toBeCloseTo(60, 6)
    expect(bd.months).toBe(3)
    expect(bd.totalInterestRemaining).toBeCloseTo(180, 6)
    expect(bd.totalToPay).toBeCloseTo(4180, 6)
    expect(bd.paymentTooSmall).toBe(false)
  })

  it('sin cuotas configuradas, los meses salen del vencimiento (aprox.)', () => {
    const bd = debtBreakdown({ ...AIXEN, installmentsRemaining: 0 }, { now: Date.parse('2026-08-28T00:00:00Z') })
    expect(bd.months).toBe(4)
    expect(bd.totalToPay).toBeCloseTo(4000 + 4 * 60, 6)
  })

  it('sin cuotas NI vencimiento no se inventa un total', () => {
    const bd = debtBreakdown({ ...AIXEN, installmentsRemaining: 0, maturityDate: '' })
    expect(bd.months).toBeNull()
    expect(bd.totalToPay).toBeNull()
    expect(bd.monthlyInterest).toBeCloseTo(60, 6)
  })
})

describe('cuota fija (sistema francés)', () => {
  it('la cuota derivada amortiza la deuda EXACTA en sus cuotas', () => {
    // 4,000 al 1.5% mensual en 3 cuotas: la fórmula cerrada, verificada
    // iterando el plan real hasta cero.
    const p = frenchPayment(4000, 0.015, 3)
    let rem = 4000
    for (let i = 0; i < 3; i++) rem = rem - (p - rem * 0.015)
    expect(rem).toBeCloseTo(0, 6)
    // Y el interés total es el que la tabla reporta: 3p − 4000.
    const bd = debtBreakdown({ ...AIXEN, debtScheme: 'amortizing' })
    expect(bd.payment).toBeCloseTo(p, 6)
    expect(bd.paymentDerived).toBe(true)
    expect(bd.months).toBe(3)
    expect(bd.totalInterestRemaining).toBeCloseTo(3 * p - 4000, 2)
    expect(bd.totalToPay).toBeCloseTo(3 * p, 2)
  })

  it('la cuota tecleada gana sobre la derivada, y su split dice interés y capital', () => {
    const bd = debtBreakdown({ ...AIXEN, debtScheme: 'amortizing', monthlyPayment: 500 })
    expect(bd.payment).toBe(500)
    expect(bd.paymentDerived).toBe(false)
    expect(bd.split.interest).toBeCloseTo(60, 6)
    expect(bd.split.principal).toBeCloseTo(440, 6)
  })

  it('⚠ una cuota que no cubre ni el interés se DICE, no se itera para siempre', () => {
    const bd = debtBreakdown({ ...AIXEN, debtScheme: 'amortizing', monthlyPayment: 50 })
    expect(bd.paymentTooSmall).toBe(true)
    expect(bd.months).toBeNull()
    expect(bd.totalToPay).toBeNull()
  })

  it('a tasa cero la cuota es el reparto plano y el interés total es cero', () => {
    const bd = debtBreakdown({ isDebt: true, currentPrice: 1200, quantity: 1, interestRate: 0, installmentsRemaining: 12, debtScheme: 'amortizing' })
    expect(bd.payment).toBeCloseTo(100, 6)
    expect(bd.totalInterestRemaining).toBeCloseTo(0, 6)
    expect(bd.totalToPay).toBeCloseTo(1200, 6)
  })
})

describe('revolvente (tarjeta)', () => {
  it('un mínimo que no cubre el interés se marca: la deuda CRECE pagando', () => {
    const bd = debtBreakdown({ isDebt: true, subtype: 'credit_card', currentPrice: 10000, quantity: 1, interestRate: 3.5, ratePeriod: 'monthly', minimumPayment: 300 })
    expect(bd.scheme).toBe('revolving')
    expect(bd.monthlyInterest).toBeCloseTo(350, 6)
    expect(bd.paymentTooSmall).toBe(true)
  })

  it('un mínimo que sí cubre no alarma', () => {
    const bd = debtBreakdown({ isDebt: true, subtype: 'credit_card', currentPrice: 10000, quantity: 1, interestRate: 3.5, ratePeriod: 'monthly', minimumPayment: 500 })
    expect(bd.paymentTooSmall).toBe(false)
  })
})

describe('splitPayment', () => {
  it('primero el interés del mes, el resto baja capital', () => {
    expect(splitPayment({ balance: 4000, monthlyRate: 0.015, payment: 400 })).toEqual({ interest: 60, principal: 340 })
  })

  it('un pago menor al interés es todo interés y cero capital', () => {
    const s = splitPayment({ balance: 4000, monthlyRate: 0.015, payment: 40 })
    expect(s.interest).toBe(40)
    expect(s.principal).toBe(0)
  })
})

describe('bordes', () => {
  it('sin saldo no hay desglose', () => {
    expect(debtBreakdown({ isDebt: true, currentPrice: 0, quantity: 1, interestRate: 5 })).toBeNull()
  })

  it('el saldo explícito del caller manda (los ítems enriquecidos vienen convertidos)', () => {
    const bd = debtBreakdown(AIXEN, { balance: 8000 })
    expect(bd.monthlyInterest).toBeCloseTo(120, 6)
  })
})
