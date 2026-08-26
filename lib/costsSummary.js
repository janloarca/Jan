// Pure engine for the Costs view: aggregates what a portfolio PAYS to hold and
// trade — trade commissions plus broker fees, withholding taxes and interest —
// from the transaction stream. Currency-independent: every amount is converted to
// the user's base currency with an isFinite fallback (a currency without an FX
// rate must never produce NaN in the cards).
//
// Sources of cost, by transaction type (sign conventions verified against every
// writer: lib/ibkrSync.js COST_TYPE, lib/parsers/ibkrFileParser.js, the XML
// adapter and CashFlowModal):
//   BUY / SELL          -> tx.commission (already absolute)               [commissions]
//   FEE                 -> tx._signedAmount when present (negative = charge,
//                          positive = adjustment/refund, NETTED). Without it
//                          the sign was destroyed at write time (file parser
//                          stores Math.abs; manual rows are positive charges),
//                          so it is assumed to be a charge.               [fees]
//   TAX                 -> tx._signedAmount when present; without it the file
//                          parser stores the RAW signed amount (withheld
//                          negative, refunded positive: its own comment says
//                          "Amounts are taken RAW, never through Math.abs").
//                          A refund NETS against the withholding instead of
//                          counting as a second charge.                   [taxes]
//   INTEREST            -> tx._signedAmount: negative = paid (cost),
//                          positive = received (income; an OFFSET, never a
//                          cost row: it does not count toward hasData)
//                                                    [interestPaid / interestReceived]
//
// FEE/TAX/INTEREST come from the IBKR sync (lib/ibkrSync.js), the file parser
// (Portfolio Analyst "Fee Summary" -> type FEE) and manual property expenses
// (CashFlowModal FEE rows). Commissions live on BUY/SELL rows.
//
// A THIRD source, item-level costs, covers manually-added assets (bonds, bank
// accounts, alternatives) that never go through that import pipeline: the "Costos
// y comisiones" fields on the item itself (AddAccountModal / EditAccountModal) —
// entryFee (one-time, dated at acquisitionDate) and managementFee/expenseRatio
// (recurring annual, prorated for the days actually held within the requested
// year — or, for "all time", from acquisition to today). Without this, a bond
// with a broker commission you typed in by hand never showed up here at all —
// only IBKR-synced costs did.                                    [assetCosts]

const monthKey = (date) => (typeof date === 'string' && date.length >= 7 ? date.slice(0, 7) : null)

function emptyBucket() {
  return { commissions: 0, fees: 0, taxes: 0, interestPaid: 0, interestReceived: 0, assetCosts: 0, total: 0, count: 0 }
}

// Portion of an ANNUAL amount that falls within `year` (or, when year is null,
// from acquisitionDate through today — "all time"). Bounded so a future
// acquisitionDate or a past year with no overlap contributes nothing.
function proratedForYear(annualAmount, acquisitionDate, year, endCapMs = null) {
  if (!(annualAmount > 0)) return 0
  const acqMs = acquisitionDate ? new Date(`${String(acquisitionDate).slice(0, 10)}T00:00:00Z`).getTime() : null
  if (acqMs != null && isNaN(acqMs)) return 0
  // A fully-sold position stops accruing management fees on its sale date.
  const now = endCapMs != null ? Math.min(Date.now(), endCapMs) : Date.now()
  if (year == null) {
    if (acqMs == null) return 0
    const days = Math.max(0, (now - acqMs) / 86400000)
    return annualAmount * (days / 365.25)
  }
  const yearStartMs = Date.UTC(year, 0, 1)
  const yearEndMs = Date.UTC(year + 1, 0, 1)
  const start = acqMs != null ? Math.max(yearStartMs, acqMs) : yearStartMs
  const end = Math.min(yearEndMs, now)
  if (end <= start) return 0
  const days = (end - start) / 86400000
  const daysInYear = (yearEndMs - yearStartMs) / 86400000
  return annualAmount * (days / daysInYear)
}

export function computeCosts({ transactions, items, convert, baseCurrency = 'USD', year = null } = {}) {
  // The page keeps the year as a STRING (SegmentedTabs keys). `Date.UTC(year+1)`
  // with a string concatenates ('2026' + 1 = '20261') and the proration divides
  // by ~6.6 million days: every recurring fee silently collapsed to ~0. Coerce
  // once here; anything unparseable means "all time" rather than garbage math.
  const yr = (() => {
    if (year == null || year === 'all' || year === '') return null
    const n = Number(year)
    return Number.isFinite(n) ? n : null
  })()

  const cv = (amount, currency) => {
    const a = Number(amount) || 0
    if (!convert || (currency || 'USD') === baseCurrency) return a
    const out = convert(a, currency || 'USD', baseCurrency)
    return isFinite(out) ? out : a
  }

  const totals = emptyBucket()
  const byMonth = {}
  const bySymbol = {}

  const bump = (mk, field, amount) => {
    totals[field] += amount
    if (mk) {
      if (!byMonth[mk]) byMonth[mk] = emptyBucket()
      byMonth[mk][field] += amount
    }
  }
  const countRow = (mk) => {
    totals.count += 1
    if (mk && byMonth[mk]) byMonth[mk].count += 1
  }
  const addSymbolCost = (sym, amount) => {
    const key = (sym || 'CASH').toUpperCase()
    bySymbol[key] = (bySymbol[key] || 0) + amount
  }

  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    const date = tx.date || ''
    const mk = monthKey(date)
    if (yr && (!mk || !mk.startsWith(String(yr)))) continue
    const cur = tx.currency || tx._originalCurrency || 'USD'

    if (type === 'BUY' || type === 'SELL') {
      const comm = cv(Math.abs(Number(tx.commission) || 0), cur)
      if (comm <= 0) continue
      bump(mk, 'commissions', comm)
      bump(mk, 'total', comm)
      countRow(mk)
      addSymbolCost(tx.symbol, comm)
    } else if (type === 'FEE') {
      // Negative = charge. Without _signedAmount the sign was destroyed at
      // write time (file parser stores Math.abs; manual rows are positive
      // charges), so a bare positive amount is assumed to be a charge.
      const signed = tx._signedAmount != null
        ? Number(tx._signedAmount)
        : -Math.abs(Number(tx.totalAmount) || 0)
      const mag = cv(Math.abs(signed), cur)
      if (mag <= 0) continue
      const amt = signed < 0 ? mag : -mag // a signed refund NETS against fees
      bump(mk, 'fees', amt)
      bump(mk, 'total', amt)
      countRow(mk)
      addSymbolCost(tx.symbol, amt)
    } else if (type === 'TAX') {
      // The file parser stores the RAW signed amount (withheld negative,
      // refunded positive); API rows carry _signedAmount with abs totalAmount.
      // Reading Math.abs here turned every refund into a SECOND charge: a
      // withholding plus its reversal summed to double instead of zero.
      const signed = tx._signedAmount != null
        ? Number(tx._signedAmount)
        : (Number(tx.totalAmount) || 0)
      const mag = cv(Math.abs(signed), cur)
      if (mag <= 0) continue
      const amt = signed < 0 ? mag : -mag // refund nets
      bump(mk, 'taxes', amt)
      bump(mk, 'total', amt)
      countRow(mk)
      addSymbolCost(tx.symbol, amt)
    } else if (type === 'INTEREST') {
      // Sign decides paid vs received. Fall back to totalAmount as a cost when the
      // signed original is absent (e.g. file-import rows).
      const signed = tx._signedAmount != null ? Number(tx._signedAmount) : -(Number(tx.totalAmount) || 0)
      const amt = cv(Math.abs(signed), cur)
      if (amt <= 0) continue
      if (signed < 0) {
        bump(mk, 'interestPaid', amt)
        bump(mk, 'total', amt)
        addSymbolCost(tx.symbol, amt)
        // Only interest PAID is a cost row. Received interest is an offset:
        // counting it made a portfolio with zero costs claim "$0.00 · 1 cost
        // entries" and hasData=true on income alone.
        countRow(mk)
      } else {
        bump(mk, 'interestReceived', amt)
      }
    }
  }

  for (const it of items || []) {
    const cur = it._originalCurrency || it.currency || 'USD'
    const label = it.symbol || it.name

    // One-time entry/brokerage cost, dated at purchase.
    const entryFee = Number(it.entryFee) || 0
    if (entryFee > 0) {
      const acqMk = monthKey(it.acquisitionDate)
      if (!yr || (acqMk && acqMk.startsWith(String(yr)))) {
        const amt = cv(entryFee, cur)
        if (amt > 0) {
          bump(acqMk, 'assetCosts', amt)
          bump(acqMk, 'total', amt)
          countRow(acqMk)
          addSymbolCost(label, amt)
        }
      }
    }

    // Recurring management fee (fixed $ or % of balance) + expense ratio (%),
    // prorated for the portion of `year` actually held.
    const mgmt = Number(it.managementFee) || 0
    const expenseRatio = Number(it.expenseRatio) || 0
    if (mgmt > 0 || expenseRatio > 0) {
      const balance = (Number(it.quantity) || 1) * (Number(it._originalPrice ?? it.currentPrice ?? it.purchasePrice) || 0)
      const annual = (it.managementFeeType === 'fixed' ? mgmt : balance * (mgmt / 100)) + balance * (expenseRatio / 100)
      // A position sold in full stops paying management the day it was sold
      // (SellModal stamps saleDate + soldFully): without the cap the fee kept
      // accruing forever on an asset the user no longer holds.
      const soldEndMs = it.soldFully && it.saleDate
        ? new Date(`${String(it.saleDate).slice(0, 10)}T00:00:00Z`).getTime()
        : null
      const prorated = proratedForYear(annual, it.acquisitionDate, yr, isFinite(soldEndMs) ? soldEndMs : null)
      if (prorated > 0) {
        const amt = cv(prorated, cur)
        if (amt > 0) {
          bump(null, 'assetCosts', amt)
          bump(null, 'total', amt)
          countRow(null)
          addSymbolCost(label, amt)
        }
      }
    }
  }

  const months = Object.keys(byMonth).sort().reverse()
  const symbols = Object.entries(bySymbol)
    .map(([symbol, amount]) => ({ symbol, amount }))
    .filter((s) => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  // Recurring account costs (management fee, expense ratio) have no month:
  // they bump the totals with mk=null, so the hero total exceeds the sum of
  // the monthly bars by exactly this amount. Exposed so the page can SAY it
  // instead of leaving two numbers that don't reconcile.
  const datedTotal = Object.values(byMonth).reduce((s, b) => s + b.total, 0)
  const undatedTotal = totals.total - datedTotal

  return {
    ...totals,
    // totalCost is what left the account (commissions + fees + taxes + interest paid + asset costs).
    // Interest received is reported separately as an offset, never netted into cost.
    totalCost: totals.total,
    byMonth,
    months,
    bySymbol: symbols,
    undatedTotal,
    hasData: totals.count > 0,
  }
}
