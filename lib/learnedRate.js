// FASE QC (Fase C de 3). Tasa aprendida: lo que una cuenta líquida de verdad
// rindió, leído de los saldos que el usuario ya corrigió en la Hoja.
//
// Por qué existe. Con la Fase B el usuario puede decir "mi estado de cuenta de
// septiembre dice 5,015". Varias de esas observaciones seguidas son una serie
// de saldos reales mes a mes, y de ahí se puede DEDUCIR a qué ritmo crece la
// cuenta una vez que se descuenta lo que el usuario metió o sacó. Es el mismo
// criterio de `lib/liquidYield.js` (el saldo es el dato duro, la tasa es lo que
// se deduce), aplicado a una serie en vez de a un solo saldo.
//
// ⛔ Reglas que no se negocian (las tres las pidió el usuario):
//   1. SOLO SE SUGIERE. Este módulo no escribe nada ni decide aplicar nada: devuelve
//      una propuesta y un parche, y quien llama los pone detrás de un toque.
//   2. NO SE ADIVINA con poco. Menos de MIN_MONTHS meses utilizables = sin sugerencia.
//   3. NO SE APRENDE DE LO QUE NO ES RENDIMIENTO. Un mes cuyo cambio no lo explica
//      el crecimiento se ignora, nunca se promedia:
//        - un retiro que el usuario no registró (el saldo baja más de lo que
//          los movimientos conocidos explican),
//        - un depósito sin registrar o un dedazo al teclear el saldo (el salto
//          es absurdo para una cuenta líquida),
//        - un mes dominado por movimientos (la tasa no se puede separar de
//          ellos con un saldo por mes).
//      Los movimientos que SÍ están registrados (depósitos, retiros,
//      transferencias, cupones de otros activos) se descuentan, igual que hace
//      `knownContributions`; no son motivo para ignorar el mes.
//
// Qué NO hace: no toca `lib/assetLogic/` (ningún cálculo congelado cambia), no
// escribe observaciones ni transacciones, y la tasa que propone es un promedio
// de lo ocurrido, no una promesa de lo que va a rendir.

import { knownContributions, MAX_PLAUSIBLE_RATE_PCT } from './liquidYield'
import { accruesInBalance } from './spreadsheetEdit'
import { sanitizeObservations } from './sheetObservations'

export const MIN_MONTHS = 3
// Un mes cuyos movimientos conocidos pasan de esta fracción del saldo inicial
// no deja medir la tasa: el rendimiento queda enterrado en el aporte.
export const MAX_FLOW_SHARE = 0.5
// Por debajo de esto el saldo bajó más de lo que los movimientos explican: un
// retiro sin registrar (o un dedazo), jamás rendimiento negativo de una cuenta
// líquida. Tolerancia de redondeo del estado de cuenta.
const MIN_MONTH_RATE = -0.0005
// Diferencia mínima contra la tasa declarada para que valga molestar.
export const MIN_DELTA_PP = 0.3

const YEAR_DAYS = 365.25
const MONTH_RE = /^(\d{4})-(\d{2})$/

const monthStartTs = (mk) => {
  const [, y, m] = MONTH_RE.exec(mk)
  return Date.UTC(Number(y), Number(m) - 1, 1)
}
const nextMonthKey = (mk) => {
  const [, y, m] = MONTH_RE.exec(mk)
  const d = new Date(Date.UTC(Number(y), Number(m), 1))
  return d.toISOString().slice(0, 7)
}
const daysIn = (mk) => Math.round((monthStartTs(nextMonthKey(mk)) - monthStartTs(mk)) / 86400000)

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return null
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

// El valor observado, en la moneda del ÍTEM (las observaciones se guardan en la
// moneda que el usuario veía al teclear).
function observedInItemCurrency(o, itemCur, convert) {
  const from = o.currency || itemCur
  if (from === itemCur || !convert) return o.value
  const c = Number(convert(o.value, from, itemCur))
  return Number.isFinite(c) ? c : null
}

/**
 * Calcula la tasa anual que explican los saldos observados.
 *
 * Devuelve siempre un objeto: `status` dice si hay propuesta y `ignored` lista
 * cada mes que se dejó fuera con su razón (la UI puede mostrarlo; un mes que
 * desaparece sin explicación es la degradación muda que este repo prohíbe).
 */
export function learnRate({ item, observations, items, transactions, convert, currentMonthKey } = {}) {
  const none = (status, extra = {}) => ({ status, ratePct: null, used: 0, ignored: [], months: [], ...extra })
  if (!item?.id) return none('no-item')
  const itemCur = item.currency || item._originalCurrency || 'USD'

  const mine = sanitizeObservations(observations)
    .filter((o) => o.itemId === item.id && (!currentMonthKey || o.month !== currentMonthKey))
  const byMonth = new Map()
  for (const o of mine) {
    const v = observedInItemCurrency(o, itemCur, convert)
    if (v != null) byMonth.set(o.month, v)
  }
  if (byMonth.size < MIN_MONTHS + 1) return none('insufficient', { observed: byMonth.size })

  const contributions = knownContributions({ item, items, transactions, convert, asOfTs: null })

  const ignored = []
  const pairs = []
  const months = [...byMonth.keys()].sort()
  for (const m0 of months) {
    const m1 = nextMonthKey(m0)
    if (!byMonth.has(m1)) continue
    const v0 = byMonth.get(m0)
    const v1 = byMonth.get(m1)
    const start = monthStartTs(m1)
    const end = monthStartTs(nextMonthKey(m1))
    // El rendimiento que el usuario ya declaró a mano (`manual_yield`) ES
    // crecimiento, no un aporte: descontarlo del cambio escondería justo lo que
    // estamos midiendo.
    let flow = 0
    for (const c of contributions) {
      if (c.ts < start || c.ts >= end) continue
      if (c.kind === 'income' && c.source === 'manual_yield') continue
      flow += c.amount
    }
    if (!(v0 > 0)) { ignored.push({ month: m1, reason: 'no-base' }); continue }
    if (Math.abs(flow) > v0 * MAX_FLOW_SHARE) { ignored.push({ month: m1, reason: 'flow-dominated' }); continue }
    // Capital promedio del mes: lo que entró a mitad de mes rindió medio mes.
    const base = v0 + flow / 2
    const r = (v1 - v0 - flow) / base
    if (r < MIN_MONTH_RATE) { ignored.push({ month: m1, reason: 'balance-dropped' }); continue }
    const days = daysIn(m1)
    const annual = (Math.exp(Math.log1p(r) * (YEAR_DAYS / days)) - 1) * 100
    if (!Number.isFinite(annual) || annual > MAX_PLAUSIBLE_RATE_PCT) { ignored.push({ month: m1, reason: 'implausible' }); continue }
    pairs.push({ month: m1, annual, logAnn: Math.log1p(r) * (YEAR_DAYS / days) })
  }

  // Un dedazo en el saldo de un mes produce DOS pares torcidos (uno al subir,
  // otro al volver). Con la mediana como vara se quedan fuera los extremos sin
  // que ninguno mande: la cuenta no se mueve a saltos, así que lo que se aparta
  // de sus vecinos más de lo que ellos se apartan entre sí es un error de captura.
  let kept = pairs
  if (pairs.length >= MIN_MONTHS) {
    const med = median(pairs.map((p) => p.annual))
    const mad = median(pairs.map((p) => Math.abs(p.annual - med)))
    const band = Math.max(2.5, 3 * 1.4826 * mad)
    kept = pairs.filter((p) => Math.abs(p.annual - med) <= band)
    for (const p of pairs) if (!kept.includes(p)) ignored.push({ month: p.month, reason: 'outlier' })
  }

  if (kept.length < MIN_MONTHS) return none('insufficient', { observed: byMonth.size, ignored })

  const meanLog = kept.reduce((s, p) => s + p.logAnn, 0) / kept.length
  const ratePct = (Math.exp(meanLog) - 1) * 100
  const sorted = kept.map((p) => p.annual).sort((a, b) => a - b)
  return {
    status: 'ok',
    ratePct: Math.round(ratePct * 100) / 100,
    used: kept.length,
    months: kept.map((p) => p.month),
    spreadPct: Math.round((sorted[sorted.length - 1] - sorted[0]) * 100) / 100,
    ignored,
    observed: byMonth.size,
  }
}

// La tasa DECLARADA del ítem, solo cuando es una sola cifra anual que se puede
// reemplazar sin reinterpretar el activo. Una tasa variable (rango) o continua
// no se sobrescribe: se muestra la aprendida pero no se ofrece aplicarla.
export function declaredFixedRate(item) {
  if (!item) return null
  if (item.rateType === 'variable' || item.rateType === 'continuous') return null
  if (item.incomeMode !== 'percent') return null
  const r = Number(item.incomeRate)
  return Number.isFinite(r) && r > 0 ? r : null
}

// La llave que dice "esta sugerencia ya se contestó". Cambia si cambian las
// observaciones usadas o la tasa propuesta, así que descartar una no silencia
// la siguiente (la misma idea que `yieldSignature`).
export function learnedRateSignature(learned, observations, itemId) {
  const obs = sanitizeObservations(observations)
    .filter((o) => o.itemId === itemId)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((o) => `${o.month}:${o.value.toFixed(2)}`)
    .join(',')
  return `${Number(learned.ratePct).toFixed(2)}|${learned.used}|${obs}`
}

/**
 * La propuesta lista para mostrar, o null si no hay nada que decir.
 *
 * Solo cuentas líquidas (`accruesInBalance`): en un bono o una acción el valor
 * se mueve por precio, no por rendimiento acreditado, y "aprender una tasa" ahí
 * no significa nada. Y solo si la propuesta se aparta de lo declarado lo
 * bastante para que valga la pena mirarla.
 */
export function learnedRateSuggestion(args = {}) {
  const { item } = args
  if (!item || item.isDebt || !accruesInBalance(item)) return null
  const learned = learnRate(args)
  if (learned.status !== 'ok') return null
  const declared = declaredFixedRate(item)
  const hasDeclared = declared != null
  // Con una tasa variable declarada tampoco se molesta: ya dijo "no sé cuál es".
  if (hasDeclared && Math.abs(learned.ratePct - declared) < MIN_DELTA_PP) return null
  const signature = learnedRateSignature(learned, args.observations, item.id)
  if (item._learnedRate?.dismissed && item._learnedRate.signature === signature) return null
  return {
    ...learned,
    declaredPct: declared,
    signature,
    // Aplicar solo reemplaza una tasa fija ya declarada: poner una donde no hay
    // ninguna cambiaría qué paga el motor automático, y eso no se hace de un toque.
    canApply: hasDeclared,
  }
}

export function applyPatch(suggestion, now = new Date()) {
  return {
    incomeRate: suggestion.ratePct,
    _learnedRate: { signature: suggestion.signature, dismissed: false, appliedAt: now.toISOString() },
  }
}

export function dismissPatch(suggestion) {
  return { _learnedRate: { signature: suggestion.signature, dismissed: true } }
}
