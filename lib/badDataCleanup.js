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
