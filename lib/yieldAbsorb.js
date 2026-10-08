// Corregir el mes en curso NO puede mover los meses ya cerrados (FASE PZ).
//
// Reporte del usuario: septiembre 5,015 y octubre 5,032; hoy el saldo real es
// 5,023. Al corregir octubre, septiembre pasó a 5,007 y ya no se podía tocar.
//
// ── POR QUÉ PASABA ──────────────────────────────────────────────────────────
// Un mes pasado de la Hoja no se guarda: se DERIVA rebobinando desde el saldo de
// hoy (`applyStaticHistory`, lib/historicalValues.js):
//
//     valor(mes) = saldoHoy − Σ eventos fechados DESPUÉS del cierre de ese mes
//
// En una cuenta que reinvierte, el rendimiento de octubre es un evento (un
// DIVIDEND `inferred_yield` o `manual_yield`, fechado el día de la foto del
// saldo, 8 de octubre). Septiembre = 5,032 − 17 = 5,015. La corrección "el
// número anterior estaba mal" baja el saldo a 5,023 y deja el evento en 17, así
// que septiembre = 5,023 − 17 = 5,006. El evento ya no describía la realidad y
// el rebobinado lo restaba igual.
//
// ── LA REGLA ────────────────────────────────────────────────────────────────
// El cierre de un mes ya pasó: es un hecho. Lo que se corrige es el mes EN CURSO,
// y lo único que ese mes tiene derecho a mover son SUS eventos de rendimiento.
// Entonces el delta de la corrección se ABSORBE en ellos, el más nuevo primero:
//
//     5,032 → 5,023  (delta −9)   evento 17 → 8   septiembre 5,015 (no se mueve)
//
// Lo que NO se toca, y por qué:
//  · Solo `inferred_yield` y `manual_yield`. Son estimaciones/declaraciones del
//    rendimiento del mes y ningún motor las vuelve a escribir. Un pago
//    `_source:'auto'` lo regeneraría el motor al borrarlo (y reaplicaría el
//    saldo), y los depósitos/retiros son capital: no se "absorben" en nada.
//  · Solo eventos de ESTE ítem, en SU moneda y fechados después del último
//    cierre de mes.
//
// Si el delta es mayor que todo el rendimiento del mes (hay más baja que
// interés que quitar) el sobrante NO cabe en el mes en curso: mueve el pasado,
// y eso se DICE (`spill`) en vez de esconderse. Sin ningún evento candidato no
// se hace nada ni se avisa: un activo sin rendimiento propio es plano en el
// tiempo y corregirlo corrige toda su historia, que es lo esperado.
//
// ⛔ No toca `knownContributions`, `computeLiquidYield`, `indexBalanceEvents` ni
// `applyStaticHistory`: ajusta los DATOS que esas funciones leen. Spec en
// lib/assetLogic/liquidFundYield.js (FASE PZ).

export const ABSORBABLE_SOURCES = ['inferred_yield', 'manual_yield']

const EPS = 0.005

const r2 = (n) => Math.round(n * 100) / 100
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Último día del mes ANTERIOR a `todayISO` ('YYYY-MM-DD'). Por componentes y en
// UTC, igual que getMonthEndDate de historicalValues: nunca `new Date(str)` en
// hora local.
export function lastClosedMonthEndISO(todayISO) {
  const m = String(todayISO || '').match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 0))
  return d.toISOString().slice(0, 10)
}

const txAmount = (tx) => num(tx.totalAmount ?? tx.amount)

export function absorbableYieldEvents({ transactions, item, currency, lastClosedEnd }) {
  if (!item || !item.id || !lastClosedEnd) return []
  const cur = String(currency || item.currency || '').toUpperCase()
  return (transactions || [])
    .filter((tx) => tx
      && String(tx.type || '').toUpperCase() === 'DIVIDEND'
      && tx._linkedItemId === item.id
      && tx._reinvested === true
      && ABSORBABLE_SOURCES.includes(tx._source)
      && typeof tx.date === 'string' && tx.date.slice(0, 10) > lastClosedEnd
      && txAmount(tx) > 0
      // Otra moneda: el delta viene en la del ítem y no se mezcla.
      && (!tx.currency || !cur || String(tx.currency).toUpperCase() === cur))
    // El más nuevo primero: es el que describe el saldo que se está corrigiendo.
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.id).localeCompare(String(a.id))))
}

/**
 * Cómo absorber `delta` (nuevo − viejo, en la moneda del ítem) en el rendimiento
 * del mes en curso.
 *
 * Devuelve `{ updates, deletes, absorbed, spill, hadCandidates }`:
 *   updates  [{ id, totalAmount }]  eventos que quedan con un monto menor/mayor
 *   deletes  [id]                   eventos que llegaron a cero
 *   absorbed lo que SÍ cupo en el rendimiento del mes (con signo)
 *   spill    lo que no cupo (con signo): ese mueve los meses cerrados
 */
export function planYieldAbsorption({ transactions, item, delta, currency, lastClosedEnd }) {
  const d = num(delta)
  const out = { updates: [], deletes: [], absorbed: 0, spill: 0, hadCandidates: false }
  if (Math.abs(d) <= EPS) return out
  const events = absorbableYieldEvents({ transactions, item, currency, lastClosedEnd })
  if (events.length === 0) {
    out.spill = d
    return out
  }
  out.hadCandidates = true

  if (d > 0) {
    // Sube: el rendimiento del mes era más grande. Va al evento más nuevo.
    const top = events[0]
    out.updates.push({ id: top.id, totalAmount: r2(txAmount(top) + d) })
    out.absorbed = d
    return out
  }

  let remaining = -d
  for (const ev of events) {
    if (remaining <= EPS) break
    const amt = txAmount(ev)
    if (amt - remaining > EPS) {
      out.updates.push({ id: ev.id, totalAmount: r2(amt - remaining) })
      remaining = 0
    } else {
      out.deletes.push(ev.id)
      remaining -= amt
    }
  }
  const left = remaining > EPS ? r2(remaining) : 0
  out.absorbed = -(r2(-d - left))
  out.spill = left ? -left : 0
  return out
}

// Las transacciones como quedarían después de aplicar el plan: para que quien
// decida sobre el estado POST-escritura (dismissalFor) vea los mismos montos que
// va a leer el motor, no los viejos.
export function applyAbsorptionToTransactions(transactions, plan) {
  if (!plan) return transactions || []
  const del = new Set(plan.deletes || [])
  const upd = new Map((plan.updates || []).map((u) => [u.id, u.totalAmount]))
  return (transactions || [])
    .filter((tx) => !del.has(tx.id))
    .map((tx) => (upd.has(tx.id) ? { ...tx, totalAmount: upd.get(tx.id) } : tx))
}
