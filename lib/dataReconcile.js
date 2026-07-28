// Wealth reconciliation + data-source staging.
//
// The idea: instead of TELLING the user how complete their data is with a fixed
// number, MEASURE it. Every change in net worth has to come from somewhere:
//
//     ΔNAV = aportes netos + mercado + dividendos + intereses − costos
//
// We know ΔNAV from the value snapshots and we know the flows/income/costs from
// the recorded movements. Whatever is left over is, by definition, activity we
// never imported. That residual IS the missing data, expressed in money, so the
// completeness score stops being a guess.
//
// Verified against a real IBKR PortfolioAnalyst inception report, where the
// broker's own Key Statistics bridge closes to the cent:
//   2,047.40 market + 7,909.99 flows + 339.01 dividends − 97.36 fees
//   − 92.29 other = 10,106.75 = ChangeInNAV.
//
// Pure module: no React, no Firestore, no network. `convert` is optional and
// only needed when movements carry mixed currencies.

const FLOW_IN = new Set(['DEPOSIT'])
const FLOW_OUT = new Set(['WITHDRAWAL'])
const INCOME = new Set(['DIVIDEND', 'INTEREST'])
const COST = new Set(['FEE', 'TAX', 'COMMISSION'])
const TRADE = new Set(['BUY', 'SELL'])

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

function amountIn(tx, convert, baseCurrency) {
  const raw = num(tx.totalAmount ?? tx.amount)
  const cur = tx.currency || baseCurrency
  if (!convert || cur === baseCurrency) return raw
  const out = convert(raw, cur, baseCurrency)
  // A missing FX rate must never turn a real movement into NaN and poison the
  // whole bridge; fall back to the raw figure rather than dropping the row.
  return Number.isFinite(out) ? out : raw
}

function snapValue(s, convert, baseCurrency) {
  const usd = num(s.netWorthUSD ?? s.totalActivosUSD)
  if (!convert || baseCurrency === 'USD') return usd
  const out = convert(usd, 'USD', baseCurrency)
  return Number.isFinite(out) ? out : usd
}

// Movements that fall inside the window the snapshots actually cover. Anything
// dated outside it cannot explain a change we can see, and counting it would
// manufacture a residual out of nothing.
function inWindow(tx, fromTs, toTs) {
  if (!tx.date) return false
  const t = new Date(`${String(tx.date).slice(0, 10)}T12:00:00Z`).getTime()
  return Number.isFinite(t) && t >= fromTs && t <= toTs
}

export function buildWealthBridge({ snapshots = [], transactions = [], convert, baseCurrency = 'USD' } = {}) {
  const dated = snapshots
    .filter((s) => s && s.date)
    .map((s) => ({ ts: new Date(`${String(s.date).slice(0, 10)}T12:00:00Z`).getTime(), s }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts)

  if (dated.length < 2) return null

  const first = dated[0]
  const last = dated[dated.length - 1]
  const beginning = snapValue(first.s, convert, baseCurrency)
  const ending = snapValue(last.s, convert, baseCurrency)
  const changeInNav = ending - beginning

  let flows = 0
  let income = 0
  let costs = 0
  let tradeCount = 0
  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    if (!inWindow(tx, first.ts, last.ts)) continue
    const amt = amountIn(tx, convert, baseCurrency)
    if (FLOW_IN.has(type)) flows += Math.abs(amt)
    else if (FLOW_OUT.has(type)) flows -= Math.abs(amt)
    else if (INCOME.has(type)) income += amt
    else if (COST.has(type)) costs += -Math.abs(amt)
    else if (TRADE.has(type)) tradeCount++
  }

  // Market movement is the residual of the identity, not an input: it is the
  // only term nobody records movement-by-movement. Anything it absorbs that
  // ISN'T market movement (an unimported deposit, missing dividends) is exactly
  // the data gap we want to surface.
  const market = changeInNav - flows - income - costs

  // How much of the change we can attribute to RECORDED activity. Market moves
  // are legitimately unrecorded, so they count as explained only in the sense
  // that the identity closes; what we score is whether the recorded pieces are
  // plausible against the size of the change.
  const gross = Math.abs(flows) + Math.abs(income) + Math.abs(costs) + Math.abs(market)
  const recordedShare = gross > 0 ? (Math.abs(flows) + Math.abs(income) + Math.abs(costs)) / gross : 0

  return {
    from: String(first.s.date).slice(0, 10),
    to: String(last.s.date).slice(0, 10),
    beginning,
    ending,
    changeInNav,
    flows,
    income,
    costs,
    market,
    tradeCount,
    recordedShare,
  }
}

// The three sources, in the order that makes each one worth doing. Scored by
// what the user can actually SEE afterwards, not by how many files they sent:
//   positions  -> today's net worth is real
//   history    -> the growth chart stops estimating the past
//   movements  -> returns, cost basis and the ledger become exact
const STAGE_WEIGHTS = { positions: 33, history: 37, movements: 30 }

// A value history worth calling a history: enough distinct months that the
// chart draws a curve instead of a couple of dots.
const MIN_HISTORY_MONTHS = 3

export function assessDataSources({ items = [], transactions = [], snapshots = [] } = {}) {
  const positions = (items || []).filter((it) => it && !it._demo)
  const hasPositions = positions.length > 0

  const months = new Set()
  for (const s of snapshots || []) {
    if (s && s.date) months.add(String(s.date).slice(0, 7))
  }
  const historyMonths = months.size
  const hasHistory = historyMonths >= MIN_HISTORY_MONTHS

  const trades = (transactions || []).filter(
    (tx) => TRADE.has((tx.type || '').toUpperCase()) && tx.date
  )
  // Movements only count as complete when they can actually date the holdings:
  // a ledger that touches a third of the portfolio still leaves most cost bases
  // and purchase dates unproven.
  const symbolsWithTrades = new Set(trades.map((t) => (t.symbol || '').toUpperCase()).filter(Boolean))
  const tradableSymbols = new Set(
    positions
      .filter((it) => !/^CASH/i.test(it.symbol || '') && (it.symbol || ''))
      .map((it) => (it.symbol || '').toUpperCase())
  )
  const covered = [...tradableSymbols].filter((s) => symbolsWithTrades.has(s)).length
  const symbolCoverage = tradableSymbols.size > 0 ? covered / tradableSymbols.size : 0
  const hasMovements = trades.length > 0 && symbolCoverage >= 0.8

  const stages = [
    {
      key: 'positions',
      done: hasPositions,
      count: positions.length,
      partial: 0,
    },
    {
      key: 'history',
      done: hasHistory,
      count: historyMonths,
      partial: hasHistory ? 1 : Math.min(1, historyMonths / MIN_HISTORY_MONTHS),
    },
    {
      key: 'movements',
      done: hasMovements,
      count: trades.length,
      partial: symbolCoverage,
    },
  ]

  const score = Math.round(
    stages.reduce((s, st) => s + STAGE_WEIGHTS[st.key] * (st.done ? 1 : st.partial), 0)
  )

  return {
    score: Math.max(0, Math.min(100, score)),
    stages,
    historyMonths,
    tradeCount: trades.length,
    symbolCoverage,
    // The one thing to do next, so the UI never asks for three things at once.
    next: !hasPositions ? 'positions' : !hasHistory ? 'history' : !hasMovements ? 'movements' : null,
  }
}
