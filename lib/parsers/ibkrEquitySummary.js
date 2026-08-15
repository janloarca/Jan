// Parser for the IBKR Flex Query "Equity Summary" section — the daily portfolio NAV
// history (<EquitySummaryByReportDateInBase> rows). This is the ONLY source of real
// historical portfolio value; without this section a Flex Query imports positions but
// no value history, so YTD/ALL returns and the value chart start from today.
//
// Extracted from the route handler so it can be unit-tested (Next.js route files only
// allow HTTP-method / segment-config exports). Kept self-contained (own date helper).

// IBKR dates arrive as YYYYMMDD or YYYY-MM-DD (sometimes with stray ; or ,). Normalize
// to YYYY-MM-DD; return undefined for anything unparseable.
export function normalizeFlexDate(dt) {
  if (!dt) return undefined
  const clean = String(dt).replace(/[;,]/g, '').trim()
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return undefined
}

export function parseEquitySummary(xml) {
  if (!xml) return []
  const entries = []
  // Match the opening tag whether it is self-closing (<... />) or paired
  // (<...>...</...>) — IBKR emits either shape depending on the report version, and
  // every attribute we read lives on the opening tag. A `/>`-only regex silently
  // dropped the entire NAV history for accounts whose Flex used the paired form.
  const regex = /<EquitySummaryByReportDateInBase\b[^>]*>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const reportDate = attr('reportDate')
    const total = parseFloat(attr('total')) || 0
    const totalLong = parseFloat(attr('totalLong')) || 0
    const totalShort = parseFloat(attr('totalShort')) || 0
    const cash = parseFloat(attr('cash')) || 0
    if (!reportDate || total === 0) continue
    const date = normalizeFlexDate(reportDate)
    if (!date) continue
    entries.push({
      date,
      netWorthUSD: total,
      totalActivosUSD: totalLong + cash,
      totalDebtUSD: Math.abs(totalShort),
      _source: 'ibkr',
    })
  }
  // Dedupe by date (a Flex report can repeat the same report date across pages).
  const seen = new Set()
  return entries.filter((e) => {
    if (seen.has(e.date)) return false
    seen.add(e.date)
    return true
  })
}
