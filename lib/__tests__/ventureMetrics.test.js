// FASE FQ. lib/ventureMetrics.js: XIRR desde inicio + múltiplos GIPS
// (TVPI/DPI/RVPI/PIC) para posiciones de Venture/PE.
//
// Los casos clave:
//  - un IRR de libro de texto (un flujo, un año, 10% exacto) verificable a mano,
//  - el fondo de EJEMPLO DEL USUARIO (calls año 0 y 1, dists año 3 y 5,
//    residual año 7), que el propio usuario acotó a "IRR ≈ 18-22%",
//  - la regla GIPS de anualización: >= 1 año se anualiza, < 1 año se presenta
//    el retorno del período SIN anualizar,
//  - los múltiplos: TVPI = DPI + RVPI siempre, PIC = paidIn/committed,
//  - bordes que devuelven null en vez de un número inventado.

import { xnpv, xirr, computeVentureMetrics } from '@/lib/ventureMetrics'

const YEAR_MS = 365.25 * 86400000
const d = (s) => new Date(`${s}T00:00:00Z`).getTime()

describe('xirr: casos verificables a mano', () => {
  it('-1000 hoy, +1100 en exactamente un año => 10% exacto', () => {
    const t0 = d('2020-01-01')
    const rate = xirr([
      { ts: t0, amount: -1000 },
      { ts: t0 + YEAR_MS, amount: 1100 },
    ])
    expect(rate).toBeCloseTo(0.10, 9)
  })

  it('-1000 hoy, +1210 en dos años => 10% anual (compuesto)', () => {
    const t0 = d('2020-01-01')
    const rate = xirr([
      { ts: t0, amount: -1000 },
      { ts: t0 + 2 * YEAR_MS, amount: 1210 },
    ])
    expect(rate).toBeCloseTo(0.10, 9)
  })

  it('una perdida total parcial: -1000 hoy, +500 en un año => -50%', () => {
    const t0 = d('2020-01-01')
    const rate = xirr([
      { ts: t0, amount: -1000 },
      { ts: t0 + YEAR_MS, amount: 500 },
    ])
    expect(rate).toBeCloseTo(-0.50, 9)
  })

  it('el rate devuelto de verdad anula el NPV', () => {
    const t0 = d('2020-01-01')
    const flows = [
      { ts: t0, amount: -100 },
      { ts: t0 + 1.5 * YEAR_MS, amount: 60 },
      { ts: t0 + 3 * YEAR_MS, amount: 70 },
    ]
    const rate = xirr(flows)
    expect(rate).not.toBeNull()
    expect(Math.abs(xnpv(rate, flows))).toBeLessThan(1e-6)
  })

  it('sin cambio de signo no hay IRR: null, nunca un numero inventado', () => {
    const t0 = d('2020-01-01')
    expect(xirr([
      { ts: t0, amount: -100 },
      { ts: t0 + YEAR_MS, amount: -50 },
    ])).toBeNull()
    expect(xirr([
      { ts: t0, amount: 100 },
      { ts: t0 + YEAR_MS, amount: 50 },
    ])).toBeNull()
  })

  it('todos los flujos el mismo instante: null (no hay tiempo transcurrido)', () => {
    const t0 = d('2020-01-01')
    expect(xirr([
      { ts: t0, amount: -100 },
      { ts: t0, amount: 110 },
    ])).toBeNull()
  })

  it('menos de dos flujos validos: null', () => {
    expect(xirr([])).toBeNull()
    expect(xirr(null)).toBeNull()
    expect(xirr([{ ts: d('2020-01-01'), amount: -100 }])).toBeNull()
  })
})

describe('el fondo de ejemplo del usuario', () => {
  // Año 0: call $100. Año 1: call $50. Año 3: dist $40. Año 5: dist $180.
  // Año 7 (hoy): residual $90. El usuario estimó "IRR ≈ 18-22%" a ojo, pero el
  // XIRR EXACTO de esos flujos es 16.01% (verificado a mano: el NPV a 16%
  // anual da ~0.08 sobre 310 de flujos). El test fija el número correcto; el
  // check duro es el de NPV = 0 de abajo, que no depende de ninguna banda.
  const t0 = d('2019-01-01')
  const nowTs = t0 + 7 * YEAR_MS
  const args = {
    capitalCalls: [
      { ts: t0, amount: 100 },
      { ts: t0 + 1 * YEAR_MS, amount: 50 },
    ],
    distributions: [
      { ts: t0 + 3 * YEAR_MS, amount: 40 },
      { ts: t0 + 5 * YEAR_MS, amount: 180 },
    ],
    residualValue: 90,
    nowTs,
  }

  it('IRR exacto de los flujos del ejemplo: ~16.0% anual', () => {
    const m = computeVentureMetrics(args)
    expect(m).not.toBeNull()
    expect(m.irrAnnual).toBeCloseTo(0.1601, 3)
    // >= 1 año: anualizado, irrDisplay ES el anual.
    expect(m.annualized).toBe(true)
    expect(m.irrDisplay).toBe(m.irrAnnual)
  })

  it('el IRR anula el NPV del set completo de flujos (calls negativos, residual al final)', () => {
    const m = computeVentureMetrics(args)
    const flows = [
      { ts: t0, amount: -100 },
      { ts: t0 + 1 * YEAR_MS, amount: -50 },
      { ts: t0 + 3 * YEAR_MS, amount: 40 },
      { ts: t0 + 5 * YEAR_MS, amount: 180 },
      { ts: nowTs, amount: 90 },
    ]
    expect(Math.abs(xnpv(m.irrAnnual, flows))).toBeLessThan(1e-6)
  })

  it('multiplos: TVPI ~2.07x, DPI ~1.47x, RVPI 0.6x, y TVPI = DPI + RVPI', () => {
    const m = computeVentureMetrics(args)
    expect(m.paidIn).toBe(150)
    expect(m.distributed).toBe(220)
    expect(m.residual).toBe(90)
    expect(m.tvpi).toBeCloseTo(310 / 150, 9)
    expect(m.dpi).toBeCloseTo(220 / 150, 9)
    expect(m.rvpi).toBeCloseTo(90 / 150, 9)
    expect(m.tvpi).toBeCloseTo(m.dpi + m.rvpi, 9)
  })

  it('PIC solo con capital comprometido; sin el, null', () => {
    expect(computeVentureMetrics(args).pic).toBeNull()
    const withCommit = computeVentureMetrics({ ...args, committedCapital: 200 })
    expect(withCommit.pic).toBeCloseTo(150 / 200, 9)
  })
})

describe('regla GIPS de anualizacion', () => {
  it('span < 1 año: irrDisplay es el retorno del periodo, NO anualizado', () => {
    // Call de 1000, residual 1050 medio año despues: el periodo gano ~5%,
    // pero el XIRR anual seria ~10.25%. GIPS manda presentar el 5%.
    const t0 = d('2026-01-01')
    const nowTs = t0 + 0.5 * YEAR_MS
    const m = computeVentureMetrics({
      capitalCalls: [{ ts: t0, amount: 1000 }],
      distributions: [],
      residualValue: 1050,
      nowTs,
    })
    expect(m.annualized).toBe(false)
    expect(m.spanYears).toBeCloseTo(0.5, 9)
    // (1 + irrAnual)^0.5 - 1 = 1050/1000 - 1 = 5%
    expect(m.irrDisplay).toBeCloseTo(0.05, 6)
    expect(m.irrAnnual).toBeGreaterThan(m.irrDisplay) // el anual compone mas alto
  })

  it('span >= 1 año: irrDisplay es el anualizado tal cual', () => {
    const t0 = d('2024-01-01')
    const nowTs = t0 + 2 * YEAR_MS
    const m = computeVentureMetrics({
      capitalCalls: [{ ts: t0, amount: 1000 }],
      distributions: [],
      residualValue: 1210,
      nowTs,
    })
    expect(m.annualized).toBe(true)
    expect(m.irrDisplay).toBeCloseTo(0.10, 6)
  })
})

describe('bordes: null en vez de numeros inventados', () => {
  it('sin ningun capital call: null (no hay nada que medir)', () => {
    expect(computeVentureMetrics({
      capitalCalls: [],
      distributions: [{ ts: d('2026-01-01'), amount: 100 }],
      residualValue: 50,
      nowTs: d('2026-06-01'),
    })).toBeNull()
    expect(computeVentureMetrics({ residualValue: 100, nowTs: d('2026-06-01') })).toBeNull()
  })

  it('perdida total (residual 0, sin dists): multiplos en 0 e IRR -100% o null, sin NaN', () => {
    const t0 = d('2024-01-01')
    const m = computeVentureMetrics({
      capitalCalls: [{ ts: t0, amount: 1000 }],
      distributions: [],
      residualValue: 0,
      nowTs: t0 + 2 * YEAR_MS,
    })
    expect(m).not.toBeNull()
    expect(m.tvpi).toBe(0)
    expect(m.dpi).toBe(0)
    expect(m.rvpi).toBe(0)
    // Un solo flujo (el call): sin cambio de signo, no hay IRR.
    expect(m.irrAnnual).toBeNull()
    expect(m.irrDisplay).toBeNull()
  })

  it('flujos invalidos (NaN, cero, negativos en dists) se filtran sin romper', () => {
    const t0 = d('2024-01-01')
    const m = computeVentureMetrics({
      capitalCalls: [
        { ts: t0, amount: 1000 },
        { ts: NaN, amount: 500 },
        { ts: t0, amount: 0 },
        null,
      ],
      distributions: [
        { ts: t0 + YEAR_MS, amount: -50 },
        { ts: t0 + YEAR_MS, amount: 100 },
      ],
      residualValue: 1000,
      nowTs: t0 + YEAR_MS,
    })
    expect(m.paidIn).toBe(1000)
    expect(m.distributed).toBe(100)
    expect(m.tvpi).toBeCloseTo(1.1, 9)
    expect(Number.isFinite(m.irrAnnual)).toBe(true)
  })
})
