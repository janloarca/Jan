// Pure transaction-rewind engine: reconstructs past portfolio state from the
// CURRENT state plus the imported transaction history, the way a broker's own
// value chart does. Instead of holding today's positions flat into the past
// (which pretends deposits and buys always existed), it walks backwards:
//
//   qty_t   = current_qty  - Σ buys after t   + Σ sells after t
//   cash_t  = current_cash - Σ deposits after t + Σ withdrawals after t
//             + Σ buy cost after t - Σ sell proceeds after t - Σ dividends after t
//
// value_t = Σ qty_t × price_t + cash_t then matches the broker's stepped value
// curve (deposits show as steps, buys move money from cash into positions).
// Everything here is currency-agnostic: callers convert amounts to one currency
// (USD for the portfolio-history API) BEFORE building events.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const toTs = (d) => {
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : null
}

// Per-symbol share-count deltas from BUY/SELL transactions.
// Returns { SYM: [{ ts, qtyDelta }] } sorted by ts ascending.
export function buildTxEvents(transactions) {
  const bySymbol = {}
  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    if (type !== 'BUY' && type !== 'SELL') continue
    const sym = (tx.symbol || '').toUpperCase().trim()
    const ts = toTs(tx.date)
    const qty = Math.abs(num(tx.quantity))
    if (!sym || ts == null || qty <= 0) continue
    if (!bySymbol[sym]) bySymbol[sym] = []
    bySymbol[sym].push({ ts, qtyDelta: type === 'BUY' ? qty : -qty })
  }
  for (const sym of Object.keys(bySymbol)) bySymbol[sym].sort((a, b) => a.ts - b.ts)
  return bySymbol
}

// Signed cash-balance deltas for the account's cash line. amountToBase converts
// (amount, currency) to the target currency; defaults to identity.
// DEPOSIT +, WITHDRAWAL -, BUY -(total+commission), SELL +(total-commission),
// DIVIDEND + (skip reinvested ones: their cash never sat in the account).
export function buildCashFlows(transactions, amountToBase) {
  const conv = amountToBase || ((amt) => amt)
  const flows = []
  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    const ts = toTs(tx.date)
    if (ts == null) continue
    const total = Math.abs(num(tx.totalAmount ?? tx.amount))
    const commission = Math.abs(num(tx.commission))
    const cur = tx.currency || 'USD'
    let amount = null
    if (type === 'DEPOSIT') amount = conv(total, cur)
    else if (type === 'WITHDRAWAL') amount = conv(-total, cur)
    else if (type === 'BUY') amount = conv(-(total + commission), cur)
    else if (type === 'SELL') amount = conv(total - commission, cur)
    else if (type === 'DIVIDEND' && !tx._reinvested) amount = conv(total, cur)
    if (amount == null || amount === 0) continue
    flows.push({ ts, amount })
  }
  flows.sort((a, b) => a.ts - b.ts)
  return flows
}

// Share count at ts: rewind by undoing every delta AFTER ts.
export function qtyAtTs(currentQty, events, ts) {
  let qty = num(currentQty)
  for (const ev of events || []) {
    if (ev.ts > ts) qty -= ev.qtyDelta
  }
  return qty > 0 ? qty : 0
}

// Cash balance at ts: rewind by undoing every flow AFTER ts. Negative balances
// are legitimate (margin), so no floor.
export function cashAtTs(currentCash, flows, ts) {
  let cash = num(currentCash)
  for (const f of flows || []) {
    if (f.ts > ts) cash -= f.amount
  }
  return cash
}
