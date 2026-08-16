import {
  hexToRgb, srgbToLinear, hexToOklab, hexToOklch, deltaE, simulateCvd,
  deltaEUnderCvd, contrastRatio, closestPair,
} from '@/lib/colorMath'

// These converters exist to make lib/__tests__/palette.test.js meaningful.
// Without this file that test could pass for the wrong reason: a subtly wrong
// matrix produces numbers, and numbers above a threshold look like a green
// test. Every assertion here is against a value that is known independently of
// the implementation.
describe('hexToRgb', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('accepts shorthand and a missing hash', () => {
    expect(hexToRgb('fff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb('#fff')).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('rejects anything that is not a hex color', () => {
    expect(hexToRgb('rebeccapurple')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb(null)).toBeNull()
  })
})

describe('srgbToLinear', () => {
  // The endpoints are fixed points of the transfer function, and 0.5 has a
  // published linear value. Checking the knee matters because using the 2.2
  // approximation instead would pass an endpoints-only test.
  it('holds the endpoints', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 10)
  })

  it('uses the piecewise curve, not a plain 2.2 gamma', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 3)
    expect(srgbToLinear(0.5)).not.toBeCloseTo(Math.pow(0.5, 2.2), 3)
  })
})

describe('hexToOklch', () => {
  it('white is L=1 with no chroma', () => {
    const w = hexToOklch('#FFFFFF')
    expect(w.L).toBeCloseTo(1, 3)
    expect(w.C).toBeCloseTo(0, 3)
  })

  it('black is L=0', () => {
    expect(hexToOklch('#000000').L).toBeCloseTo(0, 6)
  })

  it('greys carry no chroma at any lightness', () => {
    for (const g of ['#404040', '#808080', '#C0C0C0']) {
      expect(hexToOklch(g).C).toBeCloseTo(0, 3)
    }
  })

  it('puts primaries in the right hue quadrants', () => {
    // Red near 29deg, green near 142deg, blue near 264deg in OKLCH.
    expect(hexToOklch('#FF0000').h).toBeCloseTo(29, 0)
    expect(hexToOklch('#00FF00').h).toBeCloseTo(142, 0)
    expect(hexToOklch('#0000FF').h).toBeCloseTo(264, 0)
  })
})

describe('deltaE', () => {
  it('a color is zero distance from itself', () => {
    expect(deltaE('#2C67DC', '#2C67DC')).toBe(0)
  })

  it('is symmetric', () => {
    expect(deltaE('#2C67DC', '#08A8AF')).toBeCloseTo(deltaE('#08A8AF', '#2C67DC'), 10)
  })

  it('black to white is the full lightness range, x100', () => {
    expect(deltaE('#000000', '#FFFFFF')).toBeCloseTo(100, 0)
  })

  it('ranks an obviously closer pair below an obviously farther one', () => {
    const nearlyIdentical = deltaE('#2C67DC', '#2C67DD')
    const opposites = deltaE('#2C67DC', '#E07227')
    expect(nearlyIdentical).toBeLessThan(1)
    expect(opposites).toBeGreaterThan(nearlyIdentical)
  })
})

describe('simulateCvd', () => {
  it('leaves greys alone: they carry no colour information to lose', () => {
    // Any achromatic input must survive all three simulations essentially
    // unchanged. A matrix applied to the wrong (gamma-encoded) values fails
    // this, which is what makes it a useful check.
    for (const type of ['protan', 'deutan', 'tritan']) {
      const out = simulateCvd('#808080', type)
      expect(deltaE('#808080', out)).toBeLessThan(1)
    }
  })

  // The red-green collapse shows up in HUE, not in total distance. A protanope
  // still separates pure red from pure green easily, but by brightness: red
  // simulates to a dark olive (L 0.47) and green to a bright yellow (L 0.93),
  // and both land on the same hue. Asserting on total deltaE here would fail
  // against a perfectly correct simulation, because lightness is doing the work.
  it('collapses red and green onto one hue for protanopia', () => {
    const red = hexToOklch(simulateCvd('#FF0000', 'protan'))
    const green = hexToOklch(simulateCvd('#00FF00', 'protan'))
    expect(Math.abs(red.h - green.h)).toBeLessThan(2)
    // Normal vision keeps them ~113 degrees apart.
    expect(Math.abs(hexToOklch('#FF0000').h - hexToOklch('#00FF00').h)).toBeGreaterThan(100)
  })

  it('collapses the chromatic separation of red and green by protanopia', () => {
    const chromaticGap = (a, b) => {
      const A = hexToOklab(a), B = hexToOklab(b)
      return Math.hypot(A.a - B.a, A.b - B.b) * 100
    }
    const normal = chromaticGap('#FF0000', '#00FF00')
    const protan = chromaticGap(simulateCvd('#FF0000', 'protan'), simulateCvd('#00FF00', 'protan'))
    expect(protan).toBeLessThan(normal / 3)
  })

  it('returns null for an unknown deficiency rather than a silent passthrough', () => {
    expect(simulateCvd('#FF0000', 'nope')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('black on white is the WCAG maximum of 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  })

  it('a color against itself is 1', () => {
    expect(contrastRatio('#2C67DC', '#2C67DC')).toBeCloseTo(1, 6)
  })

  it('is order independent', () => {
    expect(contrastRatio('#111827', '#F8F9FB')).toBeCloseTo(contrastRatio('#F8F9FB', '#111827'), 10)
  })
})

describe('closestPair', () => {
  it('names the pair, not just the distance', () => {
    const got = closestPair(
      [['a', '#000000'], ['b', '#FFFFFF'], ['c', '#FEFEFE']],
      deltaE
    )
    expect(got.pair).toEqual(['b', 'c'])
    expect(got.distance).toBeLessThan(1)
  })

  it('returns null when there is no pair to compare', () => {
    expect(closestPair([['a', '#000000']], deltaE)).toBeNull()
  })
})
