import { attributeYtd, MAX_UNEXPLAINED_FLOOR } from '../ytdAttribution'

const acc = (key, endVal, flow, start, startIsReal = false, flowBase = flow) =>
  ({ key, name: key, endVal, flow, start, startIsReal, flowBase })

// The headline is not free-floating: it is end - start - flows over the whole
// portfolio. Building it from the same numbers keeps every test honest about
// the identity the engine relies on.
const headlineFor = (accounts, portfolioStart) =>
  accounts.reduce((s, a) => s + a.endVal - a.flow, 0) - portfolioStart

const rowsOf = (res) => res.groups.filter((g) => !g.isUnexplained)
const residualOf = (res) => res.groups.find((g) => g.isUnexplained) || null

describe('attributeYtd', () => {
  test('per-account gains add up to the headline, with nothing left over', () => {
    const accounts = [acc('A', 7000, 1000, 6000), acc('B', 4500, 0, 4000)]
    const res = attributeYtd({ accounts, portfolioStart: 10000, headlineGain: headlineFor(accounts, 10000) })
    expect(res).not.toBeNull()
    expect(res.unexplained).toBeCloseTo(0, 6)
    expect(residualOf(res)).toBeNull()
    const byKey = Object.fromEntries(rowsOf(res).map((g) => [g.key, g.gain]))
    expect(byKey.A).toBeCloseTo(0, 6)   // 7000 - 6000 - 1000
    expect(byKey.B).toBeCloseTo(500, 6)
    expect(res.totalGain).toBeCloseTo(500, 6)
  })

  test('a broker deposit is netted, never counted as profit', () => {
    // An account worth 10,012 that received 3,950 of deposits and started the
    // year at 5,362 gained ~700, not the 13,207 the old engine reported.
    const accounts = [acc('ibkr', 10012, 3950, 5362, true)]
    const res = attributeYtd({ accounts, portfolioStart: 5362, headlineGain: headlineFor(accounts, 5362) })
    expect(rowsOf(res)[0].gain).toBeCloseTo(700, 6)
  })

  test('an account keeps ITS OWN start: no stretching to make the total tidy', () => {
    // LEGDER's case. It arrives with the year-start its own chart uses (1,678)
    // and must report the loss that follows from it (-667), not a prettier
    // number obtained by deforming that start.
    const accounts = [
      acc('legder', 1011.32, 0, 1678.03),
      acc('other', 12000, 0, 11500, true),
    ]
    const portfolioStart = 13178.03
    const res = attributeYtd({ accounts, portfolioStart, headlineGain: headlineFor(accounts, portfolioStart) })
    const legder = rowsOf(res).find((g) => g.key === 'legder')
    expect(legder.start).toBeCloseTo(1678.03, 6) // untouched
    expect(legder.gain).toBeCloseTo(-666.71, 2)
  })

  test('a leftover is shown as its own row instead of being smeared', () => {
    const accounts = [acc('A', 11000, 0, 10000)]
    // The anchor says the portfolio started 40 lower than the accounts do.
    const res = attributeYtd({ accounts, portfolioStart: 9960, headlineGain: 1040 })
    const residual = residualOf(res)
    expect(residual).not.toBeNull()
    expect(residual.gain).toBeCloseTo(40, 6)
    // Everything on screen still adds up to the headline.
    const shown = res.groups.reduce((s, g) => s + g.gain, 0)
    expect(shown).toBeCloseTo(1040, 6)
    expect(rowsOf(res)[0].start).toBeCloseTo(10000, 6) // account untouched
  })

  test('refuses when the leftover is too big to call it an explanation', () => {
    expect(attributeYtd({
      accounts: [acc('A', 11000, 0, 10000)],
      portfolioStart: 6000,
      headlineGain: 5000,
    })).toBeNull()
  })

  test('a rounding-sized leftover is folded away, not shown', () => {
    const res = attributeYtd({
      accounts: [acc('A', 11000, 0, 10000)],
      portfolioStart: 9999.6,
      headlineGain: 1000.4,
    })
    expect(residualOf(res)).toBeNull()
    expect(res.unexplained).toBeCloseTo(0.4, 6)
  })

  test('rejects a negative start: an account was never worth negative money', () => {
    // The shape of the original blow-up: a broker reconstructed at ~-$3,195,
    // which turned its entire balance into "gain" (+$13,207 on a $10K account).
    expect(attributeYtd({
      accounts: [acc('ibkr', 10012, 0, -3195, true), acc('m', 5000, 0, 13195, true)],
      portfolioStart: 10000,
      headlineGain: 5017,
    })).toBeNull()
  })

  test('rejects an account that starts bigger than the whole portfolio', () => {
    expect(attributeYtd({
      accounts: [acc('a', 6000, 0, 11000, true), acc('b', 5000, 0, -1000, true)],
      portfolioStart: 10000,
      headlineGain: 1000,
    })).toBeNull()
  })

  test('the total adding up does NOT excuse an impossible row', () => {
    // Rows that cancel each other add up perfectly to the headline. A
    // total-only check waves this through; the per-account guard stops it.
    const accounts = [acc('ok', 12000, 0, 9000, true), acc('impossible', 1000, 0, -1000, true)]
    const portfolioStart = 8000
    expect(accounts.reduce((s, a) => s + a.endVal - a.start - a.flow, 0)).toBeCloseTo(5000, 6)
    expect(attributeYtd({ accounts, portfolioStart, headlineGain: 5000 })).toBeNull()
  })

  test('a start of exactly zero is fine: the account did not exist yet', () => {
    // OSMO, opened in February. Its January value is 0, not an estimate, and
    // the real -$26.65 falls straight out of end - 0 - deposits.
    const accounts = [acc('osmo', 116.88, 143.53, 0, true), acc('other', 10000, 0, 9500, true)]
    const res = attributeYtd({ accounts, portfolioStart: 9500, headlineGain: headlineFor(accounts, 9500) })
    expect(rowsOf(res).find((g) => g.key === 'osmo').gain).toBeCloseTo(-26.65, 2)
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
    expect(attributeYtd({
      accounts: [acc('A', 11000, 0, 10000)],
      portfolioStart: 10000,
      headlineGain: 1000,
      unattributedFlow: 0.4,
    })).not.toBeNull()
  })

  test('an account that contributed nothing is still listed, never omitted', () => {
    // The report that drove this rebuild was two accounts simply absent. A row
    // at $0.00 says "this one did nothing"; no row is indistinguishable from a bug.
    const accounts = [acc('flat', 5000, 0, 5000), acc('mover', 5500, 0, 5000)]
    const res = attributeYtd({ accounts, portfolioStart: 10000, headlineGain: headlineFor(accounts, 10000) })
    expect(rowsOf(res).map((g) => g.key).sort()).toEqual(['flat', 'mover'])
    expect(rowsOf(res).find((g) => g.key === 'flat').gain).toBeCloseTo(0, 6)
  })

  test('rows are ordered by weight and shares measured against the total', () => {
    const accounts = [acc('small', 1010, 0, 1000), acc('big', 9400, 0, 9000)]
    const res = attributeYtd({ accounts, portfolioStart: 10000, headlineGain: headlineFor(accounts, 10000) })
    expect(rowsOf(res).map((g) => g.key)).toEqual(['big', 'small'])
    expect(rowsOf(res)[0].share).toBeCloseTo((400 / 410) * 100, 6)
  })

  test('rejects malformed input instead of guessing', () => {
    expect(attributeYtd({ accounts: [], portfolioStart: 100, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', NaN, 0, 10)], portfolioStart: 10, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', 10, 0, 10)], portfolioStart: 0, headlineGain: 1 })).toBeNull()
    expect(attributeYtd({ accounts: [acc('A', 10, 0, 10)], portfolioStart: 10, headlineGain: null })).toBeNull()
  })

  test('each row reports ITS OWN return, on the Dietz base, not a share of the total', () => {
    // The complaint that drove this: a broker up 7.40% on the year sat next to a
    // "75%", which was its slice of the portfolio's gain. Same % sign, different
    // question. Here the deposits sat for three quarters of the window, so the
    // base is 5,362 + 3,950 x 0.75 = 8,324.5 and the return is 612/8,324.5.
    const accounts = [
      { key: 'ibkr', name: 'ibkr', endVal: 9924, flow: 3950, flowBase: 3950 * 0.75, start: 5362, startIsReal: true },
      { key: 'other', name: 'other', endVal: 5000, flow: 0, flowBase: 0, start: 5000 },
    ]
    const res = attributeYtd({ accounts, portfolioStart: 10362, headlineGain: headlineFor(accounts, 10362) })
    const ibkr = rowsOf(res).find((g) => g.key === 'ibkr')
    expect(ibkr.gain).toBeCloseTo(612, 6)
    expect(ibkr.ret).toBeCloseTo((612 / 8324.5) * 100, 6) // 7.35%, not 100%
    // The share of the total gain would have been 100% here: it is a different
    // number answering a different question, and it is no longer what is shown.
    expect(ibkr.ret).not.toBeCloseTo(100, 1)
    // An account that neither moved nor was funded reports a flat 0%, not null.
    expect(rowsOf(res).find((g) => g.key === 'other').ret).toBeCloseTo(0, 6)
  })

  test('money moved between two of your own accounts is a return for neither', () => {
    // A bond in IDC paid a 240 coupon out in cash to an account elsewhere. The
    // portfolio-level Dietz never sees it (it nets DEPOSIT/WITHDRAWAL only), so
    // without netting it per account the bond's account reads flat for a year it
    // did earn, and the cash account reads as having produced 240 out of thin
    // air. Fed as an outflow on one side and an inflow on the other, the coupon
    // lands where it was earned -- and because the two are equal and opposite,
    // the headline is untouched.
    const withNetting = [acc('idc', 6000, -240, 6000), acc('cash', 240, 240, 0)]
    const res = attributeYtd({
      accounts: withNetting, portfolioStart: 6000, headlineGain: 240,
    })
    const byKey = Object.fromEntries(rowsOf(res).map((g) => [g.key, g.gain]))
    expect(byKey.idc).toBeCloseTo(240, 6)
    expect(byKey.cash).toBeCloseTo(0, 6)
    expect(res.unexplained).toBeCloseTo(0, 6)

    // Without it, the same year reads as the cash account's achievement.
    const without = [acc('idc', 6000, 0, 6000), acc('cash', 240, 0, 0)]
    const naive = Object.fromEntries(
      rowsOf(attributeYtd({ accounts: without, portfolioStart: 6000, headlineGain: 240 }))
        .map((g) => [g.key, g.gain])
    )
    expect(naive.idc).toBeCloseTo(0, 6)
    expect(naive.cash).toBeCloseTo(240, 6)
  })

  test('a return needs capital to measure against', () => {
    // An account opened this year with money that arrived today has a base of
    // ~0: there is no honest percentage to print, so none is.
    const accounts = [
      { key: 'new', name: 'new', endVal: 100, flow: 100, flowBase: 0, start: 0 },
      { key: 'old', name: 'old', endVal: 10500, flow: 0, flowBase: 0, start: 10000 },
    ]
    const res = attributeYtd({ accounts, portfolioStart: 10000, headlineGain: headlineFor(accounts, 10000) })
    expect(rowsOf(res).find((g) => g.key === 'new').ret).toBeNull()
    expect(rowsOf(res).find((g) => g.key === 'old').ret).toBeCloseTo(5, 6)
  })

  test('the leftover floor is an absolute one, for near-zero headlines', () => {
    expect(MAX_UNEXPLAINED_FLOOR).toBeGreaterThan(0)
    const res = attributeYtd({
      accounts: [acc('A', 1000, 0, 1000)],
      portfolioStart: 1000 - (MAX_UNEXPLAINED_FLOOR - 1),
      headlineGain: MAX_UNEXPLAINED_FLOOR - 1,
    })
    expect(res).not.toBeNull()
  })
})
