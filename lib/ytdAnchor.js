// FASE RR. Un solo arranque del año, salido del DOCUMENTO archivado del 1 de
// enero, y su reparto por cuenta guardado en ese mismo documento.
//
// Por qué existe: con el mismo patrimonio la app mostraba dos YTD distintos
// (-0.21% arrancando en $343,570.55 y -0.57% arrancando en $344,827.15) según
// la pantalla y el momento. El encabezado podía cambiar el doc archivado por
// la reconstrucción en vivo apenas esta llegaba (FASE QR2), así que el
// arranque saltaba; y el panel del YTD dejaba un "Sin atribuir" de -$1,264.44
// porque repartía por cuenta con OTRO motor (la reconstrucción de hoy) un
// valor que el doc archivado nunca desglosó. La regla nueva:
//
//   1. El arranque ES el doc archivado. Lo que ese doc no podía contener (un
//      activo agregado después con fecha de compra anterior) se SUMA con su
//      valor reconstruido al arranque, en vez de reemplazar el doc entero.
//   2. Los escritores del doc guardan `_accountsUSD` (valor por cuenta). Con
//      eso el panel reparte el ancla con el MISMO dato que la formó, así que
//      las cuentas suman el ancla por construcción.
//
// Puro (sin React ni Firestore). Las funciones que necesitan la llave de
// cuenta la reciben (`keyOf`) para no importar utils.js y abrir un ciclo.

const finite = (v) => typeof v === 'number' && isFinite(v)
const round2 = (v) => Math.round(v * 100) / 100

// Etiqueta honesta del arranque: observado (lo midió la app o el broker ese
// día), transcrito (lo tecleó el usuario) o estimado (reconstrucción).
export const START_KIND = {
  daily: 'observed',
  ibkr: 'observed',
  manual: 'transcribed',
  ibkr_quarterly: 'transcribed',
  backfill: 'estimated',
  reconstruction: 'estimated',
}

export function startKindOf(src) {
  return (src && START_KIND[src]) || 'estimated'
}

function addTo(out, key, value) {
  if (!key || !finite(value)) return
  out[key] = (out[key] || 0) + value
}

function finalize(out) {
  const keys = Object.keys(out)
  if (keys.length === 0) return null
  const res = {}
  for (const k of keys) res[k] = round2(out[k])
  return res
}

/**
 * Reparto por cuenta para un doc que escribe el BACKFILL: la mitad manual sale
 * del desglose por ítem de la reconstrucción (byKey, en USD) y la del broker es
 * su NAV real de ese día (`navUSD`, bajo la llave 'ibkr'). Un byKey por SÍMBOLO
 * solo se usa cuando ese símbolo es de un único ítem: con dos posiciones del
 * mismo símbolo no se sabe a cuál pertenece (la lección de FASE IO).
 */
export function accountsUSDFromBreakdown({ byKey, items = [], keyOf, navUSD = null } = {}) {
  if (!byKey || typeof byKey !== 'object' || typeof keyOf !== 'function') return null
  const symCount = new Map()
  for (const it of items) {
    const s = String(it?.symbol || '').toUpperCase()
    if (s) symCount.set(s, (symCount.get(s) || 0) + 1)
  }
  const out = {}
  for (const it of items) {
    if (!it) continue
    let v = byKey[it.id]
    if (!finite(v)) {
      const s = String(it.symbol || '').toUpperCase()
      if (s && symCount.get(s) === 1) v = byKey[s]
    }
    if (!finite(v)) continue
    addTo(out, keyOf(it), v)
  }
  if (finite(navUSD)) addTo(out, 'ibkr', navUSD)
  return finalize(out)
}

/**
 * Reparto por cuenta para el doc DIARIO, que se escribe sumando los ítems de
 * hoy: `valueUSD(it)` es la MISMA cifra que el escritor ya suma al total.
 */
export function accountsUSDFromItems({ items = [], keyOf, valueUSD } = {}) {
  if (typeof keyOf !== 'function' || typeof valueUSD !== 'function') return null
  const out = {}
  for (const it of items) {
    if (!it || it.isDebt) continue
    addTo(out, keyOf(it), valueUSD(it))
  }
  return finalize(out)
}

/**
 * El reparto guardado en un doc de ancla, solo si sigue siendo coherente con su
 * total (tolerancia: medio centavo por cuenta, mínimo $0.05). Un doc viejo sin
 * el campo, o uno cuyo total se reescribió después sin el reparto, devuelve
 * null: repartir con números que no suman el ancla sería volver a fabricar un
 * "Sin atribuir".
 */
export function anchorAccountsUSD(doc) {
  const acc = doc && doc._accountsUSD
  if (!acc || typeof acc !== 'object') return null
  const entries = Object.entries(acc).filter(([k, v]) => k && finite(v))
  if (entries.length === 0) return null
  const sum = entries.reduce((s, [, v]) => s + v, 0)
  const total = Number(doc.totalActivosUSD)
  if (!finite(total)) return null
  const tol = Math.max(0.05, entries.length * 0.005)
  if (Math.abs(sum - total) > tol) return null
  return Object.fromEntries(entries)
}

/**
 * Valor al arranque de los activos que el ancla no contiene, desde el desglose
 * por ítem de la reconstrucción (ya en moneda base). Si ALGUNO no tiene valor
 * medido devuelve null: sumar una parte haría del arranque una mezcla que no
 * describe nada.
 */
export function lateItemsStart({ lateItems = [], startByKey, keyOf } = {}) {
  if (!lateItems.length) return { total: 0, byAccount: {} }
  if (!startByKey || typeof startByKey !== 'object') return null
  let total = 0
  const byAccount = {}
  for (const it of lateItems) {
    const v = startByKey[it.id]
    if (!finite(v)) return null
    total += v
    if (typeof keyOf === 'function') addTo(byAccount, keyOf(it), v)
  }
  return { total, byAccount }
}

/**
 * FASE RX (superficie congelada C, con OK del usuario). El valor al arranque de
 * un activo agregado DESPUES de archivar el ancla salia de la reconstruccion en
 * vivo, y esa respuesta puede llegar o no en cada carga: el arranque saltaba
 * entre "doc solo" y "doc + tardios" con el mismo patrimonio (audit 12 nov:
 * $344,088.20 contra $345,344.80, o sea exactamente $1,256.60 de un activo).
 * La primera medicion buena se GUARDA (`settings._ytdLateStartUSD`, por fecha
 * del ancla y por id de activo, en USD) y desde ahi manda la guardada: es un
 * valor historico, no tiene por que moverse. Esto lee lo guardado en la moneda
 * base. Un valor no finito se descarta.
 */
export function persistedLateStart(settings, anchorDate, toBase = (v) => v) {
  const byDate = settings && settings._ytdLateStartUSD
  const row = byDate && anchorDate ? byDate[anchorDate] : null
  if (!row || typeof row !== 'object') return {}
  const out = {}
  for (const [id, v] of Object.entries(row)) {
    if (finite(v)) out[id] = toBase(v)
  }
  return out
}

/**
 * Lo que falta guardar: los tardios con valor MEDIDO en la reconstruccion que
 * todavia no estan guardados. Un activo cuyo simbolo cayo a hold-flat (precio
 * historico no disponible) NO se guarda: ese valor es el de HOY, no el del
 * arranque, y guardarlo congelaria un dato falso para siempre.
 */
export function lateStartToPersist({ lateItems = [], startUSDByKey, persisted = {}, unmeasuredSymbols = [] } = {}) {
  if (!lateItems.length || !startUSDByKey || typeof startUSDByKey !== 'object') return null
  const skip = new Set(unmeasuredSymbols.map((s) => String(s).toUpperCase()))
  const out = {}
  for (const it of lateItems) {
    if (!it || !it.id || finite(persisted[it.id])) continue
    if (it.symbol && skip.has(String(it.symbol).toUpperCase())) continue
    const v = startUSDByKey[it.id]
    if (finite(v)) out[it.id] = round2(v)
  }
  return Object.keys(out).length ? out : null
}

/** Un doc 'backfill' viejo sin reparto por cuenta tiene que reescribirse UNA
 * vez si es candidato a ancla del año (±15 días del 1 de enero): es el único
 * doc cuyo reparto lee alguien. */
export function needsAccountsRewrite(existing, next, now = new Date()) {
  if (!existing || !next || !next._accountsUSD) return false
  if (existing._accountsUSD) return false
  const ts = Date.parse(`${existing.date}T00:00:00Z`)
  if (!isFinite(ts)) return false
  const y = now.getUTCFullYear()
  const jan1 = Date.UTC(y, 0, 1)
  return Math.abs(ts - jan1) <= 15 * 86400000
}
