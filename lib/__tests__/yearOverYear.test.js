import { yearEndMonthKeys } from '../yearOverYear'

// FASE ER. Drives which months the Año a año view of PortfolioSpreadsheet
// actually requests/fetches/renders as columns — worth pinning directly.
describe('yearEndMonthKeys', () => {
  it('maps a past year to its December', () => {
    expect(yearEndMonthKeys([2024], '2026-08')).toEqual(['2024-12'])
  })

  it('maps the current year to currentMonthKey itself, not December', () => {
    // The year is still in progress: there is no real December yet, and the
    // rest of the table already treats currentMonthKey as LIVE data, not a
    // historical reconstruction.
    expect(yearEndMonthKeys([2026], '2026-08')).toEqual(['2026-08'])
  })

  it('mixes past Decembers with the live current-year key, in order', () => {
    expect(yearEndMonthKeys([2023, 2024, 2025, 2026], '2026-08'))
      .toEqual(['2023-12', '2024-12', '2025-12', '2026-08'])
  })

  it('an empty year list gives an empty column list', () => {
    expect(yearEndMonthKeys([], '2026-08')).toEqual([])
  })

  it('a single-year portfolio (founded this year) has only the live column', () => {
    expect(yearEndMonthKeys([2026], '2026-01')).toEqual(['2026-01'])
  })

  it('a year that never had December yet (founded mid this-year, no prior years) never invents one', () => {
    // Regression guard for the exact bug this exists to avoid: NEVER emit a
    // "-12" key for the year still in progress, even if December hasn't
    // happened yet — that would ask for a reconstruction of a day that
    // hasn't occurred, and currentMonthKey is what the rest of the table
    // already treats as "live, not historical" for that year.
    const keys = yearEndMonthKeys([2025, 2026], '2026-03')
    expect(keys).toEqual(['2025-12', '2026-03'])
    expect(keys.some((k) => k === '2026-12')).toBe(false)
  })
})
