import { buildFriendStats } from '../friendsStats'

// Minimal enriched-item factory. getItemValue = quantity × currentPrice.
const item = (o) => ({ quantity: 1, currentPrice: 100, ...o })

describe('buildFriendStats', () => {
  it('publishes ytd/day as clamped percentages, never amounts', () => {
    const stats = buildFriendStats({
      enrichedItems: [item({ symbol: 'AAPL', change1d: 1 })],
      returnYTD: 12.34,
      dailyChange: { abs: 999999, pct: 0.8 },
      totalAssets: 100,
    })
    expect(stats.ytd).toBe(12.34)
    expect(stats.day).toBe(0.8)
    // No amount fields leak anywhere in the payload.
    const json = JSON.stringify(stats)
    expect(json).not.toContain('999999')
    stats.movers.forEach((m) => {
      expect(m).not.toHaveProperty('value')
      expect(m).not.toHaveProperty('amount')
    })
  })

  it('clamps out-of-range returns to [-200, 200] and nulls non-finite', () => {
    expect(buildFriendStats({ returnYTD: 5000 }).ytd).toBe(200)
    expect(buildFriendStats({ returnYTD: -9000 }).ytd).toBe(-200)
    expect(buildFriendStats({ returnYTD: NaN }).ytd).toBe(null)
    expect(buildFriendStats({ returnYTD: null }).ytd).toBe(null)
  })

  it('publishes month-to-date (mtd) alongside ytd, clamped', () => {
    expect(buildFriendStats({ returnYTD: 10, returnMTD: 3.2 }).mtd).toBe(3.2)
    expect(buildFriendStats({ returnMTD: 5000 }).mtd).toBe(200)
    expect(buildFriendStats({ returnMTD: NaN }).mtd).toBe(null)
    expect(buildFriendStats({ returnYTD: 10 }).mtd).toBe(null)
  })

  it('accepts dailyChange as a bare number', () => {
    expect(buildFriendStats({ dailyChange: 1.5 }).day).toBe(1.5)
  })

  it('ranks movers by absolute daily impact (weight × change1d), not by value', () => {
    // Big position, tiny move vs small position, huge move.
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'BIG', quantity: 1, currentPrice: 900, change1d: 0.1 }),  // weight .9 × .1 = .09
        item({ symbol: 'SMALL', quantity: 1, currentPrice: 100, change1d: 5 }),   // weight .1 × 5 = .50
      ],
      totalAssets: 1000,
    })
    expect(stats.movers[0].symbol).toBe('SMALL')
    expect(stats.movers[1].symbol).toBe('BIG')
    expect(stats.movers[0].impactPct).toBeCloseTo(0.5, 5)
  })

  it('ignores non-market items (no change1d) and debt', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'BANK', currentPrice: 5000 }),                 // no change1d
        item({ symbol: 'DEBT', change1d: 3, isDebt: true }),          // debt
        item({ symbol: 'VOO', currentPrice: 400, change1d: 1.2 }),
      ],
      totalAssets: 5400,
    })
    expect(stats.movers.map((m) => m.symbol)).toEqual(['VOO'])
  })

  it('scopeFilter narrows movers to a subset (e.g. IBKR only)', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'IBK', currentPrice: 500, change1d: 2, _source: 'ibkr' }),
        item({ symbol: 'MAN', currentPrice: 500, change1d: 9, _source: 'manual' }),
      ],
      totalAssets: 1000,
      scopeFilter: (it) => it._source === 'ibkr',
    })
    expect(stats.movers.map((m) => m.symbol)).toEqual(['IBK'])
    // Weight is relative to the scoped total (500), so impact = 1.0 × 2 = 2.
    expect(stats.movers[0].impactPct).toBeCloseTo(2, 5)
  })

  it('caps movers at 5', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ symbol: `S${i}`, currentPrice: 100, change1d: i + 1 }))
    const stats = buildFriendStats({ enrichedItems: many, totalAssets: 1000 })
    expect(stats.movers.length).toBe(5)
  })
})

// ⛔ FASE JX. El mismo defecto que la tarjeta del patrimonio, una superficie mas
// alla: quien tiene el mismo activo en dos cuentas publicaba DOS movers "BTC" a
// sus grupos de amigos.
describe('agregacion por activo en lo que se publica', () => {
  const mk = (o) => ({ isDebt: false, quantity: 1, currentPrice: 1000, change1d: 1, ...o })

  it('dos cuentas con el mismo simbolo salen como UN solo mover', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'BTC', name: 'Bitcoin', quantity: 1, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'b', symbol: 'BTC', name: 'Bitcoin', quantity: 3, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'c', symbol: 'ETH', name: 'Ether', quantity: 1, currentPrice: 5000, change1d: 1 }),
      ],
      returnYTD: 5, dailyChange: 1, totalAssets: 45000,
    })
    const btc = stats.movers.filter((m) => m.symbol === 'BTC')
    expect(btc).toHaveLength(1)
    // 40,000 de 45,000 al 2% = impacto de 1.777..., o sea los DOS lotes.
    expect(btc[0].impactPct).toBeCloseTo((40000 / 45000) * 2, 6)
    expect(btc[0].changePct).toBeCloseTo(2, 9)
  })

  it('el contrato de privacidad no cambia: cero montos', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'BTC', name: 'Bitcoin', quantity: 1, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'b', symbol: 'BTC', name: 'Bitcoin', quantity: 3, currentPrice: 10000, change1d: 2 }),
      ],
      returnYTD: 5, dailyChange: 1, totalAssets: 40000,
    })
    stats.movers.forEach((m) => {
      expect(Object.keys(m).sort()).toEqual(['changePct', 'impactPct', 'name', 'symbol'])
    })
  })

  it('sin piso de peso: un mover chiquito se sigue publicando', () => {
    // La tarjeta del patrimonio descarta por debajo del 0.5%; aca no hay piso,
    // y ese comportamiento se conserva.
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'big', symbol: 'BIG', quantity: 1, currentPrice: 100000, change1d: 0.01 }),
        mk({ id: 'tiny', symbol: 'TINY', quantity: 1, currentPrice: 100, change1d: 5 }),
      ],
      returnYTD: 1, dailyChange: 0.1, totalAssets: 100100,
    })
    expect(stats.movers.map((m) => m.symbol)).toContain('TINY')
  })
})
