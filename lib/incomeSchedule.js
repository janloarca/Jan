// Pure helpers for scheduled-income assets (bonds, CDs, rental, private debt...).
// Shared by two call sites that must agree on the same dates: the automatic
// backfill in useDashboardData (which silently creates the DIVIDEND transactions
// once the account exists) and the "did this already pay?" preview shown in
// AddAccountModal while the user is still filling the form, BEFORE anything is
// saved. Kept framework-free so both can import it without pulling in React.

// Which configured pay-dates already fell due, counting back from `today`.
// Mirrors the lookback window used by the automatic engine (capped at 24
// months) so the preview and the real backfill never disagree on what counts
// as "already happened".
export function getScheduledPayDates({ acquisitionDate, incomeMonths, incomePayDay, rateType }, today = new Date()) {
  if (rateType === 'continuous') return [] // compounding has no discrete pay dates
  const payMonths = Array.isArray(incomeMonths) && incomeMonths.length > 0 ? incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
  const payDay = parseInt(incomePayDay, 10) || 1
  const acq = acquisitionDate ? new Date(`${acquisitionDate}T00:00:00Z`) : null
  if (acq && isNaN(acq.getTime())) return []

  const todayDay = today.getUTCDate()
  const curMonth = today.getUTCMonth()
  const curYear = today.getUTCFullYear()
  const lookback = acq
    ? Math.min(24, Math.ceil((today.getTime() - acq.getTime()) / (30 * 86400000)))
    : 3
  if (lookback < 0) return [] // acquisition date is in the future

  const dates = []
  for (let offset = lookback; offset >= 0; offset--) {
    const checkDate = new Date(Date.UTC(curYear, curMonth - offset, 1))
    const checkMonth = checkDate.getUTCMonth()
    const checkYear = checkDate.getUTCFullYear()
    if (acq && checkDate < new Date(Date.UTC(acq.getUTCFullYear(), acq.getUTCMonth(), 1))) continue
    if (!payMonths.includes(checkMonth)) continue
    if (offset === 0 && todayDay < payDay) continue
    dates.push(`${checkYear}-${String(checkMonth + 1).padStart(2, '0')}-${String(payDay).padStart(2, '0')}`)
  }
  return dates
}

// Same per-payment estimate the automatic engine computes (management fees
// aside — those aren't collected until the account already exists, in
// EditAccountModal). Used only to preview an approximate figure to the user;
// the real transaction amount is computed by processDividends at write time.
export function estimateIncomeAmount({ balance, incomeMode, incomeRate, incomeAmount, rateType, rateMin, rateMax, isPerShare, qty }, payMonthsCount = 12) {
  const divisor = payMonthsCount || 12
  if (rateType === 'variable' && rateMin > 0 && rateMax > 0) {
    return (balance * (((rateMin + rateMax) / 2) / 100)) / divisor
  }
  if (incomeMode === 'percent' && incomeRate > 0) {
    return (balance * (incomeRate / 100)) / divisor
  }
  if (incomeAmount > 0) {
    return isPerShare ? incomeAmount * (qty || 1) : incomeAmount
  }
  return 0
}
