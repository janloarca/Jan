// Adapter so a Flex Query XML downloaded BY HAND from IBKR can enter the same
// file-import flow that today only understands the sectioned CSV/XLSX Activity
// Statement (parseIBKRFile + formatIBKRFileResult). The app's own instructions
// tell users to download the Flex Query in XML, and both upload entry points
// rejected that XML outright: users literally could not import the file the app
// asked for.
//
// The XML itself is parsed by lib/parsers/ibkrFlex.js (parseXmlToData), the same
// battle-tested parser the automatic API sync uses. This module only reshapes
// that output into the formatIBKRFileResult shape that FileImportModal's IBKR
// preview/import (and IBKRSyncModal's file tab) already consume:
//
//   { items, transactions, equityHistory, cashPositions, baseCurrency,
//     accounts, sections, _sectionNames, _period, benchmarks, empty, syncedAt }
//
// Deliberately NOT reused: lib/ibkrSync.js formatResult(). It is not exported,
// it stamps `_origin:'api'` (a file upload must be `_origin:'file'` so Settings
// can tell the two apart), and importing it would drag authFetch + the firebase
// client into this pure parser. The trade/cash mapping below mirrors it.

import { parseXmlToData, parseBaseCurrency, formatDate } from './ibkrFlex'
import { applyAcquisitionDates } from './ibkrFileParser'
import { transactionDocId } from '@/lib/transactionDocId'

// Human-readable names for the sections parseXmlToData counts, so an empty
// import can say "we found X and Y, but nothing usable" instead of failing
// silently (same role as _sectionNames in the CSV path).
const SECTION_LABELS = [
  ['openPositions', 'Open Positions'],
  ['trades', 'Trades'],
  ['cashTransactions', 'Cash Transactions'],
  ['equitySummary', 'Net Asset Value (NAV) in Base'],
  ['cashReport', 'Cash Report'],
]

function sectionNames(sections) {
  if (!sections) return []
  return SECTION_LABELS.filter(([key]) => (sections[key] || 0) > 0).map(([, label]) => label)
}

// Mirror of ibkrSync.js formatResult()'s cash-transaction mapping. Flow rows
// (deposits/withdrawals) feed Modified Dietz; dividend rows feed the income
// module; fee/tax/interest rows feed the Costs view. Every row carries
// _ibkrTxnId when IBKR gave us a transactionID, so bulkImport's deterministic
// dedup (useFirestoreItems) can tell two same-day/same-amount movements apart.
const COST_TYPE = { fee: 'FEE', tax: 'TAX', interest: 'INTEREST' }

function cashTxToTransactions(ct) {
  const amount = Math.abs(ct.amount || 0)
  const base = {
    symbol: ct.kind === 'flow' ? 'CASH' : (ct.symbol || 'CASH'),
    date: ct.date || new Date().toISOString().split('T')[0],
    quantity: 1,
    pricePerUnit: amount,
    commission: 0,
    currency: ct.currency || 'USD',
    _ibkrAccountId: ct.accountId || '',
    _ibkrTxnId: ct.txnId || '',
    _source: 'ibkr',
  }
  if (ct.kind === 'dividend') {
    return { ...base, type: 'DIVIDEND', description: ct.description || 'Dividend', totalAmount: amount }
  }
  if (COST_TYPE[ct.kind]) {
    return {
      ...base,
      type: COST_TYPE[ct.kind],
      description: ct.description || COST_TYPE[ct.kind],
      totalAmount: amount,
      // Signed original: negative = the account paid (cost), positive = received.
      _signedAmount: ct.amount || 0,
    }
  }
  const type = (ct.amount || 0) >= 0 ? 'DEPOSIT' : 'WITHDRAWAL'
  return { ...base, type, description: ct.description || (type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'), totalAmount: amount }
}

export function parseIBKRXmlFile(xmlText) {
  const baseCurrency = parseBaseCurrency(xmlText || '')
  const data = parseXmlToData(xmlText || '')

  if (data.empty) {
    return {
      items: [],
      transactions: [],
      equityHistory: [],
      cashPositions: [],
      baseCurrency,
      accounts: [],
      sections: data.sections || null,
      _sectionNames: sectionNames(data.sections),
      _period: null,
      benchmarks: [],
      empty: true,
      syncedAt: new Date().toISOString(),
    }
  }

  // parseXmlToData merges security positions and Cash Report rows into one list;
  // the file-import shape keeps them apart (cashPositions is diagnostic, both
  // end up in `items`).
  const rawPositions = data.positions || []
  const isCashRow = (p) => /^CASH-/i.test(p.symbol || '')
  const secPositions = rawPositions.filter((p) => !isCashRow(p))
  const cashPositions = rawPositions.filter(isCashRow).map((p) => ({ ...p, _source: 'ibkr' }))

  // Trade rows, normalized to the canonical transaction shape (mirrors
  // formatResult, plus _ibkrTxnId from the tradeID attribute when the query
  // includes it: that is what lets bulkImport distinguish two same-day,
  // same-symbol, same-amount trades instead of collapsing them into one doc).
  const today = new Date().toISOString().split('T')[0]
  const transactions = (data.trades || []).map((t) => {
    const isBuy = (t.buySell || '').toUpperCase() === 'BUY'
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: (t.symbol || '').toUpperCase(),
      description: `${t.description || t.symbol}: ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(t.quantity)} @ ${t.tradePrice}`,
      date: formatDate(t.tradeDate) || today,
      quantity: Math.abs(t.quantity || 0),
      pricePerUnit: t.tradePrice || 0,
      totalAmount: Math.abs(t.proceeds || 0),
      commission: Math.abs(t.commission || 0),
      currency: t.currency || 'USD',
      _ibkrAccountId: t.accountId || '',
      _ibkrCostBasis: t.costBasis,
      _ibkrRealizedPL: t.realizedPL,
      ...(t.tradeId ? { _ibkrTxnId: t.tradeId } : {}),
      _source: 'ibkr',
    }
  })
  for (const ct of (data.cashTransactions || [])) {
    transactions.push(cashTxToTransactions(ct))
  }

  // Real purchase dates, same two-source strategy as the CSV parser: Lots-level
  // Open Positions already carry openDateTime (parseFlexPositions stamped it);
  // for the rest, the earliest BUY in the file wins ONLY when the file's trades
  // account for every share held (otherwise _historyIncomplete, and the oldest
  // NAV day is the floor). Reuses ibkrFileParser's applyAcquisitionDates so the
  // two import paths cannot drift apart.
  applyAcquisitionDates(secPositions, transactions, data.equityHistory)

  const toItem = (p) => {
    const item = {
      symbol: (p.symbol || '').toUpperCase(),
      name: p.name || p.symbol,
      type: p.type || 'Stock',
      quantity: Math.abs(p.quantity || 0),
      purchasePrice: p.purchasePrice || 0,
      currentPrice: p.currentPrice || 0,
      institution: p.institution || 'Interactive Brokers',
      currency: p.currency || 'USD',
      isDebt: p.isDebt || false,
      _source: 'ibkr',
      // Distinguishes an uploaded file from an API sync (both are 'ibkr'), so
      // Settings can list and delete them as separate accounts.
      _origin: 'file',
    }
    if (p.acquisitionDate) item.acquisitionDate = p.acquisitionDate
    if (p._ibkrConId) item.conid = p._ibkrConId
    if (p._ibkrAccountId) item._ibkrAccountId = p._ibkrAccountId
    if (p._historyIncomplete) item._historyIncomplete = true
    return item
  }
  const items = [...secPositions, ...cashPositions]
    .filter((p) => p.quantity !== 0)
    .map(toItem)

  // Dedupe transactions: un Flex repite una fila entre paginas, asi que hace
  // falta. La llave la decide transactionDocId y NUNCA una copia local: dos
  // filas son la misma cuando resolverian al MISMO documento, que es
  // literalmente la pregunta que esa funcion contesta.
  //
  // La copia que vivia aca omitia la cuenta, aunque su propio comentario decia
  // "the same composite the doc id is built from". Con una query que no
  // selecciono transactionID (no hay _ibkrTxnId), dos aportes reales del mismo
  // monto el mismo dia a DOS cuentas distintas colapsaban en uno y el segundo
  // se descartaba aca, aguas arriba de la defensa que si los separa. Un
  // deposito tragado no es un dato de menos: se lee como ganancia de mercado.
  const seenTx = new Set()
  const dedupedTransactions = transactions.filter((tx) => {
    const key = transactionDocId(tx)
    if (seenTx.has(key)) return false
    seenTx.add(key)
    return true
  })

  // equityHistory arrives deduped by date from parseEquitySummary and tagged
  // with the base currency; sort it so the preview shows oldest → newest.
  const equityHistory = [...(data.equityHistory || [])]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  const accounts = [...new Set([
    ...items.map((i) => i._ibkrAccountId),
    ...dedupedTransactions.map((t) => t._ibkrAccountId),
  ].filter(Boolean))]

  const warnings = []
  if ((data.sections?.equitySummary || 0) === 0) {
    warnings.push('missing-nav-section')
  }

  return {
    items,
    transactions: dedupedTransactions,
    equityHistory,
    cashPositions,
    baseCurrency,
    accounts,
    sections: data.sections || null,
    warnings,
    _sectionNames: sectionNames(data.sections),
    _period: null,
    benchmarks: [],
    empty: items.length === 0 && dedupedTransactions.length === 0 && equityHistory.length === 0,
    syncedAt: data.syncedAt || new Date().toISOString(),
  }
}
