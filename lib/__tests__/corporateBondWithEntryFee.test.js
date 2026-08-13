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
  entryFeeAddbacks,
} from '@/components/dashboard/utils'
import { computeMWRSeries, computeAnchoredReturnSeries } from '@/components/dashboard/analytics'
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

// FASE IA: el caso que la rama del ancla movida NO cubre: el portafolio YA
// tenía valor el 1 de enero (otro activo), así que el ancla no se mueve y el
// depósito de VITALI (comisión adentro) entra al Dietz como flujo de mitad de
// ventana. Sin el addback, la comisión se cobraba como pérdida en el
// numerador: la violación exacta que la spec prohíbe, en el caso que ninguna
// de las ramas viejas alcanzaba. Confirmado por el usuario antes de extender
// (13 ago 2026); la evidencia empírica fue encabezado vs gráfica difiriendo
// $98.00 exactos.
describe('FASE IA: compra DENTRO de la ventana, con el ancla quieta en el 1 de enero', () => {
  const yearStart = d('2026-01-01')
  const today = d('2026-08-06')
  const preexistingStart = 2000 // otro activo ya daba valor al 1-ene

  const dietz = () => computeModifiedDietz({
    startValue: preexistingStart,
    endValue: preexistingStart + VITALI.expectedNetWorth,
    startTs: yearStart, endTs: today,
    transactions, convert: null, baseCurrency: 'USD',
  })

  it('sin addback, el Dietz crudo cobra la comisión como pérdida (ganancia − fee)', () => {
    const { abs } = dietz()
    expect(abs).toBeCloseTo(inv('gain-vs-principal').expected - VITALI.entryFee, 9)
  })

  it('el addback devuelve la comisión al numerador y la ganancia vuelve a medir contra el principal', () => {
    const { abs } = dietz()
    const addback = [...entryFeeAddbacks(items, transactions, { fromTs: yearStart, toTs: today }).values()]
      .reduce((s, v) => s + v, 0)
    expect(addback).toBe(VITALI.entryFee)
    expect(abs + addback).toBeCloseTo(inv('gain-vs-principal').expected, 9)
  })

  it('el denominador NO recibe el addback: sigue siendo capital all-in ponderado', () => {
    // Solo el numerador cambia. weightedCapital es el de siempre (arranque +
    // flujo ponderado con la comisión adentro): la mitad "denominador" de la
    // convención 3.94% queda intacta.
    const { weightedCapital, abs, pct } = dietz()
    expect(weightedCapital).toBeGreaterThan(preexistingStart)
    expect(pct).toBeCloseTo((abs / weightedCapital) * 100, 9)
  })

  it('guard del caso congelado: con el ancla movida y el depósito descartado, el addback es CERO', () => {
    // La lista filtrada (los flujos que el Dietz de verdad neteó) ya no trae el
    // depósito de apertura, así que la comisión no se devuelve aquí: ese camino
    // lo maneja ytdCostBase, igual que siempre, y el 3.94% no se toca.
    const anchorTs = d(VITALI.acquisitionDate)
    const filtered = transactions.filter((t) => d(t.date) > anchorTs)
    const addback = entryFeeAddbacks(items, filtered, { fromTs: anchorTs, toTs: today })
    expect(addback.size).toBe(0)
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

  // FASE EJ, con la función REAL que ahora usa el chart (computeAnchoredReturnSeries):
  // el mismo caso VITALI-solo, desde $0, tiene que dar el mismo 3.94% de siempre.
  it('computeAnchoredReturnSeries reproduce el mismo 3.94 % para el caso VITALI-solo', () => {
    const series = computeAnchoredReturnSeries(chart, transactions, null, 'USD')
    expect(series[0]).toBe(0) // antes de fondearse
    expect(series[series.length - 1]).toBeCloseTo(inv('pct-vs-cost-basis').expected, 9)
  })
})

// FASE EJ. XOCHI: un SEGUNDO bono (comprado en 2024, antes de esta ventana),
// que le da a la ventana un arranque > 0 ANTES de que VITALI se funde encima.
// El bug real: con el arranque en 0 el ancla vieja (findIndex(value>0)) nunca
// se activaba, así que la comisión de VITALI aparecía como una pérdida
// instantánea el día del depósito, sanando poco a poco con el peso temporal
// de Dietz — el error de comisión-en-el-numerador que este archivo ya
// documenta, repartido en toda la serie en vez de en un solo número.
describe('gráfica de rendimiento con DOS activos: XOCHI ya tenía valor cuando VITALI se fondeó', () => {
  const XOCHI_JAN1 = 1967.45 + 236.09 // XOCHI + su Fondo Líquido Q, ya en enero
  const FONDO_Q_COUPON = 78.70        // el cupón de XOCHI de febrero, en la cuenta Q
  const chart = [
    { ts: d('2026-01-01'), value: XOCHI_JAN1 },
    { ts: d(VITALI.acquisitionDate), value: XOCHI_JAN1 + VITALI.principal },       // VITALI se funde
    { ts: d('2026-02-28'), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON },  // cupón de XOCHI
    { ts: d(VITALI.couponDate), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON + VITALI.couponPaid }, // cupón de VITALI
    { ts: d('2026-08-06'), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON + VITALI.couponPaid },
  ]
  // XOCHI's own funding, years before this window: debe quedar afuera del
  // "fondeo nuevo" o se contaría dos veces (una vez adentro de XOCHI_JAN1, y
  // otra vez si el filtro de fecha no lo excluyera).
  const xochiOpeningDeposit = {
    id: 'dep-xochi', type: 'DEPOSIT', date: '2024-06-01',
    totalAmount: 1967.45, currency: 'USD', _linkedItemId: 'xochi', _source: 'manual_new_account',
  }
  const txs = [xochiOpeningDeposit, openingDeposit, coupon]

  it('el punto antes de que VITALI se fondee no es 0: mide lo que XOCHI ya valía', () => {
    // A diferencia del caso de un solo activo desde $0, acá SÍ hay capital
    // real antes del ancla — pero como no pasó nada con XOCHI en esos 5 días,
    // el relleno en 0% sigue siendo la lectura correcta para ese tramo.
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    expect(series[0]).toBe(0)
  })

  it('el cupón de XOCHI en febrero es un bump claro, no una raya plana', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    expect(series[2]).toBeGreaterThan(series[1])
  })

  it('el cupón de VITALI en mayo es otro bump claro', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    expect(series[3]).toBeGreaterThan(series[2])
  })

  it('el final da 3.84 %, el MISMO número que el encabezado de Valor (computeWindowGrowth)', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    // 318.70 (78.70 + 240) sobre 8,301.54 (2,203.54 + 6,098) — ver
    // computeWindowGrowth.test.js para el mismo número por el otro camino.
    const expectedPct = ((FONDO_Q_COUPON + VITALI.couponPaid) / (XOCHI_JAN1 + VITALI.cashOutOfPocket)) * 100
    expect(expectedPct).toBeCloseTo(3.839, 2) // 3.84 % redondeado a 2 decimales, como en pantalla
    expect(series[series.length - 1]).toBeCloseTo(expectedPct, 6)
  })

  it('la comisión de VITALI NUNCA aparece como una pérdida instantánea el día del depósito', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    // El punto del propio depósito (índice 1, el ancla) tiene que ser >= 0:
    // si la comisión se filtrara al numerador, este punto saldría negativo
    // (el bug real, "-4.45%" el día exacto del depósito).
    expect(series[1]).toBeGreaterThanOrEqual(0)
  })
})

// FASE EO. TRES bonos fondeados en TRES fechas distintas dentro de la misma
// ventana ALL: XOCHI ya tenía valor en enero (igual que arriba), VITALI se
// funda en enero, y un tercero (CrediCorp) se funda en junio. El bug real: el
// arreglo de un solo ancla (FASE EJ) solo trataba el PRIMER fondeo nuevo
// dentro de la ventana (VITALI); el fondeo de CrediCorp, con su propia
// comisión, volvía a mostrar la pérdida instantánea que el caso VITALI-solo
// ya arregló, sanando poco a poco según el peso temporal de Dietz. Eso es
// exactamente la "bajada" que se ve en la captura de un portafolio 100%
// estático (sin riesgo de mercado real): un artefacto de cómo se mide, no un
// evento real de pérdida.
describe('gráfica de rendimiento con TRES activos fondeados en TRES fechas: sin bajadas', () => {
  const XOCHI_JAN1 = 1967.45 + 236.09 // XOCHI + su Fondo Líquido Q, ya en enero
  const FONDO_Q_COUPON = 78.70        // el cupón de XOCHI de febrero, en la cuenta Q
  const CREDI_PRINCIPAL = 4000
  const CREDI_FEE = 60
  const CREDI_COST = CREDI_PRINCIPAL + CREDI_FEE // 4,060, depósito de apertura
  const CREDI_DATE = '2026-06-01'
  const chart = [
    { ts: d('2026-01-01'), value: XOCHI_JAN1 },
    { ts: d(VITALI.acquisitionDate), value: XOCHI_JAN1 + VITALI.principal },       // VITALI se funde
    { ts: d('2026-02-28'), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON },  // cupón de XOCHI
    { ts: d(VITALI.couponDate), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON + VITALI.couponPaid }, // cupón de VITALI
    { ts: d(CREDI_DATE), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON + VITALI.couponPaid + CREDI_PRINCIPAL }, // CrediCorp se funde
    { ts: d('2026-08-06'), value: XOCHI_JAN1 + VITALI.principal + FONDO_Q_COUPON + VITALI.couponPaid + CREDI_PRINCIPAL },
  ]
  const xochiOpeningDeposit = {
    id: 'dep-xochi', type: 'DEPOSIT', date: '2024-06-01',
    totalAmount: 1967.45, currency: 'USD', _linkedItemId: 'xochi', _source: 'manual_new_account',
  }
  const crediOpeningDeposit = {
    id: 'dep-credi', type: 'DEPOSIT', date: CREDI_DATE,
    totalAmount: CREDI_COST, currency: 'USD', _linkedItemId: 'credicorp', _source: 'manual_new_account',
  }
  const txs = [xochiOpeningDeposit, openingDeposit, coupon, crediOpeningDeposit]

  it('el fondeo de CrediCorp (segundo evento) tampoco aparece como pérdida instantánea', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    // Índice 4 es el punto exacto del depósito de CrediCorp: si su comisión se
    // filtrara al numerador (el bug de un solo ancla), este punto bajaría
    // respecto al punto anterior (índice 3).
    expect(series[4]).toBeGreaterThanOrEqual(series[3])
  })

  it('la serie completa es monótona no decreciente: ningún fondeo produce una bajada', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1] - 1e-9)
    }
  })

  it('CrediCorp escala el costo total agregado pero NUNCA diluye lo ya ganado', () => {
    const series = computeAnchoredReturnSeries(chart, txs, null, 'USD')
    // Sin CrediCorp, la cadena (antes del re-base final) es exactamente
    // 3.839046731088448 % / oldScale — el mismo número que fija el test de
    // DOS activos de arriba, deshaciendo su propio re-base.
    const oldScale = (XOCHI_JAN1 + VITALI.principal) / (XOCHI_JAN1 + VITALI.cashOutOfPocket)
    const unscaledChainPct = 3.839046731088448 / oldScale
    // Con CrediCorp: su propio tramo rinde 0 % en esta ventana (no generó
    // ingreso), así que la cadena NO cambia por dilución — encadenar por
    // (1+r)×(1+0)−1 deja el producto igual. Solo el re-base final se ajusta
    // con la comisión de CrediCorp sumada al costo total agregado. Si en vez
    // de encadenar se hubiera diluido (gain/cost ingenuo, contando el costo
    // de CrediCorp sin su tiempo), el número habría caído a ~2.58 %: la
    // prueba de que NO diluye es que se queda cerca de 3.84 %, no de 2.58 %.
    const newScale = (XOCHI_JAN1 + VITALI.principal + CREDI_PRINCIPAL) / (XOCHI_JAN1 + VITALI.cashOutOfPocket + CREDI_COST)
    const expectedPct = unscaledChainPct * newScale
    expect(series[series.length - 1]).toBeCloseTo(expectedPct, 6)
    expect(series[series.length - 1]).toBeGreaterThan(3.5) // lejos del 2.58 % diluido
  })
})

describe('la especificación está congelada', () => {
  it('los números del caso de referencia no se pueden mutar', () => {
    expect(Object.isFrozen(VITALI)).toBe(true)
    expect(Object.isFrozen(INVARIANTS)).toBe(true)
    INVARIANTS.forEach((i) => expect(Object.isFrozen(i)).toBe(true))
  })
})
