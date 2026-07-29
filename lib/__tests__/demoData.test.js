import { DEMO_ITEMS, DEMO_LOTS, DEMO_TRANSACTIONS, DEMO_SOURCE, isDemoItem, hasDemoData } from '../demoData'
import { analyzeDataCompleteness } from '../dataCompleteness'

describe('demo dataset integrity', () => {
  it('every doc is flagged _source demo', () => {
    for (const doc of [...DEMO_ITEMS, ...DEMO_LOTS, ...DEMO_TRANSACTIONS]) {
      expect(doc._source).toBe(DEMO_SOURCE)
    }
  })

  it('item ids are unique and demo-prefixed', () => {
    const ids = DEMO_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('demo-'))).toBe(true)
  })

  it('transaction links resolve within the dataset', () => {
    const ids = new Set(DEMO_ITEMS.map((i) => i.id))
    for (const tx of DEMO_TRANSACTIONS) {
      if (tx._linkedItemId) expect(ids.has(tx._linkedItemId)).toBe(true)
      if (tx._destinationItemId) expect(ids.has(tx._destinationItemId)).toBe(true)
    }
  })

  it('incomeDestination references resolve within the dataset', () => {
    const ids = new Set(DEMO_ITEMS.map((i) => i.id))
    for (const it of DEMO_ITEMS) {
      if (it.incomeDestination) expect(ids.has(it.incomeDestination)).toBe(true)
    }
  })

  it('bulkImport tx ids (date-SYMBOL-type-amount) do not collide', () => {
    const ids = DEMO_TRANSACTIONS.map((tx) => {
      const amt = Math.round((tx.totalAmount || tx.amount || 0) * 100)
      return `${tx.date}-${(tx.symbol || '').toUpperCase()}-${tx.type}-${amt}`
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('open lots cover each market quantity exactly', () => {
    const bySym = {}
    for (const lot of DEMO_LOTS) bySym[lot.symbol] = (bySym[lot.symbol] || 0) + lot.quantity
    for (const it of DEMO_ITEMS.filter((i) => /stock|crypto|fund/i.test(i.type) && bySym[i.symbol] != null)) {
      expect(bySym[it.symbol]).toBeCloseTo(it.quantity)
    }
  })

  it('the completeness engine finds ZERO gaps (the tour shows the ✓ state)', () => {
    const convert = (a, from, to) => {
      if (from === to) return a
      if (from === 'GTQ' && to === 'USD') return a / 7.8
      if (from === 'USD' && to === 'GTQ') return a * 7.8
      return a
    }
    // bulkImport stamps createdAt at seed time — mirror that here, otherwise
    // stale-value fires on items whose last flow is years old.
    const NOW = '2026-07-12T12:00:00Z'
    const seeded = DEMO_ITEMS.map((it) => ({ ...it, createdAt: NOW }))
    const { findings, globalScore } = analyzeDataCompleteness({
      items: seeded, transactions: DEMO_TRANSACTIONS, lots: DEMO_LOTS,
      convert, baseCurrency: 'USD', now: NOW,
    })
    expect(findings).toEqual([])
    expect(globalScore).toBe(100)
  })

  it('helpers detect demo presence', () => {
    expect(isDemoItem({ _source: 'demo' })).toBe(true)
    expect(isDemoItem({ _source: 'ibkr' })).toBe(false)
    expect(hasDemoData([{ _source: 'manual' }, { _source: 'demo' }])).toBe(true)
    expect(hasDemoData([{ _source: 'manual' }])).toBe(false)
  })
})
