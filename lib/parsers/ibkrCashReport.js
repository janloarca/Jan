// Parser for the IBKR Flex Query "Cash Report" section: the account's cash balance
// per currency (<CashReportCurrency currency=".." endingCash="..">). Without this
// section in the Flex Query there are no rows and the account's cash silently never
// shows up in the portfolio.
//
// Extracted from the route handler so it can be unit-tested (Next.js route files only
// allow HTTP-method / segment-config exports).
export function parseCashPositions(xml) {
  if (!xml) return []
  const positions = []
  const seen = new Set()
  // Match the opening tag whether it is self-closing (<... />) or paired
  // (<...>...</...>): IBKR emits either shape depending on the report version, and
  // every attribute we read lives on the opening tag. A `/>`-only regex silently
  // dropped ALL cash for accounts whose Flex used the paired form (same bug class as
  // parseEquitySummary, fixed in FASE AE). The optional (?:Currency)? also matches the
  // bare <CashReport> container, which has no currency attribute and falls through
  // the guard below.
  const cashRegex = /<CashReport(?:Currency)?\b[^>]*>/g
  let match
  while ((match = cashRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const currency = attr('currency')
    const balance = parseFloat(attr('endingCash')) || parseFloat(attr('endingSettledCash')) || 0
    if (!currency || currency === 'BASE_SUMMARY' || balance === 0) continue
    // A report can repeat the same currency (per-account plus summary detail rows).
    // First occurrence wins; keyed by account+currency so true multi-account cash
    // still comes through as separate rows.
    const key = `${attr('accountId')}-${currency}`
    if (seen.has(key)) continue
    seen.add(key)
    positions.push({
      symbol: `CASH-${currency}`,
      name: `Cash (${currency})`,
      quantity: 1,
      purchasePrice: Math.abs(balance),
      currentPrice: Math.abs(balance),
      currency,
      type: 'Bank',
      institution: 'Interactive Brokers',
      isDebt: balance < 0,
    })
  }
  return positions
}
