// Búsqueda global de la paleta de comandos (Ctrl/Cmd-K y la lupa del teléfono).
//
// Antes la paleta solo miraba los ÍTEMS vivos: un símbolo cuya posición quedó
// en 0 unidades, o que ya no existe como ítem pero sí tiene lotes o
// movimientos (SPCX, TSLA en el caso real), devolvía "Sin resultados" aunque
// su historia estuviera entera en el archivo. Desde afuera "no existe" y "no
// lo encuentro" se ven igual, y eso se lee como datos perdidos.
//
// Este módulo es PURO (sin React ni Firestore) y es la única definición de qué
// encuentra la búsqueda: posiciones, símbolos con historia pero sin unidades,
// cuentas (instituciones), movimientos (por símbolo y por descripción) y
// acciones. La paleta solo formatea lo que esto devuelve.

// Sin acentos y sin mayúsculas: "acción" encuentra "Accion" y "tsla" encuentra
// "TSLA". El rango combinante U+0300..U+036F cubre las tildes del español.
export function normalizeSearch(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const symKey = (s) => String(s ?? '').trim().toUpperCase()

// 'CASH' es el símbolo genérico de los flujos de nivel de cuenta de un broker
// (depósitos, retiros): no es una posición y mostrarlo como "0 unidades" sería
// afirmar que existió un activo llamado así.
const NOT_A_POSITION = new Set(['', 'CASH'])

// Ranking: coincidencia exacta > prefijo > contiene. Devuelve null si no hay.
function scoreText(q, ...fields) {
  let best = null
  for (const f of fields) {
    const n = normalizeSearch(f)
    if (!n) continue
    let s = null
    if (n === q) s = 3
    else if (n.startsWith(q)) s = 2
    else if (n.includes(q)) s = 1
    if (s != null && (best == null || s > best)) best = s
  }
  return best
}

const byScore = (a, b) => b.score - a.score

export const DEFAULT_LIMITS = Object.freeze({
  items: 8,
  symbols: 5,
  accounts: 4,
  transactions: 6,
  total: 25,
})

// Cuántos movimientos y lotes tiene cada símbolo (en mayúsculas). Una
// transacción vinculada a un ítem cuenta para el símbolo de ese ítem aunque no
// traiga símbolo propio.
export function symbolActivity({ items = [], lots = [], transactions = [] } = {}) {
  const itemSym = new Map()
  for (const it of items || []) if (it?.id) itemSym.set(it.id, symKey(it.symbol))
  const out = new Map()
  const bump = (sym, field) => {
    if (NOT_A_POSITION.has(sym)) return
    const cur = out.get(sym) || { txCount: 0, lotCount: 0 }
    cur[field] += 1
    out.set(sym, cur)
  }
  for (const tx of transactions || []) {
    const sym = symKey(tx?.symbol) || itemSym.get(tx?._linkedItemId) || ''
    bump(sym, 'txCount')
  }
  for (const l of lots || []) bump(symKey(l?.symbol), 'lotCount')
  return out
}

export function searchGlobal({
  query,
  items = [],
  lots = [],
  transactions = [],
  actions = [],
  limits = {},
} = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits }
  const q = normalizeSearch(query)
  const activity = symbolActivity({ items, lots, transactions })

  if (!q) {
    return actions.slice(0, lim.total).map((a) => ({ type: 'action', id: a.id, action: a }))
  }

  // 1) Posiciones vivas (incluidas las de 0 unidades).
  const itemHits = []
  const itemSymbols = new Set()
  for (const it of items || []) {
    if (!it) continue
    const s = symKey(it.symbol)
    if (s) itemSymbols.add(s)
    const score = scoreText(q, it.symbol, it.name, it.institution)
    if (score == null) continue
    const qty = Number(it.quantity) || 0
    const act = activity.get(s) || { txCount: 0, lotCount: 0 }
    itemHits.push({
      type: 'item', id: `item-${it.id}`, score, item: it,
      zeroUnits: qty <= 0,
      txCount: act.txCount, lotCount: act.lotCount,
    })
  }
  itemHits.sort(byScore)

  // 2) Símbolos con historia (lotes o movimientos) y SIN ítem vivo.
  const symbolHits = []
  const seen = new Set()
  const consider = (raw, name) => {
    const s = symKey(raw)
    if (NOT_A_POSITION.has(s) || itemSymbols.has(s) || seen.has(s)) return
    const score = scoreText(q, s, name)
    if (score == null) return
    seen.add(s)
    const act = activity.get(s) || { txCount: 0, lotCount: 0 }
    symbolHits.push({ type: 'symbol', id: `symbol-${s}`, score, symbol: s, name: name || null, ...act })
  }
  for (const l of lots || []) consider(l?.symbol, l?.name)
  for (const tx of transactions || []) consider(tx?.symbol, null)
  symbolHits.sort(byScore)

  // 3) Cuentas (instituciones), agrupando sus posiciones.
  const accounts = new Map()
  for (const it of items || []) {
    const inst = String(it?.institution || '').trim()
    if (!inst) continue
    const key = normalizeSearch(inst)
    const cur = accounts.get(key) || { name: inst, items: [] }
    cur.items.push(it)
    accounts.set(key, cur)
  }
  const accountHits = []
  for (const [key, acc] of accounts) {
    const score = scoreText(q, acc.name)
    if (score == null) continue
    accountHits.push({ type: 'account', id: `account-${key}`, score, name: acc.name, items: acc.items })
  }
  accountHits.sort(byScore)

  // 4) Movimientos: por símbolo y por descripción, los más recientes primero.
  const itemById = new Map((items || []).filter((i) => i?.id).map((i) => [i.id, i]))
  const txHits = []
  for (const tx of transactions || []) {
    if (!tx) continue
    const linked = itemById.get(tx._linkedItemId)
    const s = symKey(tx.symbol) || symKey(linked?.symbol)
    const score = scoreText(q, NOT_A_POSITION.has(s) ? '' : s, tx.description)
    if (score == null) continue
    txHits.push({ type: 'transaction', id: `tx-${tx.id ?? txHits.length}`, score, tx, symbol: NOT_A_POSITION.has(s) ? null : s, item: linked || null })
  }
  txHits.sort((a, b) => b.score - a.score || String(b.tx.date || '').localeCompare(String(a.tx.date || '')))

  // 5) Acciones.
  const actionHits = []
  for (const a of actions || []) {
    const score = scoreText(q, a.label, ...(a.keywords || []))
    if (score == null) continue
    actionHits.push({ type: 'action', id: a.id, score, action: a })
  }
  actionHits.sort(byScore)

  const out = [
    ...itemHits.slice(0, lim.items),
    ...symbolHits.slice(0, lim.symbols),
    ...accountHits.slice(0, lim.accounts),
    ...txHits.slice(0, lim.transactions),
    ...actionHits,
  ]
  return out.slice(0, lim.total)
}

// La nota que acompaña a un símbolo sin unidades. "0 unidades · 3 movimientos".
export function zeroUnitsNote({ txCount = 0, lotCount = 0 } = {}, lang = 'es') {
  const es = lang === 'es'
  const parts = [es ? '0 unidades' : '0 units']
  if (txCount > 0) parts.push(es ? `${txCount} ${txCount === 1 ? 'movimiento' : 'movimientos'}` : `${txCount} ${txCount === 1 ? 'movement' : 'movements'}`)
  if (lotCount > 0) parts.push(es ? `${lotCount} ${lotCount === 1 ? 'lote' : 'lotes'}` : `${lotCount} ${lotCount === 1 ? 'lot' : 'lots'}`)
  return parts.join(' · ')
}
