import { CATEGORY, CHART_PALETTE, INVESTMENT_CLASS_COLORS, SEMANTIC } from '@/lib/colors'
import { hexToOklch, deltaE, deltaEUnderCvd, closestPair } from '@/lib/colorMath'

// The guard for the asset-class palette.
//
// lib/colors.js has always DOCUMENTED that the palette was picked in OKLCH and
// checked against a perceptual floor, but nothing enforced it: `scripts/` does
// not exist in this repo, and the validator its comment cited belongs to an
// external tool. Raising a hue's chroma would have broken the guarantee with
// zero signal. This file is that signal.
//
// ⚠️ If one of these fails, the answer is NOT to widen the threshold until it
// passes. It is to ask whether the palette change was intended, and to fix the
// palette or update BOTH the numbers and the prose in lib/colors.js. Widening
// a bound to keep a false claim alive is the exact failure mode CLAUDE.md warns
// about for the frozen-logic tests.

// The six INVESTED classes carry a hue. receivables/banks/other are neutral on
// purpose, and `debts` is a liability rather than an invested class, so none of
// them belong in the separation set.
const HUED = ['stocks', 'bonds', 'funds', 'crypto', 'realestate', 'alternatives']
const NEUTRAL = ['receivables', 'banks', 'other']
const huedEntries = HUED.map((k) => [k, CATEGORY[k].bg])

describe('asset-class palette: structure', () => {
  it('has exactly six hued classes, the documented ceiling', () => {
    // "Six is the ceiling here; a seventh hue cannot be added without dropping
    // one of these below the readable floor" (lib/colors.js).
    expect(HUED.length).toBe(6)
    HUED.forEach((k) => expect(CATEGORY[k]?.bg).toMatch(/^#[0-9a-fA-F]{6}$/))
  })

  it('uses no color twice', () => {
    const all = Object.values(CATEGORY).map((c) => c.bg.toLowerCase())
    expect(new Set(all).size).toBe(all.length)
  })

  it('CHART_PALETTE hands out only colors that exist in CATEGORY', () => {
    const known = new Set(Object.values(CATEGORY).map((c) => c.bg.toLowerCase()))
    CHART_PALETTE.forEach((hex) => expect(known.has(hex.toLowerCase())).toBe(true))
  })

  it('INVESTMENT_CLASS_COLORS reuses CATEGORY rather than inventing its own', () => {
    const known = new Set(Object.values(CATEGORY).map((c) => c.bg.toLowerCase()))
    Object.values(INVESTMENT_CLASS_COLORS).forEach((hex) => expect(known.has(hex.toLowerCase())).toBe(true))
  })
})

describe('asset-class palette: color space', () => {
  // Measured range today is L 0.5000 (realestate) to 0.6687 (crypto). The band
  // is a guard rail with real headroom on both sides, not a value retrofitted
  // to what happens to be there: below ~0.45 a fill loses definition against
  // the dark base #0A0A12, above ~0.75 against the light base #F8F9FB.
  it('every hued class sits in the lightness band that works in both themes', () => {
    HUED.forEach((k) => {
      const { L } = hexToOklch(CATEGORY[k].bg)
      expect(L).toBeGreaterThanOrEqual(0.45)
      expect(L).toBeLessThanOrEqual(0.75)
    })
  })

  it('every hued class clears the chroma floor', () => {
    // Lowest today is realestate at 0.1102. Below ~0.10 a "colored" class stops
    // reading as colored and starts competing with the neutrals.
    HUED.forEach((k) => {
      expect(hexToOklch(CATEGORY[k].bg).C).toBeGreaterThanOrEqual(0.10)
    })
  })

  it('the neutral classes stay neutral', () => {
    // They are deliberately grey. If one drifts into real chroma it starts
    // competing with the six that are supposed to carry meaning.
    NEUTRAL.forEach((k) => {
      expect(hexToOklch(CATEGORY[k].bg).C).toBeLessThanOrEqual(0.05)
    })
  })
})

describe('asset-class palette: separation in normal vision', () => {
  // This is the headline guarantee lib/colors.js documents, and it reproduces
  // exactly: the closest pair is bonds vs realestate at 18.10. The margin over
  // the floor is 0.10, so this is effectively frozen to today's palette. That
  // is the point: it is a regression guard, not a target to optimize.
  it('the closest pair clears deltaE 18', () => {
    const closest = closestPair(huedEntries, deltaE)
    expect(closest.distance).toBeGreaterThanOrEqual(18)
  })

  it('names bonds vs realestate as the closest pair', () => {
    // Asserted so a failure says WHAT moved instead of leaving the next person
    // to diff ten hexes by hand.
    expect(closestPair(huedEntries, deltaE).pair).toEqual(['bonds', 'realestate'])
  })
})

describe('asset-class palette: separation under colour vision deficiency', () => {
  // Measured with Viénot (1999), the stricter of the two standard models.
  //
  // What lib/colors.js used to claim: "the tightest colorblind pair (deep green
  // vs magenta) lands at deltaE 6". That is exactly right for DEUTERANOPIA
  // (realestate vs alternatives, 6.27) and wrong as a general statement, which
  // is why these are three separate tests with three honest numbers rather than
  // one blanket floor.
  it('protanopia keeps every pair above 8', () => {
    const closest = closestPair(huedEntries, (a, b) => deltaEUnderCvd(a, b, 'protan'))
    expect(closest.distance).toBeGreaterThanOrEqual(8)
    expect(closest.pair).toEqual(['funds', 'stocks'])
  })

  it('deuteranopia keeps every pair above 6, the documented figure', () => {
    const closest = closestPair(huedEntries, (a, b) => deltaEUnderCvd(a, b, 'deutan'))
    expect(closest.distance).toBeGreaterThanOrEqual(6)
    expect(closest.pair).toEqual(['alternatives', 'realestate'])
  })

  // Named on its own because its floor is genuinely lower, and pretending
  // otherwise would be the dishonest version of this test.
  //
  // Measured: alternatives vs funds at 3.27 (magenta vs purple, which
  // tritanopia flattens hard). It does NOT clear 6. Two reasons this ships as
  // a documented floor rather than a palette change: tritanopia prevalence is
  // roughly 0.01%, and lib/colors.js already commits to the mitigation that
  // matters more than any distance number: every surface that shows these
  // colors also prints the class name, so identity is never carried by color
  // alone. The floor of 3 exists to catch a regression, not to bless 3.27 as
  // comfortable.
  it('tritanopia: the tightest pair is 3.27, below the other two by design', () => {
    const closest = closestPair(huedEntries, (a, b) => deltaEUnderCvd(a, b, 'tritan'))
    expect(closest.distance).toBeGreaterThanOrEqual(3)
    expect(closest.pair).toEqual(['alternatives', 'funds'])
  })
})

describe('asset-class palette: known collisions with the semantic colors', () => {
  // Reported, not enforced. Fixing these means changing the palette, which is
  // a product decision, not something a test should force. They are pinned so
  // they cannot get quietly WORSE, and so the next person finds the numbers
  // instead of rediscovering them.
  //
  // SEMANTIC.warning vs crypto is 2.34: effectively the same orange. Worth
  // knowing that lib/colors.js congratulates itself on having fixed a milder
  // collision (realestate green vs profit green, which measures 9.76) while
  // this one sits undocumented.
  it('the semantic/category collisions are no worse than measured today', () => {
    expect(deltaE(SEMANTIC.warning, CATEGORY.crypto.bg)).toBeGreaterThanOrEqual(2.3)
    expect(deltaE(SEMANTIC.negative, CATEGORY.debts.bg)).toBeGreaterThanOrEqual(3.9)
    expect(deltaE(SEMANTIC.action, CATEGORY.stocks.bg)).toBeGreaterThanOrEqual(7.5)
  })

  it('profit green and real-estate green stay apart, the collision that WAS fixed', () => {
    expect(deltaE(SEMANTIC.positive, CATEGORY.realestate.bg)).toBeGreaterThanOrEqual(9)
  })
})
