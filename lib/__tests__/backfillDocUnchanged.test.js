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

describe('backfillDeltaDetail (FASE RZ)', () => {
  const { backfillDeltaDetail } = require('../snapshotBackfill')
  test('nombra la cuenta que explica la diferencia', () => {
    const d = backfillDeltaDetail(
      { totalActivosUSD: 1000, _accountsUSD: { IBKR: 700, IDC: 300 } },
      { totalActivosUSD: 2432.4, _accountsUSD: { IBKR: 2132.4, IDC: 300 } },
    )
    expect(d.storedTotal).toBe(1000)
    expect(d.nextTotal).toBe(2432.4)
    expect(d.accounts).toHaveLength(1)
    expect(d.accounts[0].key).toBe('IBKR')
    expect(d.accounts[0].diff).toBeCloseTo(1432.4, 2)
  })
  test('sin reparto guardado no inventa cuentas', () => {
    expect(backfillDeltaDetail({ totalActivosUSD: 1 }, { totalActivosUSD: 2, _accountsUSD: { X: 2 } }).accounts).toEqual([])
  })
})
