// Borrado selectivo del historial de Flujo: por mes y por método de captura.
//
// Por qué es un módulo puro y no una query: las filas de Flujo ya están
// COMPLETAS en memoria (useFirestoreItems carga la colección entera ordenada
// por fecha), así que filtrar acá no cuesta una sola lectura de Firestore.
// Importa: esta app ya tocó el techo de cuota diario en producción (FASE IE9).
//
// La regla que sostiene todo el módulo: la MISMA función decide qué se cuenta
// en la vista previa y qué se borra. Si fueran dos, el número que ves y el
// número que desaparece podrían discrepar, que en una acción irreversible es
// exactamente el error que no se puede cometer.

// El método por el que una fila entró al archivo.
//
// 'manual' es el RESIDUO a propósito, nunca `source === 'manual'` estricto: las
// filas tecleadas antes de que ese campo existiera no lo llevan, y con una
// prueba estricta quedarían fuera de los tres filtros, o sea imborrables salvo
// con "todo". Un residuo no puede dejar nada afuera.
//
// Los dos nombres de campo son históricos: las filas de estado de cuenta llevan
// `source`, las capturas automáticas `_source` (misma distinción que documenta
// isMachineDescribed en lib/recategorize.js).
const STATEMENT_SOURCES = new Set(['card_import', 'bi_import'])
const AUTO_RE = /^auto_(\w+)$/

export function methodOfTx(tx) {
  if (AUTO_RE.test(String(tx?._source || ''))) return 'auto'
  if (STATEMENT_SOURCES.has(String(tx?.source || ''))) return 'statement'
  return 'manual'
}

// De qué transporte vino una captura automática: 'shortcut' | 'email' |
// 'android'. null para todo lo demás.
export function transportOfTx(tx) {
  const m = AUTO_RE.exec(String(tx?._source || ''))
  return m ? m[1] : null
}

export const WIPE_METHODS = ['all', 'auto', 'statement', 'manual']

// El mes de una fila, por RECORTE DE TEXTO. Nunca new Date(): JS lee
// 'YYYY-MM-DD' como medianoche UTC y en Guatemala eso cae en el día anterior,
// así que el primer día de cada mes se archivaría bajo el mes previo (el bug
// exacto que MonthlyBreakdown ya tuvo). Es la convención de lib/financeMonth.js.
export function monthKeyOfTx(tx) {
  const m = /^(\d{4}-\d{2})/.exec(String(tx?.date || ''))
  return m ? m[1] : null
}

function matches(tx, { month, method, transport }) {
  if (month && month !== 'all' && monthKeyOfTx(tx) !== month) return false
  if (method && method !== 'all' && methodOfTx(tx) !== method) return false
  // El transporte solo acota DENTRO de la captura automática; pedirlo con otro
  // método sería una combinación que la UI no puede producir, pero si llegara
  // no debe borrar de más.
  if (transport) {
    if (methodOfTx(tx) !== 'auto') return false
    if (transportOfTx(tx) !== transport) return false
  }
  return true
}

// Los meses que de verdad tienen datos, del más reciente al más viejo, con su
// conteo. El desplegable se arma con esto en vez de con un calendario: ofrecer
// un mes vacío es ofrecer una acción que no hace nada.
export function monthsPresent(transactions) {
  const counts = new Map()
  for (const tx of transactions || []) {
    const mk = monthKeyOfTx(tx)
    if (!mk) continue
    counts.set(mk, (counts.get(mk) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

// Qué transportes de captura automática existen en los datos. La UI abre el
// bucket 'auto' a sus transportes SOLO cuando hay más de uno: con un solo
// teléfono conectado, tres sub-opciones serían ruido para una distinción que
// los datos no pueden hacer (mismo criterio que el `pct: null` de
// lib/walletCoverage.js).
export function transportsPresent(transactions) {
  const counts = new Map()
  for (const tx of transactions || []) {
    const via = transportOfTx(tx)
    if (!via) continue
    counts.set(via, (counts.get(via) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([transport, count]) => ({ transport, count }))
    .sort((a, b) => b.count - a.count)
}

// El plan de borrado. Devuelve los ids exactos que se van a borrar y el
// resumen que la vista previa imprime, calculados en la MISMA pasada.
//
// El total va POR MONEDA, sin convertir: convertir necesitaría tasas y una
// tasa faltante devolvería el monto crudo en silencio, o sea la vista previa
// mentiría sobre cuánto se está por borrar. "Q3,240.50 y $210.00" siempre es
// verdad; "Q4,857.50" puede no serlo.
export function planFinanceWipe(transactions, { month = 'all', method = 'all', transport = null } = {}) {
  const rows = []
  const totals = new Map()
  const byMethod = { auto: 0, statement: 0, manual: 0 }

  for (const tx of transactions || []) {
    if (!tx?.id) continue // sin id no se puede borrar; contarla mentiría
    if (!matches(tx, { month, method, transport })) continue
    rows.push(tx)
    byMethod[methodOfTx(tx)] += 1
    const cur = String(tx.currency || 'GTQ').toUpperCase()
    totals.set(cur, (totals.get(cur) || 0) + (Number(tx.amount) || 0))
  }

  return {
    ids: rows.map((t) => t.id),
    rows,
    count: rows.length,
    byMethod,
    totals: [...totals.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    // Un filtro que abarca TODO se puede resolver con el borrado de colección
    // entera, que es una operación y no N. El caller lo usa para no hacer
    // cientos de deletes cuando uno alcanza.
    isEverything: month === 'all' && method === 'all' && !transport,
  }
}
