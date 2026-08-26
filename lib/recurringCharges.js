// Suscripciones y cargos recurrentes, detectados del histórico ya importado.
//
// El problema (plan de agentes, feature 3): la categoría 'Suscripciones' se
// llena por palabras clave, pero nadie dice cuánto suma la nómina mensual,
// cuál subió de precio, ni cuál dejó de cobrar. Con ~170 movimientos por
// período, un cargo de Q79 que se repite doce veces es invisible fila por
// fila. Esto lo DESCRIBE; no es un presupuesto y no impone ningún límite.
//
// Decisiones que no son accidente:
//  - Se agrupa por `merchantRuleKey`, la MISMA normalización que ya junta
//    "FINCA FELIZ GT" con "FINCA FELIZ ZONA 10" cuando dos bancos escriben el
//    mismo lugar distinto. Nunca una segunda copia de esa regla.
//  - Los montos se comparan en la MONEDA ORIGINAL de la fila: una suscripción
//    en dólares convertida a quetzales se mueve con el FX y cada tipo de
//    cambio se leería como "subió de precio". Un grupo que mezcla monedas se
//    rechaza como recurrente: un mismo cargo no cambia de moneda.
//  - Un supermercado con ocho cobros al mes de montos parecidos NO es una
//    suscripción: la disciplina de UNA vez por mes (mediana de cobros/mes = 1,
//    ningún mes con más de 2) es lo que separa un cargo recurrente de un
//    hábito de compra.
//  - "No cobró este mes" solo se afirma cuando el día esperado YA PASÓ con
//    margen (mediana del día de cobro + 5): sin eso, cada mes empezaría con
//    toda la nómina "desaparecida" hasta que fueran cayendo los cobros.
//  - Fechas SIEMPRE por recorte de texto sobre 'YYYY-MM-DD' (la regla de
//    financeMonth.js); los GAPS en días usan Date.parse, que sobre esa forma
//    es medianoche UTC en ambos extremos, así que la resta es libre de zona.
//
// La cadencia ANUAL/SEMESTRAL que también devuelve este módulo alimenta la
// feature 4 (separar pagos anuales del gasto recurrente del mes).
//
// Módulo puro + tests.

import { merchantRuleKey } from './merchantLabels'
import { addMonths } from './installmentPlans'
import { FINANCE_CURRENCY } from './financeMonth'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Banda de "es el mismo cargo": cubre un alza real de precio (Spotify
// 54.99 → 64.99 es 1.18x) sin aceptar montos de otra naturaleza.
export const SAME_CHARGE_MIN_RATIO = 0.55
export const SAME_CHARGE_MAX_RATIO = 1.8
// Un alza de precio se reporta a partir de +5%: por debajo es redondeo/ajuste.
export const PRICE_RISE_MIN_RATIO = 1.05
// Días de gracia después del día esperado antes de afirmar "no cobró".
export const MISSING_GRACE_DAYS = 5
// Meses distintos mínimos para afirmar recurrencia mensual. Con menos de tres
// puntos, "recurrente" sería una adivinanza con cara de dato.
export const MIN_MONTHS = 3

const TRANSFER_CATEGORIES = new Set(['Transferencia Enviada', 'Transferencia Recibida'])

// Filas que pueden contar como ocurrencia de un cargo recurrente.
function isCandidateRow(tx) {
  if (!tx || tx.type !== 'EXPENSE') return false
  if (num(tx.amount) <= 0) return false // un reembolso no es una ocurrencia
  if (!tx.date || String(tx.date).length < 10) return false
  if (TRANSFER_CATEGORIES.has(tx.category)) return false
  if (tx._nettedTransfer) return false
  if (tx.kind === 'payment' || tx.kind === 'payment-adjustment') return false
  // Una cuota es el pago de algo ya comprado: es trabajo de la card de cuotas
  // (lib/installmentPlans.js), y contarla acá la mostraría dos veces.
  if (tx.installment || tx.kind === 'installment') return false
  return true
}

const monthOf = (tx) => String(tx.date).slice(0, 7)
const dayOf = (tx) => Number(String(tx.date).slice(8, 10))

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

// ¿Hay al menos `n` meses CONSECUTIVOS en la lista de llaves 'YYYY-MM'?
function hasConsecutiveMonths(monthKeys, n) {
  const set = new Set(monthKeys)
  for (const mk of monthKeys) {
    let run = 1
    let cur = mk
    while (run < n) {
      cur = addMonths(cur, 1)
      if (!set.has(cur)) break
      run++
    }
    if (run >= n) return true
  }
  return false
}

function toGtq(amount, currency, convert) {
  const amt = num(amount)
  const cur = currency || FINANCE_CURRENCY
  if (cur === FINANCE_CURRENCY || typeof convert !== 'function') return amt
  const out = convert(amt, cur, FINANCE_CURRENCY)
  return isFinite(out) ? out : amt
}

// Agrupa las filas candidatas por comercio normalizado. Cada grupo sale con
// sus ocurrencias ordenadas por fecha y la etiqueta más corta vista (la misma
// convención de lib/unclassifiedMerchants.js: la variante sin cola de banco).
function groupByMerchant(transactions) {
  const groups = new Map()
  for (const tx of transactions || []) {
    if (!isCandidateRow(tx)) continue
    const raw = tx.merchant || tx.description || ''
    const key = merchantRuleKey(raw)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { key, label: String(raw).trim(), rows: [] })
    const g = groups.get(key)
    if (String(raw).trim() && String(raw).trim().length < g.label.length) g.label = String(raw).trim()
    g.rows.push(tx)
  }
  for (const g of groups.values()) g.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return groups
}

// La nómina de cargos recurrentes MENSUALES más la lista de cadencia larga
// (anual/semestral). `nowDate` es 'YYYY-MM-DD'; sin él no se puede juzgar
// "no cobró este mes", así que ese flag queda apagado.
export function detectRecurringCharges(transactions, { convert = null, nowDate = null } = {}) {
  const groups = groupByMerchant(transactions)
  const nowMonth = nowDate ? String(nowDate).slice(0, 7) : null
  const nowDay = nowDate ? Number(String(nowDate).slice(8, 10)) : null

  const monthly = []
  const longCadence = []

  for (const g of groups.values()) {
    const currencies = new Set(g.rows.map((r) => r.currency || FINANCE_CURRENCY))
    if (currencies.size > 1) continue // un mismo cargo no cambia de moneda
    const currency = [...currencies][0]

    const amounts = g.rows.map((r) => num(r.amount))
    const med = median(amounts)
    if (med <= 0) continue
    const inBand = amounts.filter((a) => a >= med * SAME_CHARGE_MIN_RATIO && a <= med * SAME_CHARGE_MAX_RATIO)
    const bandOk = inBand.length / amounts.length >= 0.8

    // --- cadencia larga (anual / semestral), para la feature 4 -------------
    if (g.rows.length >= 2 && bandOk) {
      const gaps = []
      for (let i = 1; i < g.rows.length; i++) {
        gaps.push((Date.parse(g.rows[i].date) - Date.parse(g.rows[i - 1].date)) / 86400000)
      }
      const gapMed = median(gaps)
      const cadence = gapMed >= 300 && gapMed <= 430 ? 'annual'
        : gapMed >= 150 && gapMed <= 215 ? 'semiannual' : null
      if (cadence) {
        const last = g.rows[g.rows.length - 1]
        longCadence.push({
          key: g.key, label: g.label, cadence, currency,
          latestAmount: num(last.amount), lastDate: last.date,
          months: [...new Set(g.rows.map(monthOf))],
          occurrences: g.rows.length,
        })
        continue // una cadencia larga no es también una suscripción mensual
      }
    }

    // --- recurrencia mensual ----------------------------------------------
    const byMonth = new Map()
    for (const r of g.rows) {
      const mk = monthOf(r)
      byMonth.set(mk, (byMonth.get(mk) || 0) + 1)
    }
    const monthKeys = [...byMonth.keys()].sort()
    if (monthKeys.length < MIN_MONTHS) continue
    if (!hasConsecutiveMonths(monthKeys, MIN_MONTHS)) continue
    const counts = [...byMonth.values()]
    if (median(counts) !== 1 || counts.some((c) => c > 2)) continue
    if (!bandOk) continue

    const lastMonth = monthKeys[monthKeys.length - 1]
    // Fuera de la nómina activa: si el último cobro es de hace 2+ meses, ya no
    // describe la nómina de HOY. (Su ventana de "no cobró este mes" ya pasó.)
    if (nowMonth && addMonths(lastMonth, 2) <= nowMonth) continue

    const last = g.rows[g.rows.length - 1]
    const expectedDay = median(g.rows.map(dayOf))

    // Alza de precio: caminar los montos en orden; el "típico" arranca en el
    // primero y cada salto sostenido lo reemplaza. Se reporta solo el último
    // salto, y solo si es reciente (los últimos 3 meses): un alza de hace un
    // año ya no es noticia.
    let typical = amounts[0]
    let rise = null
    for (let i = 1; i < g.rows.length; i++) {
      const a = num(g.rows[i].amount)
      if (a > typical * PRICE_RISE_MIN_RATIO && a <= typical * SAME_CHARGE_MAX_RATIO) {
        rise = { from: typical, to: a, month: monthOf(g.rows[i]) }
        typical = a
      } else if (a >= typical * SAME_CHARGE_MIN_RATIO && a < typical) {
        typical = a // una baja también actualiza el típico, sin reportarse
      }
    }
    if (rise && nowMonth && addMonths(rise.month, 3) < nowMonth) rise = null

    // "No cobró este mes": solo con el día esperado ya pasado con gracia, y
    // solo si el último cobro fue exactamente el mes anterior (si es más
    // viejo, el grupo entero ya salió de la nómina arriba).
    let missing = false
    if (nowMonth && nowDay != null && lastMonth < nowMonth) {
      missing = addMonths(lastMonth, 1) === nowMonth && nowDay > expectedDay + MISSING_GRACE_DAYS
    }

    monthly.push({
      key: g.key, label: g.label, currency,
      latestAmount: num(last.amount),
      monthlyGtq: toGtq(num(last.amount), currency, convert),
      monthsActive: monthKeys.length,
      firstMonth: monthKeys[0], lastMonth,
      expectedDay, rise, missing,
      category: last.category || null,
    })
  }

  monthly.sort((a, b) => b.monthlyGtq - a.monthlyGtq)
  const totalMonthlyGtq = monthly.reduce((s, m) => s + m.monthlyGtq, 0)
  return { monthly, totalMonthlyGtq, longCadence }
}

// Los pagos de cadencia larga que CAYERON en un mes dado, para decir "de tus
// Q49,000 de julio, Q39,782 son pagos anuales" (feature 4). Suma las filas
// REALES del mes cuyos comercios están en la lista de cadencia larga: el
// total del mes no se toca, esto es una lectura derivada.
export function longCadencePaymentsInMonth(transactions, monthKey, longCadence, { convert = null } = {}) {
  if (!monthKey || !longCadence?.length) return { totalGtq: 0, rows: [] }
  const keys = new Map(longCadence.map((c) => [c.key, c]))
  const rows = []
  let totalGtq = 0
  for (const tx of transactions || []) {
    if (!isCandidateRow(tx)) continue
    if (monthOf(tx) !== monthKey) continue
    const key = merchantRuleKey(tx.merchant || tx.description || '')
    const hit = key && keys.get(key)
    if (!hit) continue
    const gtq = toGtq(num(tx.amount), tx.currency, convert)
    totalGtq += gtq
    rows.push({ id: tx.id || null, key, label: hit.label, cadence: hit.cadence, amountGtq: gtq, date: tx.date })
  }
  return { totalGtq, rows }
}

// Los pagos anuales/semestrales que cayeron en un mes: la unión de la marca
// MANUAL del usuario (`_annualCadence`, puesta desde el editor de categoría)
// y la cadencia larga DETECTADA. La marca manual existe porque con pocos
// meses de historial importado una prima anual aparece UNA sola vez y ninguna
// detección de cadencia puede verla: el caso real (FASE JW) es exactamente
// ese, la prima y la matrícula que fueron el 79% de julio con tres meses de
// estados en el archivo.
//
// ⛔ El total del mes NO se toca ni se prorratea aquí: esto es una lectura
// DERIVADA que va siempre JUNTO al total real, nunca en su lugar (la regla de
// "las partes suman el todo" de este módulo de Flujo). Deduplicada por id:
// una fila marcada Y detectada cuenta una vez.
export function annualPaymentsOfMonth(transactions, monthKey, { convert = null, longCadence = [] } = {}) {
  if (!monthKey) return { totalGtq: 0, rows: [] }
  const rows = []
  const seen = new Set()
  for (const tx of transactions || []) {
    if (!tx || tx.type !== 'EXPENSE' || num(tx.amount) <= 0) continue
    if (tx._annualCadence !== true) continue
    if (monthOf(tx) !== monthKey) continue
    const gtq = toGtq(num(tx.amount), tx.currency, convert)
    rows.push({ id: tx.id || null, label: String(tx.merchant || tx.description || '').trim(), cadence: 'manual', amountGtq: gtq, date: tx.date })
    if (tx.id) seen.add(tx.id)
  }
  for (const r of longCadencePaymentsInMonth(transactions, monthKey, longCadence, { convert }).rows) {
    if (r.id && seen.has(r.id)) continue
    rows.push(r)
  }
  const totalGtq = rows.reduce((s, r) => s + r.amountGtq, 0)
  return { totalGtq, rows }
}
