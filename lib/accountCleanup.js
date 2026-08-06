// What stops belonging to anyone when a group of accounts is deleted.
//
// Deleting a group from Settings ("IBKR API · 12 posiciones") removed the items,
// their lots and their transactions, but never a single snapshot. Snapshots are
// not all portfolio-wide though: a broker NAV row is ONE account's balance, and a
// calibration anchor is one account's solved start value. Left behind, they keep
// describing an account the portfolio no longer holds — which is exactly how a
// leftover IBKR NAV of 5,760 got topped up with a manually typed 6,240 bond and
// drew a flat 12,000 line across a portfolio worth 6,240 (FASE DW/DX).
//
// The rule is "the last item of that account is gone", not "an item of that
// account is gone": IBKR can be split across several groups (API + file), so
// deleting one must not wipe NAV the other still explains.
//
// Portfolio-wide snapshots ('daily', 'manual', 'backfill', or no source at all)
// are NEVER touched here. They measure everything the user owned that day,
// including whatever survives the delete, so they belong to the portfolio and
// not to any one account.

import { accountKeyOfItem, BROKER_NAV_SOURCES } from '@/components/dashboard/utils'

const BROKER_SOURCE_OF_NAV = { ibkr: 'ibkr', ibkr_quarterly: 'ibkr' }

// Sources that identify a real synced/imported account (not hand entry).
const isAccountSource = (s) => !!s && s !== 'manual' && s !== 'demo'

/**
 * Ids of the snapshots that no surviving item can explain any more.
 *
 * @param snapshots       every snapshot doc (needs `id`, plus `_source`/`_account`)
 * @param deletedItems    the items about to be removed
 * @param survivingItems  every item that will still exist afterwards
 */
export function orphanedAccountSnapshotIds(snapshots, deletedItems, survivingItems) {
  const gone = deletedItems || []
  const left = survivingItems || []
  if (gone.length === 0) return []

  // Broker sources losing their LAST item.
  const goneSources = new Set(gone.map((it) => it && it._source).filter(isAccountSource))
  for (const s of [...goneSources]) {
    if (left.some((it) => it && it._source === s)) goneSources.delete(s)
  }
  // Account keys (calibration anchors) losing their LAST item.
  const goneKeys = new Set(gone.map((it) => accountKeyOfItem(it)).filter(Boolean))
  for (const k of [...goneKeys]) {
    if (left.some((it) => accountKeyOfItem(it) === k)) goneKeys.delete(k)
  }
  if (goneSources.size === 0 && goneKeys.size === 0) return []

  return (snapshots || [])
    .filter((s) => {
      if (!s || !s.id) return false
      // A calibration anchor names its account outright.
      if (s._account) return goneKeys.has(s._account)
      // A broker NAV row (synced daily or transcribed quarterly) belongs to the
      // broker that produced it. Anything else is portfolio-wide: leave it.
      if (!BROKER_NAV_SOURCES.includes(s._source)) return false
      return goneSources.has(BROKER_SOURCE_OF_NAV[s._source] || s._source)
    })
    .map((s) => s.id)
}
