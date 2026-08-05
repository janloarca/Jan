// Pure engine for the Costs view: aggregates what a portfolio PAYS to hold and
// trade — trade commissions plus broker fees, withholding taxes and interest —
// from the transaction stream. Currency-independent: every amount is converted to
// the user's base currency with an isFinite fallback (a currency without an FX
// rate must never produce NaN in the cards).
//
// Sources of cost, by transaction type:
//   BUY / SELL          -> tx.commission (already absolute)               [commissions]
//   FEE                 -> tx.totalAmount (Other Fees, Commission Adj.)   [fees]
//   TAX                 -> tx.totalAmount (Withholding Tax)               [taxes]
//   INTEREST            -> tx._signedAmount: negative = paid (cost),
//                          positive = received (income)          [interestPaid / interestReceived]
//
// FEE/TAX/INTEREST come from the IBKR sync (lib/ibkrSync.js) and the file parser
// (Portfolio Analyst "Fee Summary" -> type FEE). Commissions live on BUY/SELL rows.
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
function proratedForYear(annualAmount, acquisitionDate, year) {
  if (!(annualAmount > 0)) return 0
  const acqMs = acquisitionDate ? new Date(`${String(acquisitionDate).slice(0, 10)}T00:00:00Z`).getTime() : null
  if (acqMs != null && isNaN(acqMs)) return 0
  const now = Date.now()
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
    if (year && (!mk || !mk.startsWith(String(year)))) continue
    const cur = tx.currency || tx._originalCurrency || 'USD'

    if (type === 'BUY' || type === 'SELL') {
      const comm = cv(Math.abs(Number(tx.commission) || 0), cur)
      if (comm <= 0) continue
      bump(mk, 'commissions', comm)
      bump(mk, 'total', comm)
      countRow(mk)
      addSymbolCost(tx.symbol, comm)
    } else if (type === 'FEE') {
      const amt = cv(Math.abs(Number(tx.totalAmount) || 0), cur)
      if (amt <= 0) continue
      bump(mk, 'fees', amt)
      bump(mk, 'total', amt)
      countRow(mk)
      addSymbolCost(tx.symbol, amt)
    } else if (type === 'TAX') {
      const amt = cv(Math.abs(Number(tx.totalAmount) || 0), cur)
      if (amt <= 0) continue
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
      } else {
        bump(mk, 'interestReceived', amt)
      }
      countRow(mk)
    }
  }

  for (const it of items || []) {
    const cur = it._originalCurrency || it.currency || 'USD'
    const label = it.symbol || it.name

    // One-time entry/brokerage cost, dated at purchase.
    const entryFee = Number(it.entryFee) || 0
    if (entryFee > 0) {
      const acqMk = monthKey(it.acquisitionDate)
      if (!year || (acqMk && acqMk.startsWith(String(year)))) {
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
      const prorated = proratedForYear(annual, it.acquisitionDate, year)
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

  return {
    ...totals,
    // totalCost is what left the account (commissions + fees + taxes + interest paid + asset costs).
    // Interest received is reported separately as an offset, never netted into cost.
    totalCost: totals.total,
    byMonth,
    months,
    bySymbol: symbols,
    hasData: totals.count > 0,
  }
}
