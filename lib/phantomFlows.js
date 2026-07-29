// Self-healing for a shipped parser bug.
//
// Some broker statements close their "Deposits & Withdrawals" section with a
// TOTAL row that carries no date and no discriminator. Until it was fixed, the
// importer read that row as a real deposit and stamped it with the import date,
// so the user ended up with a contribution that never happened, equal to the sum
// of all their real ones.
//
// Fixing the parser only protects future imports. Everyone who imported before
// the fix still holds the bad row, it silently doubles their contributions, and
// the time-weighted return divides by it:
//     subReturn = endValue / (startValue + flow) - 1
// A phantom 3,945 on a 10,300 portfolio drops that sub-period ~27% and drags the
// whole year down with it. Nobody can be expected to find that by hand, so the
// app has to point at it.
//
// Detection is deliberately narrow. The giveaway is arithmetic, not a guess: a
// real contribution almost never equals the exact sum of every OTHER flow from
// the same source. We only flag a row when that identity holds.
//
// Pure module: no React, no Firestore. Returns candidates; deleting is the
// caller's (and the user's) decision.

const CENTS = (n) => Math.round((Number(n) || 0) * 100)

// Generic labels the importer falls back to when the source row had no
// description of its own, which is exactly the case for a totals line.
const GENERIC = /^(deposit|withdrawal|dep[oó]sito|retiro|total)$/i

function flowAmount(tx) {
  const raw = Number(tx.totalAmount ?? tx.amount) || 0
  return (tx.type || '').toUpperCase() === 'WITHDRAWAL' ? -Math.abs(raw) : Math.abs(raw)
}

export function detectPhantomFlows(transactions = []) {
  const flows = (transactions || []).filter((tx) => {
    const t = (tx.type || '').toUpperCase()
    return (t === 'DEPOSIT' || t === 'WITHDRAWAL') && tx.id
  })
  if (flows.length < 3) return []

  // Compare only within the same origin: a summary row can never be the total of
  // flows that came from a different broker or were typed in by hand.
  const groups = new Map()
  for (const tx of flows) {
    const key = tx._source || 'manual'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(tx)
  }

  const found = []
  for (const group of groups.values()) {
    if (group.length < 3) continue
    const totalCents = group.reduce((s, tx) => s + CENTS(flowAmount(tx)), 0)

    for (const tx of group) {
      const amt = CENTS(flowAmount(tx))
      if (amt === 0) continue
      // Does this row equal everything else in its group?
      const others = totalCents - amt
      if (others !== amt) continue

      // Two more guards so a genuine "I doubled my position" deposit survives:
      // the row has to look unlabeled, and it has to be the newest of the group
      // (a totals line is stamped at import time, after every real movement).
      const desc = (tx.description || '').trim()
      if (desc && !GENERIC.test(desc)) continue
      const newest = group.every((o) => !o.date || !tx.date || o.date <= tx.date)
      if (!newest) continue

      found.push({
        id: tx.id,
        date: tx.date,
        amount: flowAmount(tx),
        type: (tx.type || '').toUpperCase(),
        reason: 'equals-sum-of-others',
      })
    }
  }
  return found
}
