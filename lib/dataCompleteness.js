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

function itemBalance(it) {
  // Value in the item's OWN currency (raw fields).
  if (isBankLikeItem(it)) return Number(it.currentPrice ?? it.purchasePrice) || 0
  return (Number(it.quantity) || 0) * (Number(it.currentPrice ?? it.purchasePrice) || 0)
}

function parseDay(s) {
  if (!s) return null
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

export function analyzeDataCompleteness({ items = [], transactions = [], lots = [], convert, baseCurrency = 'USD', now } = {}) {
  const nowDate = now ? new Date(now) : new Date()
  const cv = (amount, from, to) => {
    if (!amount || !from || !to || from === to || typeof convert !== 'function') return amount || 0
    const out = convert(amount, from, to)
    return isFinite(out) ? out : amount
  }
  const toBase = (amount, cur) => cv(amount, cur, baseCurrency)

  const findings = []
  const push = (code, severity, itemId, textEs, textEn, action) => {
    findings.push({ id: `${code}:${itemId || 'global'}`, code, severity, itemId: itemId || null, textEs, textEn, action })
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
  const flows = new Map() // itemId -> { count, inflow, outflow, lastTs }
  const touch = (id, amountInItemCur, ts) => {
    if (!id || !byId.has(id)) return
    const f = flows.get(id) || { count: 0, inflow: 0, outflow: 0, lastTs: 0 }
    f.count += 1
    if (amountInItemCur >= 0) f.inflow += amountInItemCur
    else f.outflow += -amountInItemCur
    if (ts) f.lastTs = Math.max(f.lastTs, ts)
    flows.set(id, f)
  }

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
  }

  // ── Per-item checks ────────────────────────────────────────────────────────
  for (const it of items) {
    const name = it.name || it.symbol || '—'
    const cur = itemCurrency(it)
    const balance = itemBalance(it)
    const balanceBase = toBase(balance, cur)
    const broker = isBroker(it)

    // 4. Missing acquisition date — applies to everything (it gates history).
    if (!it.acquisitionDate) {
      push('no-acq-date', 'high', it.id,
        `${name} no tiene fecha de adquisición — sin ella el historial no sabe desde cuándo existe.`,
        `${name} has no acquisition date — history can't tell when it started.`,
        { kind: 'edit-item' })
    }

    // Global exemptions for the rest: broker data is authoritative, debt and
    // excluded items don't feed the history math, dust accounts are noise.
    if (broker || !isTracked(it) || balanceBase < MIN_BALANCE_BASE) continue

    // 5. Missing currency (assumed USD silently — a 7.8× error for GTQ).
    if (!it.currency && !it._originalCurrency) {
      push('no-currency', 'medium', it.id,
        `${name} no tiene moneda — se asume USD, lo que distorsiona los totales si no lo es.`,
        `${name} has no currency — USD is assumed, which skews totals if it isn't.`,
        { kind: 'edit-item' })
    }

    // 10. Missing institution (drives merges and lot attribution).
    if (!it.institution) {
      push('no-institution', 'low', it.id,
        `${name} no tiene institución — ayuda a agrupar y a atribuir compras.`,
        `${name} has no institution — it helps grouping and lot attribution.`,
        { kind: 'edit-item' })
    }

    const hasIncome = (Number(it.incomeRate) || 0) > 0 || (Number(it.incomeAmount) || 0) > 0 || (Number(it.dividendYield) || 0) > 0

    // 6. Income without payment months → projections assume all 12.
    if (hasIncome && !(Array.isArray(it.incomeMonths) && it.incomeMonths.length > 0)) {
      push('income-no-months', 'medium', it.id,
        `${name} genera ingresos pero no dice en qué meses pagan — la proyección asume los 12.`,
        `${name} earns income but has no payment months — projections assume all 12.`,
        { kind: 'edit-item' })
    }

    // 7. Cash income with nowhere to land → payments vanish from tracking.
    if (hasIncome && it.dividendAction !== 'reinvest' && !it.incomeDestination) {
      push('income-no-dest', 'low', it.id,
        `¿A qué cuenta llegan los pagos de ${name}? Sin destino, desaparecen del rastreo.`,
        `Where do ${name}'s payments land? Without a destination they vanish from tracking.`,
        { kind: 'edit-item' })
    }

    // 9. Broken income destination link.
    if (it.incomeDestination && !resolveRef(it.incomeDestination)) {
      push('broken-link', 'medium', it.id,
        `El destino de ingresos de ${name} apunta a una cuenta que ya no existe.`,
        `${name}'s income destination points at an account that no longer exists.`,
        { kind: 'edit-item' })
    }

    // 11. Matured but still on the books.
    const maturity = parseDay(it.maturityDate)
    if (maturity && maturity < nowDate) {
      push('past-maturity', 'medium', it.id,
        `${name} venció el ${it.maturityDate} — ¿se renovó, se cobró, se convirtió?`,
        `${name} matured on ${it.maturityDate} — was it renewed, cashed out, converted?`,
        { kind: 'edit-item' })
    }

    // History checks only make sense for balance-style (static) assets —
    // market assets reconstruct from lots (checked separately below).
    if (!isMarket(it)) {
      const f = flows.get(it.id)

      // 1. No history at all: a balance no movement explains.
      if (!f || f.count === 0) {
        push('no-history', 'high', it.id,
          `${name} tiene ${cur} ${fmt(balance)} sin ningún movimiento que lo explique — ¿cuándo entró este dinero?`,
          `${name} holds ${cur} ${fmt(balance)} with no movement explaining it — when did this money arrive?`,
          { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true } })
      } else {
        // 2. Partial history: flows explain less than half the balance.
        // Growth (interest) legitimately widens balance beyond net flows, so
        // the 50% bar + an absolute floor keep compounding out of the noise.
        const explained = f.inflow - f.outflow
        const unexplained = balance - explained
        const unexplainedBase = toBase(unexplained, cur)
        if (balance > 0 && explained / balance < EXPLAINED_PCT_THRESHOLD && unexplainedBase > UNEXPLAINED_FLOOR_BASE) {
          const pct = Math.max(0, Math.round((explained / balance) * 100))
          push('partial-history', 'medium', it.id,
            `Solo el ${pct}% del saldo de ${name} tiene historia — faltan aportes por ${cur} ${fmt(unexplained)}.`,
            `Only ${pct}% of ${name}'s balance has history — contributions worth ${cur} ${fmt(unexplained)} are missing.`,
            { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true } })
        }

        // 8. Stale value: nothing touched it in a long time.
        const lastTouch = Math.max(
          f.lastTs || 0,
          parseDay(it.lastValuationDate)?.getTime() || 0,
          parseDay(it.acquisitionDate)?.getTime() || 0,
          new Date(it.createdAt || 0).getTime() || 0,
        )
        if (!it.isIlliquid && lastTouch > 0 && (nowDate.getTime() - lastTouch) > STALE_DAYS * 86400000) {
          push('stale-value', 'low', it.id,
            `${name} no registra movimientos ni valuación en más de ${STALE_DAYS} días — ¿sigue valiendo lo mismo?`,
            `${name} has had no movement or valuation in over ${STALE_DAYS} days — is it still worth the same?`,
            { kind: 'edit-item' })
        }
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
      const biggest = g.items.reduce((a, b) => (itemBalance(a) >= itemBalance(b) ? a : b))
      push('uncovered-shares', 'medium', biggest.id,
        `${fmt(gap)} de ${fmt(g.qty)} unidades de ${sym} no tienen fecha de compra — el historial las asume desde el inicio.`,
        `${fmt(gap)} of ${fmt(g.qty)} ${sym} units have no purchase date — history assumes them from the start.`,
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
    const names = group.map((g) => g.name || g.symbol).join(', ')
    push('dup-suspect', 'low', group[0].id,
      `${names} comparten símbolo e institución — ¿son la misma posición duplicada?`,
      `${names} share symbol and institution — are they the same position duplicated?`,
      { kind: 'review' })
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
    const w = Math.max(toBase(itemBalance(it), itemCurrency(it)), 1)
    weightSum += w
    scoreSum += w * itemScores[it.id]
  }
  const globalScore = weightSum > 0 ? Math.round(scoreSum / weightSum) : 100

  const order = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { findings, itemScores, globalScore }
}
