// Color math for the palette guard (lib/__tests__/palette.test.js).
//
// lib/colors.js documents that the asset-class palette was picked in OKLCH and
// checked against a perceptual-distance floor. That check was real but it was
// run ONCE, by hand, with an external tool: `scripts/` does not exist in this
// repo, there is no npm task, no hook and no test. The guarantee lived only in
// prose, so nothing would have failed if someone raised a hue's chroma
// tomorrow. This module is the math that makes it enforceable here.
//
// No color library is installed, so every conversion is spelled out. Sources:
// the OKLab matrices are Björn Ottosson's published constants; the colour
// vision deficiency matrices are Viénot, Brettel & Mollon (1999). All pure
// functions, no dependencies, deliberately small enough to audit in review.

// --- sRGB ------------------------------------------------------------------

export function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  }
}

// sRGB transfer function. The 0.04045 knee is the actual piecewise definition,
// not the 2.2 approximation: at these chroma levels the difference is large
// enough to move a deltaE by a few tenths, and the thresholds below are tight.
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

// --- OKLab / OKLCH ---------------------------------------------------------

export function linearRgbToOklab({ r, g, b }) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

export function hexToOklab(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return linearRgbToOklab({ r: srgbToLinear(rgb.r), g: srgbToLinear(rgb.g), b: srgbToLinear(rgb.b) })
}

export function hexToOklch(hex) {
  const lab = hexToOklab(hex)
  if (!lab) return null
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L: lab.L, C, h }
}

// Euclidean distance in OKLab, x100. OKLab is designed so that euclidean
// distance approximates perceptual difference, which is exactly why the
// palette was authored in it. The x100 scale is what makes the documented
// figure read as "18" rather than "0.18".
export function deltaE(hexA, hexB) {
  const a = hexToOklab(hexA)
  const b = hexToOklab(hexB)
  if (!a || !b) return null
  const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db) * 100
}

// --- Colour vision deficiency ---------------------------------------------

// Viénot, Brettel & Mollon (1999). The simulation is a projection onto the
// dichromat's reduced colour plane, and that projection is defined in LMS
// cone space, NOT in RGB: it has to be RGB -> LMS -> project -> RGB. Applying
// the projection coefficients straight to RGB channels is a real and easy
// mistake (it barely moves red vs green, which is the one thing protanopia is
// supposed to collapse) and the "greys survive / red-green collapses" tests in
// colorMath.test.js exist to catch exactly that.
//
// Chosen over Machado (2009) deliberately: it is the STRICTER of the two on
// this palette, so the guard is the harder test rather than the flattering one.

// Hunt-Pointer-Estevez style RGB <-> LMS pair used by the Viénot method.
const RGB_TO_LMS = [
  17.8824, 43.5161, 4.11935,
  3.45565, 27.1554, 3.86714,
  0.0299566, 0.184309, 1.46709,
]
const LMS_TO_RGB = [
  0.0809444479, -0.130504409, 0.116721066,
  -0.0102485335, 0.0540193266, -0.113614708,
  -0.000365296938, -0.00412161469, 0.693511405,
]

// Each dichromacy drops one cone and reconstructs its response from the other
// two, which is why exactly one row differs from the identity.
const PROJECT = {
  protan: ([L, M, S]) => [2.02344 * M - 2.52581 * S, M, S],
  deutan: ([L, M, S]) => [L, 0.494207 * L + 1.24827 * S, S],
  tritan: ([L, M, S]) => [L, M, -0.395913 * L + 0.801109 * M],
}

function apply3(m, [x, y, z]) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ]
}

export function simulateCvd(hex, type) {
  const project = PROJECT[type]
  const rgb = hexToRgb(hex)
  if (!project || !rgb) return null
  const lin = [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)]
  const out = apply3(LMS_TO_RGB, project(apply3(RGB_TO_LMS, lin)))
    .map((v) => Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function deltaEUnderCvd(hexA, hexB, type) {
  const a = simulateCvd(hexA, type)
  const b = simulateCvd(hexB, type)
  if (!a || !b) return null
  return deltaE(a, b)
}

// --- WCAG contrast ---------------------------------------------------------

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  if (la == null || lb == null) return null
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// --- Helpers used by the palette guard ------------------------------------

// Closest pair by a given distance function. Returns the pair too, not just
// the number: a threshold failure that does not name what moved sends the
// next person hunting through ten hexes by hand.
export function closestPair(entries, distance) {
  let best = null
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = distance(entries[i][1], entries[j][1])
      if (d == null) continue
      if (!best || d < best.distance) {
        best = { distance: d, pair: [entries[i][0], entries[j][0]].sort() }
      }
    }
  }
  return best
}
