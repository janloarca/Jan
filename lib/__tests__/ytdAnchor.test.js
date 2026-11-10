import {
  accountsUSDFromBreakdown, accountsUSDFromItems, anchorAccountsUSD,
  lateItemsStart, needsAccountsRewrite, startKindOf,
} from '../ytdAnchor'
import { composeDailyTotals, backfillDocUnchanged } from '../snapshotBackfill'
import { lateItemsOf, anchorMissesLateItems } from '../../components/dashboard/utils'

const keyOf = (it) => (it.institution || '').toLowerCase() || null

describe('FASE RR: reparto por cuenta del ancla', () => {
  const items = [
    { id: 'a', symbol: 'VOO', institution: 'IDC' },
    { id: 'b', symbol: 'BTC', institution: 'Ledger' },
    { id: 'c', symbol: 'BTC', institution: 'Ledger' },
    { id: 'd', symbol: 'ETH', institution: 'Ledger' },
  ]

  it('agrupa el desglose por cuenta y suma el NAV del broker a ibkr', () => {
    const acc = accountsUSDFromBreakdown({ byKey: { a: 100, b: 50, c: 25, ETH: 10 }, items, keyOf, navUSD: 500 })
    expect(acc).toEqual({ idc: 100, ledger: 85, ibkr: 500 })
  })

  it('un símbolo compartido por dos ítems no se adivina', () => {
    const acc = accountsUSDFromBreakdown({ byKey: { a: 100, BTC: 75 }, items, keyOf })
    expect(acc).toEqual({ idc: 100 })
  })

  it('el reparto del doc diario suma lo mismo que el total', () => {
    const acc = accountsUSDFromItems({ items: [...items, { id: 'x', isDebt: true, institution: 'X' }], keyOf, valueUSD: () => 10 })
    expect(acc).toEqual({ idc: 10, ledger: 30 })
  })

  it('solo se lee un reparto que cuadra con el total del doc', () => {
    expect(anchorAccountsUSD({ totalActivosUSD: 300, _accountsUSD: { idc: 100, ledger: 200 } })).toEqual({ idc: 100, ledger: 200 })
    // Una llave vieja sobreviviente al merge rompe la suma: no se usa.
    expect(anchorAccountsUSD({ totalActivosUSD: 300, _accountsUSD: { idc: 100, ledger: 200, old: 50 } })).toBeNull()
    expect(anchorAccountsUSD({ totalActivosUSD: 300 })).toBeNull()
    expect(anchorAccountsUSD(null)).toBeNull()
  })

  it('suma los activos tardíos con su valor medido, o rehúsa si falta uno', () => {
    const late = [items[0], items[3]]
    expect(lateItemsStart({ lateItems: late, startByKey: { a: 40, d: 5 }, keyOf })).toEqual({ total: 45, byAccount: { idc: 40, ledger: 5 } })
    expect(lateItemsStart({ lateItems: late, startByKey: { a: 40 }, keyOf })).toBeNull()
    expect(lateItemsStart({ lateItems: [], startByKey: null })).toEqual({ total: 0, byAccount: {} })
  })

  it('rotula el arranque como observado, transcrito o estimado', () => {
    expect(startKindOf('daily')).toBe('observed')
    expect(startKindOf('ibkr')).toBe('observed')
    expect(startKindOf('manual')).toBe('transcribed')
    expect(startKindOf('backfill')).toBe('estimated')
    expect(startKindOf('reconstruction')).toBe('estimated')
    expect(startKindOf(undefined)).toBe('estimated')
  })

  it('lateItemsOf devuelve la misma decisión que anchorMissesLateItems', () => {
    const anchor = { date: '2026-01-01', _source: 'backfill', createdAt: '2026-01-02T00:00:00Z' }
    const its = [
      { id: 'old', quantity: 1, acquisitionDate: '2025-05-01', createdAt: '2025-05-01T00:00:00Z' },
      { id: 'late', quantity: 1, acquisitionDate: '2025-06-01', createdAt: '2026-03-01T00:00:00Z' },
    ]
    expect(lateItemsOf(anchor, its).map((i) => i.id)).toEqual(['late'])
    expect(anchorMissesLateItems(anchor, its)).toBe(true)
    expect(lateItemsOf({ ...anchor, _source: 'manual' }, its)).toEqual([])
  })

  it('composeDailyTotals entrega las dos mitades solo con withParts', () => {
    const pts = [{ ts: Date.parse('2026-01-01T12:00:00Z'), total: 100, byKey: { a: 100 } }]
    const nav = new Map([['2026-01-01', 400]])
    const plain = composeDailyTotals({ gaps: ['2026-01-01'], manualPoints: pts, navByDate: nav, hasBrokerItems: true })
    expect(plain).toEqual([{ date: '2026-01-01', total: 500, composed: true }])
    const parts = composeDailyTotals({ gaps: ['2026-01-01'], manualPoints: pts, navByDate: nav, hasBrokerItems: true, withParts: true })
    expect(parts[0]).toMatchObject({ total: 500, nav: 400, manualByKey: { a: 100 } })
  })

  it('un ancla candidata sin reparto se reescribe una vez; las demás no', () => {
    const now = new Date('2026-11-10T00:00:00Z')
    const base = { _source: 'backfill', totalActivosUSD: 300, netWorthUSD: 300, totalDebtUSD: 0, _transactional: true }
    const next = { ...base, _accountsUSD: { idc: 300 } }
    expect(needsAccountsRewrite({ ...base, date: '2026-01-01' }, next, now)).toBe(true)
    expect(needsAccountsRewrite({ ...base, date: '2026-06-01' }, next, now)).toBe(false)
    expect(needsAccountsRewrite({ ...base, date: '2026-01-01', _accountsUSD: { idc: 300 } }, next, now)).toBe(false)
    // Fuera de la ventana del ancla un doc idéntico sigue sin reescribirse.
    expect(backfillDocUnchanged({ ...base, date: '2026-06-01' }, { ...next, date: '2026-06-01' })).toBe(true)
  })
})
