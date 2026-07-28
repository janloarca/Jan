import { reconcileBrokerPositions } from '../brokerReconcile'

const pos = (symbol, over = {}) => ({
  symbol, name: symbol, type: 'Stock', quantity: 10,
  purchasePrice: 100, currentPrice: 120, currency: 'USD', ...over,
})
const item = (id, symbol, over = {}) => ({
  id, symbol, quantity: 10, currentPrice: 120, purchasePrice: 100,
  _source: 'alpaca', institution: 'Alpaca', ...over,
})

describe('reconcileBrokerPositions', () => {
  it('inserts on a first sync', () => {
    const r = reconcileBrokerPositions({ incoming: [pos('AAPL'), pos('MSFT')], existing: [], source: 'alpaca' })
    expect(r.newItems).toHaveLength(2)
    expect(r.updateItems).toHaveLength(0)
    expect(r.deleteIds).toHaveLength(0)
    expect(r.newItems[0]._source).toBe('alpaca')
  })

  it('UPDATES instead of duplicating on a second sync (the net-worth-doubling bug)', () => {
    const existing = [item('a1', 'AAPL'), item('a2', 'MSFT')]
    const r = reconcileBrokerPositions({
      incoming: [pos('AAPL', { quantity: 12, currentPrice: 130 }), pos('MSFT')],
      existing, source: 'alpaca',
    })
    expect(r.newItems).toHaveLength(0)
    expect(r.updateItems).toHaveLength(2)
    expect(r.matched).toBe(2)
    const aapl = r.updateItems.find((u) => u.id === 'a1')
    expect(aapl.fields.quantity).toBe(12)
    expect(aapl.fields.currentPrice).toBe(130)
  })

  it('closes positions the broker no longer reports', () => {
    const existing = [item('a1', 'AAPL'), item('a2', 'MSFT')]
    const r = reconcileBrokerPositions({ incoming: [pos('AAPL')], existing, source: 'alpaca' })
    expect(r.deleteIds).toEqual(['a2'])
  })

  it('NEVER deletes when the broker returned nothing (failed/partial sync)', () => {
    const existing = [item('a1', 'AAPL'), item('a2', 'MSFT')]
    const r = reconcileBrokerPositions({ incoming: [], existing, source: 'alpaca' })
    expect(r.deleteIds).toHaveLength(0)
    expect(r.newItems).toHaveLength(0)
  })

  it('never touches other sources or manual holdings', () => {
    const existing = [
      item('a1', 'AAPL'),
      item('m1', 'AAPL', { _source: 'manual', institution: 'Mi banco' }),
      item('k1', 'AAPL', { _source: 'kraken' }),
    ]
    const r = reconcileBrokerPositions({ incoming: [pos('TSLA')], existing, source: 'alpaca' })
    // Only the alpaca AAPL is closed; manual and kraken rows are untouched.
    expect(r.deleteIds).toEqual(['a1'])
    expect(r.newItems).toHaveLength(1)
  })

  it('preserves shorts (isDebt) instead of flattening them to long', () => {
    const r = reconcileBrokerPositions({
      incoming: [pos('TSLA', { quantity: 3, isDebt: true })], existing: [], source: 'ig',
    })
    expect(r.newItems[0].isDebt).toBe(true)
  })

  it('flips an existing position when it goes short', () => {
    const existing = [item('i1', 'TSLA', { _source: 'ig', isDebt: false })]
    const r = reconcileBrokerPositions({
      incoming: [pos('TSLA', { isDebt: true })], existing, source: 'ig',
    })
    expect(r.updateItems[0].fields.isDebt).toBe(true)
  })

  it('matches by conid when symbols differ', () => {
    const existing = [item('a1', 'OLD', { conid: '265598' })]
    const r = reconcileBrokerPositions({
      incoming: [pos('AAPL', { conid: '265598' })], existing, source: 'alpaca',
    })
    expect(r.updateItems).toHaveLength(1)
    expect(r.newItems).toHaveLength(0)
  })

  it('keeps the same symbol in two accounts distinct', () => {
    const existing = [item('a1', 'AAPL', { accountId: 'U1' })]
    const r = reconcileBrokerPositions({
      incoming: [pos('AAPL', { accountId: 'U2' })], existing, source: 'alpaca',
    })
    expect(r.newItems).toHaveLength(1)
    expect(r.updateItems).toHaveLength(0)
  })

  it('only backfills an EARLIER acquisition date, never a later one', () => {
    const existing = [item('a1', 'AAPL', { acquisitionDate: '2024-01-01' })]
    const later = reconcileBrokerPositions({
      incoming: [pos('AAPL', { acquisitionDate: '2026-07-01' })], existing, source: 'alpaca',
    })
    expect(later.updateItems[0].fields.acquisitionDate).toBeUndefined()
    const earlier = reconcileBrokerPositions({
      incoming: [pos('AAPL', { acquisitionDate: '2023-05-01' })], existing, source: 'alpaca',
    })
    expect(earlier.updateItems[0].fields.acquisitionDate).toBe('2023-05-01')
  })

  it('applies the portfolio/entity tag to new items only', () => {
    const r = reconcileBrokerPositions({
      incoming: [pos('AAPL')], existing: [], source: 'alpaca', tag: { portfolioId: 'p1' },
    })
    expect(r.newItems[0].portfolioId).toBe('p1')
  })

  it('skips rows with no symbol', () => {
    const r = reconcileBrokerPositions({ incoming: [pos('')], existing: [], source: 'alpaca' })
    expect(r.newItems).toHaveLength(0)
  })
})

describe('reconcileBrokerPositions — enrich mode (uploaded statement)', () => {
  const enrich = (incoming, existing) =>
    reconcileBrokerPositions({ incoming, existing, source: 'ibkr', mode: 'enrich' })

  it('matches an already-synced holding instead of duplicating it', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2.06, _source: 'ibkr' }]
    const incoming = [{ symbol: 'META', quantity: 2.06, acquisitionDate: '2024-03-01' }]
    const r = enrich(incoming, existing)
    expect(r.matched).toBe(1)
    expect(r.newItems).toHaveLength(0)
    expect(r.updateItems).toHaveLength(1)
    expect(r.updateItems[0].id).toBe('a')
  })

  it('never proposes deletions: a statement is not a liquidation report', () => {
    const existing = [
      { id: 'a', symbol: 'META', quantity: 2, _source: 'ibkr' },
      { id: 'b', symbol: 'MO', quantity: 7, _source: 'ibkr' },
    ]
    // File only covers ONE of the two holdings (older/partial statement).
    const r = enrich([{ symbol: 'META', quantity: 2 }], existing)
    expect(r.deleteIds).toEqual([])
  })

  it('does NOT overwrite live quantity or current price with the file snapshot', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2.06, currentPrice: 593, purchasePrice: 300, _source: 'ibkr' }]
    // Statement is older: fewer shares, stale price.
    const incoming = [{ symbol: 'META', quantity: 1, currentPrice: 400, purchasePrice: 250 }]
    const r = enrich(incoming, existing)
    const fields = r.updateItems[0]?.fields || {}
    expect(fields.quantity).toBeUndefined()
    expect(fields.currentPrice).toBeUndefined()
    expect(fields.purchasePrice).toBeUndefined()
  })

  it('pulls acquisitionDate BACKWARDS to the real trade date', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2, acquisitionDate: '2026-07-28', _source: 'ibkr' }]
    const incoming = [{ symbol: 'META', quantity: 2, acquisitionDate: '2024-03-01' }]
    const r = enrich(incoming, existing)
    expect(r.updateItems[0].fields.acquisitionDate).toBe('2024-03-01')
  })

  it('does not push acquisitionDate forwards', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2, acquisitionDate: '2024-03-01', _source: 'ibkr' }]
    const incoming = [{ symbol: 'META', quantity: 2, acquisitionDate: '2026-07-28' }]
    const r = enrich(incoming, existing)
    expect(r.updateItems).toHaveLength(0)
  })

  it('fills gaps only: missing cost basis and identity fields', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2, _source: 'ibkr' }]
    const incoming = [{ symbol: 'META', quantity: 2, purchasePrice: 250, conid: '107113386', _ibkrAccountId: 'U1', name: 'Meta Platforms' }]
    const r = enrich(incoming, existing)
    expect(r.updateItems[0].fields).toMatchObject({
      purchasePrice: 250, conid: '107113386', _ibkrAccountId: 'U1', name: 'Meta Platforms',
    })
  })

  it('writes nothing for a holding that is already complete', () => {
    const existing = [{ id: 'a', symbol: 'META', quantity: 2, name: 'Meta', conid: 'X', _ibkrAccountId: 'U1', currency: 'USD', purchasePrice: 250, acquisitionDate: '2024-03-01', _source: 'ibkr' }]
    const incoming = [{ symbol: 'META', quantity: 2, name: 'Meta', conid: 'X', _ibkrAccountId: 'U1', currency: 'USD', purchasePrice: 250, acquisitionDate: '2024-03-01' }]
    const r = enrich(incoming, existing)
    expect(r.matched).toBe(1)
    expect(r.enriched).toBe(0)
    expect(r.updateItems).toHaveLength(0)
  })

  it('still creates positions the file has and we do not', () => {
    const r = enrich([{ symbol: 'NVDA', quantity: 5 }], [{ id: 'a', symbol: 'META', quantity: 2, _source: 'ibkr' }])
    expect(r.newItems).toHaveLength(1)
    expect(r.newItems[0].symbol).toBe('NVDA')
  })

  it('leaves other brokers and manual holdings untouched', () => {
    const existing = [{ id: 'm', symbol: 'META', quantity: 99, _source: 'manual' }]
    const r = enrich([{ symbol: 'META', quantity: 2, acquisitionDate: '2024-01-01' }], existing)
    expect(r.matched).toBe(0)
    expect(r.updateItems).toHaveLength(0)
    expect(r.newItems).toHaveLength(1)
  })
})
