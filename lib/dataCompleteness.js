// Data-completeness engine: pure gap-detection over the user's raw data so
// nothing slips through — accounts with balances no transaction explains,
// shares no lot dates, income that vanishes because it has no destination, etc.
// Each finding carries a stable id (code:itemId) for dismissal persistence and
// an `action` the UI can wire to a one-tap fix (edit the item, open the cash
// flow modal prefilled, open the review wizard).
//
// Pure module: no React, no Firestore. Callers pass RAW items (prices in the
// item's own currency), transactions, lots, and the convert(amount, from, to)
// helper. `now` is injectable for tests.

import { isBankLikeItem } from '@/lib/contributions'

const SEVERITY_WEIGHT = { high: 40, medium: 20, low: 10 }
// Ignore accounts worth less than this (in base currency) for history checks —
// a $30 leftover doesn't deserve a "no history" nag.
const MIN_BALANCE_BASE = 100
// partial-history only fires when the unexplained slice is at least this big.
const UNEXPLAINED_FLOOR_BASE = 200
const EXPLAINED_PCT_THRESHOLD = 0.5
const STALE_DAYS = 180

const BROKER_SOURCES = /^(ibkr|blockchain|ledger)$/i

const fmt = (n) => (Math.round(n) || 0).toLocaleString()

function itemCurrency(it) {
  return it.currency || it._originalCurrency || 'USD'
}

// A market asset's live price is NEVER persisted to Firestore by design —
// AddAccountModal never sets currentPrice for a stock/crypto/fund at
// creation, and useMarketPrices resolves it fresh by symbol on every render
// instead. So a raw item's currentPrice being 0 is the NORMAL, expected state
// for a market asset, not evidence its price is missing. `marketPrices` (the
// same map useMarketPrices already produces, keyed by symbol) is the only way
// to tell "genuinely no price resolves for this symbol" apart from "this
// asset's real price just isn't the field this pure module got handed" —
// without it (older callers, tests) this falls back to the item's own stored
// price exactly like before, so nothing here changes when it's omitted.
// FASE HV11. `resolvedPrices` es el precio que la app YA está mostrando para
// ESE ítem, indexado por su id, y por eso va primero: es la única fuente que no
// puede discrepar de lo que el usuario ve en la gráfica y en el Spreadsheet.
//
// El emparejamiento por SÍMBOLO, que era lo único que había, sí puede: dos
// posiciones del mismo activo pueden tener símbolos distintos (una 'BTC' y la
// otra con el nombre puesto como símbolo, o vacío), y entonces una resuelve y
// la otra no. El usuario lo vio exactamente así: dos Bitcoin, el Spreadsheet
// imprimiendo bien los dos al mismo precio, y el aviso diciendo que uno "no
// tiene precio actual: se está contando en $0". Nunca se contó en $0; lo que
// fallaba era esta consulta.
//
// Sin el mapa (callers viejos, tests) cae al camino de siempre.
function effectivePrice(it, marketPrices, resolvedPrices) {
  const resolved = resolvedPrices && it.id ? Number(resolvedPrices[it.id]) || 0 : 0
  if (resolved > 0) return resolved
  const stored = Number(it.currentPrice) || 0
  if (stored > 0) return stored
  if (!marketPrices) return 0
  const live = marketPrices[(it.symbol || '').toUpperCase()] || marketPrices[it.symbol]
  return (live && Number(live.price)) || 0
}

function itemBalance(it, marketPrices, resolvedPrices) {
  // Value in the item's OWN currency (raw fields). Falls back to purchasePrice
  // when neither the stored nor the live price resolves, same fallback chain
  // useDashboardData's own enrichedItems uses for what actually ends up on
  // screen — without it, a market item with only a live-resolved price (never
  // stored) computed as $0 here, read as dust below MIN_BALANCE_BASE, and
  // every check after that floor (no-cost-basis, no-currency, no-history...)
  // silently never ran on it at all.
  if (isBankLikeItem(it)) return Number(it.currentPrice ?? it.purchasePrice) || 0
  const price = effectivePrice(it, marketPrices, resolvedPrices) || Number(it.purchasePrice) || 0
  return (Number(it.quantity) || 0) * price
}

function parseDay(s) {
  if (!s) return null
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

// `it.createdAt` is written as a full ISO datetime string (useFirestoreItems'
// addItem/bulkImport), not the 'YYYY-MM-DD' shape parseDay expects — same
// accessor PortfolioSpreadsheet.jsx already uses for the same field.
function parseCreatedAt(it) {
  if (!it.createdAt) return null
  const d = new Date(it.createdAt)
  return isNaN(d.getTime()) ? null : d
}

const isoDate = (ts) => new Date(ts).toISOString().slice(0, 10)
const MONTH_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthList = (idxs, names) => idxs.map((i) => names[i]).join(', ')

export function analyzeDataCompleteness({ items = [], transactions = [], lots = [], convert, baseCurrency = 'USD', now, marketPrices = null, resolvedPrices = null, pricesReady = true } = {}) {
  const nowDate = now ? new Date(now) : new Date()
  const cv = (amount, from, to) => {
    if (!amount || !from || !to || from === to || typeof convert !== 'function') return amount || 0
    const out = convert(amount, from, to)
    return isFinite(out) ? out : amount
  }
  const toBase = (amount, cur) => cv(amount, cur, baseCurrency)

  const findings = []
  // `suggestion` is optional and ONLY set when a concrete value can be derived
  // from data that already exists (a real transaction, the account's own
  // createdAt) — never invented. When present it lets the UI offer a one-tap
  // "use this" instead of just pointing at the gap and sending the user to
  // hunt the value down and type it in by hand.
  const push = (code, severity, itemId, textEs, textEn, action, suggestion) => {
    findings.push({ id: `${code}:${itemId || 'global'}`, code, severity, itemId: itemId || null, textEs, textEn, action, suggestion: suggestion || null })
  }

  const byId = new Map(items.map((it) => [it.id, it]))
  const bySym = new Map()
  const byName = new Map()
  for (const it of items) {
    if (it.symbol) bySym.set(String(it.symbol).toUpperCase(), it)
    if (it.name) byName.set(String(it.name).toUpperCase(), it)
  }
  const resolveRef = (ref) => {
    if (!ref) return null
    return byId.get(ref) || bySym.get(String(ref).toUpperCase()) || byName.get(String(ref).toUpperCase()) || null
  }

  const isMarket = (it) => /stock|crypto|fund|etf/i.test(it.type || '') && !/realestate/i.test(it.type || '')
  const isBroker = (it) => BROKER_SOURCES.test(it._source || '')
  const isTracked = (it) => !it.isDebt && !it.isExcludedFromNetWorth

  // ── Flow index: which transactions touch which item, and by how much ──────
  // inflow/outflow are kept in the ITEM's currency so they compare directly
  // against its balance. Counts every channel that moves that account's money:
  // linked deposits/withdrawals, transfers in/out, dividends and sale proceeds
  // routed to it (explicit _destinationItemId or the source's incomeDestination).
  const flows = new Map() // itemId -> { count, inflow, outflow, lastTs, firstTs }
  const touch = (id, amountInItemCur, ts) => {
    if (!id || !byId.has(id)) return
    const f = flows.get(id) || { count: 0, inflow: 0, outflow: 0, lastTs: 0, firstTs: 0 }
    f.count += 1
    if (amountInItemCur >= 0) f.inflow += amountInItemCur
    else f.outflow += -amountInItemCur
    if (ts) {
      f.lastTs = Math.max(f.lastTs, ts)
      f.firstTs = f.firstTs ? Math.min(f.firstTs, ts) : ts
    }
    flows.set(id, f)
  }

  // Real payment history for income suggestions below: which months a source
  // actually paid in, and which account its payments actually landed in —
  // both read straight off past DIVIDEND/INTEREST transactions, never guessed.
  const incomeMonthsByItem = new Map() // itemId -> Set<monthIndex 0-11>
  const incomeDestByItem = new Map() // itemId -> { id, ts } (most recent destination seen)

  for (const tx of transactions) {
    const ty = (tx.type || '').toUpperCase()
    const amt = Number(tx.totalAmount ?? tx.amount) || 0
    if (!(amt > 0)) continue
    const txCur = tx.currency || baseCurrency
    const ts = parseDay(tx.date)?.getTime() || 0
    const inItemCur = (id) => cv(amt, txCur, itemCurrency(byId.get(id) || {}))

    if (ty === 'DEPOSIT' && tx._linkedItemId) {
      touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'WITHDRAWAL' && tx._linkedItemId) {
      touch(tx._linkedItemId, -inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'TRANSFER') {
      if (tx._originItemId) touch(tx._originItemId, -inItemCur(tx._originItemId), ts)
      if (tx._linkedItemId) touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'DIVIDEND') {
      if (tx._destinationItemId) {
        touch(tx._destinationItemId, inItemCur(tx._destinationItemId), ts)
      } else if (tx._linkedItemId) {
        const src = byId.get(tx._linkedItemId)
        if (tx._reinvested || (src && src.dividendAction === 'reinvest')) {
          // Reinvested into the source: it explains the source's growth.
          touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
        } else {
          const dest = resolveRef(src?.incomeDestination)
          if (dest) touch(dest.id, cv(amt, txCur, itemCurrency(dest)), ts)
          else touch(tx._linkedItemId, 0, ts) // at least marks the source as "has history"
        }
      }
    } else if (ty === 'SELL') {
      if (tx._destinationItemId) touch(tx._destinationItemId, inItemCur(tx._destinationItemId), ts)
      if (tx._linkedItemId) touch(tx._linkedItemId, 0, ts)
    }

    if ((ty === 'DIVIDEND' || ty === 'INTEREST') && tx._linkedItemId) {
      const day = parseDay(tx.date)
      if (day) {
        const set = incomeMonthsByItem.get(tx._linkedItemId) || new Set()
        set.add(day.getUTCMonth())
        incomeMonthsByItem.set(tx._linkedItemId, set)
      }
      if (tx._destinationItemId) {
        const prev = incomeDestByItem.get(tx._linkedItemId)
        if (!prev || ts >= prev.ts) incomeDestByItem.set(tx._linkedItemId, { id: tx._destinationItemId, ts })
      }
    }
  }

  // ── Per-item checks ────────────────────────────────────────────────────────
  for (const it of items) {
    const name = it.name || it.symbol || '-'
    const cur = itemCurrency(it)
    const balance = itemBalance(it, marketPrices, resolvedPrices)
    const balanceBase = toBase(balance, cur)
    const broker = isBroker(it)

    // 4. Missing acquisition date. NOT for broker items: their date comes from the
    // sync/Excel import, not something the user should hand-type. Nagging on an IBKR
    // stock is noise (and if it's missing that's an import concern, not a user to-do).
    if (!broker && !it.acquisitionDate) {
      // Best real date we have: the earliest transaction actually linked to
      // this item, else the moment the account itself was added to Chispudo
      // (createdAt) — both are values already on file, never a guess.
      const firstFlowTs = flows.get(it.id)?.firstTs || null
      const createdTs = parseCreatedAt(it)?.getTime() || null
      const candidateTs = firstFlowTs || createdTs
      const suggestion = candidateTs ? {
        patch: { acquisitionDate: isoDate(candidateTs) },
        textEs: firstFlowTs
          ? `Usar la fecha de tu primer movimiento registrado: ${isoDate(candidateTs)}.`
          : `Usar la fecha en que agregaste esta cuenta: ${isoDate(candidateTs)}.`,
        textEn: firstFlowTs
          ? `Use the date of your first recorded transaction: ${isoDate(candidateTs)}.`
          : `Use the date you added this account: ${isoDate(candidateTs)}.`,
      } : null
      push('no-acq-date', 'high', it.id,
        `${name} no tiene fecha de adquisición: sin ella el historial no sabe desde cuándo existe.`,
        `${name} has no acquisition date: history can't tell when it started.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 13. Market asset silently worth $0: a real holding (quantity > 0) whose
    // price never synced or was left blank shows as zero on every card, as if
    // the position vanished. Placed BEFORE the dust-floor `continue` below on
    // purpose: the bug IS that its value reads as dust, so the floor would
    // hide exactly the case this exists to catch.
    //
    // A market item's currentPrice is NEVER the raw item's own field in
    // practice — it's resolved live by symbol on every render
    // (useMarketPrices), never written back to Firestore. Reading
    // it.currentPrice directly here flagged nearly every working stock/crypto
    // position in the portfolio: real holdings, real prices shown everywhere
    // else, just not the field this pure module was handed. effectivePrice
    // checks the live marketPrices map (when the caller passes one) before
    // concluding the price is actually missing.
    // `pricesReady` false = la cotización todavía viene en camino (o el fetch de
    // esta vuelta falló). Ahí "no tiene precio" no es un hueco de datos del
    // usuario sino un estado momentáneo de la app, y avisarlo es gritar lobo:
    // el usuario lo reportó como "A VECES con BTC no detecta el precio, pero en
    // la gráfica y en el Spreadsheet me aparece bien". Un activo genuinamente
    // sin precio sigue avisando en cuanto la vuelta de precios termina.
    if (pricesReady && !broker && isTracked(it) && isMarket(it) && (Number(it.quantity) || 0) > 0 && !(effectivePrice(it, marketPrices, resolvedPrices) > 0)) {
      push('no-market-price', 'high', it.id,
        `${name} tiene ${it.quantity} unidades pero sin precio actual: se está contando en $0 en tu patrimonio.`,
        `${name} holds ${it.quantity} units but has no current price: it's being counted as $0 in your net worth.`,
        { kind: 'edit-item' })
    }

    // Global exemptions for the rest: broker data is authoritative, debt and
    // excluded items don't feed the history math, dust accounts are noise.
    if (broker || !isTracked(it) || balanceBase < MIN_BALANCE_BASE) continue

    // 14. Cost basis missing on a priced market holding: the gain shown
    // assumes it cost $0, inflating the return on every P&L card. Same
    // effectivePrice reasoning as #13 above for the gate.
    if (isMarket(it) && (Number(it.quantity) || 0) > 0 && effectivePrice(it, marketPrices, resolvedPrices) > 0 && !((Number(it.purchasePrice) || 0) > 0)) {
      push('no-cost-basis', 'medium', it.id,
        `${name} no tiene precio de compra: la ganancia mostrada asume que costó $0.`,
        `${name} has no purchase price: the gain shown assumes it cost $0.`,
        { kind: 'edit-item' })
    }

    // 15. Market asset with no symbol: price sync, lot matching and dividend
    // attribution all key off it, so a blank symbol silently opts the asset
    // out of all three.
    if (isMarket(it) && !it.symbol) {
      push('no-symbol', 'medium', it.id,
        `${name} no tiene símbolo: no se puede sincronizar su precio ni vincular sus movimientos.`,
        `${name} has no symbol: its price can't sync and its transactions can't be matched to it.`,
        { kind: 'edit-item' })
    }

    // 5. Missing currency (assumed USD silently — a 7.8× error for GTQ).
    if (!it.currency && !it._originalCurrency) {
      push('no-currency', 'medium', it.id,
        `${name} no tiene moneda: se asume USD, lo que distorsiona los totales si no lo es.`,
        `${name} has no currency: USD is assumed, which skews totals if it isn't.`,
        { kind: 'edit-item' })
    }

    // 10. Missing institution (drives merges and lot attribution).
    if (!it.institution) {
      push('no-institution', 'low', it.id,
        `${name} no tiene institución: ayuda a agrupar y a atribuir compras.`,
        `${name} has no institution: it helps grouping and lot attribution.`,
        { kind: 'edit-item' })
    }

    const hasIncome = (Number(it.incomeRate) || 0) > 0 || (Number(it.incomeAmount) || 0) > 0 || (Number(it.dividendYield) || 0) > 0

    // 6. Income without payment months → projections assume all 12.
    if (hasIncome && !(Array.isArray(it.incomeMonths) && it.incomeMonths.length > 0)) {
      const seenMonths = incomeMonthsByItem.get(it.id)
      const suggestion = seenMonths && seenMonths.size > 0 ? (() => {
        const idxs = [...seenMonths].sort((a, b) => a - b)
        return {
          patch: { incomeMonths: idxs, incomeMonthsExplicit: true },
          textEs: `Ya vimos pagos en ${monthList(idxs, MONTH_ES)}: usar esos meses.`,
          textEn: `We already saw payments in ${monthList(idxs, MONTH_EN)}: use those months.`,
        }
      })() : null
      push('income-no-months', 'medium', it.id,
        `${name} genera ingresos pero no dice en qué meses pagan: la proyección asume los 12.`,
        `${name} earns income but has no payment months: projections assume all 12.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 7. Cash income with nowhere to land → payments vanish from tracking.
    if (hasIncome && it.dividendAction !== 'reinvest' && !it.incomeDestination) {
      const seenDest = incomeDestByItem.get(it.id)
      const destItem = seenDest ? byId.get(seenDest.id) : null
      const suggestion = destItem ? {
        patch: { incomeDestination: destItem.id },
        textEs: `Sus pagos ya llegan a ${destItem.name || destItem.symbol}: usar esa cuenta como destino.`,
        textEn: `Its payments already land in ${destItem.name || destItem.symbol}: use that account as the destination.`,
      } : null
      push('income-no-dest', 'low', it.id,
        `¿A qué cuenta llegan los pagos de ${name}? Sin destino, desaparecen del rastreo.`,
        `Where do ${name}'s payments land? Without a destination they vanish from tracking.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 9. Broken income destination link. No real replacement to suggest (the
    // account it pointed to is genuinely gone), but clearing a dead reference
    // is a safe action, not a guess — it removes stale data, it invents none.
    if (it.incomeDestination && !resolveRef(it.incomeDestination)) {
      push('broken-link', 'medium', it.id,
        `El destino de ingresos de ${name} apunta a una cuenta que ya no existe.`,
        `${name}'s income destination points at an account that no longer exists.`,
        { kind: 'edit-item' }, {
          patch: { incomeDestination: null },
          textEs: 'Quitar la referencia rota: después puedes asignar una cuenta nueva.',
          textEn: 'Clear the broken reference: you can assign a new account afterward.',
        })
    }

    // 11. Matured but still on the books.
    const maturity = parseDay(it.maturityDate)
    if (maturity && maturity < nowDate) {
      push('past-maturity', 'medium', it.id,
        `${name} venció el ${it.maturityDate}: ¿se renovó, se cobró, se convirtió?`,
        `${name} matured on ${it.maturityDate}: was it renewed, cashed out, converted?`,
        { kind: 'edit-item' })
    }

    // 16. Maturity before acquisition: the two dates contradict each other,
    // almost always a typo in one of them. Independent of #11 above (a bond
    // can fail this check while still being in the future).
    const acqForMaturity = parseDay(it.acquisitionDate)
    if (maturity && acqForMaturity && maturity < acqForMaturity) {
      push('bad-maturity-date', 'medium', it.id,
        `${name} vence el ${it.maturityDate}, antes de haberse adquirido el ${it.acquisitionDate}: revisa las fechas.`,
        `${name} matures on ${it.maturityDate}, before it was acquired on ${it.acquisitionDate}: check the dates.`,
        { kind: 'edit-item' })
    }

    // History checks only make sense for balance-style (static) assets —
    // market assets reconstruct from lots (checked separately below).
    if (!isMarket(it)) {
      const f = flows.get(it.id)
      // "¿De dónde vino este dinero?" — asked and answered once, at creation
      // (AddAccountModal's "es dinero nuevo" toggle, stamped as
      // `_newMoneyConfirmed`). It must not come back just because the DEPOSIT
      // transaction that normally proves it got edited, deduped, or never
      // synced the way this check expects — that reads as the app not having
      // listened, and worse, invites a real duplicate deposit from a
      // well-meaning second click on "Capturar historia". Scoped to ONLY
      // these two checks: staleness (#8 below) is a different question and
      // still deserves its own nag regardless of how the money arrived.
      const originConfirmed = !!it._newMoneyConfirmed

      // 1. No history at all: a balance no movement explains.
      if (!originConfirmed && (!f || f.count === 0)) {
        push('no-history', 'high', it.id,
          `${name} tiene ${cur} ${fmt(balance)} sin ningún movimiento que lo explique: ¿cuándo entró este dinero?`,
          `${name} holds ${cur} ${fmt(balance)} with no movement explaining it: when did this money arrive?`,
          { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true } })
      } else if (f) {
        // 2. Partial history: flows explain less than half the balance.
        // Growth (interest) legitimately widens balance beyond net flows, so
        // the 50% bar + an absolute floor keep compounding out of the noise.
        const explained = f.inflow - f.outflow
        const unexplained = balance - explained
        const unexplainedBase = toBase(unexplained, cur)
        if (!originConfirmed && balance > 0 && explained / balance < EXPLAINED_PCT_THRESHOLD && unexplainedBase > UNEXPLAINED_FLOOR_BASE) {
          const pct = Math.max(0, Math.round((explained / balance) * 100))
          push('partial-history', 'medium', it.id,
            `Solo el ${pct}% del saldo de ${name} tiene historia: faltan aportes por ${cur} ${fmt(unexplained)}.`,
            `Only ${pct}% of ${name}'s balance has history: contributions worth ${cur} ${fmt(unexplained)} are missing.`,
            { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true } })
        }
      }
      // 8. Stale value: nothing touched it in a long time. A different
      // question from "where did it come from" — still asked even once the
      // origin is confirmed.
      const lastTouch = Math.max(
        f?.lastTs || 0,
        parseDay(it.lastValuationDate)?.getTime() || 0,
        parseDay(it.acquisitionDate)?.getTime() || 0,
        new Date(it.createdAt || 0).getTime() || 0,
      )
      if (!it.isIlliquid && lastTouch > 0 && (nowDate.getTime() - lastTouch) > STALE_DAYS * 86400000) {
        push('stale-value', 'low', it.id,
          `${name} no registra movimientos ni valuación en más de ${STALE_DAYS} días: ¿sigue valiendo lo mismo?`,
          `${name} has had no movement or valuation in over ${STALE_DAYS} days: is it still worth the same?`,
          { kind: 'edit-item' })
      }
    }
  }

  // ── 3. Uncovered shares: market quantity without lot dates ────────────────
  // Lots are keyed by symbol (attribution prefers institution, like
  // closeLotsFIFO), and reconstruction is per-symbol, so the gap is evaluated
  // per symbol aggregate — shared symbols across wallets don't false-positive.
  const marketBySym = new Map()
  for (const it of items) {
    if (!isMarket(it) || !it.symbol || isBroker(it) || !isTracked(it)) continue
    // Rate-bearing qty-1 "funds" (liquid funds, CDT-style) are balance assets:
    // there are no shares to cover with lots — their history comes from linked
    // deposits, not purchase records.
    if ((Number(it.quantity) || 0) === 1 && (Number(it.incomeRate) || 0) > 0) continue
    const sym = String(it.symbol).toUpperCase()
    const g = marketBySym.get(sym) || { qty: 0, items: [] }
    g.qty += Number(it.quantity) || 0
    g.items.push(it)
    marketBySym.set(sym, g)
  }
  const openLotQty = new Map()
  for (const lot of lots) {
    if ((lot.status || 'open') !== 'open') continue
    const sym = String(lot.symbol || '').toUpperCase()
    if (!sym) continue
    openLotQty.set(sym, (openLotQty.get(sym) || 0) + (Number(lot.quantity) || 0))
  }
  for (const [sym, g] of marketBySym) {
    if (!(g.qty > 0)) continue
    const covered = openLotQty.get(sym) || 0
    const gap = g.qty - covered
    if (gap > g.qty * 0.01) {
      const biggest = g.items.reduce((a, b) => (itemBalance(a, marketPrices, resolvedPrices) >= itemBalance(b, marketPrices, resolvedPrices) ? a : b))
      push('uncovered-shares', 'medium', biggest.id,
        `${fmt(gap)} de ${fmt(g.qty)} unidades de ${sym} no tienen registro de compra: confirma la fecha de adquisición del activo para anclar su historial.`,
        `${fmt(gap)} of ${fmt(g.qty)} ${sym} units have no purchase record: confirm the asset's acquisition date to anchor its history.`,
        { kind: 'edit-item' })
    }
  }

  // ── 12. Duplicate suspects: same symbol + institution, both manual ────────
  const dupKey = new Map()
  for (const it of items) {
    if (isBroker(it) || !it.symbol || it.isDebt) continue
    const key = `${String(it.symbol).toUpperCase()}|${(it.institution || '').toLowerCase()}`
    ;(dupKey.get(key) || dupKey.set(key, []).get(key)).push(it)
  }
  for (const [, group] of dupKey) {
    if (group.length < 2) continue
    // Answered once, stays answered — same pattern as _newMoneyConfirmed
    // (FASE DP): a flag on the ITEM, not a client-only dismiss, so "no son
    // iguales" sticks across every surface that runs this same check
    // (ChispuSuggestions AND AccountReviewModal), not just the one it was
    // clicked in. Only suppressed while the group is EXACTLY these items —
    // a new item later sharing the same symbol+institution has no flag of
    // its own, so it re-asks about the new situation, not the old one.
    if (group.every((it) => it._dupConfirmedDistinct)) continue
    const names = group.map((g) => g.name || g.symbol).join(', ')
    push('dup-suspect', 'low', group[0].id,
      `${names} comparten símbolo e institución: ¿son la misma posición duplicada?`,
      `${names} share symbol and institution: are they the same position duplicated?`,
      { kind: 'review', itemIds: group.map((g) => g.id) })
  }

  // ── Scores ─────────────────────────────────────────────────────────────────
  const itemScores = {}
  for (const it of items) itemScores[it.id] = 100
  for (const fnd of findings) {
    if (fnd.itemId && itemScores[fnd.itemId] != null) {
      itemScores[fnd.itemId] = Math.max(0, itemScores[fnd.itemId] - SEVERITY_WEIGHT[fnd.severity])
    }
  }
  let weightSum = 0
  let scoreSum = 0
  for (const it of items) {
    if (!isTracked(it)) continue
    const w = Math.max(toBase(itemBalance(it, marketPrices, resolvedPrices), itemCurrency(it)), 1)
    weightSum += w
    scoreSum += w * itemScores[it.id]
  }
  const globalScore = weightSum > 0 ? Math.round(scoreSum / weightSum) : 100

  const order = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { findings, itemScores, globalScore }
}
