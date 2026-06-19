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

function fillFallback(result, it, months, convert, baseCurrency) {
  const acqDate = parseUTCDate(it.acquisitionDate)
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

export async function getHistoricalItemValues(items, months, convert, baseCurrency, lots, transactions) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

  const hasLots = lots && lots.length > 0
  const lotSymbols = hasLots ? new Set(lots.map(l => (l.symbol || '').toUpperCase())) : new Set()

  // Index real BUY/SELL trades per symbol so past-month share counts come from
  // actual trade history (true dates) rather than import-stamped lot dates.
  const txBySymbol = {}
  // Index reinvested income (interest/dividends compounded INTO the asset) so a
  // static asset's past value can be reconstructed by reversing income that
  // compounded after each month (e.g. a bond shows its principal before a coupon
  // and steps up afterward). Cash-destination income is excluded — it lives in
  // the destination account, not the asset.
  const reinvestById = {}
  const reinvestBySym = {}
  if (transactions && transactions.length) {
    const itemById = new Map(items.map(it => [it.id, it]))
    for (const tx of transactions) {
      const ty = (tx.type || '').toUpperCase()
      if (ty === 'BUY' || ty === 'SELL') {
        const sym = (tx.symbol || '').toUpperCase()
        const d = parseUTCDate(tx.date)
        const q = Math.abs(Number(tx.quantity) || 0)
        if (!sym || !d || !q) continue
        if (!txBySymbol[sym]) txBySymbol[sym] = []
        txBySymbol[sym].push({ ts: d.getTime(), delta: ty === 'BUY' ? q : -q })
      } else if (ty === 'DIVIDEND') {
        const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
        const d = parseUTCDate(tx.date)
        if (!(amtRaw > 0) || !d) continue
        const linked = tx._linkedItemId ? itemById.get(tx._linkedItemId) : null
        const reinvested = tx._reinvested === true || (linked && linked.dividendAction === 'reinvest')
        if (!reinvested) continue
        const cur = tx.currency || baseCurrency || 'USD'
        const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
        const ev = { ts: d.getTime(), amount }
        const id = tx._linkedItemId
        const sym = (tx.symbol || (linked && (linked.symbol || linked.name)) || '').toUpperCase()
        if (id) (reinvestById[id] = reinvestById[id] || []).push(ev)
        else if (sym) (reinvestBySym[sym] = reinvestBySym[sym] || []).push(ev)
      }
    }
  }

  const marketItems = items.filter(it =>
    it.symbol && /stock|crypto|fund|etf/i.test(it.type || '') && !/realestate|inmueble/i.test(it.type || '')
  )
  const staticItems = items.filter(it =>
    !it.symbol || !/stock|crypto|fund|etf/i.test(it.type || '') || /realestate|inmueble/i.test(it.type || '')
  )

  staticItems.forEach(it => {
    if (!it.id) return
    const acqDate = parseUTCDate(it.acquisitionDate)
    // Prefer the raw original price + its currency, converted to base. Past months
    // of a static asset (bond/bank/real estate) hold its constant balance in base
    // currency — never a raw, unconverted figure.
    const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? it.price ?? it.cost ?? 0
    const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
    const incEvents = reinvestById[it.id] || reinvestBySym[(it.symbol || it.name || '').toUpperCase()] || []
    months.forEach(mk => {
      const monthEnd = getMonthEndDate(mk)
      if (acqDate && monthEnd < acqDate) return
      // Reverse any interest/dividends that compounded AFTER this month, so the
      // value reflects the balance as of month-end (principal before later coupons).
      let val = curVal
      if (incEvents.length) {
        const end = monthEnd.getTime()
        for (const ev of incEvents) if (ev.ts > end) val -= ev.amount
        if (val < 0) val = 0
      }
      result[mk][it.id] = { value: val, symbol: it.name || it.symbol || '', category: it._category || '', institution: it.institution || '' }
    })
  })

  const range = rangeForMonths(months)
  const BATCH_SIZE = 15
  for (let i = 0; i < marketItems.length; i += BATCH_SIZE) {
    const batch = marketItems.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (it) => {
      try {
        const res = await authFetch(`/api/prices/chart?symbol=${encodeURIComponent(it.symbol)}&range=${range}&interval=1mo`)
        if (!res.ok) { fillFallback(result, it, months, convert, baseCurrency); return }
        const data = await safeJson(res)
        const prices = data.prices || []
        if (prices.length === 0) { fillFallback(result, it, months, convert, baseCurrency); return }

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

  return result
}
