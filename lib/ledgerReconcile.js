// FASE SK. "Conciliar con mi cuenta": deja UNA cuenta de broker de Chispu
// igual a lo que dice el archivo del broker (PortfolioAnalyst de IBKR), sin
// conectar ni pedir la sincronización (que está pausada) y sin duplicar nada.
//
// Planificador PURO: recibe lo que hay y lo que trae el archivo y devuelve el
// plan de escritura para bulkImport + el bloque de settings. No escribe.
//
// Qué hace, con la decisión del usuario (17 nov 2026) detrás de cada punto:
//   - Posiciones del archivo que ya existen en la cuenta (mismo símbolo): se
//     actualizan cantidad y costo promedio. El precio actual no se toca.
//   - Posiciones del archivo que no existen: se crean en la institución que el
//     usuario ya usa ("IBKR" o "Interactive Brokers": misma cuenta, ver
//     accountKeyOfItem), nunca una segunda institución.
//   - Posiciones de la cuenta que el archivo ya no trae (cerradas en el
//     broker): se BORRAN ("que se borren", pedido explícito), salvo las que el
//     usuario desmarque. Por defecto solo se proponen las que el broker dice
//     que la cuenta tuvo (historicalSymbols): una posición cargada ahí por
//     error (era de otra cuenta) queda sin tocar hasta que el usuario decida.
//   - Lotes abiertos de la cuenta: se CIERRAN (no se borran) y se abre uno
//     por posición con el costo del broker. Así la auditoría de lotes cuadra.
//   - Depósitos y retiros del archivo: se escriben como el LEDGER de la cuenta
//     (`_source: 'account_ledger'`). Ids deterministas: subir el archivo otra
//     vez no duplica.
//   - Los DEPOSIT/WITHDRAWAL manuales de la cuenta (el "dinero nuevo" que
//     escribía cada compra, el retiro de cada venta "fuera de la app") se
//     marcan `_ledgerSuperseded`. No se borran: dejan de contar.
//   - Dividendos y comisiones del archivo NO se importan (los dividendos
//     automáticos de Chispu siguen como hoy).
//   - Los cierres de mes (NAV) y los retornos mensuales del broker van a
//     settings.ledgerAccounts[clave], no a snapshots: la vista "Todas" y la
//     Hoja no cambian por esto.

import { accountKeyOfItem } from '@/components/dashboard/utils'
import { transactionDocId } from './transactionDocId'
import { LEDGER_SOURCE } from './ledgerFlows'

const up = (s) => String(s || '').trim().toUpperCase()
const isCashRow = (it) => /bank|cash/i.test(it?.type || '') && !/stock|etf|bond|fund/i.test(it?.type || '')
const CASH_SYMBOLS = new Set(['USD', 'CASH', 'CASH-USD'])
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d

// Instituciones (por clave de cuenta) presentes entre los ítems, con su
// nombre visible más usado. Para el selector del modal.
export function ledgerInstitutionOptions(items) {
  const map = new Map()
  for (const it of items || []) {
    const key = accountKeyOfItem(it)
    if (!key) continue
    const name = (it.institution || '').trim() || key
    if (!map.has(key)) map.set(key, { key, names: new Map(), count: 0 })
    const e = map.get(key)
    e.count++
    e.names.set(name, (e.names.get(name) || 0) + 1)
  }
  return [...map.values()]
    .map((e) => ({ key: e.key, name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count }))
    .sort((a, b) => b.count - a.count)
}

// La institución que este archivo de IBKR concilia por defecto.
export function defaultLedgerInstitution(options) {
  return (options || []).find((o) => o.key === 'ibkr') || null
}

export function planLedgerReconcile({
  parsed,
  accountKey,
  items = [],
  lots = [],
  transactions = [],
  keepIds = null,
  existingLedgerAccount = null,
  tag = {},
  now = new Date().toISOString(),
  newId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
} = {}) {
  if (!parsed || !accountKey) throw new Error('planLedgerReconcile: falta el archivo o la cuenta')
  const key = String(accountKey)
  const accountItems = items.filter((it) => it && it.id && accountKeyOfItem(it) === key)
  const displayName = (() => {
    const counts = new Map()
    for (const it of accountItems) {
      const n = (it.institution || '').trim()
      if (n) counts.set(n, (counts.get(n) || 0) + 1)
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    return best ? best[0] : (key === 'ibkr' ? 'Interactive Brokers' : key)
  })()
  const historical = new Set((parsed.historicalSymbols || []).map(up))
  const incoming = (parsed.items || []).filter((it) => it && Number(it.quantity) > 0)

  // ── Posiciones ──────────────────────────────────────────────────────────
  const used = new Set()
  const updates = []
  const creates = []
  const positions = [] // { itemId, symbol, quantity, cost, currency, acquisitionDate, cash }
  for (const inc of incoming) {
    const cash = isCashRow(inc)
    const sym = up(inc.symbol)
    const match = accountItems.find((it) => !used.has(it.id) && (cash
      ? (isCashRow(it) || CASH_SYMBOLS.has(up(it.symbol))) && up(it.currency || 'USD') === up(inc.currency || 'USD')
      : up(it.symbol) === sym))
    const qty = Number(inc.quantity)
    const cost = cash ? 1 : Number(inc.purchasePrice) || 0
    if (match) {
      used.add(match.id)
      updates.push({
        id: match.id,
        symbol: match.symbol,
        before: { quantity: Number(match.quantity) || 0, purchasePrice: Number(match.purchasePrice) || 0 },
        fields: {
          quantity: qty,
          purchasePrice: cost,
          ...(cash ? { currentPrice: 1 } : {}),
          _ledgerAccount: key,
        },
      })
      positions.push({ itemId: match.id, symbol: up(match.symbol), quantity: qty, cost, currency: inc.currency || match.currency || 'USD', acquisitionDate: match.acquisitionDate || inc.acquisitionDate, cash })
    } else {
      const id = newId()
      const { _source: _drop, _ibkrAccountId: _acct, ...rest } = inc
      const item = {
        ...rest,
        ...tag,
        id,
        symbol: cash ? `CASH-${up(inc.currency || 'USD')}` : inc.symbol,
        name: cash ? `Efectivo ${up(inc.currency || 'USD')}` : inc.name,
        purchasePrice: cost,
        institution: displayName,
        _origin: 'ledger_reconcile',
        _ledgerAccount: key,
      }
      creates.push(item)
      positions.push({ itemId: id, symbol: up(item.symbol), quantity: qty, cost, currency: inc.currency || 'USD', acquisitionDate: inc.acquisitionDate, cash })
    }
  }

  // Lo que la cuenta tiene y el archivo ya no.
  const leftovers = accountItems.filter((it) => !used.has(it.id))
  const deleteCandidates = leftovers.map((it) => ({
    id: it.id,
    symbol: it.symbol,
    name: it.name,
    quantity: Number(it.quantity) || 0,
    // El broker dice que la cuenta lo tuvo (y ya no): cerrada de verdad.
    closedAtBroker: historical.has(up(it.symbol)),
  }))
  const keep = keepIds instanceof Set
    ? keepIds
    : new Set(deleteCandidates.filter((c) => !c.closedAtBroker).map((c) => c.id))
  const deleteIds = deleteCandidates.filter((c) => !keep.has(c.id)).map((c) => c.id)
  const keptIds = deleteCandidates.filter((c) => keep.has(c.id)).map((c) => c.id)

  // ── Lotes ───────────────────────────────────────────────────────────────
  const accountIds = new Set(accountItems.map((it) => it.id))
  const keptSet = new Set(keptIds)
  const periodEnd = parsed.periodEnd || now.slice(0, 10)
  const lotsToClose = lots.filter((l) => l && l.id && l.status !== 'closed'
    && ((l.itemId && accountIds.has(l.itemId) && !keptSet.has(l.itemId))
      || (!l.itemId && accountKeyOfItem({ institution: l.institution }) === key
        && !leftovers.some((it) => keptSet.has(it.id) && up(it.symbol) === up(l.symbol)))))
  const updateLots = lotsToClose.map((l) => ({
    id: l.id,
    // FASE SL2. Cerrado POR la conciliación, no vendido: el lote nuevo de
    // la misma posición lo reemplaza desde su fecha de compra. La marca deja
    // que un lector de lotes lo distinga de una venta real (que trae
    // closedPrice/realizedGain) y no cuente esas acciones dos veces.
    fields: { status: 'closed', closedDate: periodEnd, _ledgerSuperseded: true },
  }))
  const newLots = positions.filter((p) => !p.cash && p.quantity > 0 && p.cost > 0).map((p) => ({
    ...tag,
    symbol: p.symbol,
    quantity: p.quantity,
    costBasis: p.cost,
    currency: p.currency,
    acquisitionDate: p.acquisitionDate || periodEnd,
    institution: displayName,
    itemId: p.itemId,
    _source: 'ledger_reconcile',
  }))

  // ── Ledger de depósitos y retiros ──────────────────────────────────────
  const ledgerFlows = (parsed.transactions || [])
    .filter((tx) => /^(DEPOSIT|WITHDRAWAL)$/i.test(tx?.type || '') && tx.date)
    .map((tx) => {
      const amt = round(Math.abs(Number(tx.totalAmount ?? tx.amount ?? 0)), 2)
      return {
        ...tag,
        type: up(tx.type),
        symbol: 'CASH',
        date: String(tx.date).slice(0, 10),
        quantity: 1,
        pricePerUnit: amt,
        totalAmount: amt,
        currency: tx.currency || 'USD',
        description: tx.type === 'WITHDRAWAL' || up(tx.type) === 'WITHDRAWAL' ? 'Retiro (ledger del broker)' : 'Depósito (ledger del broker)',
        _source: LEDGER_SOURCE,
        _ledgerAccount: key,
      }
    })
    .filter((tx) => tx.totalAmount > 0)
  const ledgerIds = new Set(ledgerFlows.map((tx) => transactionDocId(tx)))

  // ── Depósitos/retiros manuales que el ledger reemplaza ─────────────────
  const allIds = new Set(items.map((it) => it && it.id).filter(Boolean))
  const otherSymbols = new Set(items.filter((it) => it && accountKeyOfItem(it) !== key).map((it) => up(it.symbol)))
  const accountSymbols = new Set([
    ...accountItems.filter((it) => !keptSet.has(it.id)).map((it) => up(it.symbol)),
    ...positions.map((p) => p.symbol),
    // Lo que el broker dice que la cuenta tuvo: el depósito de una posición
    // ya cerrada y borrada de Chispu (vínculo muerto) también era de aquí.
    ...historical,
  ])
  const superseded = transactions.filter((tx) => {
    if (!tx || !tx.id || tx._ledgerSuperseded) return false
    if (!/^(DEPOSIT|WITHDRAWAL)$/i.test(tx.type || '')) return false
    if (tx._source === LEDGER_SOURCE || ledgerIds.has(tx.id)) return false
    if (tx._linkedItemId && allIds.has(tx._linkedItemId)) {
      return accountIds.has(tx._linkedItemId) && !keptSet.has(tx._linkedItemId)
    }
    // Vínculo muerto (el activo ya se borró) o sin vínculo: por símbolo, solo
    // si ese símbolo es de esta cuenta y de ninguna otra.
    const sym = up(tx.symbol)
    return !!sym && sym !== 'CASH' && accountSymbols.has(sym) && !otherSymbols.has(sym)
  })
  const updateTransactions = superseded.map((tx) => ({
    id: tx.id,
    fields: { _ledgerSuperseded: true, _ledgerAccount: key },
  }))

  // ── NAV mensual + retornos del broker → settings ───────────────────────
  const incomingNav = (parsed.equityHistory || [])
    .filter((e) => e && e.date && !e._type && Number(e.netWorthUSD) > 0)
    .map((e) => ({
      d: e.date,
      v: round(Number(e.netWorthUSD), 2),
      ...(Number.isFinite(e._brokerDailyReturn)
        ? { r: round(e._brokerDailyReturn, 6), f: 'd' }
        : Number.isFinite(e._brokerMonthlyReturn) ? { r: round(e._brokerMonthlyReturn, 6) } : {}),
    }))
    .sort((a, b) => a.d.localeCompare(b.d))
  // FASE SM. Un reporte DIARIO suele cubrir solo el último año: los cierres
  // que ya estaban fuera de su rango (los meses viejos) se conservan.
  const nav = mergeLedgerNav(existingLedgerAccount?.nav, incomingNav)
  const ledgerAccount = {
    institution: displayName,
    source: 'IBKR PortfolioAnalyst',
    ...(nav.some((p) => p.f === 'd') ? { navFrequency: 'daily' } : {}),
    periodEnd: parsed.periodEnd || (nav.length ? nav[nav.length - 1].d : null),
    cumulativeReturnPct: parsed.cumulativeReturn ?? null,
    nav,
    reconciledAt: now,
  }

  const netFlows = round(ledgerFlows.reduce((s, tx) => s + (tx.type === 'DEPOSIT' ? tx.totalAmount : -tx.totalAmount), 0), 2)
  const skipped = (parsed.transactions || []).reduce((acc, tx) => {
    const t = up(tx?.type)
    if (t !== 'DEPOSIT' && t !== 'WITHDRAWAL') acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  return {
    accountKey: key,
    institution: displayName,
    bulk: {
      deleteIds,
      items: creates,
      updateItems: updates.map((u) => ({ id: u.id, fields: u.fields })),
      updateLots,
      lots: newLots,
      updateTransactions,
      transactions: ledgerFlows,
    },
    ledgerAccount,
    summary: {
      updates,
      creates: creates.map((c) => ({ id: c.id, symbol: c.symbol, quantity: c.quantity })),
      deleteCandidates,
      deleteIds,
      keptIds,
      lotsClosed: updateLots.length,
      lotsCreated: newLots.length,
      supersededFlows: superseded.length,
      ledgerFlows: ledgerFlows.length,
      netFlows,
      navPoints: nav.length,
      lastNav: nav.length ? nav[nav.length - 1] : null,
      periodEnd: ledgerAccount.periodEnd,
      cumulativeReturnPct: ledgerAccount.cumulativeReturnPct,
      skipped,
    },
  }
}

// FASE SM. Une los cierres guardados con los del archivo nuevo, sin contar
// dos veces ningún retorno.
//
//   - Mismo día: gana el archivo nuevo.
//   - Fuera del rango del archivo nuevo, lo guardado se queda (un reporte
//     diario del último año no borra los meses de 2023).
//   - Un cierre MENSUAL que cae dentro del tramo cubierto por cierres DIARIOS
//     sobra: su retorno es la suma de esos mismos días. Se quita.
//   - Costuras: el primer día de un tramo diario que llega varios días
//     después del cierre anterior, o el primer cierre mensual después de un
//     tramo diario cuyo mes empezó antes, pierden su retorno publicado (que
//     mide otro periodo) y se miden con Dietz entre los dos NAV.
// Puntos: { d, v, r?, f? } con f: 'd' en los diarios.
const SEAM_DAYS = 5
export function mergeLedgerNav(existing, incoming) {
  const clean = (list) => (Array.isArray(list) ? list : [])
    .filter((p) => p && p.d && Number(p.v) > 0)
    .map((p) => ({ ...p, d: String(p.d).slice(0, 10) }))
  const inc = clean(incoming).sort((a, b) => a.d.localeCompare(b.d))
  const old = clean(existing)
  if (inc.length === 0) return old.sort((a, b) => a.d.localeCompare(b.d))
  const lo = inc[0].d
  const hi = inc[inc.length - 1].d
  const incDaily = inc.some((p) => p.f === 'd')
  const byDate = new Map()
  // Un archivo MENSUAL no borra los días ya guardados: se quedan y, más
  // abajo, los cierres mensuales que caen entre ellos sobran.
  for (const p of old) if (p.d < lo || p.d > hi || (p.f === 'd' && !incDaily)) byDate.set(p.d, p)
  for (const p of inc) byDate.set(p.d, p)
  let all = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d))

  const dayMs = 86400000
  const gap = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs
  // Tramos diarios: días seguidos sin un hueco de más de SEAM_DAYS (fines de
  // semana y feriados caben).
  const spans = []
  let cur = null
  for (const p of all) {
    if (p.f !== 'd') continue
    if (cur && gap(cur.to, p.d) <= SEAM_DAYS) cur.to = p.d
    else { cur = { from: p.d, to: p.d }; spans.push(cur) }
  }
  if (spans.length) {
    const inSpan = (d) => spans.some((sp) => d > sp.from && d <= sp.to)
    all = all.filter((p) => p.f === 'd' || !inSpan(p.d))
  }
  return all.map((p, i) => {
    const prev = i > 0 ? all[i - 1] : null
    if (!prev || p.r == null) return p
    if (p.f === 'd' && prev.f !== 'd' && gap(prev.d, p.d) > SEAM_DAYS) {
      const { r: _r, ...rest } = p
      return rest
    }
    if (p.f !== 'd' && prev.f === 'd' && prev.d >= `${p.d.slice(0, 7)}-01`) {
      const { r: _r, ...rest } = p
      return rest
    }
    return p
  })
}
