import { computeLoadStages } from '@/lib/loadStages'

// Reload-animation-improvements plan, Fase 2. Pins the fix for the header
// refresh ring's permanent 33% floor on every refresh after the very first
// page load (dataLoading never re-arms once it resolves, so counting it as
// "1 of 3 stages" forever was fake progress).
describe('computeLoadStages', () => {
  it('counts every stage during the very first load, nothing resolved yet', () => {
    expect(computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true }))
      .toEqual({ done: 0, total: 3 })
  })

  it('with a benchmark stage, the very first load is 4 stages wide', () => {
    expect(computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }))
      .toEqual({ done: 0, total: 4 })
  })

  it('the first load resolves stage by stage without ever going backward', () => {
    const steps = [
      computeLoadStages({ dataLoading: true, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: true, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: true }),
      computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: false }),
    ]
    const pct = ({ done, total }) => Math.round((done / total) * 100)
    expect(steps.map(pct)).toEqual([0, 0, 33, 67, 100])
  })

  it('after the first load, a resolved dataLoading is never counted again — no artificial floor', () => {
    // Old inline expression ([!dataLoading, !ratesLoading, !pricesLoading].filter(Boolean).length / 3)
    // would report 1/3 (33%) here purely because dataLoading is permanently
    // false post-mount, even though nothing real has resolved yet.
    expect(computeLoadStages({ dataLoading: false, ratesLoading: true, pricesLoading: true }))
      .toEqual({ done: 0, total: 2 })
  })

  it('a later refresh still reaches a genuine 100%', () => {
    expect(computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: false }))
      .toEqual({ done: 2, total: 2 })
  })

  it('benchmarkLoading omitted entirely does not count as a stage (pre-Fase-3 callers)', () => {
    expect(computeLoadStages({ dataLoading: false, ratesLoading: false, pricesLoading: true }))
      .toEqual({ done: 1, total: 2 })
  })

  // The core correctness claim: dropping an already-resolved stage from the
  // denominator can only raise or hold the percentage, never lower it —
  // checked across every combination of what else is still in flight at the
  // exact moment dataLoading flips from true to false.
  it('the dataLoading true→false transition is monotonic non-decreasing for any state of the other stages', () => {
    const others = [
      { ratesLoading: true, pricesLoading: true, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: true, benchmarkLoading: true },
      { ratesLoading: true, pricesLoading: false, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: false, benchmarkLoading: true },
      { ratesLoading: false, pricesLoading: false, benchmarkLoading: false },
      { ratesLoading: true, pricesLoading: true },
    ]
    for (const rest of others) {
      const before = computeLoadStages({ dataLoading: true, ...rest })
      const after = computeLoadStages({ dataLoading: false, ...rest })
      const pct = ({ done, total }) => done / total
      expect(pct(after)).toBeGreaterThanOrEqual(pct(before))
    }
  })

  // Antes devolvía {done:2,total:2} porque `ratesLoading` y `pricesLoading`
  // entraban SIEMPRE a la lista y `undefined` es falsy, o sea contaban como dos
  // etapas ya resueltas. Sin banderas no hay etapas, y el consumidor lee un
  // total de 0 como "sin porcentaje" (`loadStagesTotal > 0 ? ... : null` en
  // Header.jsx y en PullToRefresh.jsx) y dibuja un barrido indeterminado, que
  // es la respuesta honesta.
  it('sin banderas no hay etapas, en vez de inventar dos ya resueltas', () => {
    expect(computeLoadStages()).toEqual({ done: 0, total: 0 })
  })
})

// FASE JG. Una pantalla puede tener MENOS etapas que el tablero, y el helper
// tiene que poder decirlo. Finanzas no carga precios de mercado: su único
// trabajo re-ejecutable son las tasas de cambio.
describe('computeLoadStages en una pantalla con menos etapas (Finanzas)', () => {
  it('la primera carga cuenta datos + tasas', () => {
    expect(computeLoadStages({ dataLoading: true, ratesLoading: true }))
      .toEqual({ done: 0, total: 2 })
  })

  it('un refresco posterior arranca en CERO, no en el 50% de antes', () => {
    // La expresión inline que tenía la página ([!dataLoading, !ratesLoading]
    // sobre un total fijo de 2) reportaba 1/2 acá, puramente porque
    // `dataLoading` es false para siempre después del primer montaje, aunque
    // nada real hubiera resuelto todavía.
    expect(computeLoadStages({ dataLoading: false, ratesLoading: true }))
      .toEqual({ done: 0, total: 1 })
  })

  it('y llega a un 100% genuino', () => {
    expect(computeLoadStages({ dataLoading: false, ratesLoading: false }))
      .toEqual({ done: 1, total: 1 })
  })

  it('una bandera ausente NO cuenta como etapa resuelta', () => {
    // El error fácil: pasar `pricesLoading: undefined` al helper viejo movía el
    // piso de lugar en vez de quitarlo, porque undefined es falsy.
    expect(computeLoadStages({ dataLoading: false, ratesLoading: true, pricesLoading: undefined }))
      .toEqual(computeLoadStages({ dataLoading: false, ratesLoading: true }))
  })
})

// El helper es compartido con el tablero, así que el cambio de arriba tiene que
// ser una GENERALIZACIÓN estricta: con las cuatro banderas booleanas, cada
// resultado es el mismo de antes. Este test es el que lo fija.
describe('el tablero no cambia de comportamiento', () => {
  const CASES = [
    [{ dataLoading: true, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }, { done: 0, total: 4 }],
    [{ dataLoading: false, ratesLoading: true, pricesLoading: true, benchmarkLoading: true }, { done: 0, total: 3 }],
    [{ dataLoading: false, ratesLoading: false, pricesLoading: true, benchmarkLoading: true }, { done: 1, total: 3 }],
    [{ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: true }, { done: 2, total: 3 }],
    [{ dataLoading: false, ratesLoading: false, pricesLoading: false, benchmarkLoading: false }, { done: 3, total: 3 }],
  ]
  CASES.forEach(([input, expected]) => {
    it(`${JSON.stringify(input)} sigue dando ${JSON.stringify(expected)}`, () => {
      expect(computeLoadStages(input)).toEqual(expected)
    })
  })
})
