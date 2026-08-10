import { attributeYtd, MAX_START_SCALE } from '../ytdAttribution'

// Shorthand for a fully-specified account row.
const acc = (key, endVal, flow, start, startIsReal = false) =>
  ({ key, name: key, endVal, flow, start, startIsReal })

describe('attributeYtd', () => {
  test('per-account gains sum to the headline exactly when the split already agrees', () => {
    // start 10,000 -> end 11,500 with 1,000 deposited: gain = 500.
    const res = attributeYtd({
      accounts: [acc('A', 7000, 1000, 6000), acc('B', 4500, 0, 4000)],
      portfolioStart: 10000,
      headlineGain: 500,
    })
    expect(res).not.toBeNull()
    expect(res.totalGain).toBeCloseTo(500, 6)
    expect(res.scaledEstimates).toBe(false)
    const byKey = Object.fromEntries(res.groups.map((g) => [g.key, g.gain]))
    expect(byKey.A).toBeCloseTo(0, 6)   // 7000 - 6000 - 1000
    expect(byKey.B).toBeCloseTo(500, 6) // 4500 - 4000 - 0
  })

  test('a broker deposit is netted, never counted as profit', () => {
    // The shape of the bug this rebuild exists for: an account worth 10,012 that
    // received 3,950 of deposits and started the year at 5,362 gained ~700, not
    // the 13,207 the position-by-position version reported.
    const res = attributeYtd({
      accounts: [acc('ibkr', 10012, 3950, 5362, true)],
      portfolioStart: 5362,
      headlineGain: 700,
    })
    expect(res).not.toBeNull()
    expect(res.groups[0].gain).toBeCloseTo(700, 6)
  })

  test('estimated starts are pinned to the anchor, known starts are left alone', () => {
    // The broker's real year-start NAV is 5,000 and must survive untouched; the
    // manual estimates (4,000 + 2,000) have to add up to 10,000 - 5,000, so they
    // are scaled by 5/6.
    const res = attributeYtd({
      accounts: [
        acc('ibkr', 6000, 0, 5000, true),
        acc('manualA', 4200, 0, 4000),
        acc('manualB', 2100, 0, 2000),
      ],
      portfolioStart: 10000,
      headlineGain: 2300, // 12,300 end - 10,000 start - 0 flows
    })
    expect(res).not.toBeNull()
    expect(res.scaledEstimates).toBe(true)
    const byKey = Object.fromEntries(res.groups.map((g) => [g.key, g]))
    expect(byKey.ibkr.start).toBeCloseTo(5000, 6) // untouched
    expect(byKey.manualA.start).toBeCloseTo(4000 * (5000 / 6000), 6)
    expect(byKey.manualB.start).toBeCloseTo(2000 * (5000 / 6000), 6)
    expect(res.totalGain).toBeCloseTo(2300, 6)
  })

  test('refuses when the estimates would have to be stretched beyond reason', () => {
    // Estimated starts sum to 1,000 but the anchor demands 10,000: a 10x stretch
    // is not a correction, it is fiction.
    expect(attributeYtd({
      accounts: [acc('A', 11000, 0, 1000)],
      portfolioStart: 10000,
      headlineGain: 1000,
    })).toBeNull()
  })

  test('accepts a stretch right at the allowed edge', () => {
    const start = 5000
    const res = attributeYtd({
      accounts: [acc('A', 12000, 0, start)],
      portfolioStart: start * MAX_START_SCALE,
      headlineGain: 12000 - start * MAX_START_SCALE,
    })
    expect(res).not.toBeNull()
    expect(res.groups[0].start).toBeCloseTo(10000, 6)
  })

  test('refuses when real starts alone already exceed the whole anchor', () => {
    expect(attributeYtd({
      accounts: [acc('ibkr', 6000, 0, 12000, true), acc('m', 1000, 0, 500)],
      portfolioStart: 10000,
      headlineGain: -5000,
    })).toBeNull()
  })

  test('refuses when external money could not be attributed to any account', () => {
    expect(attributeYtd({
      accounts: [acc('A', 11000, 0, 10000)],
      portfolioStart: 10000,
      headlineGain: 1000,
      unattributedFlow: 900,
    })).toBeNull()
  })

  test('tolerates a rounding-sized unattributed remainder', () => {
    const res = attributeYtd({
      accounts: [acc('A', 11000, 0, 10000)],
      portfolioStart: 10000,
      headlineGain: 1000,
      unattributedFlow: 0.4,
    })
    expect(res).not.toBeNull()
  })

  test('every start known but disagreeing with the anchor is refused, not fudged', () => {
    expect(attributeYtd({
      accounts: [acc('a', 6000, 0, 5000, true), acc('b', 3000, 0, 2000, true)],
      portfolioStart: 10000, // real starts sum to 7,000
      headlineGain: 2000,
    })).toBeNull()
  })

  test('shares are expressed against the total and ordered by weight', () => {
    const res = attributeYtd({
      accounts: [acc('small', 1010, 0, 1000), acc('big', 9400, 0, 9000)],
      portfolioStart: 10000,
      headlineGain: 410,
    })
    expect(res.groups.map((g) => g.key)).toEqual(['big', 'small'])
    expect(res.groups[0].share).toBeCloseTo((400 / 410) * 100, 6)
  })

  test('an account that contributed nothing is still listed, never omitted', () => {
    // The report that drove this rebuild was two accounts simply absent from the
    // panel. A row at $0.00 says "this one did nothing"; no row at all is
    // indistinguishable from a bug.
    const res = attributeYtd({
      accounts: [acc('flat', 5000, 0, 5000), acc('mover', 5500, 0, 5000)],
      portfolioStart: 10000,
      headlineGain: 500,
    })
    expect(res.groups.map((g) => g.key).sort()).toEqual(['flat', 'mover'])
    expect(res.groups.find((g) => g.key === 'flat').gain).toBeCloseTo(0, 6)
  })

  test('rejects malformed input instead of guessing', () => {
    expect(attributeYtd({ accounts: [], portfolioStart: 100, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', NaN, 0, 10)], portfolioStart: 10, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', 10, 0, 10)], portfolioStart: 0, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', 10, 0, 10)], portfolioStart: 10, headlineGain: null })).toBeNull()
  })
})
