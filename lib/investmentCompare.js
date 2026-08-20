// Comparador de inversiones: hasta tres escenarios con plazos y tasas
// distintas, puestos en el MISMO eje de años. Módulo puro (sin React ni
// Firestore) y sin ningún contacto con el archivo del usuario: es una
// calculadora, no una medición de lo que pasó.
//
// La pregunta que contesta, y que una calculadora de un solo escenario no
// puede: "tengo tres opciones con plazos y porcentajes distintos, ¿cuál me
// deja mejor parado, y en qué año?".
//
// ⛔ LA DECISIÓN QUE HACE COMPARABLES DOS PLAZOS DISTINTOS
//
// Si una opción dura 2 años y otra 10, hay que decir qué pasa con el dinero de
// la corta cuando vence, porque sin eso las dos curvas no se pueden mirar en
// la misma fecha. Acá se congela en EFECTIVO al 0%: al vencer, el saldo deja
// de crecer y deja de recibir aportes. Es la lectura conservadora y la que
// eligió el usuario, y muestra el costo real de un plazo corto sin plan de qué
// sigue. Reinvertir a una tasa supuesta sería inventar una segunda inversión
// que nadie eligió.

export const COMPOUND_OPTIONS = [
  { key: 'annually', perYear: 1, es: 'Anual', en: 'Annually' },
  { key: 'semiannually', perYear: 2, es: 'Semestral', en: 'Semiannually' },
  { key: 'quarterly', perYear: 4, es: 'Trimestral', en: 'Quarterly' },
  { key: 'monthly', perYear: 12, es: 'Mensual', en: 'Monthly' },
  { key: 'semimonthly', perYear: 24, es: 'Quincenal (24/año)', en: 'Semimonthly' },
  { key: 'biweekly', perYear: 26, es: 'Cada 2 semanas', en: 'Biweekly' },
  { key: 'weekly', perYear: 52, es: 'Semanal', en: 'Weekly' },
  { key: 'daily', perYear: 365, es: 'Diaria', en: 'Daily' },
  { key: 'continuously', perYear: null, es: 'Continua', en: 'Continuously' },
]

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// La tasa nominal anual y su frecuencia de capitalización, convertidas a la
// tasa EFECTIVA anual. Es lo que hace que la frecuencia signifique algo: 7%
// capitalizado mensual no rinde lo mismo que 7% capitalizado anual.
export function effectiveAnnualRate(ratePct, compound = 'monthly') {
  const r = num(ratePct) / 100
  const opt = COMPOUND_OPTIONS.find((o) => o.key === compound)
  if (!opt) return r
  if (opt.perYear == null) return Math.exp(r) - 1 // continua
  return Math.pow(1 + r / opt.perYear, opt.perYear) - 1
}

export function termMonthsOf(scenario) {
  return Math.max(0, Math.round(num(scenario?.years) * 12 + num(scenario?.months)))
}

// Un escenario simulado mes a mes hasta el horizonte común.
//
// El interés se acredita de forma CONTINUA dentro del año usando la tasa
// efectiva, así que un aporte de mitad de año rinde la parte proporcional del
// año en vez de esperar al cierre del período. Con la capitalización alineada
// a los aportes (lo normal: mensual con mensual, o un monto único con
// cualquier frecuencia) el resultado es exacto contra la fórmula cerrada;
// mezclando frecuencias, es la interpretación suave y monótona, que es la
// única que no produce escalones raros a mitad de la gráfica.
export function simulateScenario(scenario, horizonMonths) {
  const initial = num(scenario?.initial)
  const monthly = num(scenario?.monthly)
  const annual = num(scenario?.annual)
  const atBeginning = scenario?.contributeAt !== 'end'
  const ear = effectiveAnnualRate(scenario?.ratePct, scenario?.compound)
  // Con una tasa efectiva de -100% o peor no hay raíz real que tomar: el
  // capital simplemente desaparece.
  const growth = 1 + ear > 0 ? Math.pow(1 + ear, 1 / 12) : 0
  const term = termMonthsOf(scenario)
  const horizon = Math.max(0, Math.round(num(horizonMonths, term)))

  let balance = initial
  let contributed = initial
  const balances = [balance]

  for (let m = 1; m <= horizon; m++) {
    if (m <= term) {
      if (atBeginning) {
        balance += monthly
        contributed += monthly
        if ((m - 1) % 12 === 0) { balance += annual; contributed += annual }
      }
      balance *= growth
      if (!atBeginning) {
        balance += monthly
        contributed += monthly
        if (m % 12 === 0) { balance += annual; contributed += annual }
      }
    }
    // Pasado el plazo el saldo queda congelado: ni crece ni recibe aportes.
    balances.push(balance)
  }

  return {
    balances,
    termMonths: term,
    endBalance: balances[balances.length - 1],
    maturityBalance: balances[Math.min(term, balances.length - 1)],
    totalContributed: contributed,
    totalInterest: balances[balances.length - 1] - contributed,
    effectiveRate: ear,
  }
}

// Los tres escenarios en el mismo eje, más la tabla año por año.
export function compareScenarios(scenarios = []) {
  const list = (Array.isArray(scenarios) ? scenarios : []).filter(Boolean)
  const horizonMonths = Math.max(1, ...list.map(termMonthsOf))
  const results = list.map((s) => ({ ...simulateScenario(s, horizonMonths), id: s.id, name: s.name }))

  const lastYear = Math.ceil(horizonMonths / 12)
  const yearly = []
  for (let y = 0; y <= lastYear; y++) {
    const m = Math.min(y * 12, horizonMonths)
    const values = results.map((r) => r.balances[m])
    const best = values.length ? Math.max(...values) : 0
    yearly.push({
      year: y,
      // Un año que cae más allá del horizonte se recorta al último mes real,
      // así la última fila siempre dice el saldo final y no uno inventado.
      partial: y * 12 > horizonMonths,
      values,
      bestIndex: values.length ? values.findIndex((v) => v === best) : -1,
    })
  }

  const ends = results.map((r) => r.endBalance)
  const bestEnd = ends.length ? Math.max(...ends) : 0
  return {
    horizonMonths,
    results: results.map((r) => ({ ...r, deltaVsBest: r.endBalance - bestEnd })),
    yearly,
    winnerIndex: ends.length ? ends.findIndex((v) => v === bestEnd) : -1,
  }
}

export function newScenario(id, name, overrides = {}) {
  return {
    id, name,
    initial: 0, monthly: 0, annual: 0,
    contributeAt: 'end',
    ratePct: 7, compound: 'annually',
    years: 10, months: 0,
    ...overrides,
  }
}

// Quién va arriba en cada tramo del eje, para poder DECIRLO en vez de dejar
// que se deduzca leyendo la tabla fila por fila.
//
// Es la información que de verdad decide, y que la fila "mejor" esconde: con
// un plazo de 7 años contra uno de 3, el ganador final gana por DURAR, no por
// rendir. El cruce ("la corta va arriba hasta el año 3, la larga la pasa en el
// 4") es el hecho que separa las dos cosas.
//
// Un año donde dos escenarios empatan no tiene líder y no abre tramo: al año 0
// todos valen su monto inicial, así que sin esto el primer tramo sería
// siempre el escenario que quedó primero en el arreglo, que no significa nada.
export function leadershipSegments(comparison) {
  const rows = comparison?.yearly || []
  const segments = []
  for (const row of rows) {
    const vals = row.values || []
    if (vals.length < 2) return []
    const max = Math.max(...vals)
    const winners = vals.reduce((acc, v, i) => (v === max ? [...acc, i] : acc), [])
    if (winners.length !== 1) continue
    const index = winners[0]
    const last = segments[segments.length - 1]
    if (last && last.index === index) last.endYear = row.year
    else segments.push({ index, startYear: row.year, endYear: row.year })
  }
  return segments
}
