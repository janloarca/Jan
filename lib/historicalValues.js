import { authFetch, safeJson } from './authFetch'

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}

// Parse a date string to a UTC Date so comparisons against getMonthEndDate
// (which uses Date.UTC) never drift by a day due to local-vs-UTC parsing.
function parseUTCDate(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function rangeForMonths(months) {
  if (months.length === 0) return '1y'
  const [y] = months[0].split('-').map(Number)
  const yearsBack = new Date().getFullYear() - y + 1
  if (yearsBack <= 1) return '1y'
  return 'max'
}

// Reconstruct shares held at a past month-end by reversing every BUY/SELL trade
// that happened AFTER it. Trades carry real dates (unlike import-stamped lots),
// so this stays correct even when lots default to the import date.
function qtyFromTx(currentQty, events, monthEnd) {
  let qty = currentQty
  const end = monthEnd.getTime()
  for (const ev of events) {
    if (ev.ts > end) qty -= ev.delta
  }
  return qty > 0 ? qty : 0
}

function qtyAtMonth(lots, symbol, monthEnd) {
  let qty = 0
  for (const lot of lots) {
    if ((lot.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
    const acqDate = parseUTCDate(lot.acquisitionDate)
    if (acqDate && acqDate > monthEnd) continue
    if (lot.status === 'closed') {
      const closedDate = parseUTCDate(lot.closedDate)
      if (closedDate && closedDate <= monthEnd) continue
      qty += lot.quantity || 0
    } else {
      qty += lot.quantity || 0
    }
  }
  return qty
}

// Convert a raw price in the item's original currency to baseCurrency. Uses the
// _original* fields (true raw values + currency) so the result is correct even
// when the item was not pre-enriched (e.g. rates not loaded yet).
function valueInBase(it, rawPrice, convert, baseCurrency) {
  const rawCurrency = it._originalCurrency || it.currency || baseCurrency || 'USD'
  let val = (it.quantity || 0) * (rawPrice || 0)
  if (convert && rawCurrency !== (baseCurrency || 'USD')) {
    val = convert(val, rawCurrency, baseCurrency || 'USD')
  }
  return val
}

// Acquisition gate for historical reconstruction. Uses the exact acquisitionDate
// when known; otherwise falls back to Jan 1 of the year the asset was ADDED to the
// app (createdAt). createdAt is an import/add timestamp, NOT an acquisition date —
// using it directly would blank a position imported mid-year for every earlier
// month of that same year. Snapping it to the start of its year hides the asset in
// PRIOR years it didn't exist while still showing it across all months of its
// add-year. Returns null when neither date is available (no gate).
function effectiveAcqDate(it) {
  const acq = parseUTCDate(it.acquisitionDate)
  if (acq) return acq
  const created = parseUTCDate(it.createdAt)
  if (created) return new Date(Date.UTC(created.getUTCFullYear(), 0, 1))
  return null
}

function fillFallback(result, it, months, convert, baseCurrency) {
  const acqDate = effectiveAcqDate(it)
  const rawPrice = it._originalPurchasePrice ?? it.purchasePrice ?? 0
  const val = valueInBase(it, rawPrice, convert, baseCurrency)
  if (val <= 0) return
  months.forEach(mk => {
    if (acqDate && getMonthEndDate(mk) < acqDate) return
    if (!result[mk][it.id]) {
      result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
    }
  })
}

// Reconstruct a fixed-value asset's history: hold the current balance, then
// reverse any deposits/dividends/withdrawals that happened AFTER each month so
// the value steps down for earlier months (e.g. a bond at 6000 before a 240
// dividend in May, 6240 after). Used for true static assets AND for items whose
// "symbol" isn't a real market ticker (Yahoo returns no prices).
function applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestBySym) {
  const acqDate = effectiveAcqDate(it)
  const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? it.price ?? it.cost ?? 0
  const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
  const balEvents = balanceEventsById[it.id] || []
  const symEvents = reinvestBySym[(it.symbol || it.name || '').toUpperCase()] || []
  const allEvents = balEvents.length && symEvents.length ? [...balEvents, ...symEvents] : (balEvents.length ? balEvents : symEvents)
  months.forEach(mk => {
    const monthEnd = getMonthEndDate(mk)
    if (acqDate && monthEnd < acqDate) return
    let val = curVal
    if (allEvents.length) {
      const end = monthEnd.getTime()
      for (const ev of allEvents) if (ev.ts > end) val -= ev.amount
      if (val < 0) val = 0
    }
    result[mk][it.id] = { value: val, symbol: it.name || it.symbol || '', category: it._category || '', institution: it.institution || '' }
  })
}

export async function getHistoricalItemValues(items, months, convert, baseCurrency, lots, transactions, snapshots) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

  const hasLots = lots && lots.length > 0
  const lotSymbols = hasLots ? new Set(lots.map(l => (l.symbol || '').toUpperCase())) : new Set()

  // Index real BUY/SELL trades per symbol so past-month share counts come from
  // actual trade history (true dates) rather than import-stamped lot dates.
  const txBySymbol = {}
  // Index balance-changing events linked to static assets so past values can be
  // reconstructed by reversing deposits/dividends/withdrawals that happened after
  // each month. For dividends not linked to a specific item, only reinvested ones
  // are included (cash-destination dividends live in the destination account).
  const balanceEventsById = {}
  const reinvestBySym = {}
  if (transactions && transactions.length) {
    const itemById = new Map(items.map(it => [it.id, it]))
    const itemBySym = new Map(items.map(it => [(it.symbol || '').toUpperCase(), it]))
    const itemByName = new Map(items.filter(it => it.name).map(it => [it.name.toUpperCase(), it]))
    const pushBalance = (id, ev) => { (balanceEventsById[id] = balanceEventsById[id] || []).push(ev) }
    for (const tx of transactions) {
      const ty = (tx.type || '').toUpperCase()
      if (ty === 'BUY' || ty === 'SELL') {
        const sym = (tx.symbol || '').toUpperCase()
        const d = parseUTCDate(tx.date)
        const q = Math.abs(Number(tx.quantity) || 0)
        if (!sym || !d || !q) continue
        if (!txBySymbol[sym]) txBySymbol[sym] = []
        txBySymbol[sym].push({ ts: d.getTime(), delta: ty === 'BUY' ? q : -q })
      } else if (ty === 'DEPOSIT' || ty === 'DIVIDEND' || ty === 'WITHDRAWAL') {
        const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
        const d = parseUTCDate(tx.date)
        if (!(amtRaw > 0) || !d) continue
        const linked = tx._linkedItemId ? itemById.get(tx._linkedItemId) : null
        const cur = tx.currency || baseCurrency || 'USD'
        const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
        const delta = ty === 'WITHDRAWAL' ? -amount : amount
        const ts = d.getTime()

        if (ty === 'DIVIDEND') {
          // Each dividend feeds exactly ONE reconstruction bucket so a value is
          // never reversed twice (source AND symbol):
          //  - reinvested into the source  → reinvestBySym[source] (static path)
          //  - cash routed to a destination → balanceEventsById[destination]
          //  - cash with no destination     → ignored (left the tracked portfolio)
          const reinvest = tx._reinvested === true
            || (linked && linked.dividendAction === 'reinvest')
            || tx._source === 'manual_contribution'
            || !tx._linkedItemId
          if (!reinvest && linked && linked.incomeDestination) {
            const dest = itemById.get(linked.incomeDestination)
              || itemBySym.get(String(linked.incomeDestination).toUpperCase())
              || itemByName.get(String(linked.incomeDestination).toUpperCase())
            if (dest && dest.id) pushBalance(dest.id, { ts, amount: delta })
          } else if (reinvest) {
            const sym = (tx.symbol || (linked && (linked.symbol || linked.name)) || '').toUpperCase()
            if (sym) (reinvestBySym[sym] = reinvestBySym[sym] || []).push({ ts, amount })
          }
        } else if (tx._linkedItemId) {
          // DEPOSIT / WITHDRAWAL change the linked account's balance directly.
          pushBalance(tx._linkedItemId, { ts, amount: delta })
        }
      }
    }
  }

  // IBKR positions are reconstructed by scaling to the real per-month NAV from
  // equity snapshots (see below), NOT from Yahoo×currentQty — so keep them out of
  // the market path (which would inflate early months with the current share count).
  const marketItems = items.filter(it => {
    if (it._source === 'ibkr') return false
    if (!it.symbol || !/stock|crypto|fund|etf/i.test(it.type || '')) return false
    if (/realestate|inmueble/i.test(it.type || '')) return false
    if (!it._source && it.symbol.length > 10) return false
    return true
  })
  const marketSet = new Set(marketItems)
  const staticItems = items.filter(it =>
    it._source !== 'ibkr' && !marketSet.has(it)
  )

  staticItems.forEach(it => {
    if (!it.id) return
    applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestBySym)
  })

  const range = rangeForMonths(months)
  const BATCH_SIZE = 15
  for (let i = 0; i < marketItems.length; i += BATCH_SIZE) {
    const batch = marketItems.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (it) => {
      try {
        const res = await authFetch(`/api/prices/chart?symbol=${encodeURIComponent(it.symbol)}&range=${range}&interval=1mo`)
        // Unknown ticker / no market data → it's a fixed-value asset (e.g. a bond
        // or custom investment whose "symbol" isn't a real ticker). Reconstruct its
        // history from its balance + deposit/dividend events, not a flat figure.
        if (!res.ok) { applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestBySym); return }
        const data = await safeJson(res)
        const prices = data.prices || []
        if (prices.length === 0) { applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestBySym); return }

        const priceCurrency = data.currency || 'USD'
        const priceByMonth = {}
        prices.forEach(p => {
          if (p.close != null && p.date) {
            const mk = getMonthKey(new Date(p.date))
            priceByMonth[mk] = p.close
          }
        })

        const acqDate = parseUTCDate(it.acquisitionDate)
        const currentQty = it.quantity || 0
        const sym = (it.symbol || '').toUpperCase()
        const txEvents = txBySymbol[sym] || []
        // Only trust lot-level FIFO reconstruction when there's genuine history
        // (a sell, or multiple lots). A single import-stamped lot would otherwise
        // zero out every month before the import date.
        const symLots = hasLots ? lots.filter(l => (l.symbol || '').toUpperCase() === sym) : []
        const hasRealLotHistory = symLots.length > 1 || symLots.some(l => l.status === 'closed')
        // An IBKR position with no trade history has an unreliable (import-date)
        // acquisitionDate — don't let it zero out past months. If there were a
        // real recent purchase, it would have an in-window BUY trade.
        const dateUnreliable = it._source === 'ibkr' && txEvents.length === 0

        months.forEach(mk => {
          const monthEnd = getMonthEndDate(mk)
          const price = priceByMonth[mk]

          let qty
          if (txEvents.length > 0) {
            // Reverse real trades after this month → exact historical share count.
            qty = qtyFromTx(currentQty, txEvents, monthEnd)
          } else if (hasRealLotHistory) {
            qty = qtyAtMonth(lots, sym, monthEnd)
          } else {
            // Held-flat: no trade history and no multi-lot detail. Assume the
            // current position was held throughout, gated by a reliable acq date.
            qty = (dateUnreliable || !acqDate || monthEnd >= acqDate) ? currentQty : 0
          }
          if (qty <= 0) return

          if (price != null) {
            let val = qty * price
            if (convert && priceCurrency !== baseCurrency) {
              val = convert(val, priceCurrency, baseCurrency || 'USD')
            }
            result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
          } else if (!result[mk][it.id]) {
            const rawCur = it._originalCurrency || it.currency || baseCurrency || 'USD'
            let val = qty * (it._originalPurchasePrice ?? it.purchasePrice ?? 0)
            if (convert && rawCur !== (baseCurrency || 'USD')) val = convert(val, rawCur, baseCurrency || 'USD')
            if (val > 0) {
              result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
            }
          }
        })
        fillFallback(result, it, months, convert, baseCurrency)
      } catch (err) {
        console.error(`[historicalValues] Failed for ${it.symbol}:`, err.message)
        fillFallback(result, it, months, convert, baseCurrency)
      }
    }))
  }

  // IBKR positions: scale each item's current value by the real per-month NAV
  // (from equity snapshots) so the rows sum to the true account value and follow
  // the broker's growth curve — instead of inflating early months with the
  // current share count at old prices.
  const ibkrItems = items.filter(it => it._source === 'ibkr' && it.id)
  if (ibkrItems.length && snapshots && snapshots.length) {
    // Build NAV-per-month from IBKR snapshots (latest snapshot wins per month),
    // converting the stored USD NAV to baseCurrency.
    const ibkrSnaps = snapshots.filter(s => s._source === 'ibkr' && s.date)
    const navByMonth = {}
    const navDates = {}
    ;(ibkrSnaps.length ? ibkrSnaps : snapshots.filter(s => s.date)).forEach(s => {
      const navUSD = s.netWorthUSD ?? s.totalActivosUSD ?? 0
      if (!navUSD) return
      const mk = getMonthKey(new Date(s.date))
      const sd = new Date(s.date)
      if (!navDates[mk] || sd > navDates[mk]) {
        navDates[mk] = sd
        navByMonth[mk] = convert ? convert(navUSD, 'USD', baseCurrency || 'USD') : navUSD
      }
    })

    const currentNAV = ibkrItems.reduce((sum, it) => {
      const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
      return sum + valueInBase(it, rawPrice, convert, baseCurrency)
    }, 0)

    const navMonthKeys = Object.keys(navByMonth).sort()
    if (currentNAV > 0 && navMonthKeys.length > 0) {
      // For a month without its own snapshot, carry forward the most recent prior
      // snapshot NAV (months may be a non-contiguous subset, so resolve per-month
      // against all known snapshot months rather than a running variable).
      const navForMonth = (mk) => {
        if (navByMonth[mk] != null) return navByMonth[mk]
        let chosen = null
        for (const k of navMonthKeys) { if (k <= mk) chosen = navByMonth[k]; else break }
        return chosen
      }
      months.forEach(mk => {
        const nav = navForMonth(mk)
        if (nav == null) return
        const scale = nav / currentNAV
        ibkrItems.forEach(it => {
          const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
          const curItemVal = valueInBase(it, rawPrice, convert, baseCurrency)
          if (curItemVal <= 0) return
          result[mk][it.id] = {
            value: curItemVal * scale,
            symbol: it.symbol || it.name || '',
            category: it._category || '',
            institution: it.institution || '',
          }
        })
      })
    }
  }

  // Held-flat safety net: any currently-held item still left blank for a displayed
  // month gets its current value, as long as the month is on/after the item's
  // effective acquisition date. This guarantees a held asset never shows blank for
  // a month it existed (e.g. an IBKR position whose snapshots don't reach back that
  // far), while real reconstructed/scaled values above always take precedence and
  // prior-year months before the asset existed stay genuinely empty.
  for (const it of items) {
    if (!it.id) continue
    const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? it.price ?? it.cost ?? 0
    const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
    if (!(curVal > 0)) continue
    const acqDate = effectiveAcqDate(it)
    for (const mk of months) {
      if (result[mk][it.id]) continue
      if (acqDate && getMonthEndDate(mk) < acqDate) continue
      result[mk][it.id] = {
        value: curVal,
        symbol: it.symbol || it.name || '',
        category: it._category || '',
        institution: it.institution || '',
      }
    }
  }

  return result
}
