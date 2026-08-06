// FASE ER. Year-over-year spreadsheet view: one column per year, at its LAST
// real day — December for a year that's over, "today" (currentMonthKey
// itself) for the year still in progress, same convention the monthly view
// already uses to decide how far its own current-year columns go. Every
// other row/footer/export in PortfolioSpreadsheet already just asks
// "what does historicalItems/monthlyTotals say for this key, and is it
// currentMonthKey" — handing it these keys instead of a month-by-month list
// is what turns the SAME table into year-over-year, no second render tree.
//
// Deliberately its own file, no imports: historicalValues.js pulls in
// authFetch → lib/firebase.js → Firebase Auth, which breaks under Jest
// (no TextEncoder polyfill there) — every existing test for that module
// works around it by replicating logic instead of importing the real thing.
// A one-line date-key mapping has no reason to drag that in just to be
// testable.
export function yearEndMonthKeys(years, currentMonthKey) {
  const currentYear = parseInt(String(currentMonthKey).split('-')[0], 10)
  return (years || []).map((y) => (y === currentYear ? currentMonthKey : `${y}-12`))
}
