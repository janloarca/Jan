// Decisions for the automatic income engine (useDashboardData's processDividends),
// pulled out as pure functions because getting them wrong silently doubles money.
//
// The engine creates a DIVIDEND transaction for each scheduled payment and, when
// the income is routed to another account, credits that account's balance. So a
// payment written twice is not a cosmetic duplicate: the destination's stored
// balance goes up twice and STAYS up, and every past month reconstructed from it
// inherits the wrong figure. That is how a semiannual $240 coupon left a cash
// account sitting at $480 from July onward (FASE DH).
//
// The bug was that "did we already pay this?" compared the FULL date. The
// schedule pays on `incomePayDay`, but a coupon the user records by hand carries
// the day it actually landed (the 15th, say). Different strings, so the engine
// saw no payment and wrote its own on the 1st. Both then credited the
// destination. Matching by MONTH is the fix: a month either has been paid or it
// has not, whoever recorded it.

import { getTypeCategory } from '@/components/dashboard/utils'

const monthKey = (dateStr) => (dateStr ? String(dateStr).slice(0, 7) : '')

const belongsTo = (tx, item) => {
  if (tx._linkedItemId) return tx._linkedItemId === item.id
  const sym = item.symbol || item.name
  return !!sym && tx.symbol === sym
}

const isDividend = (tx) => (tx.type || '').toUpperCase() === 'DIVIDEND'

/**
 * Has this item already been paid for the month of `dateStr`, by ANY route
 * (the engine, an import, or the user typing it in)? Compared by month, never
 * by exact date: the schedule's pay day and the day the money really landed
 * are routinely different, and treating those as two payments doubles them.
 */
export function hasDividendInMonth(transactions, item, dateStr) {
  const mk = monthKey(dateStr)
  if (!mk || !item) return false
  return (transactions || []).some(
    (tx) => isDividend(tx) && monthKey(tx.date) === mk && belongsTo(tx, item)
  )
}

/**
 * Auto-generated payments that should not exist any more, as transaction ids:
 *  - a month the schedule no longer pays,
 *  - a second auto payment in a month that already has one,
 *  - an auto payment in a month where a REAL (non-auto) dividend exists. The
 *    recorded one is the truth; the fabricated one is the duplicate, so it goes,
 *    never the other way around.
 *
 * `payMonths` is 0-indexed (UTC month numbers), matching the item's incomeMonths.
 * With no explicit schedule the engine cannot know which months pay, so it only
 * keeps the newest auto payment.
 */
export function redundantAutoDividendIds(transactions, item, payMonths, explicitSchedule) {
  const all = (transactions || []).filter((tx) => isDividend(tx) && belongsTo(tx, item))
  const autos = all
    .filter((tx) => tx._source === 'auto' && tx.id)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  if (autos.length === 0) return []

  if (!explicitSchedule) {
    // Unknown schedule: keep only the most recent auto payment.
    return autos.slice(0, -1).map((tx) => tx.id)
  }

  const manualMonths = new Set(
    all.filter((tx) => tx._source !== 'auto' && tx.date).map((tx) => monthKey(tx.date))
  )
  const months = Array.isArray(payMonths) ? payMonths : []
  const keptMonths = new Set()
  const drop = []
  for (const tx of autos) {
    if (!tx.date) { drop.push(tx.id); continue }
    const mk = monthKey(tx.date)
    const monthIndex = Number(mk.slice(5, 7)) - 1
    if (!months.includes(monthIndex) || manualMonths.has(mk) || keptMonths.has(mk)) {
      drop.push(tx.id)
    } else {
      keptMonths.add(mk)
    }
  }
  return drop
}

/**
 * Backfilled payments the destination's balance provably does NOT already
 * contain, so they can be credited after the fact.
 *
 * A backfilled coupon deliberately does not move the destination's balance: the
 * figure the user typed is a photo of TODAY, so a coupon from a month that
 * already closed is assumed to be inside it already. Crediting it again is what
 * left a cash account permanently $240 high (FASE DI), so the payment is written
 * as history and tagged `_destinationCredited:false`.
 *
 * That assumption has one case where it is certainly wrong: a balance of zero.
 * An empty account cannot "already contain" a $240 coupon. The destination
 * created alongside the asset that feeds it (VITALI → Fondo Líquido, opened at
 * 0) hit exactly that: the transaction was on file and visible in the account,
 * but the balance stayed 0, so the spreadsheet reconstructed every month from 0
 * and the coupon existed nowhere in the history (FASE DV).
 *
 * Deliberately narrow — only `balance <= 0`, never "the balance looks too small".
 * A typed balance of 100 against a 240 coupon is genuinely ambiguous (did 140
 * leave, or is the 100 stale?), and guessing there re-opens the double-credit
 * bug this flag exists to prevent. Zero is not ambiguous.
 *
 * Returns the matching transactions (not just ids): the caller needs each
 * amount and currency to credit, and each id to flip the flag afterwards so a
 * later cleanup reverses a credit that now really happened.
 */
// Cuándo salió dinero de esta cuenta por última vez, o null si nunca salió.
//
// Las dos formas en que una cuenta se vacía: una TRANSFERENCIA cuyo ORIGEN es
// ella (`_originItemId`, lib/transferTx.js) y un RETIRO vinculado a ella
// (`_linkedItemId`). Se compara por TEXTO 'YYYY-MM-DD', nunca con `new Date`:
// el orden lexicográfico de una fecha ISO ya es el cronológico y no lo puede
// corromper una zona horaria (regla de lib/financeMonth.js).
export function latestOutflowDate(transactions, destId) {
  if (!destId) return null
  let latest = null
  for (const tx of transactions || []) {
    const type = String(tx?.type || '').toUpperCase()
    const isOut = type === 'TRANSFER'
      ? tx._originItemId === destId
      : type === 'WITHDRAWAL' && tx._linkedItemId === destId
    if (!isOut) continue
    const d = typeof tx.date === 'string' ? tx.date.slice(0, 10) : null
    if (!d) continue
    if (!latest || d > latest) latest = d
  }
  return latest
}

export function creditableBackfills(transactions, item, destinationBalance) {
  if (!item || !item.incomeDestination) return []
  if (!(Number(destinationBalance) <= 0)) return []
  const pending = (transactions || []).filter(
    (tx) => tx && tx.id && isDividend(tx) && belongsTo(tx, item)
      && tx._destinationCredited === false
      && Number(tx.totalAmount ?? tx.amount ?? 0) > 0
  )
  if (pending.length === 0) return []

  // ⛔ UN SALDO EN CERO TIENE DOS CAUSAS Y SOLO UNA ADMITE ESTE CRÉDITO.
  //
  // El caso para el que esto se construyó (FASE DV) es una cuenta que NUNCA se
  // fondeó: la que nace junto al activo que la alimenta (VITALI → Fondo
  // Líquido, abierta en 0). Ahí el cupón de verdad no está adentro y hay que
  // meterlo.
  //
  // El otro caso es una cuenta que el usuario VACIÓ a propósito, y ahí este
  // crédito la vuelve a llenar. Ese era el defecto, reportado cinco veces
  // sobre la misma cuenta: vaciaba su fondo líquido en dólares, y volvía a
  // 240, que es exactamente el cupón semestral de VITALI. Tres vaciados
  // seguidos acreditaron tres cupones atrasados, uno por vez. Y solo pasaba en
  // el fondo de DÓLARES porque es el único que recibe pagos de ese bono, que
  // es justo lo que el usuario venía diciendo desde el principio.
  //
  // La evidencia que las separa está en el archivo y no hay que adivinarla: si
  // salió dinero de la cuenta DESPUÉS del cupón, ese cupón ya pasó por ahí (o
  // el usuario la puso en cero a conciencia), y en las dos lecturas volver a
  // sumarlo es inventar dinero. Sin ninguna salida, la cuenta nunca se usó y
  // el comportamiento de FASE DV se conserva intacto.
  const lastOutflow = latestOutflowDate(transactions, item.incomeDestination)
  if (!lastOutflow) return pending
  return pending.filter((tx) => {
    const d = typeof tx.date === 'string' ? tx.date.slice(0, 10) : null
    // Sin fecha no se puede juzgar contra la salida. Se REHÚSA: un cupón sin
    // acreditar se ve en el historial y se puede arreglar, uno acreditado de
    // más rellena en silencio una cuenta que el usuario acaba de vaciar.
    if (!d) return false
    return d > lastOutflow
  })
}

/**
 * The math behind crediting (or reversing) one destination account's balance,
 * with a RUNNING total that survives across every call made during the same
 * processDividends pass — not just within one item's own batched payments.
 *
 * Real bug (FASE EL): two DIFFERENT items sharing ONE destination (XOCHI and
 * CrediCorp, both paying into Fondo Líquido Q) each called the old
 * addToDestination with `dest` taken from the SAME enrichedItems snapshot,
 * captured once before processDividends started writing anything. XOCHI's
 * credit landed in Firestore; CrediCorp's call still saw the PRE-XOCHI
 * balance in its own `dest` object, so it computed newBalance from that stale
 * number and overwrote Firestore with just its own amount — erasing XOCHI's
 * credit entirely, with no error and no trace beyond the destination's
 * balance quietly going backwards. Adding a second bond to a shared account
 * was all it took; nothing about editing was required.
 *
 * The fix: every credit/reversal for a given destination, however many items
 * or however many separate calls trigger it, reads and writes the SAME
 * runningBalances accumulator (keyed by destination id, mutated in place) —
 * so the second call in a run always builds on the first call's result,
 * never on a snapshot taken before either of them ran.
 *
 * @param runningBalances  mutable { [destId]: currentBalance } accumulator,
 *                          shared across every call in one processDividends run
 * @param dest              the destination item (its OWN currency/type/quantity;
 *                          its purchasePrice/currentPrice is only the SEED,
 *                          used the first time this destination is touched)
 * @param amount            signed amount in sourceCurrency (negative = reversal)
 * @param sourceCurrency    currency `amount` is denominated in
 * @param convert           (amount, from, to) => number, or null/undefined for no-op
 */
export function creditDestinationBalance(runningBalances, dest, amount, sourceCurrency, convert) {
  const destCur = dest.currency || dest._originalCurrency || 'USD'
  const converted = convert ? convert(amount, sourceCurrency, destCur) : amount
  const key = dest.id
  const seed = (dest.quantity || 1) * (dest._originalPrice ?? dest.purchasePrice ?? 0)
  const oldBalance = Object.prototype.hasOwnProperty.call(runningBalances, key) ? runningBalances[key] : seed
  const newBalance = oldBalance + (Number.isFinite(converted) ? converted : 0)
  runningBalances[key] = newBalance
  const rawQty = Number(dest.quantity)
  const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1
  // ⛔ El precio de arriba se calcula ASUMIENDO esa cantidad, así que si la
  // guardada no es esa hay que escribirla: `getItemValue` multiplica por la
  // cantidad REAL, y con cantidad 0 el saldo acreditado se lee como CERO.
  //
  // El caso real: una cuenta que se vació entera (una transferencia que la deja
  // en cero escribe `quantity: 0`, lib/transferFields.js) y después recibe el
  // cupón de un bono. El movimiento se archivaba bien y se veía en el historial
  // de la cuenta, pero su valor seguía en 0.00 en la Hoja y en el patrimonio:
  // el dinero entraba al precio y nadie lo leía. Sin esto, TODOS los cupones
  // siguientes a esa cuenta también desaparecían.
  //
  // `creditFields` (el camino hermano, transferencias) ya normaliza así desde
  // FASE JD3; este camino era la copia que se quedó atrás.
  const newQuantity = Number.isFinite(rawQty) && rawQty > 0 ? null : 1
  return { newBalance, newPrice: newBalance / qty, newQuantity }
}

/**
 * FASE EP. Whether a DIVIDEND transaction moved a destination account's
 * balance when it was written — and if so, where that money went — so the
 * user-facing delete/edit paths (EditAccountModal, RecentTransactions) can
 * reverse or adjust the same credit `creditDestinationBalance` applied,
 * instead of leaving the destination permanently off by the stale amount.
 *
 * Returns null for anything that never touched a balance: not a DIVIDEND,
 * reinvested (touches quantity/lots, not a destination), or a backfilled
 * payment (`_destinationCredited:false`, written as history without moving
 * money — see the comment on that flag where DIVIDEND transactions are
 * created). Also null for a destination type the engine itself would have
 * skipped crediting (stocks/crypto/funds carry their own market price, not a
 * stored balance).
 *
 * @param tx     the DIVIDEND transaction being deleted or edited
 * @param items  enriched items (needs `_originalPrice`/`_originalCurrency`,
 *               the same fields creditDestinationBalance reads)
 */
export function dividendCreditTarget(tx, items) {
  if ((tx?.type || '').toUpperCase() !== 'DIVIDEND') return null
  if (tx._reinvested) return null
  if (tx._destinationCredited === false) return null
  const source = (items || []).find((it) => it.id === tx._linkedItemId)
  if (!source?.incomeDestination) return null
  const dest = (items || []).find((it) => (it.id || it.symbol) === source.incomeDestination)
  if (!dest) return null
  const cat = getTypeCategory(dest)
  if (cat === 'stocks' || cat === 'crypto' || cat === 'funds') return null
  return { dest, currency: tx.currency || source._originalCurrency || 'USD' }
}
