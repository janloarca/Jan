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
