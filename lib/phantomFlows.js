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

// Can `target` be formed by adding up some of `values`? Exact-cent subset sum
// over a bounded set. The first version compared the candidate against the sum
// of ALL other flows, which only held when the user had imported exactly one
// statement: after a second import the group total no longer matched and the
// phantom went undetected in precisely the accounts that had it.
// IMPORTANT: `values` must arrive NEWEST FIRST. A totals row sums the batch it
// was imported with, i.e. the most recent flows, so consuming those first finds
// the target within a handful of steps. Fed oldest-first (the order Firestore
// returns, since transactions are queried orderBy('date')), the search spends
// its entire budget on years of older deposits and bails BEFORE reaching the
// four that actually add up. That is not a theoretical risk: it is why the
// detector returned nothing on a real 25-flow account while passing a test
// suite whose fixtures only had 8.
function isSubsetSum(values, target) {
  if (values.length > 60) return false

  // Values can be NEGATIVE (a withdrawal inside the batch the total sums up), so
  // there is no monotonic pruning to lean on: a real case was 1450 + 1350 + 1150
  // - 5 = 3945, which a positives-only search never reaches. Track every
  // reachable sum instead, capped so a pathological ledger cannot blow up.
  let reachable = new Set([0])
  for (const v of values) {
    const next = new Set(reachable)
    for (const r of reachable) {
      const sum = r + v
      if (sum === target) return true
      next.add(sum)
    }
    if (next.size > 400000) return false
    reachable = next
  }
  return reachable.has(target)
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
  for (const [source, group] of groups) {
    // Never touch anything the user entered themselves.
    if (source === 'manual') continue
    if (group.length < 3) continue

    for (const tx of group) {
      // Mandatory guard: the importer only falls back to a bare "Deposit" label
      // when the source row carried NO description of its own, and in a
      // Deposits & Withdrawals section every genuine movement is described
      // ("Electronic Fund Transfer", "Disbursement..."). Only the totals line
      // arrives unlabelled, so a real contribution can never be flagged here.
      const desc = (tx.description || '').trim()
      if (!GENERIC.test(desc)) continue

      const amt = CENTS(flowAmount(tx))
      if (amt <= 0) continue

      // The totals row is written at import time, after every movement it sums,
      // so only earlier flows are candidates for its parts.
      const older = group
        .filter((o) => o.id !== tx.id && (!tx.date || !o.date || o.date <= tx.date))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .map((o) => CENTS(flowAmount(o)))

      if (!isSubsetSum(older, amt)) continue

      found.push({
        id: tx.id,
        date: tx.date,
        amount: flowAmount(tx),
        type: (tx.type || '').toUpperCase(),
        reason: 'unlabelled-and-equals-subset-of-earlier-flows',
      })
    }
  }
  return found
}
