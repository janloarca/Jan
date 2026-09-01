// Self-healing for four shipped IBKR file-parser bugs (FASE BU/BV/BY, fixed
// 2026-07-28), mirroring lib/phantomFlows.js: pure detectors, the app deletes
// what it is CERTAIN it invented and tells the user why. Nobody importing a
// broker statement can be expected to spot a fake row buried in their ledger.
//
// Every predicate here comes from a git-history audit (which commit
// introduced each bug, which commit fixed it, and what the buggy code path
// actually wrote) — see the "why it cannot match real data" note on each
// detector for the proof that a genuine row can't trigger it.
//
// Pure module: no React, no Firestore. Returns candidates; deleting/editing
// is the caller's decision.

// La única dependencia, y es otro módulo puro: la regla del sufijo de cuenta
// tiene que salir de la MISMA definición que la escribe (FASE MO), o el sanador
// de la transición terminaría buscando una forma que ya nadie escribe.
import { accountIdSuffix } from './transactionDocId'

// The file-import path (formatIBKRFileResult) never writes _ibkrAccountId or
// _ibkrTxnId; the API-sync path (lib/ibkrSync.js) always writes at least one
// (possibly '' — that still counts as present). This is the load-bearing
// discriminator for every predicate below: none of these bugs exist in the
// API-sync path.
function isFileImportedIbkrTx(tx) {
  return tx._source === 'ibkr' && !('_ibkrAccountId' in tx) && !('_ibkrTxnId' in tx)
}

// Class 1 — a PortfolioAnalyst "Trade Summary" (lifetime aggregate, one row
// per symbol, no date/commission/cost-basis columns) misread as individual
// Trades rows. A real Trades section always carries a commission (IBKR
// charges a minimum fee on every fill) and a cost basis; a real same-day
// cohort also repeats symbols on partial fills. None of that is reachable
// from a genuine statement, so requiring ALL of it (>=10 rows, zero symbol
// repeats, zero commission across the whole group) cannot false-positive.
// An impossible (non-ISO) currency code is independently sufficient on its
// own — no code path writes one for a real trade.
export function detectFakeAggregateTrades(transactions = []) {
  const list = transactions || []
  const candidates = list.filter((tx) =>
    isFileImportedIbkrTx(tx) && tx.id &&
    /^(BUY|SELL)$/i.test(tx.type || '') &&
    tx.date && tx.createdAt && tx.date === String(tx.createdAt).slice(0, 10) &&
    Number(tx.commission || 0) === 0 &&
    !Number(tx._ibkrCostBasis || 0) &&
    !Number(tx._ibkrRealizedPL || 0)
  )

  const flagged = new Map()

  // Independent sufficient condition: currency isn't a 3-letter ISO code.
  for (const tx of candidates) {
    if (tx.currency && !/^[A-Za-z]{3}$/.test(String(tx.currency).trim())) {
      flagged.set(tx.id, tx)
    }
  }

  // Cohort test: group same-day candidates, require the aggregate's shape.
  const byDate = new Map()
  for (const tx of candidates) {
    if (!byDate.has(tx.date)) byDate.set(tx.date, [])
    byDate.get(tx.date).push(tx)
  }
  for (const group of byDate.values()) {
    if (group.length < 10) continue
    // Safety cap: a real account's symbol universe rarely exceeds a few
    // hundred names — a "cohort" that large is more likely a detector
    // false-positive than a real Trade Summary export. Abort, don't delete.
    if (group.length > 200) continue
    const symbols = new Set(group.map((t) => (t.symbol || '').toUpperCase()))
    if (symbols.size !== group.length) continue
    if (!group.every((t) => Number(t.commission || 0) === 0)) continue
    for (const tx of group) flagged.set(tx.id, tx)
  }

  return [...flagged.values()].map((tx) => ({
    id: tx.id, symbol: tx.symbol, date: tx.date, amount: tx.totalAmount,
    reason: 'fake-aggregate-trade',
  }))
}

// Class 1b — side effect of class 1: applyAcquisitionDates takes the fake
// aggregate's lifetime quantity as "the earliest buy," stamping every
// affected position's acquisitionDate to the import date. Only clear the
// date (never delete the item), and only for symbols already confirmed as
// class 1 — a legitimate same-day acquisition is indistinguishable from this
// on its own.
export function detectImportStampedAcquisitions(items = [], fakeTradeSymbols) {
  const symbols = fakeTradeSymbols instanceof Set ? fakeTradeSymbols : new Set(fakeTradeSymbols || [])
  if (symbols.size === 0) return []
  return (items || [])
    .filter((item) =>
      item.id &&
      item._source === 'ibkr' && item._origin === 'file' &&
      item.acquisitionDate && item.createdAt &&
      item.acquisitionDate === String(item.createdAt).slice(0, 10) &&
      symbols.has((item.symbol || '').toUpperCase())
    )
    .map((item) => ({ id: item.id, symbol: item.symbol, reason: 'import-stamped-acquisition-date' }))
}

// Class 3 — the Cash Report's label column ("Currency Summary") was matched
// as the currency column, turning every cash-report line item into its own
// fake holding (CASH-Deposits, CASH-Trades (Purchase), ...). Every legitimate
// CASH-* producer (file parser post-fix, XML cash-report parser, demo data,
// crypto venues) emits a 3-letter ISO code; scoping to IBKR file items keeps
// crypto exchanges' CASH-USDT etc. untouched.
export function detectFakeCashReportItems(items = []) {
  const matches = (items || []).filter((item) =>
    item.id &&
    item._source === 'ibkr' &&
    item.institution === 'Interactive Brokers' &&
    /^CASH-/i.test(item.symbol || '') &&
    !/^CASH-[A-Za-z]{3}$/.test(item.symbol || '')
  )
  // Safety cap: only a couple dozen Cash Report line suffixes exist. A much
  // larger match count means the predicate is catching something else —
  // abort rather than delete.
  if (matches.length > 30) return []
  return matches.map((item) => ({ id: item.id, symbol: item.symbol, value: item.currentPrice, reason: 'fake-cash-report-item' }))
}

// Class 4 — both file-import parsers (Activity Statement and PortfolioAnalyst)
// claim the Dividends section and their output gets concatenated; the
// Activity-layout copy has no Description column, so its symbol falls
// through to the literal 'CASH' and its description to the literal uppercase
// 'DIVIDEND'. The API-sync path never writes that exact uppercase literal
// (title-case 'Dividend' instead) and always carries _ibkrTxnId, so it's
// excluded by isFileImportedIbkrTx. Requiring a real same-date, same-cent-
// amount partner under a DIFFERENT symbol proves the row is redundant before
// it's touched — a real CASH dividend with no partner is never flagged.
export function detectDuplicateCashDividends(transactions = []) {
  const list = transactions || []
  const flagged = list.filter((tx) =>
    isFileImportedIbkrTx(tx) && tx.id &&
    (tx.type || '').toUpperCase() === 'DIVIDEND' &&
    (tx.symbol || '').toUpperCase() === 'CASH' &&
    tx.description === 'DIVIDEND' &&
    list.some((o) =>
      o.id !== tx.id &&
      (o.type || '').toUpperCase() === 'DIVIDEND' &&
      (o.symbol || '').toUpperCase() !== 'CASH' &&
      o.date === tx.date &&
      Math.round(Math.abs(o.totalAmount || 0) * 100) === Math.round(Math.abs(tx.totalAmount || 0) * 100)
    )
  )
  // Safety cap: mirrors the other detectors' circuit breaker.
  if (flagged.length > 1000) return []
  return flagged.map((tx) => ({ id: tx.id, date: tx.date, amount: tx.totalAmount, reason: 'duplicate-cash-dividend' }))
}

// Class 5 — the SAME real deposit/withdrawal, imported once as a file (doc id
// has no txn-id suffix: `${date}-CASH-${type}-${cents}`) and once via the
// live API sync (doc id gets a `-${_ibkrTxnId}` suffix appended whenever the
// field is present — see useFirestoreItems.js addTransaction/bulkImport).
// Same date + type + amount but a different id collide on every FIELD except
// the id, so they land as two separate docs instead of one and the flow
// counts twice against the return. This is the exact "trampa del dedup
// cruzado" pattern: match by date + amount-in-cents, never by description
// (the file and the API word a deposit differently for the same event).
// The API-synced copy carries a broker-verified transaction id — keep it,
// drop the file-imported twin.
export function detectCrossSourceDuplicateFlows(transactions = []) {
  const list = transactions || []
  const isFlow = (tx) => /^(DEPOSIT|WITHDRAWAL)$/i.test(tx.type || '')
  const cents = (tx) => Math.round(Math.abs(Number(tx.totalAmount ?? tx.amount) || 0) * 100)
  const fileImported = list.filter((tx) => isFileImportedIbkrTx(tx) && tx.id && isFlow(tx))
  const apiSynced = list.filter((tx) =>
    tx._source === 'ibkr' && tx.id && isFlow(tx) &&
    (('_ibkrAccountId' in tx) || ('_ibkrTxnId' in tx))
  )
  const flagged = fileImported.filter((f) => apiSynced.some((a) =>
    a.date === f.date &&
    (a.type || '').toUpperCase() === (f.type || '').toUpperCase() &&
    cents(a) === cents(f)
  ))
  // Safety cap: mirrors the other detectors' circuit breaker.
  if (flagged.length > 1000) return []
  return flagged.map((tx) => ({ id: tx.id, date: tx.date, amount: tx.totalAmount, reason: 'cross-source-duplicate-flow' }))
}

// Class 5b — el MISMO trade escrito dos veces, una por cada camino de import.
//
// El id del documento sale de fecha+símbolo+tipo+centavos y, cuando hay
// `_ibkrTxnId`, lo agrega. El adaptador del ARCHIVO XML lo estampaba y la ruta
// de API no (arreglado en FASE KG), así que los dos caminos escribían ids
// distintos para el mismo hecho. Y el viaje pide hacer los dos: paso 1
// sincroniza por API, paso 2 sube el mismo XML. Con los trades duplicados, el
// rebobinado de posiciones ve el doble de acciones compradas.
//
// La firma es una ASIMETRÍA, y por eso no puede confundirse con dos operaciones
// reales idénticas: dentro de un mismo camino, dos filas iguales o bien traen
// las dos su `tradeID` (archivo, ids distintos, dos docs legítimos) o bien
// ninguna lo trae (API, mismo id, un solo doc). Que exista una fila CON id y
// otra SIN él, con la misma fecha, símbolo, tipo y monto, solo ocurre cuando
// las escribieron caminos distintos.
//
// Se borra la que NO tiene el id: es el registro más pobre, y la que sobrevive
// conserva la referencia del broker. Nunca se queda sin superviviente, porque
// la candidata solo se marca cuando existe su pareja con id.
export function detectCrossSourceDuplicateTrades(transactions = []) {
  const list = transactions || []
  const isTrade = (tx) => /^(BUY|SELL)$/i.test(tx.type || '')
  const cents = (tx) => Math.round(Math.abs(Number(tx.totalAmount ?? tx.amount) || 0) * 100)
  const key = (tx) => `${tx.date}|${(tx.symbol || '').toUpperCase()}|${(tx.type || '').toUpperCase()}|${cents(tx)}`

  const withId = new Set()
  for (const tx of list) {
    if (!tx || tx._source !== 'ibkr' || !isTrade(tx)) continue
    if (tx._ibkrTxnId) withId.add(key(tx))
  }
  if (withId.size === 0) return []

  const flagged = list.filter((tx) =>
    tx && tx.id && tx._source === 'ibkr' && isTrade(tx) && !tx._ibkrTxnId && withId.has(key(tx))
  )
  // Safety cap: mirrors the other detectors' circuit breaker.
  if (flagged.length > 1000) return []
  return flagged.map((tx) => ({
    id: tx.id, date: tx.date, symbol: tx.symbol, amount: tx.totalAmount,
    reason: 'cross-source-duplicate-trade',
  }))
}

// Class 5c — la MISMA fila escrita bajo dos ids porque la llave cambió.
//
// FASE MO metió la CUENTA en el id de una transacción de IBKR sin
// `_ibkrTxnId`, porque sin ella dos depósitos del mismo monto el mismo día en
// cuentas distintas colapsaban en un solo documento y uno se perdía. El costo
// de ese arreglo es la transición: el primer sync posterior escribe la fila
// bajo `base-CUENTA` y el doc viejo, bajo `base`, se queda al lado. Un DEPOSIT
// duplicado se lee como capital que entró dos veces y envenena el retorno.
//
// La firma es INEQUÍVOCA y no una heurística: dos docs de IBKR con la MISMA
// fecha, símbolo, tipo, monto y cuenta, ninguno con `_ibkrTxnId`, y uno de los
// dos ids es exactamente el otro más `-CUENTA`. Dos cobros reales distintos no
// pueden producir esa pareja, porque el id viejo es único por definición: si
// hubiera habido dos, ya habrían colapsado en uno (que es el bug original).
//
// Se borra el VIEJO (el que no lleva la cuenta): el que sobrevive es el que la
// app va a seguir escribiendo, así que la siguiente pasada no reabre nada.
export function detectAccountQualifiedIdDuplicates(transactions = []) {
  const list = transactions || []
  const cents = (tx) => Math.round(Math.abs(Number(tx.totalAmount ?? tx.amount) || 0) * 100)
  const key = (tx) => [
    tx.date, (tx.symbol || '').toUpperCase(), (tx.type || '').toUpperCase(),
    cents(tx), String(tx._ibkrAccountId || ''),
  ].join('|')

  const eligible = list.filter((tx) =>
    tx && tx.id && tx._source === 'ibkr' && !tx._ibkrTxnId && tx._ibkrAccountId)
  if (eligible.length === 0) return []

  // El sufijo sale de la MISMA definición que lo escribe
  // (`lib/transactionDocId.js`): con una copia acá, un cambio futuro en la
  // llave dejaría a este sanador buscando una forma que ya nadie escribe.
  const qualified = new Map()
  for (const tx of eligible) {
    // Los ids que YA llevan la cuenta: solo con uno de esos enfrente se puede
    // afirmar que el otro es su versión vieja.
    if (String(tx.id).endsWith(accountIdSuffix(tx._ibkrAccountId))) qualified.set(key(tx), tx)
  }
  if (qualified.size === 0) return []

  const flagged = eligible.filter((tx) => {
    const twin = qualified.get(key(tx))
    if (!twin || twin.id === tx.id) return false
    // El viejo es EXACTAMENTE el nuevo sin el sufijo de cuenta: sin esa
    // igualdad literal no se borra nada, para no tocar una fila que sea otra
    // cosa y solo se le parezca.
    return `${tx.id}${accountIdSuffix(tx._ibkrAccountId)}` === twin.id
  })
  if (flagged.length > 1000) return []
  return flagged.map((tx) => ({
    id: tx.id, date: tx.date, symbol: tx.symbol, amount: tx.totalAmount,
    reason: 'account-qualified-id-duplicate',
  }))
}

// Class 5d — el mismo movimiento del broker archivado bajo VARIAS fechas.
//
// FASE MH: `formatDate` devolvía `undefined` con el separador de coma, así que
// el adaptador fechaba el trade con `|| today`. Como el id del documento sale
// de la fecha, CADA sync creaba un doc nuevo: un usuario con ese formato venía
// acumulando una copia por día de cada operación, todas mal fechadas.
//
// La firma es un imposible en datos reales, no una heurística: **un
// `_ibkrTxnId` es el id de UN evento del broker**, así que el mismo id bajo dos
// FECHAS distintas solo puede venir de que nosotros lo fechamos mal. (Repetido
// en la MISMA fecha no cuenta: eso es la misma fila y el id del doc ya la
// deduplica.)
//
// Sobrevive la fecha MÁS VIEJA: las copias equivocadas se fecharon con el día
// del sync, o sea son todas posteriores a la real. Con el arreglo de FASE MH
// desplegado, la fila con la fecha correcta ya está entre ellas.
export function detectSameTxnIdAcrossDates(transactions = []) {
  const list = transactions || []
  const byTxn = new Map()
  for (const tx of list) {
    if (!tx || !tx.id || tx._source !== 'ibkr' || !tx._ibkrTxnId || !tx.date) continue
    const k = String(tx._ibkrTxnId)
    if (!byTxn.has(k)) byTxn.set(k, [])
    byTxn.get(k).push(tx)
  }

  const flagged = []
  for (const rows of byTxn.values()) {
    const dates = new Set(rows.map((r) => r.date))
    if (dates.size < 2) continue
    const keep = rows.reduce((a, b) => (a.date <= b.date ? a : b))
    for (const r of rows) if (r.id !== keep.id) flagged.push(r)
  }
  if (flagged.length > 1000) return []
  return flagged.map((tx) => ({
    id: tx.id, date: tx.date, symbol: tx.symbol, amount: tx.totalAmount,
    reason: 'same-txn-id-across-dates',
  }))
}

// Class 6 — monthly PortfolioAnalyst NAV rows carry YYYYMM dates holding the
// month-END NAV, but parseDate stamped them month-START ('202601' ->
// '2026-01-01'). Every snapshot imported before the parser fix sits on day 01
// holding the PRIOR month's ending value, which poisons the YTD anchor
// (findYearStartAnchor) and the growth chart. The signature is unmistakable:
// >=3 IBKR snapshots all on day 01 of CONSECUTIVE months, spaced 28-31 days
// apart. A legitimate daily snapshot that happens to fall on the 1st can
// never form that run (two real first-of-month snapshots in a row would
// already require the user to open the app at midnight on New Year's, and
// three in a row is not a human pattern), and daily snapshots carry
// _source 'daily', not 'ibkr'.
// Snapshot doc ids ARE the date string (useFirestoreItems.js saveSnapshot /
// bulkImport), so a re-stamp means writing the doc under its month-end id and
// deleting the day-01 doc — the caller owns both writes; this module stays
// pure and only names the candidates.
export function detectMisstampedMonthlyNavSnapshots(snapshots = []) {
  const list = (snapshots || [])
    .filter((s) => s && s.id && s._source === 'ibkr' && /^\d{4}-\d{2}-01$/.test(s.date || ''))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (list.length < 3) return []

  const monthIndex = (s) => (+s.date.slice(0, 4)) * 12 + (+s.date.slice(5, 7))
  const dayGap = (a, b) => (new Date(b.date).getTime() - new Date(a.date).getTime()) / 86400000
  const monthEnd = (s) => {
    const y = +s.date.slice(0, 4), m = +s.date.slice(5, 7)
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  }
  // Never re-stamp onto a date that already has its own snapshot doc: the
  // merge would overwrite a genuine observation (and the month-end row could
  // have been imported AFTER the parser fix, already correct).
  const takenDates = new Set((snapshots || []).map((s) => s && s.date).filter(Boolean))

  // Split into runs of consecutive months spaced 28-31 days apart.
  const runs = []
  let run = [list[0]]
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i]
    const gap = dayGap(prev, cur)
    if (monthIndex(cur) - monthIndex(prev) === 1 && gap >= 28 && gap <= 31) run.push(cur)
    else { runs.push(run); run = [cur] }
  }
  runs.push(run)

  const flagged = []
  for (const r of runs) {
    if (r.length < 3) continue
    for (const s of r) {
      const newDate = monthEnd(s)
      if (takenDates.has(newDate)) continue
      flagged.push({ id: s.id, date: s.date, newDate, reason: 'misstamped-monthly-nav-snapshot' })
    }
  }
  // Safety cap: even a decade of monthly rows is 120. More means the
  // predicate is matching something else — abort, don't touch.
  if (flagged.length > 120) return []
  return flagged
}
