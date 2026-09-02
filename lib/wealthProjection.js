// Proyección del patrimonio de aquí a fin de año, mes por mes, alimentada por
// el plan de ingresos de Flujo. Módulo puro (sin React ni Firestore).
//
// El ejercicio que contesta: si de aquí a diciembre entra lo que planeaste y
// ahorrás este porcentaje cada mes, ¿en cuánto terminás?
//
// Único import a propósito: la regla de qué es una transferencia entre cuentas
// propias vive en un solo lugar. Una copia local acá se quedaría atrás la
// primera vez que esa lista cambie.
//
//   V(m+1) = V(m) × (1 + tasaAnual/12) + ingreso(m) × ahorro(m)
//
// Dos cosas importan de esa fórmula y las dos son decisiones, no accidentes:
//
//  1. El rendimiento se aplica al patrimonio que YA estaba, y el aporte del mes
//     entra después. Un aporte no puede rendir el mes en que llega: eso sería
//     regalarle un mes de interés a dinero que todavía no estaba adentro.
//  2. Los gastos no se modelan aparte. Viven DENTRO del porcentaje de ahorro,
//     que es exactamente cómo lo pidió el usuario ("50% en junio, 40% en julio")
//     y lo que hace que la pantalla se pueda usar sin tener el presupuesto
//     completo cargado.
//
// Esto NO mide nada del pasado: no toca Dietz, ni TWR, ni MWR, ni los
// snapshots. Es una proyección hacia adelante y su único insumo del archivo es
// el patrimonio de hoy.

import { isTransferCategory } from '@/lib/financeCategories'

// El mes en curso cuenta COMPLETO, no prorrateado por los días que faltan.
// Es la misma convención que ya usa la proyección de ingresos pasivos
// (`DividendIncome`), y prorratear un solo mes agrega una precisión falsa
// sobre una proyección que de por sí es un supuesto.

export function projectWealth({
  startValue = 0,
  monthlyIncome = [],
  savingsRate = {},
  defaultSavingsRate = 0,
  annualReturnPct = 0,
  fromMonth = 0,
  toMonth = 11,
} = {}) {
  const start = Number(startValue) || 0
  const r = (Number(annualReturnPct) || 0) / 100 / 12
  const points = []
  let value = start
  let totalSaved = 0
  let totalGrowth = 0

  for (let m = Math.max(0, fromMonth); m <= Math.min(11, toMonth); m++) {
    const income = Number(monthlyIncome[m]) || 0
    const pctRaw = savingsRate[m]
    const pct = Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : (Number(defaultSavingsRate) || 0)
    const growth = value * r
    const saved = income * (pct / 100)
    value = value + growth + saved
    totalSaved += saved
    totalGrowth += growth
    points.push({ month: m, income, pct, saved, growth, value })
  }

  return {
    startValue: start,
    points,
    totalSaved,
    totalGrowth,
    endValue: points.length ? points[points.length - 1].value : start,
    totalChange: (points.length ? points[points.length - 1].value : start) - start,
  }
}

// Un porcentaje de ahorro SUGERIDO, sacado de lo que la persona de verdad
// ahorró, nunca de un número inventado. Mira los meses ya CERRADOS (el mes en
// curso está a medias y siempre se vería como un ahorro altísimo o pésimo
// según el día) y pide ingreso > 0 para no dividir entre cero.
//
// Devuelve null cuando no hay meses utilizables: mejor sin sugerencia que con
// una inventada.
export function suggestSavingsRate(financeTransactions, { year, month, lookback = 6, minMonths = 1, convert, to = 'GTQ' } = {}) {
  const byMonth = new Map()
  const amountIn = (tx) => {
    const amt = Number(tx.amount) || 0
    const from = tx.currency || to
    if (from === to || typeof convert !== 'function') return amt
    const out = convert(amt, from, to)
    return Number.isFinite(out) ? out : amt
  }

  for (const tx of financeTransactions || []) {
    const date = typeof tx?.date === 'string' ? tx.date : ''
    if (date.length < 7) continue
    const key = date.slice(0, 7)
    if (!byMonth.has(key)) byMonth.set(key, { income: 0, expenses: 0 })
    const bucket = byMonth.get(key)
    // Mover dinero entre cuentas propias no ahorra ni gasta nada, así que no
    // puede mover la tasa de ahorro sugerida (ver lib/financeCategories.js).
    if (isTransferCategory(tx.category)) continue
    if (tx.type === 'INCOME') bucket.income += amountIn(tx)
    else if (tx.type === 'EXPENSE') bucket.expenses += amountIn(tx)
  }

  let income = 0
  let expenses = 0
  let used = 0
  for (let back = 1; back <= lookback; back++) {
    const d = new Date(Date.UTC(year, month - back, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const bucket = byMonth.get(key)
    if (!bucket || bucket.income <= 0) continue
    income += bucket.income
    expenses += bucket.expenses
    used += 1
  }
  // `minMonths` es lo que separa una medición de un ruido. Con dos meses a
  // medio registrar, "ahorraste 0%" no es un dato: es una muestra chica
  // presentada con la misma autoridad que una buena.
  if (used < Math.max(1, minMonths) || income <= 0) return null
  const pct = ((income - expenses) / income) * 100
  return { pct: Math.min(100, Math.max(0, Math.round(pct))), months: used }
}

// El retorno anualizado del propio portafolio, para sugerir la tasa en vez de
// inventar un 7%. Null cuando la historia es demasiado corta: anualizar dos
// meses de mercado produce números absurdos (un +6% en dos meses "anualiza" a
// más del 40%) y ofrecerlo como sugerencia sería mentir con forma de dato.
export function annualizedReturnPct(totalReturnPct, sinceDate, now = new Date()) {
  // El chequeo de null va ANTES del Number(): `Number(null)` es 0 y
  // `Number.isFinite(0)` es true, así que "no hay dato de retorno" se colaría
  // como "el portafolio rindió 0%" y se ofrecería esa cifra como sugerencia.
  // Es la misma trampa que ya apareció con `returnRate` en lib/incomePlan.js.
  if (totalReturnPct === null || totalReturnPct === undefined || totalReturnPct === '') return null
  const total = Number(totalReturnPct)
  if (!Number.isFinite(total)) return null
  const startTs = sinceDate ? new Date(sinceDate).getTime() : NaN
  if (!Number.isFinite(startTs)) return null
  const years = (now.getTime() - startTs) / (365.25 * 86400000)
  if (!(years >= 1)) return null
  const growth = 1 + total / 100
  if (growth <= 0) return null
  return (Math.pow(growth, 1 / years) - 1) * 100
}

// La tasa de ahorro que el usuario DECLARÓ en su perfil financiero. Es un
// auto-reporte, no una medición, así que solo se usa cuando no hay meses
// reales suficientes: entre una muestra de dos meses incompletos y lo que la
// persona dice de sí misma, lo segundo es mejor.
//
// No necesita conversión de moneda: es la RAZÓN entre dos cifras que se
// teclean en el mismo formulario, así que sale igual en quetzales o dólares
// mientras las dos estén en la misma moneda, que es el caso por construcción.
export function savingsRateFromProfile(profile) {
  const income = Number(profile?.monthlyIncome)
  const savings = Number(profile?.monthlySavings)
  if (!Number.isFinite(income) || income <= 0) return null
  if (!Number.isFinite(savings) || savings < 0) return null
  return {
    pct: Math.min(100, Math.max(0, Math.round((savings / income) * 100))),
    income, savings,
  }
}

// ── ¿Voy a llegar a mi meta? ───────────────────────────────────────────────
//
// La proyección de arriba se detiene en diciembre; esta la lleva hasta el año
// objetivo. Es la pregunta detrás de todo el ejercicio: no "cuánto voy a tener
// en diciembre" sino "a este ritmo, ¿llego?".
//
// Los supuestos, y cada uno es una decisión que se dice en pantalla:
//
//  - Los años futuros REPITEN el plan del año en curso, con una tasa de
//    crecimiento anual ajustable (default 0%, o sea todo igual).
//  - En el año en curso mandan los porcentajes de ahorro mes por mes; en los
//    años futuros manda el default, porque nadie va a teclear 48 meses.
//  - El mes en curso cuenta completo, igual que la proyección a diciembre.
//
// `currentYearIncome` viene ya recortado al mes de arranque y
// `futureYearIncome` es el plan de un año COMPLETO: un salario mensual que
// arrancó en septiembre porque ahí se configuró la app aplica los doce meses
// del año siguiente. Esa es la misma regla de rollover que `normalizePlan` ya
// documenta, y por eso el caller la produce con ella en vez de con una segunda
// definición acá.
export function projectToGoal({
  startValue = 0,
  currentYearIncome = [],
  futureYearIncome = [],
  savingsRate = {},
  defaultSavingsRate = 0,
  annualReturnPct = 0,
  incomeGrowthPct = 0,
  fromMonth = 0,
  currentYear,
  throughYear,
  goalValue = null,
} = {}) {
  const start = Number(startValue) || 0
  const r = (Number(annualReturnPct) || 0) / 100 / 12
  const g = (Number(incomeGrowthPct) || 0) / 100
  const y0 = Number(currentYear)
  const yN = Number(throughYear)
  const goal = Number(goalValue)
  const hasGoal = Number.isFinite(goal) && goal > 0

  if (!Number.isFinite(y0) || !Number.isFinite(yN) || yN < y0) {
    return { years: [], endValue: start, totalSaved: 0, totalGrowth: 0, reachedYear: null, gap: hasGoal ? goal - start : 0, goalValue: hasGoal ? goal : null }
  }

  let value = start
  let totalSaved = 0
  let totalGrowth = 0
  let reachedYear = hasGoal && start >= goal ? y0 : null
  const years = []

  for (let year = y0; year <= yN; year++) {
    const isCurrent = year === y0
    const income = isCurrent ? currentYearIncome : futureYearIncome
    // El crecimiento aplica desde el PRIMER año futuro: el año en curso ya
    // está planeado mes por mes y no se toca. No hace falta una rama para
    // eso, y por eso NO la hay: en el año en curso el exponente es cero, así
    // que el factor es 1 por construcción. Un `isCurrent ? 1 : ...` acá sería
    // código que nunca puede correr distinto.
    const scale = Math.pow(1 + g, year - y0)
    const startMonth = isCurrent ? Math.max(0, fromMonth) : 0
    let saved = 0
    let growth = 0

    for (let m = startMonth; m <= 11; m++) {
      const monthIncome = (Number(income[m]) || 0) * scale
      const pctRaw = isCurrent ? savingsRate[m] : undefined
      const pct = Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : (Number(defaultSavingsRate) || 0)
      const monthGrowth = value * r
      const monthSaved = monthIncome * (pct / 100)
      value = value + monthGrowth + monthSaved
      saved += monthSaved
      growth += monthGrowth
    }

    totalSaved += saved
    totalGrowth += growth
    years.push({ year, value, saved, growth })
    if (hasGoal && reachedYear == null && value >= goal) reachedYear = year
  }

  return {
    years,
    startValue: start,
    endValue: value,
    totalSaved,
    totalGrowth,
    reachedYear,
    goalValue: hasGoal ? goal : null,
    gap: hasGoal ? goal - value : 0,
  }
}

// La tasa de ahorro MÍNIMA que hace aterrizar la meta en el año objetivo.
//
// Se resuelve por bisección y no con una fórmula cerrada porque el plan no es
// un aporte parejo: cambia mes a mes y crece por año. Es monótona en la tasa
// (ahorrar más nunca puede dar menos), así que la bisección es válida.
//
// ⛔ Lo que se mueve es el DEFAULT, no los meses que el usuario ya ajustó a
// mano: esos son decisiones suyas sobre este año y pisarlas para hacer cuadrar
// una meta sería contestar otra pregunta. Por eso el resultado se presenta
// como "el default tendría que ser X".
//
// Devuelve null cuando no hay nada que resolver (la meta ya se alcanza con lo
// que hay) o cuando es inalcanzable incluso ahorrando el 100%: decirlo es la
// respuesta, inventar una tasa de 340% no.
export function savingsRateForGoal(params = {}) {
  const goal = Number(params.goalValue)
  if (!Number.isFinite(goal) || goal <= 0) return null
  const at = (pct) => projectToGoal({ ...params, defaultSavingsRate: pct, savingsRate: params.savingsRate || {} }).endValue
  if (at(Number(params.defaultSavingsRate) || 0) >= goal) return null
  if (at(100) < goal) return null

  let lo = 0
  let hi = 100
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) >= goal) hi = mid
    else lo = mid
  }
  return Math.ceil(hi * 10) / 10
}
