// FASE QA (Fase B de 3). Observaciones de la Hoja: el saldo REAL que el usuario
// leyó de su estado de cuenta para un mes ya CERRADO.
//
// Por qué existe. Un mes pasado de la Hoja no es un dato guardado: se DERIVA
// rebobinando desde el saldo de hoy (applyStaticHistory), y por eso no se podía
// corregir. Si el estado de cuenta de septiembre dice 5,015 y la derivación dice
// 5,006, no había dónde decirlo. Una observación es ese dato: "el saldo de este
// ítem al cierre de este mes fue X".
//
// Es una CAPA, no un cambio al motor:
//   - se aplica DESPUÉS de la reconstrucción, sobre su resultado, así que
//     `indexBalanceEvents` / `applyStaticHistory` (superficie congelada F) no
//     cambian una línea y los tres consumidores de la reconstrucción
//     (Hoja, ancla del YTD, gráfica) siguen coincidiendo entre sí;
//   - fija el saldo de CIERRE de ESE mes y de ese ítem, y NADA MÁS: no toca los
//     meses vecinos, no escribe transacciones y no mueve el saldo de hoy;
//   - NO se hornea en el caché mensual (itemSnapshots): vive aparte y se
//     superpone al leer, así que borrar una observación devuelve la derivación
//     tal cual, sin recalcular y sin SNAPSHOT_VERSION.
//
// ⛔ Qué NO es: no es un movimiento. Si el saldo de septiembre fue 5,015 pero el
// de agosto derivado ya no cuadra con él, la diferencia se queda visible; la
// Hoja no inventa un depósito para taparla.
//
// Se guarda como ARRAY en su propio doc, sin merge (lección FASE FT: un mapa
// anidado se fusiona campo a campo y lo borrado sobrevive a la escritura).

export const MAX_OBSERVATION_VALUE = 10_000_000
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function validValue(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_OBSERVATION_VALUE
}

// Lo que sale de Firestore es untrusted para este módulo: una fila mal formada
// se DESCARTA, nunca se corrige adivinando.
export function sanitizeObservations(raw) {
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.observations) ? raw.observations : [])
  const seen = new Set()
  const out = []
  for (const o of list) {
    if (!o || typeof o !== 'object') continue
    const itemId = typeof o.itemId === 'string' ? o.itemId : ''
    const month = typeof o.month === 'string' ? o.month : ''
    const value = Number(o.value)
    if (!itemId || !MONTH_RE.test(month) || !validValue(value)) continue
    const currency = typeof o.currency === 'string' && o.currency ? o.currency.toUpperCase() : null
    const key = `${itemId}|${month}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ itemId, month, value, currency, at: typeof o.at === 'string' ? o.at : null })
  }
  return out
}

// Una por (ítem, mes): corregir dos veces el mismo mes reemplaza, no apila.
export function upsertObservation(list, obs, now = new Date()) {
  const clean = sanitizeObservations([{ ...obs, at: obs?.at || now.toISOString() }])
  if (clean.length === 0) return sanitizeObservations(list)
  const [next] = clean
  const rest = sanitizeObservations(list).filter(o => !(o.itemId === next.itemId && o.month === next.month))
  return [...rest, next]
}

export function removeObservation(list, itemId, month) {
  return sanitizeObservations(list).filter(o => !(o.itemId === itemId && o.month === month))
}

export function findObservation(list, itemId, month) {
  return sanitizeObservations(list).find(o => o.itemId === itemId && o.month === month) || null
}

// Superpone las observaciones al resultado de la reconstrucción.
//
// `historical` es { 'YYYY-MM': { [itemId]: { value, ... } } } con `value` en
// moneda BASE (magnitud positiva incluso para una deuda: el signo se aplica al
// leer). `items` da nombre/categoría/institución cuando la reconstrucción no
// trae celda para ese mes (antes de la compra, o un hueco): una observación SÍ
// puede llenar un hueco, que es justo cuando uno tiene el estado de cuenta en
// la mano y la derivación no pudo.
//
// Devuelve la MISMA referencia si no hay nada que aplicar, así los memos
// aguas abajo no se invalidan de balde.
export function applyObservations(historical, observations, { items = [], convert, baseCurrency, currentMonthKey } = {}) {
  const obs = sanitizeObservations(observations)
  if (obs.length === 0) return historical
  const byId = new Map((items || []).map(it => [it.id, it]))
  let next = null
  for (const o of obs) {
    // El mes en curso se edita con la columna viva de siempre, no con esto.
    if (currentMonthKey && o.month === currentMonthKey) continue
    const item = byId.get(o.itemId)
    // Un ítem de broker no se corrige a mano: su pasado es el NAV real del broker
    // (la Hoja ni ofrece editarlo), y una celda por ítem junto al bucket del
    // broker contaría la cuenta dos veces.
    if (item?._source === 'ibkr') continue
    const existing = historical?.[o.month]?.[o.itemId]
    // Sin ítem vivo ni celda derivada no hay a qué colgarla.
    if (!item && !existing) continue
    const from = o.currency || item?._originalCurrency || item?.currency || baseCurrency
    let inBase = o.value
    if (convert && baseCurrency && from && from !== baseCurrency) {
      const c = convert(o.value, from, baseCurrency)
      // `convert` sin tasa devuelve el monto CRUDO: eso no es una conversión y
      // no se acepta como si lo fuera (dólares vestidos de quetzales).
      inBase = Number.isFinite(c) ? c : o.value
    }
    if (!next) {
      next = { ...historical }
    }
    if (next[o.month] === historical?.[o.month]) next[o.month] = { ...(historical?.[o.month] || {}) }
    next[o.month][o.itemId] = {
      symbol: existing?.symbol || item?.name || item?.symbol || '',
      category: existing?.category || item?._category || '',
      institution: existing?.institution || item?.institution || '',
      ...existing,
      value: inBase,
      estimated: false,
    }
  }
  return next || historical
}

// Para avisar lo que la observación NO arregla: cuánto se aparta la derivación
// del valor observado (en moneda base). La Hoja lo muestra en el tooltip.
export function observationGap(derivedValue, observedValue) {
  if (!Number.isFinite(derivedValue) || !Number.isFinite(observedValue)) return null
  return observedValue - derivedValue
}
