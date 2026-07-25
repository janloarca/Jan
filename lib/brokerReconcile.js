// Pure reconciliation for broker syncs: turn "here are my current positions" into
// insert / update / close operations against what we already store.
//
// Why this exists: the traditional-broker sync used to bulkImport() the incoming
// positions with no matching at all, and bulkImport mints a fresh random doc id per
// item. Syncing Alpaca twice therefore created AAPL twice and DOUBLED the user's net
// worth; sold positions were never removed. IBKR avoided this with bespoke matching
// logic inside the hook; this module generalizes it so every broker gets it.
//
// Safety rule that matters: deletions only happen when the broker actually returned
// positions. A failed/partial sync that yields an empty list must never be read as
// "the user sold everything" — several connectors can return 200 with zero rows.

const up = (s) => (s || '').toString().trim().toUpperCase()

// Two positions are the same holding when they carry the same broker-assigned id
// (conid and friends) or, failing that, the same symbol within the same source.
function sameHolding(existingItem, incoming) {
  if (incoming.conid && existingItem.conid && incoming.conid === existingItem.conid) return true
  if (!up(existingItem.symbol) || up(existingItem.symbol) !== up(incoming.symbol)) return false
  // Same symbol held in two accounts of the same broker stays distinct.
  const a = incoming._ibkrAccountId || incoming.accountId
  const b = existingItem._ibkrAccountId || existingItem.accountId
  if (a && b && a !== b) return false
  return true
}

export function reconcileBrokerPositions({ incoming = [], existing = [], source, tag = {} } = {}) {
  const newItems = []
  const updateItems = []
  const deleteIds = []
  if (!source) return { newItems, updateItems, deleteIds, matched: 0 }

  // Only ever touch rows this broker owns — a user's manual holdings and other
  // brokers' rows must be invisible to this reconciliation.
  const mine = existing.filter((it) => it._source === source)
  const claimed = new Set()
  let matched = 0

  for (const pos of incoming) {
    if (!up(pos.symbol)) continue
    const hit = mine.find((it) => !claimed.has(it.id) && sameHolding(it, pos))
    if (hit) {
      claimed.add(hit.id)
      matched++
      updateItems.push({
        id: hit.id,
        fields: {
          quantity: pos.quantity,
          currentPrice: pos.currentPrice,
          purchasePrice: pos.purchasePrice,
          currency: pos.currency,
          // A position that flipped long/short must flip here too.
          isDebt: !!pos.isDebt,
          _source: source,
          // Only fill an acquisition date we don't already have, or an earlier one:
          // the stored date may be a real trade date we don't want to overwrite with
          // a later import date.
          ...(pos.acquisitionDate && (!hit.acquisitionDate || new Date(pos.acquisitionDate) < new Date(hit.acquisitionDate))
            ? { acquisitionDate: pos.acquisitionDate } : {}),
        },
      })
    } else {
      newItems.push({ ...pos, _source: source, ...tag })
    }
  }

  // Positions we hold for this broker that it no longer reports were closed. Guarded:
  // never act on an empty incoming list (that is a failed sync, not a liquidation).
  if (incoming.length > 0) {
    for (const it of mine) {
      if (!claimed.has(it.id)) deleteIds.push(it.id)
    }
  }

  return { newItems, updateItems, deleteIds, matched }
}
