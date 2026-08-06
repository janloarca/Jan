import { staleBackfillDates } from '../snapshotBackfill'

// A fixed "today" so date math is deterministic regardless of when the test runs.
const TODAY = new Date('2026-08-06T12:00:00Z').getTime()
const dayStr = (daysAgo) => {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

describe('staleBackfillDates', () => {
  it('with no snapshots at all, every day in the window is a gap', () => {
    const out = staleBackfillDates([], { windowDays: 5, todayMs: TODAY })
    expect(out).toHaveLength(5)
    expect(out).toContain(dayStr(1))
    expect(out).toContain(dayStr(5))
  })

  it('a real observation (daily) blocks re-fill by default', () => {
    const snapshots = [{ date: dayStr(2), _source: 'daily' }]
    const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
    expect(out).not.toContain(dayStr(2))
    expect(out).toHaveLength(4)
  })

  it('manual, ibkr and ibkr_quarterly always block re-fill, even with treatDailyAsStale', () => {
    const snapshots = [
      { date: dayStr(1), _source: 'manual' },
      { date: dayStr(2), _source: 'ibkr' },
      { date: dayStr(3), _source: 'ibkr_quarterly' },
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 3, todayMs: TODAY, treatDailyAsStale: true })
    expect(out).toHaveLength(0)
  })

  it('a doc with no _source at all counts as honest history (FASE DX) and blocks re-fill by default', () => {
    const snapshots = [{ date: dayStr(1) }]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    expect(out).toHaveLength(0)
  })

  // The XOCHI regression: a day already covered by an OLD backfill estimate
  // (written back when XOCHI did not exist yet) must stay re-fillable, or it
  // sits there forever alternating against the fresh days next to it.
  it('a _source:backfill doc is re-fillable, exactly like a missing day', () => {
    const snapshots = [{ date: dayStr(3), _source: 'backfill' }]
    const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
    expect(out).toContain(dayStr(3))
    expect(out).toHaveLength(5)
  })

  it('a calibration anchor (_account set) is ignored: it neither blocks nor fills the day', () => {
    const snapshots = [{ date: dayStr(1), _source: 'manual', _account: 'idc' }]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    // The compound-id anchor doesn't stand in for the portfolio-wide doc, so
    // the day is still a gap.
    expect(out).toContain(dayStr(1))
  })

  it('mixed window: only the missing day and the stale-backfill day come back by default', () => {
    const snapshots = [
      { date: dayStr(1), _source: 'daily' },
      { date: dayStr(2), _source: 'backfill' },
      // dayStr(3) has no doc at all
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 3, todayMs: TODAY })
    expect(out.sort()).toEqual([dayStr(2), dayStr(3)].sort())
  })

  describe('treatDailyAsStale (no broker-synced item in the portfolio)', () => {
    it('a daily doc becomes re-fillable too', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, treatDailyAsStale: true })
      expect(out).toContain(dayStr(2))
    })

    it('a doc with no _source at all becomes re-fillable too (same treatment as daily)', () => {
      const snapshots = [{ date: dayStr(1) }]
      const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY, treatDailyAsStale: true })
      expect(out).toContain(dayStr(1))
    })

    it('off by default: the caller must opt in explicitly', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
      expect(out).not.toContain(dayStr(2))
    })
  })
})
