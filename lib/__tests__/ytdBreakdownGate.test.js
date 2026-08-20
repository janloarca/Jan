import { breakdownReconciles } from '../ytdBreakdownGate'

describe('breakdownReconciles', () => {
  test('rejects the real case that shipped: parts claim 15x the headline', () => {
    // Exactly what the user was shown: the panel summed +$12,835.82 (IBKR alone
    // +$13,207.59) while the YTD headline above it read +$835.36.
    expect(breakdownReconciles(12835.82, 835.36)).toBe(false)
  })

  test('accepts an exact match', () => {
    expect(breakdownReconciles(835.36, 835.36)).toBe(true)
  })

  test('accepts normal drift between the two reconstruction paths', () => {
    // 5% off: the two engines rarely agree to the cent, and that is fine.
    expect(breakdownReconciles(877.13, 835.36)).toBe(true)
  })

  test('rejects once the drift stops being drift', () => {
    // 20% off on a $835 headline is $167 the panel cannot account for.
    expect(breakdownReconciles(1002.43, 835.36)).toBe(false)
  })

  test('near-zero headline still gets a workable absolute window', () => {
    // A proportional-only tolerance would be ~$0.12 here and would suppress the
    // panel over rounding noise.
    expect(breakdownReconciles(3.4, 1.2)).toBe(true)
    expect(breakdownReconciles(60, 1.2)).toBe(false)
  })

  test('works the same for losses', () => {
    expect(breakdownReconciles(-820, -835.36)).toBe(true)
    expect(breakdownReconciles(820, -835.36)).toBe(false)
  })

  test('no headline to contradict means nothing to gate', () => {
    expect(breakdownReconciles(1234, null)).toBe(true)
    expect(breakdownReconciles(1234, undefined)).toBe(true)
    expect(breakdownReconciles(1234, NaN)).toBe(true)
  })

  test('a non-finite total can never be shown', () => {
    expect(breakdownReconciles(NaN, 835.36)).toBe(false)
    expect(breakdownReconciles(Infinity, 835.36)).toBe(false)
    expect(breakdownReconciles(null, 835.36)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FASE IE: el arranque del broker despejado del ancla.
// ─────────────────────────────────────────────────────────────────────────────
import { deriveBrokerStart, attributeYtd } from '../ytdAttribution'

describe('deriveBrokerStart', () => {
  test('el caso real del usuario: despeja el NAV del broker y el reparto cuadra', () => {
    // Números exactos de su captura (14 ago 2026).
    const anchor = 11856.08
    const manual = {
      IDC: 3539.27, OSMO: 0, LEGDER: 1006.30,
      'Banco Industrial': 602.17, ClubCashIn: 641.81,
    }
    const derived = deriveBrokerStart({ anchor, manualStarts: Object.values(manual) })
    // 11,856.08 - 5,789.55 = 6,066.53 (el estimado por precios daba 7,174: esa
    // diferencia de ~1,107 ERA el residuo que hacia rehusar el panel).
    expect(derived).toBeCloseTo(6066.53, 2)

    const accounts = [
      { key: 'idc', name: 'IDC', start: manual.IDC, endVal: 9843.64, flow: 5934.48, flowBase: 5934.48 },
      { key: 'osmo', name: 'OSMO', start: manual.OSMO, endVal: 112.92, flow: 143.53, flowBase: 143.53 },
      { key: 'legder', name: 'LEGDER', start: manual.LEGDER, endVal: 1006.30, flow: 0, flowBase: 0 },
      { key: 'bi', name: 'Banco Industrial', start: manual['Banco Industrial'], endVal: 4741.08, flow: 4139.00, flowBase: 4139.00 },
      { key: 'cci', name: 'ClubCashIn', start: manual.ClubCashIn, endVal: 1571.65, flow: 864.87, flowBase: 864.87 },
      { key: 'ibkr', name: 'Interactive Brokers', start: derived, endVal: 9993.15, flow: 3945.00, flowBase: 3945.00, startIsReal: true },
    ]
    const headlineGain = 409.43
    const out = attributeYtd({ accounts, portfolioStart: anchor, headlineGain })
    expect(out).not.toBeNull()
    // Las filas mostradas suman el encabezado, que es la garantia del panel.
    const shown = out.groups.reduce((s, g) => s + g.gain, 0)
    expect(shown).toBeCloseTo(headlineGain, 2)
  })

  test('con el arranque estimado por precios el mismo caso REHUSA (regresion negativa)', () => {
    const anchor = 11856.08
    const accounts = [
      { key: 'idc', name: 'IDC', start: 3539.27, endVal: 9843.64, flow: 5934.48, flowBase: 5934.48 },
      { key: 'osmo', name: 'OSMO', start: 0, endVal: 112.92, flow: 143.53, flowBase: 143.53 },
      { key: 'legder', name: 'LEGDER', start: 1006.30, endVal: 1006.30, flow: 0, flowBase: 0 },
      { key: 'bi', name: 'Banco Industrial', start: 602.17, endVal: 4741.08, flow: 4139.00, flowBase: 4139.00 },
      { key: 'cci', name: 'ClubCashIn', start: 641.81, endVal: 1571.65, flow: 864.87, flowBase: 864.87 },
      { key: 'ibkr', name: 'Interactive Brokers', start: 7174.00, endVal: 9993.15, flow: 3945.00, flowBase: 3945.00 },
    ]
    const diag = {}
    expect(attributeYtd({ accounts, portfolioStart: anchor, headlineGain: 409.43 }, diag)).toBeNull()
    expect(diag.reason).toBe('unexplained-too-large')
  })

  test('rehusa antes que inventar: sin ancla, sin cuentas manuales, o despeje negativo', () => {
    expect(deriveBrokerStart({ anchor: 0, manualStarts: [100] })).toBeNull()
    expect(deriveBrokerStart({ anchor: 1000, manualStarts: [] })).toBeNull()
    // Los arranques manuales solos ya exceden el ancla: el problema esta en
    // otro lado y este atajo lo taparia.
    expect(deriveBrokerStart({ anchor: 1000, manualStarts: [700, 500] })).toBeNull()
    expect(deriveBrokerStart({ anchor: 1000, manualStarts: [700, NaN] })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FASE IF: elegir el punto con desglose que cae en el ancla.
// ─────────────────────────────────────────────────────────────────────────────
import { pickAnchorBreakdown } from '../ytdAttribution'

describe('pickAnchorBreakdown', () => {
  const pts = [
    { ts: 100, total: 0, byKey: { a: 0 } },
    { ts: 200, total: 500, byKey: { a: 500 } },
    { ts: 300, total: 700, byKey: { a: 700 } },
  ]

  test('el ancla NO tiene que ser el primer punto de la serie (el bug que mandaba todo a los respaldos)', () => {
    // Ancla en 200: la version vieja exigia withKeys[0].ts === anchorTs, veia
    // 100 !== 200 y descartaba el desglose entero.
    const out = pickAnchorBreakdown(pts, 200)
    expect(out).not.toBeNull()
    expect(out.start).toEqual({ a: 500 })
    expect(out.end).toEqual({ a: 700 })
  })

  test('mide EXACTAMENTE en el ancla, nunca en un punto cercano', () => {
    expect(pickAnchorBreakdown(pts, 250)).toBeNull()
  })

  test('sin al menos dos puntos con desglose no afirma nada', () => {
    expect(pickAnchorBreakdown([{ ts: 200, total: 500, byKey: { a: 500 } }], 200)).toBeNull()
    expect(pickAnchorBreakdown([{ ts: 200, total: 500 }, { ts: 300, total: 700 }], 200)).toBeNull()
  })

  test('entradas invalidas devuelven null en vez de romper', () => {
    expect(pickAnchorBreakdown(null, 200)).toBeNull()
    expect(pickAnchorBreakdown(pts, null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FASE IJ: el movimiento interno viaja con la fila, sin tocar la matematica.
// ─────────────────────────────────────────────────────────────────────────────
describe('movimiento interno por cuenta', () => {
  const accounts = [
    { key: 'a', name: 'LEGDER', start: 1678.03, endVal: 1007.79, flow: -451.62, flowBase: -451.62, internal: -451.62 },
    { key: 'b', name: 'IBKR', start: 5427.00, endVal: 9960.01, flow: 4312.18, flowBase: 4312.18, internal: 367.18 },
  ]
  const portfolioStart = 7105.03
  // gain(a) = 1007.79 - 1678.03 + 451.62 = -218.62 (el numero del panel)
  // gain(b) = 9960.01 - 5427.00 - 4312.18 = 220.83
  const headlineGain = -218.62 + 220.83

  test('la fila lleva el monto interno y la ganancia NO lo suma dos veces', () => {
    const out = attributeYtd({ accounts, portfolioStart, headlineGain })
    expect(out).not.toBeNull()
    const legder = out.groups.find((g) => g.name === 'LEGDER')
    expect(legder.internal).toBeCloseTo(-451.62, 2)
    // La identidad de siempre: gain = end - start - flow. El internal es SOLO
    // informativo, ya viene incluido dentro de flow.
    expect(legder.gain).toBeCloseTo(1007.79 - 1678.03 - (-451.62), 2)
  })

  test('una cuenta sin movimientos internos reporta 0, no undefined', () => {
    const out = attributeYtd({
      accounts: [{ key: 'c', name: 'IDC', start: 100, endVal: 110, flow: 0, flowBase: 0 }],
      portfolioStart: 100, headlineGain: 10,
    })
    expect(out.groups[0].internal).toBe(0)
  })
})
