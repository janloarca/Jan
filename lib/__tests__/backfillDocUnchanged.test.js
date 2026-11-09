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
