import { getBrokerCompletionSteps, ibkrSnapshotSpanDays, earliestNeededDays, hasCompleteBrokerData, IBKR_STEPS } from '../brokerCompletion'

describe('getBrokerCompletionSteps', () => {
  it('returns the full 4-step IBKR checklist', () => {
    expect(getBrokerCompletionSteps('ibkr')).toBe(IBKR_STEPS)
    expect(IBKR_STEPS.map((s) => s.id)).toEqual(['connect', 'history', 'quarterly', 'returns'])
  })

  it('falls back to the api door when the broker has one', () => {
    const steps = getBrokerCompletionSteps('coinbase', { api: {}, csv: {} })
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('api')
  })

  it('falls back to the csv door when only that exists', () => {
    const steps = getBrokerCompletionSteps('fidelity', { csv: {} })
    expect(steps[0].kind).toBe('csv')
  })

  it('returns nothing for an unknown broker', () => {
    expect(getBrokerCompletionSteps('nope', null)).toEqual([])
  })
})

describe('IBKR_STEPS.done', () => {
  it('step 1 (connect) follows ibkrConnected directly', () => {
    expect(IBKR_STEPS[0].done({ ibkrConnected: true })).toBe(true)
    expect(IBKR_STEPS[0].done({ ibkrConnected: false })).toBe(false)
  })

  it('step 2 (history) treats >400 days of real IBKR NAV as "a prior year landed"', () => {
    expect(IBKR_STEPS[1].done({ ibkrSnapshotSpanDays: 401 })).toBe(true)
    expect(IBKR_STEPS[1].done({ ibkrSnapshotSpanDays: 300 })).toBe(false)
  })

  it('step 3 (quarterly) is skippable once step 2 already reaches the account start', () => {
    expect(IBKR_STEPS[2].skippable({ ibkrSnapshotSpanDays: 500, earliestNeededDays: 400 })).toBe(true)
    expect(IBKR_STEPS[2].skippable({ ibkrSnapshotSpanDays: 200, earliestNeededDays: 400 })).toBe(false)
    expect(IBKR_STEPS[2].skippable({ ibkrSnapshotSpanDays: 500, earliestNeededDays: null })).toBe(false)
  })

  it('step 4 (returns) follows an ibkr-scoped calibration', () => {
    expect(IBKR_STEPS[3].done({ hasIbkrCalibration: true })).toBe(true)
    expect(IBKR_STEPS[3].done({ hasIbkrCalibration: false })).toBe(false)
  })
})

describe('ibkrSnapshotSpanDays', () => {
  const now = new Date('2026-08-05T00:00:00Z')

  it('measures from the earliest real ibkr snapshot to now', () => {
    const snaps = [
      { _source: 'ibkr', date: '2025-01-01' },
      { _source: 'ibkr', date: '2026-06-01' },
      { _source: 'ibkr_quarterly', date: '2020-01-01' }, // must NOT count
      { _source: 'manual', date: '2019-01-01' },
    ]
    expect(ibkrSnapshotSpanDays(snaps, now)).toBe(Math.round((now - new Date('2025-01-01')) / 86400000))
  })

  it('is 0 with no real ibkr snapshots', () => {
    expect(ibkrSnapshotSpanDays([], now)).toBe(0)
    expect(ibkrSnapshotSpanDays([{ _source: 'ibkr_quarterly', date: '2020-01-01' }], now)).toBe(0)
  })
})

describe('earliestNeededDays', () => {
  const now = new Date('2026-08-05T00:00:00Z')

  it('measures from the earliest acquisitionDate to now', () => {
    const items = [{ acquisitionDate: '2023-01-06' }, { acquisitionDate: '2025-05-01' }]
    expect(earliestNeededDays(items, now)).toBe(Math.round((now - new Date('2023-01-06')) / 86400000))
  })

  it('is null with no dated items', () => {
    expect(earliestNeededDays([], now)).toBeNull()
    expect(earliestNeededDays([{ acquisitionDate: null }], now)).toBeNull()
  })
})

describe('hasCompleteBrokerData', () => {
  it('is true only when every IBKR step is done or skippable', () => {
    const complete = {
      ibkrConnected: true, ibkrSnapshotSpanDays: 500,
      hasQuarterlyHistory: true, hasIbkrCalibration: true, earliestNeededDays: 400,
    }
    expect(hasCompleteBrokerData('ibkr', null, complete)).toBe(true)
  })

  it('is false when a step is missing (e.g. no calibration yet)', () => {
    const missing = {
      ibkrConnected: true, ibkrSnapshotSpanDays: 500,
      hasQuarterlyHistory: true, hasIbkrCalibration: false, earliestNeededDays: 400,
    }
    expect(hasCompleteBrokerData('ibkr', null, missing)).toBe(false)
  })

  it('accepts the quarterly step via skippable instead of done', () => {
    const viaSkippable = {
      ibkrConnected: true, ibkrSnapshotSpanDays: 500,
      hasQuarterlyHistory: false, hasIbkrCalibration: true, earliestNeededDays: 400,
    }
    expect(hasCompleteBrokerData('ibkr', null, viaSkippable)).toBe(true)
  })

  it('is false for a broker with no defined steps', () => {
    expect(hasCompleteBrokerData('unknown-broker', null, {})).toBe(false)
  })
})
