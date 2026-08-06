import { orphanedAccountSnapshotIds } from '../accountCleanup'

const ibkrPos = (id) => ({ id, _source: 'ibkr', institution: 'Interactive Brokers', symbol: 'AAPL' })
const manualBond = (id) => ({ id, institution: 'IDC', symbol: 'VITALI' })

const navSynced = { id: 's1', date: '2026-08-05', _source: 'ibkr', netWorthUSD: 5760 }
const navQuarterly = { id: 's2', date: '2026-03-31', _source: 'ibkr_quarterly', netWorthUSD: 4000 }
const daily = { id: 's3', date: '2026-08-01', _source: 'daily', netWorthUSD: 12000 }
const plain = { id: 's4', date: '2026-07-01', netWorthUSD: 11000 }
const calIbkr = { id: 's5', date: '2026-01-01', _account: 'ibkr', _calibrated: true }
const calIdc = { id: 's6', date: '2026-01-01', _account: 'idc', _calibrated: true }

const ALL = [navSynced, navQuarterly, daily, plain, calIbkr, calIdc]

describe('orphanedAccountSnapshotIds', () => {
  it('drops a broker\'s NAV once its LAST position is deleted', () => {
    const ids = orphanedAccountSnapshotIds(ALL, [ibkrPos('a')], [manualBond('b')])
    expect(ids).toEqual(['s1', 's2', 's5'])
  })

  it('keeps the NAV while another position of the same broker survives', () => {
    // IBKR split across two groups (API + file): deleting one must not wipe
    // history the other still explains.
    const ids = orphanedAccountSnapshotIds(ALL, [ibkrPos('a')], [ibkrPos('b'), manualBond('c')])
    expect(ids).toEqual([])
  })

  it('never touches portfolio-wide snapshots', () => {
    const ids = orphanedAccountSnapshotIds(ALL, [ibkrPos('a')], [manualBond('b')])
    expect(ids).not.toContain('s3') // daily
    expect(ids).not.toContain('s4') // no source at all
  })

  it('drops a manual institution\'s calibration anchor when its last item goes', () => {
    const ids = orphanedAccountSnapshotIds(ALL, [manualBond('b')], [ibkrPos('a')])
    expect(ids).toEqual(['s6'])
  })

  it('keeps everything when nothing is deleted', () => {
    expect(orphanedAccountSnapshotIds(ALL, [], [ibkrPos('a')])).toEqual([])
  })

  it('handles an empty snapshot list', () => {
    expect(orphanedAccountSnapshotIds([], [ibkrPos('a')], [])).toEqual([])
    expect(orphanedAccountSnapshotIds(null, [ibkrPos('a')], [])).toEqual([])
  })

  it('ignores snapshots with no id (nothing to delete by)', () => {
    const noId = [{ date: '2026-08-05', _source: 'ibkr' }]
    expect(orphanedAccountSnapshotIds(noId, [ibkrPos('a')], [])).toEqual([])
  })

  it('deleting the whole portfolio drops every account-scoped snapshot', () => {
    const ids = orphanedAccountSnapshotIds(ALL, [ibkrPos('a'), manualBond('b')], [])
    expect(ids).toEqual(['s1', 's2', 's5', 's6'])
  })
})
