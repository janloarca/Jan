import { monthsUntilGoal, monthlyNeeded, measuredMonthlyContribution, MIN_MONTHS_FOR_RATE } from '../goalProjection'
import { computeYtdInvested } from '../ytdInvested'
import { runMonteCarloSimulation } from '@/components/dashboard/analytics'

const AGO_2026 = Date.UTC(2026, 7, 28) // 28 ago 2026, el dia de la captura

describe('monthsUntilGoal', () => {
  it('cuenta hasta el CIERRE del año objetivo', () => {
    // Ago 2026 -> fin de 2028: sep..dic de 2026 (4) + 2027 (12) + 2028 (12).
    // El mes en curso no se cuenta entero: ya va corrido.
    expect(monthsUntilGoal(2028, AGO_2026)).toBe(28)
  })

  // El defecto: `targetYear - añoActual` daba 2 en enero y 2 en diciembre del
  // mismo año, o sea el horizonte no se movia en doce meses y despues caia de
  // golpe. Un conteo regresivo tiene que bajar cada mes.
  it('baja mes a mes en vez de quedarse quieto un año entero', () => {
    const ene = monthsUntilGoal(2028, Date.UTC(2026, 0, 15))
    const jun = monthsUntilGoal(2028, Date.UTC(2026, 5, 15))
    const dic = monthsUntilGoal(2028, Date.UTC(2026, 11, 15))
    expect(ene).toBe(35) // feb..dic 2026 (11) + 2027 + 2028
    expect(jun).toBe(30) // jul..dic 2026 (6) + 24
    expect(dic).toBe(24) // nada de 2026 + 24
    expect(ene).toBeGreaterThan(jun)
    expect(jun).toBeGreaterThan(dic)
  })

  it('sin salto artificial al cruzar el año nuevo', () => {
    const dic31 = monthsUntilGoal(2028, Date.UTC(2026, 11, 31))
    const ene1 = monthsUntilGoal(2028, Date.UTC(2027, 0, 1))
    expect(dic31 - ene1).toBe(1) // un mes, no doce
  })

  it('el año en curso todavia cuenta lo que le queda; uno pasado da cero', () => {
    expect(monthsUntilGoal(2026, AGO_2026)).toBe(4) // sep, oct, nov, dic
    expect(monthsUntilGoal(2025, AGO_2026)).toBe(0)
    expect(monthsUntilGoal(null, AGO_2026)).toBe(0)
  })
})

describe('monthlyNeeded', () => {
  // Los tres numeros EXACTOS de la captura del usuario: 28,873.33 -> 40,000 en
  // 24 meses. La aritmetica no cambio, solo la unidad del horizonte.
  it('reproduce los tres escenarios de la card', () => {
    expect(monthlyNeeded(28873.33, 40000, 5, 24)).toBeCloseTo(321.48, 1)
    expect(monthlyNeeded(28873.33, 40000, 7, 24)).toBeCloseTo(264.84, 1)
    expect(monthlyNeeded(28873.33, 40000, 10, 24)).toBeCloseTo(180.11, 1)
  })

  it('con mas meses hace falta menos por mes', () => {
    expect(monthlyNeeded(28873.33, 40000, 7, 28)).toBeLessThan(monthlyNeeded(28873.33, 40000, 7, 24))
  })

  it('meta ya alcanzada o sin tiempo: cero, nunca un negativo', () => {
    expect(monthlyNeeded(50000, 40000, 7, 24)).toBe(0)
    expect(monthlyNeeded(28873.33, 40000, 7, 0)).toBe(0)
  })

  it('tasa cero reparte la brecha en partes iguales', () => {
    expect(monthlyNeeded(0, 1200, 0, 12)).toBeCloseTo(100, 6)
  })
})

describe('measuredMonthlyContribution', () => {
  const dep = (date, amount, extra = {}) => ({ type: 'DEPOSIT', date, totalAmount: amount, currency: 'USD', ...extra })

  it('mide el ritmo real de los ultimos 12 meses', () => {
    const txs = [
      dep('2025-12-01', 300), dep('2026-02-01', 300), dep('2026-05-01', 300), dep('2026-08-01', 300),
    ]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(true)
    expect(out.invested).toBeCloseTo(1200, 2)
    expect(out.monthly).toBeGreaterThan(90)
    expect(out.monthly).toBeLessThan(140)
  })

  // Quien lleva cuatro meses en la app y metio 1,200 aporta ~300/mes, no 100:
  // dividir entre doce meses de los que ocho no existen subestima su ritmo.
  it('la ventana se acorta a la historia disponible', () => {
    const txs = [dep('2026-05-01', 600), dep('2026-07-01', 600)]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(true)
    expect(out.monthsCovered).toBeLessThan(5)
    expect(out.monthly).toBeGreaterThan(250)
  })

  // ⛔ La distincion que evita afirmar algo sobre la conducta de alguien: sin
  // NINGUN movimiento no se puede medir un ritmo (el caso de quien tecleo sus
  // saldos y nunca capturo su historia), y con movimientos viejos pero nada
  // reciente el ritmo es cero DE VERDAD.
  it('sin ningun movimiento REHUSA en vez de decir cero', () => {
    const out = measuredMonthlyContribution({ transactions: [], items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(false)
    expect(out.reason).toBe('no-flow-history')
  })

  it('con historia vieja y nada reciente el ritmo es cero, y eso SI se mide', () => {
    const txs = [dep('2023-01-01', 20000)]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(true)
    expect(out.monthly).toBe(0)
  })

  it('con menos de tres meses de historia no se afirma un ritmo', () => {
    const txs = [dep('2026-08-01', 500)]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(false)
    expect(out.reason).toBe('too-short')
    expect(MIN_MONTHS_FOR_RATE).toBeGreaterThanOrEqual(2)
  })

  it('un retiro resta: quien saca mas de lo que mete tiene ritmo negativo', () => {
    const txs = [
      dep('2025-10-01', 1000),
      { type: 'WITHDRAWAL', date: '2026-06-01', totalAmount: 5000, currency: 'USD' },
    ]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.measurable).toBe(true)
    expect(out.monthly).toBeLessThan(0)
  })

  // Hereda las exclusiones del motor compartido en vez de re-implementarlas:
  // una transferencia entre cuentas propias y un dividendo no son aporte.
  it('reusa las reglas de computeYtdInvested (transferencias y dividendos fuera)', () => {
    const txs = [
      dep('2025-10-01', 1200),
      { type: 'TRANSFER', date: '2026-03-01', totalAmount: 9000, currency: 'USD' },
      { type: 'DIVIDEND', date: '2026-04-01', totalAmount: 500, currency: 'USD' },
    ]
    const out = measuredMonthlyContribution({ transactions: txs, items: [], nowTs: AGO_2026 })
    expect(out.invested).toBeCloseTo(1200, 2)
  })
})

// El rango opcional es ADITIVO: sin el, el camino por año es el de siempre.
describe('computeYtdInvested con rango explicito', () => {
  const txs = [
    { type: 'DEPOSIT', date: '2025-06-01', totalAmount: 100, currency: 'USD' },
    { type: 'DEPOSIT', date: '2026-03-01', totalAmount: 200, currency: 'USD' },
  ]

  it('sin rango se comporta identico al camino por año', () => {
    expect(computeYtdInvested({ transactions: txs, items: [], year: 2026 }).invested).toBe(200)
    expect(computeYtdInvested({ transactions: txs, items: [], year: 2025 }).invested).toBe(100)
  })

  it('con rango manda el rango y puede cruzar años', () => {
    const out = computeYtdInvested({
      transactions: txs, items: [], year: 2026,
      startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2026, 11, 31),
    })
    expect(out.invested).toBe(300)
  })

  it('un rango a medias (solo una punta) se ignora y gana el año', () => {
    const out = computeYtdInvested({ transactions: txs, items: [], year: 2026, startTs: Date.UTC(2025, 0, 1) })
    expect(out.invested).toBe(200)
  })
})

// ⛔ EL INVARIANTE CENTRAL DE LA FASE, y el que fija que el defecto no vuelva.
//
// Con el aporte "necesario" la simulacion era circular: se le daba exactamente
// el aporte que aterriza la meta al retorno asumido y despues se le preguntaba
// que tan probable era la meta, asi que respondia ~50% aunque la meta fuera
// imposible. Con el aporte MEDIDO la respuesta tiene que poder moverse de punta
// a punta.
describe('la probabilidad depende de lo que el usuario aporta de verdad', () => {
  const sim = (monthly, months = 24) => runMonteCarloSimulation({
    startValue: 28873.33,
    monthlyContribution: monthly,
    years: months / 12,
    expectedReturn: 0.07,
    volatility: 0.15,
    numSimulations: 500,
    goalValue: 40000,
  }).goalProbability

  it('sin aportar nada la probabilidad es BAJA', () => {
    expect(sim(0)).toBeLessThan(25)
  })

  // Medido con el motor real sobre el caso del usuario: sin aportar 16%, la
  // mitad de lo necesario 31%, justo lo necesario 47%, el doble 79%, el triple
  // 95%. Los umbrales llevan margen para el ruido de 500 simulaciones.
  it('aportando el doble de lo necesario es ALTA', () => {
    expect(sim(monthlyNeeded(28873.33, 40000, 7, 24) * 2)).toBeGreaterThan(70)
  })

  it('la respuesta es monotona en el aporte: mas aporte, mas probabilidad', () => {
    const need = monthlyNeeded(28873.33, 40000, 7, 24)
    const nada = sim(0)
    const mitad = sim(need / 2)
    const triple = sim(need * 3)
    expect(mitad).toBeGreaterThan(nada)
    expect(triple).toBeGreaterThan(mitad)
  })

  it('el rango entre no aportar y aportar de sobra es amplio, no un ~50% fijo', () => {
    const nada = sim(0)
    const doble = sim(monthlyNeeded(28873.33, 40000, 7, 24) * 2)
    expect(doble - nada).toBeGreaterThan(50)
  })

  // La regresion negativa explicita: reproducir el comportamiento VIEJO
  // (alimentar la simulacion con el aporte necesario) da ~50% para una meta
  // real Y para una imposible. Esto es lo que se elimino.
  it('regresion negativa: con el aporte "necesario" una meta imposible tambien daba ~50%', () => {
    const imposible = runMonteCarloSimulation({
      startValue: 28873.33,
      monthlyContribution: monthlyNeeded(28873.33, 500000, 7, 24), // ~18,177/mes
      years: 2, expectedReturn: 0.07, volatility: 0.15,
      numSimulations: 500, goalValue: 500000,
    }).goalProbability
    expect(imposible).toBeGreaterThan(35)
    expect(imposible).toBeLessThan(60)
  })
})

// GoalTracker le pasa el horizonte como `meses / 12`, o sea fraccionario.
// Verificado que `(m/12)*12 === m` EXACTO para los 1..420 meses alcanzables
// (GOAL_MAX_YEAR=2060 es el tope), asi que el motor no necesita redondear: lo
// escribi como guard defensivo y lo revirti al comprobar que el caso no existe.
// El test se queda como el contrato que eso apoya.
describe('runMonteCarloSimulation con horizonte fraccionario', () => {
  it('un horizonte en meses/12 no pierde ningun mes', () => {
    for (const m of [13, 28, 47, 101, 419]) {
      expect((m / 12) * 12).toBe(m)
    }
  })

  it('los percentiles cubren todos los meses, sin huecos', () => {
    const out = runMonteCarloSimulation({
      startValue: 10000, monthlyContribution: 100,
      years: 28 / 12, expectedReturn: 0.07, volatility: 0.15,
      numSimulations: 50, goalValue: 20000,
    })
    expect(out.percentiles.p50).toHaveLength(29) // 28 meses + el punto inicial
    expect(out.percentiles.p50.every((v) => Number.isFinite(v))).toBe(true)
  })
})
