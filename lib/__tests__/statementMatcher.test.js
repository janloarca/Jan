import { matchStatement, normalizeDesc, descSimilarity } from '../statementMatcher'

const p = (date, amount, description, over = {}) => ({ date, amount, type: 'EXPENSE', description, ...over })

describe('normalizeDesc / descSimilarity', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeDesc('  Café  "El Ratón" #123 ')).toBe('cafe el raton 123')
  })
  it('token overlap survives truncation and reorder', () => {
    expect(descSimilarity('WALMART HIPER LOS PROCERES', 'walmart proceres')).toBeGreaterThanOrEqual(0.5)
    expect(descSimilarity('Pago Netflix', 'NETFLIX.COM 866-579')).toBeGreaterThanOrEqual(0.5)
    expect(descSimilarity('Uber viaje', 'Farmacia Galeno')).toBe(0)
  })
})

describe('matchStatement', () => {
  const existing = [
    p('2026-07-03', 250.5, 'Supermercado Paiz zona 10', { source: 'manual' }),
    p('2026-07-05', 89.99, 'Netflix', { source: 'manual' }),
    p('2026-07-08', 1200, 'Renta oficina', { source: 'manual', reference: 'REF-777' }),
    p('2026-07-12', 45, 'Gasolina Shell', { source: 'bi_import', reference: 'BI-001' }),
  ]

  it('exact: same day + same amount + similar description → skipped', () => {
    const parsed = [p('2026-07-03', 250.5, 'PAIZ Z.10 GUATEMALA')]
    const r = matchStatement(parsed, existing)
    expect(r.exact).toHaveLength(1)
    expect(r.newTxs).toHaveLength(0)
    expect(r.likely).toHaveLength(0)
  })

  it('exact: reference equality wins regardless of description', () => {
    const parsed = [p('2026-07-08', 1200, 'TRANSFERENCIA SALIENTE', { reference: 'REF-777' })]
    const r = matchStatement(parsed, existing)
    expect(r.exact).toHaveLength(1)
    expect(r.exact[0].match.reference).toBe('REF-777')
  })

  it('likely: same amount within 3 days with similar description → review bucket', () => {
    const parsed = [p('2026-07-07', 89.99, 'NETFLIX.COM')]
    const r = matchStatement(parsed, existing)
    expect(r.likely).toHaveLength(1)
    expect(r.newTxs).toHaveLength(0)
  })

  it('likely: same day + same amount but unrelated description → review, not auto-add', () => {
    const parsed = [p('2026-07-05', 89.99, 'CARGO SIN DETALLE')]
    const r = matchStatement(parsed, existing)
    expect(r.likely).toHaveLength(1)
  })

  it('new: nothing similar exists', () => {
    const parsed = [p('2026-07-20', 333.33, 'Farmacia Galeno')]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(1)
  })

  it('different type never matches (INCOME vs EXPENSE, same amount/day)', () => {
    const parsed = [p('2026-07-03', 250.5, 'PAIZ Z.10', { type: 'INCOME' })]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(1)
  })

  it('amount off by a centavo does not match', () => {
    const parsed = [p('2026-07-03', 250.51, 'Supermercado Paiz zona 10')]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(1)
  })

  // Dos filas idénticas sin referencia siguen colapsando (no hay con qué
  // distinguirlas), pero ya NO caen en `exact`: van a `repeats`, que la UI
  // ofrece con checkbox. Dos Uber de Q75 el mismo día son cobros reales, y
  // antes se descartaban bajo el rótulo "Ya registradas", que era falso porque
  // nunca se registraron, sin ninguna ruta en la app para recuperarlas.
  it('las filas idénticas del archivo van a repeats, no a exact', () => {
    const parsed = [
      p('2026-07-21', 75, 'UBER TRIP'),
      p('2026-07-21', 75, 'UBER TRIP'),
    ]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(1)
    expect(r.repeats).toHaveLength(1)
    expect(r.repeats[0].reason).toBe('in-file-duplicate')
    // `exact` queda solo para lo que de verdad ya estaba registrado, así que su
    // rótulo por fin es cierto.
    expect(r.exact).toHaveLength(0)
  })

  it('con referencia distinta NO colapsan: el banco ya les dio identidad', () => {
    const parsed = [
      p('2026-07-21', 75, 'UBER TRIP', { reference: 'BI-900' }),
      p('2026-07-21', 75, 'UBER TRIP', { reference: 'BI-901' }),
    ]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(2)
    expect(r.repeats).toHaveLength(0)
  })

  it('la MISMA referencia repetida sí colapsa: es la misma fila impresa dos veces', () => {
    const parsed = [
      p('2026-07-21', 75, 'UBER TRIP', { reference: 'BI-900' }),
      p('2026-07-21', 75, 'UBER TRIP', { reference: 'BI-900' }),
    ]
    const r = matchStatement(parsed, existing)
    expect(r.newTxs).toHaveLength(1)
    expect(r.repeats).toHaveLength(1)
  })

  it('re-importing the same statement yields zero new', () => {
    const statement = [
      p('2026-07-03', 250.5, 'PAIZ Z.10 GUATEMALA'),
      p('2026-07-12', 45, 'SHELL GASOLINERA', { reference: 'BI-001' }),
    ]
    const r = matchStatement(statement, existing)
    expect(r.newTxs).toHaveLength(0)
    expect(r.exact).toHaveLength(2)
  })

  it('mixed statement: adds only the missing rows', () => {
    const statement = [
      p('2026-07-03', 250.5, 'PAIZ Z.10 GUATEMALA'), // exact
      p('2026-07-15', 500, 'CLINICA DENTAL'), // new
      p('2026-07-18', 62.75, 'POLLO CAMPERO'), // new
    ]
    const r = matchStatement(statement, existing)
    expect(r.newTxs).toHaveLength(2)
    expect(r.exact).toHaveLength(1)
  })
})
