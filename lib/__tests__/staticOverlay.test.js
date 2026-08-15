import { staticValueAt } from '../staticOverlay'

const day = (d) => Date.UTC(2026, 0, d)
const pts = [
  { ts: day(10), value: 13000 },
  { ts: day(11), value: 13100 },
  { ts: day(12), value: 13200 },
]
const acq = Date.UTC(2024, 0, 2)

describe('staticValueAt', () => {
  test('inside the reconstruction it is the last known value, exactly as before', () => {
    expect(staticValueAt(day(10), pts, { earliestAcqTs: acq })).toBe(13000)
    expect(staticValueAt(day(11) + 3600000, pts, { earliestAcqTs: acq })).toBe(13100)
    expect(staticValueAt(day(12), pts, { earliestAcqTs: acq })).toBe(13200)
  })

  test('past the right edge it holds the last value forward, unchanged', () => {
    expect(staticValueAt(day(400), pts, { earliestAcqTs: acq })).toBe(13200)
  })

  test('before the left edge it holds the earliest known value backwards', () => {
    // The bug: this returned 0, so a broker NAV of ~$4,000 from 2024 was drawn
    // as the whole portfolio and the ALL view headlined "+475%" off it.
    expect(staticValueAt(Date.UTC(2024, 5, 1), pts, { earliestAcqTs: acq })).toBe(13000)
    expect(staticValueAt(Date.UTC(2025, 5, 1), pts, { earliestAcqTs: acq })).toBe(13000)
  })

  test('never earlier than the assets existed: before acquisition, zero is the answer', () => {
    expect(staticValueAt(Date.UTC(2023, 5, 1), pts, { earliestAcqTs: acq })).toBe(0)
    expect(staticValueAt(acq, pts, { earliestAcqTs: acq })).toBe(13000)
    expect(staticValueAt(acq - 1, pts, { earliestAcqTs: acq })).toBe(0)
  })

  test('an earliest known value of zero means the broker WAS the whole portfolio', () => {
    // Nothing to add back: the bare NAV is the complete, correct figure and must
    // not be inflated by a later asset the user had not bought yet.
    const zeroFirst = [{ ts: day(10), value: 0 }, { ts: day(11), value: 13100 }]
    expect(staticValueAt(Date.UTC(2024, 5, 1), zeroFirst, { earliestAcqTs: acq })).toBe(0)
  })

  test('with no acquisition date to bound it, nothing is held back', () => {
    // An unbounded guess is the thing this function exists to avoid, so the
    // conservative old behaviour stands.
    expect(staticValueAt(Date.UTC(2024, 5, 1), pts)).toBe(0)
    expect(staticValueAt(Date.UTC(2024, 5, 1), pts, { earliestAcqTs: NaN })).toBe(0)
  })

  test('no reconstruction at all contributes nothing', () => {
    expect(staticValueAt(day(10), [], { earliestAcqTs: acq })).toBe(0)
    expect(staticValueAt(day(10), null, { earliestAcqTs: acq })).toBe(0)
    expect(staticValueAt(day(10), [{ value: 5 }], { earliestAcqTs: acq })).toBe(0)
  })
})
