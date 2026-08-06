// ============================================================================
//  CANDADO de la especificación congelada del bono corporativo con comisión.
//  Spec: lib/assetLogic/corporateBondWithEntryFee.js  (LEER ANTES DE TOCAR)
//
//  Este archivo NO prueba una función: recalcula el caso VITALI completo con
//  las funciones REALES de producción y fija los números que salen en pantalla.
//  Si alguien mueve la lógica, aquí sale rojo con el antes y el después.
//
//  ⛔ Si este test falla, la respuesta correcta NO es actualizar el número
//  esperado. Es preguntar a quien pidió el cambio si de verdad quiere cambiar
//  la lógica congelada, y por qué. Ver el protocolo en la cabecera de la spec.
// ============================================================================

import {
  getItemPrincipalCost, getItemCostBasis, getDividendIncomeByItem,
  getIncomeReceivedByItem, getInvestedCapital, computeModifiedDietz,
} from '@/components/dashboard/utils'
import { computeMWRSeries } from '@/components/dashboard/analytics'
import { VITALI, INVARIANTS } from '../assetLogic/corporateBondWithEntryFee'

const inv = (id) => INVARIANTS.find((i) => i.id === id)
const d = (s) => new Date(`${s}T00:00:00Z`).getTime()

// El portafolio exacto del caso de referencia.
const bond = {
  id: 'vitali', symbol: 'VITALI', name: 'Vitali', type: 'Bond',
  institution: 'IDC', currency: 'USD',
  quantity: 1,
  purchasePrice: VITALI.principal,
  currentPrice: VITALI.principal,
  entryFee: VITALI.entryFee,
  entryFeeMode: VITALI.entryFeeMode,
  acquisitionDate: VITALI.acquisitionDate,
  incomeDestination: 'fondo',
  dividendAction: 'cash',
}
const fondo = {
  id: 'fondo', symbol: 'IDC-CASH', name: 'Fondo Líquido', type: 'bank',
  institution: 'IDC', currency: 'USD',
  quantity: 1,
  purchasePrice: VITALI.couponPaid,   // un banco guarda su SALDO aquí
  currentPrice: VITALI.couponPaid,
  acquisitionDate: VITALI.acquisitionDate,
}
const items = [bond, fondo]

const openingDeposit = {
  id: 'dep', type: 'DEPOSIT', date: VITALI.acquisitionDate,
  totalAmount: VITALI.cashOutOfPocket, currency: 'USD',
  _linkedItemId: 'vitali', _source: 'manual_new_account',
}
const coupon = {
  id: 'cup', type: 'DIVIDEND', date: VITALI.couponDate,
  totalAmount: VITALI.couponPaid, currency: 'USD',
  _linkedItemId: 'vitali', _source: 'auto',
}
const transactions = [openingDeposit, coupon]

describe('las tres cantidades no son la misma cantidad', () => {
  it('principalCost = lo que costó el activo en sí (6,000)', () => {
    expect(getItemPrincipalCost(bond)).toBe(VITALI.principal)
  })

  it('costBasis = todo el efectivo que salió del bolsillo (6,098)', () => {
    expect(getItemCostBasis(bond)).toBe(VITALI.cashOutOfPocket)
  })

  it('la diferencia entre ambas ES la comisión, y ese es el invariante', () => {
    expect(getItemCostBasis(bond) - getItemPrincipalCost(bond)).toBe(VITALI.entryFee)
  })

  it('ingresos = lo que el activo generó, aunque su propio precio no se mueva', () => {
    const income = getDividendIncomeByItem(transactions, items, null, 'USD')
    expect(income.get('vitali')).toBe(VITALI.couponPaid)
  })
})

describe('el cupón que aterriza en otra cuenta no es capital invertido', () => {
  it('se le atribuye al DESTINO, no al activo que lo generó', () => {
    const received = getIncomeReceivedByItem(transactions, items, null, 'USD')
    expect(received.get('fondo')).toBe(VITALI.couponPaid)
    expect(received.get('vitali')).toBeUndefined()
  })

  it('y sale del capital invertido del destino, que queda en 0', () => {
    const received = getIncomeReceivedByItem(transactions, items, null, 'USD')
    expect(getInvestedCapital(fondo, received.get('fondo')))
      .toBe(inv('income-is-not-invested-capital').destinationInvestedCapital)
  })

  it('el bono conserva su costo total completo', () => {
    const received = getIncomeReceivedByItem(transactions, items, null, 'USD')
    expect(getInvestedCapital(bond, received.get('vitali'))).toBe(VITALI.cashOutOfPocket)
  })
})

describe('LA FÓRMULA: ganancia contra el principal, porcentaje contra el costo total', () => {
  const income = getDividendIncomeByItem(transactions, items, null, 'USD')
  const received = getIncomeReceivedByItem(transactions, items, null, 'USD')

  // Exactamente lo que hacen AssetAllocation e InstitutionPerformance.
  const groupValue = items.reduce((s, it) => s + (it.quantity || 1) * it.currentPrice, 0)
  const groupPrincipal = items.reduce((s, it) => s + getItemPrincipalCost(it), 0)
  const groupIncome = items.reduce((s, it) => s + (income.get(it.id) || 0), 0)
  const groupCost = items.reduce((s, it) => s + getInvestedCapital(it, received.get(it.id)), 0)

  const gain = groupValue - groupPrincipal + groupIncome
  const pct = (gain / groupCost) * 100

  it('el patrimonio del caso es 6,240', () => {
    expect(groupValue).toBe(VITALI.expectedNetWorth)
  })

  it('la ganancia es 240', () => {
    expect(gain).toBe(inv('gain-vs-principal').expected)
  })

  it('el capital invertido es 6,098, no 6,338', () => {
    expect(groupCost).toBe(VITALI.cashOutOfPocket)
  })

  it('el retorno es 3.94 %, en las dos tarjetas', () => {
    expect(pct).toBeCloseTo(inv('pct-vs-cost-basis').expected, 9)
    expect(Number(pct.toFixed(2))).toBe(VITALI.expectedReturnPct)
  })
})

describe('los dos errores que ya se cometieron, fijados para que no vuelvan', () => {
  const wrong = inv('fee-never-on-both-sides')

  it('comisión en AMBOS lados da 2.33 % (no es el número correcto)', () => {
    const bad = ((VITALI.expectedNetWorth - VITALI.cashOutOfPocket) / VITALI.cashOutOfPocket) * 100
    expect(bad).toBeCloseTo(wrong.wrongBothSides, 9)
    expect(Number(bad.toFixed(2))).not.toBe(VITALI.expectedReturnPct)
  })

  it('comisión en NINGÚN lado da 4.00 % (tampoco es el correcto)', () => {
    const bad = (VITALI.couponPaid / VITALI.principal) * 100
    expect(bad).toBeCloseTo(wrong.wrongNeitherSide, 9)
    expect(Number(bad.toFixed(2))).not.toBe(VITALI.expectedReturnPct)
  })

  it('el correcto queda ENTRE los dos', () => {
    expect(inv('pct-vs-cost-basis').expected).toBeGreaterThan(wrong.wrongBothSides)
    expect(inv('pct-vs-cost-basis').expected).toBeLessThan(wrong.wrongNeitherSide)
  })
})

describe('YTD: el ancla viaja con su fecha y los flujos que la crearon quedan fuera', () => {
  const yearStart = d('2026-01-01')
  const anchorTs = d(VITALI.acquisitionDate)
  const today = d('2026-08-06')

  it('medir desde el 1 de enero resta el depósito que creó el arranque', () => {
    const { pct } = computeModifiedDietz({
      startValue: VITALI.principal, endValue: VITALI.expectedNetWorth,
      startTs: yearStart, endTs: today, transactions, convert: null, baseCurrency: 'USD',
    })
    expect(pct).toBeLessThan(-40) // el −51 % del bug original
  })

  it('con el ancla en su fecha y ese flujo fuera, la ganancia es 240', () => {
    const { abs } = computeModifiedDietz({
      startValue: VITALI.principal, endValue: VITALI.expectedNetWorth,
      startTs: anchorTs, endTs: today,
      transactions: transactions.filter((t) => d(t.date) > anchorTs),
      convert: null, baseCurrency: 'USD',
    })
    expect(abs).toBe(inv('gain-vs-principal').expected)
  })

  it('y esa ganancia dividida entre el costo total da el mismo 3.94 % de las tarjetas', () => {
    const { abs } = computeModifiedDietz({
      startValue: VITALI.principal, endValue: VITALI.expectedNetWorth,
      startTs: anchorTs, endTs: today,
      transactions: transactions.filter((t) => d(t.date) > anchorTs),
      convert: null, baseCurrency: 'USD',
    })
    expect((abs / VITALI.cashOutOfPocket) * 100).toBeCloseTo(inv('pct-vs-cost-basis').expected, 9)
  })
})

describe('gráfica de rendimiento: mismo número que todo lo demás', () => {
  const chart = [
    { ts: d('2026-01-01'), value: 0 },                        // aún no existía
    { ts: d(VITALI.acquisitionDate), value: VITALI.principal },
    { ts: d(VITALI.couponDate), value: VITALI.expectedNetWorth },
    { ts: d('2026-08-06'), value: VITALI.expectedNetWorth },
  ]

  it('medida desde el 1 de enero la serie sale plana en 0: no hay capital', () => {
    expect(computeMWRSeries(chart, transactions, null, 'USD').every((v) => v === 0)).toBe(true)
  })

  it('medida desde que se fondeó, y re-baseada al costo total, da 3.94 %', () => {
    const measured = chart.slice(1)
    const raw = computeMWRSeries(measured, transactions, null, 'USD',
      { flowFromTs: measured[0].ts + 1 })
    const scaled = raw.map((v) => v * (VITALI.principal / VITALI.cashOutOfPocket))
    expect(scaled.pop()).toBeCloseTo(inv('pct-vs-cost-basis').expected, 9)
  })
})

describe('la especificación está congelada', () => {
  it('los números del caso de referencia no se pueden mutar', () => {
    expect(Object.isFrozen(VITALI)).toBe(true)
    expect(Object.isFrozen(INVARIANTS)).toBe(true)
    INVARIANTS.forEach((i) => expect(Object.isFrozen(i)).toBe(true))
  })
})
