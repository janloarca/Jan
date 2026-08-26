// Plan de ingresos por mes: el tablero con el que el usuario JUEGA a mover su
// salario variable entre meses. Módulo puro (sin React ni Firestore): los
// callers pasan el doc del plan y un convert(amount, from, to).
//
// ⛔ LA REGLA QUE SOSTIENE TODO ESTO: un plan NO es una transacción.
//
// Vive en su propio doc (`users/{uid}/settings/incomePlan`) y ningún motor de
// Flujo lo lee: ni `computeMonthlyAnalysis`, ni los insights, ni la tasa de
// ahorro, ni los correos semanal/mensual/anual, ni el reporte. Si el plan
// entrara al archivo, proyectar diciembre escribiría un ingreso que todavía no
// se cobró, y eso inflaría el ahorro y el resumen de un mes que ni siquiera
// pasó. El plan solo mira hacia adelante; el archivo solo guarda lo que de
// verdad pasó.
//
// Los meses ya cerrados no llevan plan: ahí manda el ingreso REAL de las
// transacciones (decisión del usuario). `firstPlannedMonth` es esa frontera.

// Dos tipos de cuadrito, y la distinción no es cosmética:
//
//   'monthly' — el salario fijo. Se dibuja en todos los meses desde
//               `startMonth`, se edita UNA vez y cambia en todos. NO se
//               arrastra: mover algo que está en los doce meses no significa
//               nada. Se puede quitar de un mes suelto (`skip`).
//   'once'    — el ingreso variable (la cátedra que a veces cae en noviembre y
//               a veces en diciembre). Vive en un mes y SÍ se arrastra.
import { isTransferCategory } from './financeCategories'

export const REPEAT_MONTHLY = 'monthly'
export const REPEAT_ONCE = 'once'

export const PLAN_CURRENCY = 'GTQ'

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const clampMonth = (m) => {
  const n = Math.trunc(Number(m))
  if (!Number.isFinite(n)) return 0
  return Math.min(11, Math.max(0, n))
}

function normalizeChip(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null
  if (!id) return null
  const amount = Number(raw.amount)
  if (!Number.isFinite(amount)) return null
  const repeat = raw.repeat === REPEAT_MONTHLY ? REPEAT_MONTHLY : REPEAT_ONCE
  const chip = {
    id,
    label: typeof raw.label === 'string' ? raw.label : '',
    amount,
    currency: typeof raw.currency === 'string' && raw.currency ? raw.currency : PLAN_CURRENCY,
    repeat,
  }
  if (repeat === REPEAT_MONTHLY) {
    chip.startMonth = clampMonth(raw.startMonth)
    // `skip` guarda los meses de los que el usuario quitó este cuadrito a mano.
    chip.skip = Array.isArray(raw.skip) ? [...new Set(raw.skip.map(clampMonth))].sort((a, b) => a - b) : []
  } else {
    chip.month = clampMonth(raw.month)
  }
  return chip
}

// El doc crudo de Firestore convertido a algo con lo que se puede trabajar, y
// aterrizado en el año que el usuario está viendo.
//
// Rollover de año: los cuadritos mensuales arrancan en enero (su `startMonth`
// describía el año viejo) y los de una sola vez conservan su mes, así que tu
// salario fijo y tu cátedra de diciembre siguen ahí el 1 de enero sin que
// tengas que volver a teclearlos. Nada se borra en silencio.
export function normalizePlan(raw, currentYear) {
  const year = Number(currentYear)
  const storedYear = Number(raw?.year)
  const rolled = Number.isFinite(storedYear) && Number.isFinite(year) && storedYear !== year
  const chips = (Array.isArray(raw?.chips) ? raw.chips : [])
    .map(normalizeChip)
    .filter(Boolean)
    .map((c) => (rolled && c.repeat === REPEAT_MONTHLY ? { ...c, startMonth: 0, skip: [] } : c))

  const savingsRate = {}
  const rawRate = raw?.savingsRate
  if (rawRate && typeof rawRate === 'object') {
    for (const [k, v] of Object.entries(rawRate)) {
      const m = clampMonth(k)
      const pct = Number(v)
      if (Number.isFinite(pct)) savingsRate[m] = Math.min(100, Math.max(0, pct))
    }
  }

  // `numOrNull` y no `Number(...)`: `Number(null)` es 0, así que una tasa
  // NUNCA configurada se leería como "0%" en vez de "usá la sugerida", y la
  // proyección saldría plana sin que nadie lo pidiera. Lo cazó el test de
  // round-trip por Firestore, no la lectura del código.
  const defaultSavings = numOrNull(raw?.defaultSavingsRate)
  const returnRate = numOrNull(raw?.returnRate)
  return {
    year: Number.isFinite(year) ? year : new Date().getUTCFullYear(),
    chips,
    savingsRate,
    defaultSavingsRate: defaultSavings == null ? null : Math.min(100, Math.max(0, defaultSavings)),
    returnRate,
  }
}

// El primer mes que el plan puede tocar: hoy si estamos dentro del año del
// plan, enero si el plan es de un año futuro, y 12 (o sea ninguno) si el año
// ya pasó entero.
export function firstPlannedMonth(planYear, today = new Date()) {
  const y = Number(planYear)
  const curY = today.getUTCFullYear()
  if (!Number.isFinite(y) || y === curY) return today.getUTCMonth()
  return y > curY ? 0 : 12
}

// Los cuadritos que le tocan a un mes concreto. Un mes anterior a
// `fromMonth` devuelve vacío: ahí manda lo real.
export function chipsForMonth(plan, monthIndex, fromMonth = 0) {
  const m = clampMonth(monthIndex)
  if (m < fromMonth) return []
  const out = []
  for (const chip of plan?.chips || []) {
    if (chip.repeat === REPEAT_MONTHLY) {
      if (m >= Math.max(chip.startMonth, fromMonth) && !chip.skip.includes(m)) out.push(chip)
    } else if (chip.month === m) {
      out.push(chip)
    }
  }
  return out
}

// Los doce meses expandidos de una sola pasada.
export function expandPlan(plan, fromMonth = 0) {
  return Array.from({ length: 12 }, (_, m) => chipsForMonth(plan, m, fromMonth))
}

function chipAmountIn(chip, convert, to) {
  const amt = Number(chip.amount) || 0
  const from = chip.currency || PLAN_CURRENCY
  if (from === to || typeof convert !== 'function') return amt
  const out = convert(amt, from, to)
  // Sin tasa disponible, `convert` devuelve el monto crudo: mejor el número sin
  // convertir que un NaN que se propague a toda la proyección.
  return Number.isFinite(out) ? out : amt
}

// Total planeado por mes, ya convertido a `to`.
export function planTotalsByMonth(plan, { fromMonth = 0, convert, to = PLAN_CURRENCY } = {}) {
  return expandPlan(plan, fromMonth).map((chips) =>
    chips.reduce((sum, c) => sum + chipAmountIn(c, convert, to), 0)
  )
}

// Ingreso REAL por mes del año, de las transacciones de Flujo. Es lo que se
// muestra en los meses ya cerrados, donde el plan no manda.
//
// Comparación por prefijo de string ('YYYY-MM'), nunca `new Date()`: la misma
// convención que `lib/financeMonth.js`, para que un usuario en UTC-6 no vea
// sus transacciones corridas de mes.
export function realIncomeByMonth(financeTransactions, year, { convert, to = PLAN_CURRENCY } = {}) {
  const out = Array(12).fill(0)
  for (const tx of financeTransactions || []) {
    if (tx?.type !== 'INCOME') continue
    // FASE LK. Dinero movido entre cuentas propias no es ingreso real: sin
    // esta exclusión, un pago de tarjeta degradado a 'Transferencia Recibida'
    // por el neteo (FASE KV) inflaba el "real" del calendario del plan. La
    // misma regla que ya aplican los tres motores de financeMonth.
    if (isTransferCategory(tx.category)) continue
    const date = typeof tx.date === 'string' ? tx.date : ''
    if (!date.startsWith(`${year}-`)) continue
    const m = Number(date.slice(5, 7)) - 1
    if (!(m >= 0 && m <= 11)) continue
    out[m] += chipAmountIn({ amount: tx.amount, currency: tx.currency }, convert, to)
  }
  return out
}

// ── Mutaciones ──────────────────────────────────────────────────────────────
// Todas devuelven un plan NUEVO y todas conservan `chips` como ARRAY.
//
// ⛔ `chips` no puede ser un mapa por mes. `setDoc(..., {merge:true})` fusiona
// los mapas anidados campo a campo, así que con un mapa borrar un cuadrito
// sería imposible: el campo viejo sobreviviría a la escritura y el cuadrito
// "volvería" solo. Con un array, Firestore reemplaza el valor entero y el
// borrado es un borrado (lección FASE FT).

export function upsertChip(plan, chip) {
  const next = normalizeChip(chip)
  if (!next) return plan
  const chips = [...(plan?.chips || [])]
  const i = chips.findIndex((c) => c.id === next.id)
  if (i >= 0) chips[i] = next
  else chips.push(next)
  return { ...plan, chips }
}

export function removeChip(plan, chipId, { month = null } = {}) {
  const chips = plan?.chips || []
  const target = chips.find((c) => c.id === chipId)
  if (!target) return plan
  // Quitar un cuadrito mensual de UN mes no lo borra: lo salta ahí y sigue en
  // los demás. Sin mes, se borra entero.
  if (target.repeat === REPEAT_MONTHLY && month != null) {
    const m = clampMonth(month)
    if (target.skip.includes(m)) return plan
    return upsertChip(plan, { ...target, skip: [...target.skip, m] })
  }
  return { ...plan, chips: chips.filter((c) => c.id !== chipId) }
}

// Mover un cuadrito a otro mes. Solo aplica a los de una sola vez: un mensual
// está en todos los meses y no tiene a dónde moverse.
export function moveChip(plan, chipId, toMonth) {
  const chips = plan?.chips || []
  const target = chips.find((c) => c.id === chipId)
  if (!target || target.repeat !== REPEAT_ONCE) return plan
  const m = clampMonth(toMonth)
  if (target.month === m) return plan
  return upsertChip(plan, { ...target, month: m })
}

// Id estable sin `Math.random()` en el render: el caller pasa el timestamp.
export function newChipId(nowMs, seed = 0) {
  return `chip-${Number(nowMs) || 0}-${seed}`
}

// Lo que se guarda en Firestore: solo campos serializables, sin undefined
// (Firestore los rechaza).
export function serializePlan(plan) {
  return {
    year: plan.year,
    chips: (plan.chips || []).map((c) =>
      c.repeat === REPEAT_MONTHLY
        ? { id: c.id, label: c.label, amount: c.amount, currency: c.currency, repeat: c.repeat, startMonth: c.startMonth, skip: c.skip }
        : { id: c.id, label: c.label, amount: c.amount, currency: c.currency, repeat: c.repeat, month: c.month }
    ),
    savingsRate: { ...(plan.savingsRate || {}) },
    defaultSavingsRate: plan.defaultSavingsRate == null ? null : plan.defaultSavingsRate,
    returnRate: plan.returnRate == null ? null : plan.returnRate,
  }
}
