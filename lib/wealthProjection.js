// Proyección del patrimonio de aquí a fin de año, mes por mes, alimentada por
// el plan de ingresos de Flujo. Módulo puro (sin React ni Firestore).
//
// El ejercicio que contesta: si de aquí a diciembre entra lo que planeaste y
// ahorrás este porcentaje cada mes, ¿en cuánto terminás?
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
export function suggestSavingsRate(financeTransactions, { year, month, lookback = 6, convert, to = 'GTQ' } = {}) {
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
  if (used === 0 || income <= 0) return null
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
