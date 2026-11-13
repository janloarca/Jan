import { backfillDocUnchanged } from '../snapshotBackfill'

const next = { totalActivosUSD: 1000, netWorthUSD: 900, totalDebtUSD: 100, _source: 'backfill', _transactional: true }

describe('backfillDocUnchanged (FASE RC)', () => {
  it('un backfill idéntico no se reescribe', () => {
    expect(backfillDocUnchanged({ ...next }, next)).toBe(true)
  })
  it('medio centavo de ruido sigue siendo el mismo doc', () => {
    expect(backfillDocUnchanged({ ...next, totalActivosUSD: 1000.004, netWorthUSD: 900.004 }, next)).toBe(true)
  })
  it('un valor distinto SÍ se reescribe (la re-derivación de FASE EG sigue viva)', () => {
    expect(backfillDocUnchanged({ ...next, totalActivosUSD: 999 }, next)).toBe(false)
    expect(backfillDocUnchanged({ ...next, netWorthUSD: 901 }, next)).toBe(false)
  })
  it('cambiar la marca transaccional también se escribe', () => {
    expect(backfillDocUnchanged({ ...next, _transactional: false }, next)).toBe(false)
  })
  it('un daily, un manual o un doc calibrado nunca cuentan como "sin cambios"', () => {
    expect(backfillDocUnchanged({ ...next, _source: 'daily' }, next)).toBe(false)
    expect(backfillDocUnchanged({ ...next, _source: undefined }, next)).toBe(false)
    expect(backfillDocUnchanged({ ...next, _calibrated: true }, next)).toBe(false)
  })
  it('sin doc previo se escribe', () => {
    expect(backfillDocUnchanged(undefined, next)).toBe(false)
  })
})

import { backfillRewriteReason } from '../snapshotBackfill'

describe('FASE RY: tolerancia relativa y razón de reescritura', () => {
  const next = { totalActivosUSD: 340000, netWorthUSD: 339000, totalDebtUSD: 1000, _source: 'backfill', _transactional: true }
  it('ruido de punto flotante bajo una millonésima no cuenta como cambio', () => {
    expect(backfillDocUnchanged({ ...next, totalActivosUSD: 340000.2, netWorthUSD: 339000.2 }, next)).toBe(true)
  })
  it('la razón dice hueco, otra fuente o cambio de valor con su delta', () => {
    expect(backfillRewriteReason(null, next).reason).toBe('gap')
    expect(backfillRewriteReason({ ...next, _source: 'daily' }, next).reason).toBe('source')
    const r = backfillRewriteReason({ ...next, totalActivosUSD: 340012.5 }, next)
    expect(r.reason).toBe('value')
    expect(r.delta).toBeCloseTo(12.5, 6)
    expect(backfillRewriteReason({ ...next, _transactional: false }, next).reason).toBe('shape')
  })
})
