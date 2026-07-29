import { detectPhantomFlows } from '@/lib/phantomFlows'

const dep = (id, date, amount, extra = {}) => ({
  id, date, type: 'DEPOSIT', totalAmount: amount, _source: 'ibkr',
  description: 'Electronic Fund Transfer', ...extra,
})

describe('detectPhantomFlows', () => {
  // The exact shape the parser bug produced: three real transfers plus a totals
  // row stamped with the import date and carrying the generic label.
  const real = [
    dep('a', '2026-01-27', 1450),
    dep('b', '2026-02-26', 1350),
    dep('c', '2026-04-10', 1150),
    { id: 'd', date: '2026-04-20', type: 'WITHDRAWAL', totalAmount: 5, _source: 'ibkr', description: 'Disbursement' },
  ]
  const phantom = dep('ghost', '2026-07-28', 3945, { description: 'Deposit' })

  it('finds the row that equals the sum of every other flow', () => {
    const hits = detectPhantomFlows([...real, phantom])
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('ghost')
    expect(hits[0].amount).toBe(3945)
  })

  it('flags nothing on a clean ledger', () => {
    expect(detectPhantomFlows(real)).toEqual([])
  })

  it('leaves a labelled deposit alone even if the amount happens to match', () => {
    // Someone really can transfer an amount equal to everything before it.
    const labelled = dep('big', '2026-07-28', 3945, { description: 'Bonus anual' })
    expect(detectPhantomFlows([...real, labelled])).toEqual([])
  })

  it('leaves the matching row alone when it is not the newest', () => {
    // A totals line is written at import time, so it is always last. Something
    // in the middle that happens to match is a coincidence, not a summary.
    const middle = dep('mid', '2026-02-01', 3945, { description: 'Deposit' })
    expect(detectPhantomFlows([...real, middle])).toEqual([])
  })

  it('does not compare across different sources', () => {
    const manual = { id: 'm', date: '2026-07-28', type: 'DEPOSIT', totalAmount: 3945, _source: 'manual', description: 'Deposit' }
    expect(detectPhantomFlows([...real, manual])).toEqual([])
  })

  it('ignores ledgers too small to have a meaningful total', () => {
    expect(detectPhantomFlows([dep('a', '2026-01-01', 100), dep('b', '2026-02-01', 100)])).toEqual([])
  })

  it('needs an id to be actionable', () => {
    const noId = { date: '2026-07-28', type: 'DEPOSIT', totalAmount: 3945, _source: 'ibkr', description: 'Deposit' }
    expect(detectPhantomFlows([...real, noId])).toEqual([])
  })

  it('accounts for withdrawals with their sign', () => {
    const flows = [
      dep('a', '2026-01-01', 1000),
      { id: 'b', date: '2026-02-01', type: 'WITHDRAWAL', totalAmount: 200, _source: 'ibkr', description: 'Out' },
      dep('total', '2026-03-01', 800, { description: 'Deposit' }),
    ]
    expect(detectPhantomFlows(flows).map((f) => f.id)).toEqual(['total'])
  })
})
