import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { isMarketPriced } from '@/components/dashboard/utils'

export const dynamic = 'force-dynamic'

const VALID_PERIODS = ['DAY', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', 'ALL']
const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', AVAX: 'avalanche-2', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave', XRP: 'ripple',
  DOGE: 'dogecoin', SHIB: 'shiba-inu', BNB: 'binancecoin',
  ATOM: 'cosmos', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand',
  XLM: 'stellar', LTC: 'litecoin', USDT: 'tether', USDC: 'usd-coin',
}

const RANGE_MAP = {
  DAY: { range: '5d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
  YTD: { range: 'ytd', interval: '1d' },
  ALL: { range: 'max', interval: '1wk' },
}

async function fetchYahooHistory(symbol, range, interval) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return []
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return []
    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    return timestamps
      .map((ts, i) => ({ ts: ts * 1000, close: closes[i] }))
      .filter((p) => p.close != null)
  } catch (err) {
    console.error(`[api/portfolio-history] Yahoo failed for ${symbol}:`, err.message)
    return []
  }
}

async function fetchCryptoHistory(id, days) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
    const res = await fetchWithRetry(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.prices || []).map(([ts, price]) => ({ ts, close: price }))
  } catch (err) {
    console.error(`[api/portfolio-history] CoinGecko failed for ${id}:`, err.message)
    return []
  }
}

// Earliest plausible portfolio date. Anything before this is treated as corrupt
// (a 6-digit cell misread as YYYYMM → e.g. 1982, an epoch/0, or a seconds-vs-ms
// confusion) and excluded from the ALL-period chart start.
const MIN_VALID_TS = Date.UTC(1990, 0, 1)
function validAcqTs(raw) {
  if (!raw) return null
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return null
  if (t < MIN_VALID_TS) return null
  if (t > Date.now() + 86400000) return null
  return t
}

function getCryptoDays(period) {
  const map = { DAY: 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, ALL: 'max' }
  if (period === 'YTD') {
    const now = new Date()
    const jan1 = new Date(now.getFullYear(), 0, 1)
    return Math.ceil((now - jan1) / 86400000)
  }
  return map[period] || 365
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  try {
    const { items, lots, period, income } = await request.json()
    if (!items || !Array.isArray(items) || items.length > 100) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }
    if (income && (!Array.isArray(income) || income.length > 2000)) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    // Reinvested income events raise the value of their linked asset as a
    // step-up from the payment date onward. Cash-destination income is excluded
    // (its value already lives in the destination account's balance), so the
    // client marks those reinvested:false and they never reach here.
    const incomeEvents = []
    if (income && Array.isArray(income)) {
      for (const ev of income) {
        const ts = ev.date ? new Date(ev.date).getTime() : 0
        const amt = Number(ev.amount) || 0
        if (!ts || amt <= 0 || ev.reinvested === false) continue
        incomeEvents.push({
          ts, amount: amt,
          itemId: ev.itemId || null,
          symbol: (ev.symbol || '').toUpperCase().trim() || null,
        })
      }
    }

    const lotsBySymbol = {}
    if (lots && Array.isArray(lots) && lots.length <= 500) {
      for (const lot of lots) {
        const sym = (lot.symbol || '').toUpperCase().trim()
        if (!sym || !lot.quantity) continue
        if (!lotsBySymbol[sym]) lotsBySymbol[sym] = []
        lotsBySymbol[sym].push({
          qty: lot.quantity,
          acquiredTs: lot.acquisitionDate ? new Date(lot.acquisitionDate).getTime() : 0,
          closedTs: lot.closedDate ? new Date(lot.closedDate).getTime() : null,
        })
      }
    }
    const hasLots = Object.keys(lotsBySymbol).length > 0

    const per = period || 'YTD'
    if (!VALID_PERIODS.includes(per)) {
      return NextResponse.json({ error: 'Invalid period', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    for (const it of items) {
      const sym = (it.symbol || '').trim()
      if (sym && !SYMBOL_RE.test(sym)) {
        return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST' }, { status: 400 })
      }
    }

    const { range, interval } = RANGE_MAP[per] || RANGE_MAP.YTD

    const marketItems = []
    const cryptoItems = []
    const staticItems = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym) return
      const type = (it.type || '').toLowerCase()
      // Same whitelist as live quotes (isMarketPriced): anything not clearly a
      // market instrument is reconstructed held-flat instead of being priced by
      // whatever Yahoo ticker its symbol happens to match.
      if (!isMarketPriced(it)) {
        staticItems.push(it)
      } else if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptoItems.push(it)
      } else {
        marketItems.push(it)
      }
    })

    const allTimeSeries = {}

    const stockBatches = []
    for (let i = 0; i < marketItems.length; i += 10) stockBatches.push(marketItems.slice(i, i + 10))
    for (const batch of stockBatches) {
      await Promise.all(batch.map(async (it) => {
        const sym = it.symbol.toUpperCase()
        const history = await fetchYahooHistory(sym, range, interval)
        if (history.length > 0) {
          allTimeSeries[sym] = {
            history,
            qty: it.quantity || 0,
            acquiredTs: it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0,
            costBasis: (it.quantity || 0) * (it.purchasePrice || 0),
            lots: hasLots && lotsBySymbol[sym] ? lotsBySymbol[sym] : null,
            holdFlat: !!it._holdFlat,
          }
        }
      }))
    }

    await Promise.all(cryptoItems.map(async (it) => {
      const sym = it.symbol.toUpperCase()
      const id = CRYPTO_MAP[sym]
      if (!id) return
      const days = getCryptoDays(per)
      const history = await fetchCryptoHistory(id, days)
      if (history.length > 0) {
        allTimeSeries[sym] = {
          history,
          qty: it.quantity || 0,
          acquiredTs: it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0,
          costBasis: (it.quantity || 0) * (it.purchasePrice || 0),
          lots: hasLots && lotsBySymbol[sym] ? lotsBySymbol[sym] : null,
          holdFlat: !!it._holdFlat,
        }
      }
    }))

    marketItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        staticItems.push(it)
      }
    })
    cryptoItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        staticItems.push(it)
      }
    })

    if (Object.keys(allTimeSeries).length === 0 && staticItems.length === 0) {
      return NextResponse.json({ dataPoints: [], staticTotal: 0, staticPoints: [] })
    }

    const allTs = new Set()
    Object.values(allTimeSeries).forEach(({ history }) => {
      history.forEach((p) => allTs.add(p.ts))
    })

    if (per === 'ALL') {
      const allDates = [
        ...items.map((it) => validAcqTs(it.acquisitionDate)),
        ...(lots || []).map((l) => validAcqTs(l.acquisitionDate)),
      ].filter((t) => t != null)

      let earliest = allDates.length > 0 ? Math.min(...allDates) : 0

      if (earliest === 0 && allTs.size > 0) {
        const threeYearsAgo = Date.now() - 3 * 365.25 * 86400000
        earliest = Math.max(Math.min(...allTs), threeYearsAgo)
      }

      if (earliest > 0) {
        const dayBefore = earliest - 86400000
        allTs.add(dayBefore)
      }
    }

    // Static-only scope (e.g. a single fixed-value account) has no market history
    // to anchor timestamps, which would leave the chart empty. Synthesize a weekly
    // series across the period so fixed-value assets still plot a line.
    if (allTs.size === 0 && staticItems.length > 0) {
      const now = Date.now()
      const acqs = staticItems.map((it) => validAcqTs(it.acquisitionDate)).filter((t) => t != null)
      const SPAN = { DAY: 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }
      let start
      if (per === 'YTD') start = Date.UTC(new Date().getUTCFullYear(), 0, 1)
      else if (per === 'ALL') start = acqs.length > 0 ? Math.min(...acqs) : now - 365 * 86400000
      else start = now - (SPAN[per] || 365) * 86400000
      if (acqs.length > 0) start = Math.min(start, ...acqs)
      // Floor the synthesized range: a far-past acquisitionDate (attacker-controlled)
      // could otherwise generate thousands of weekly points and blow up the income-
      // reversal inner loop below (|ts| × |staticItems| × |income|).
      const FLOOR = now - 12 * 365.25 * 86400000
      if (start < FLOOR) start = FLOOR
      const step = per === 'DAY' || per === '1W' ? 86400000 : 7 * 86400000
      for (let t = start; t < now; t += step) allTs.add(t)
      allTs.add(now)
    }

    let sortedTs = [...allTs].sort((a, b) => a - b)
    // Hard cap on the number of timestamps to bound per-request CPU regardless of
    // input source; downsample evenly (keeping the last point) if exceeded.
    const MAX_TS = 800
    if (sortedTs.length > MAX_TS) {
      const stride = sortedTs.length / MAX_TS
      const sampled = []
      for (let i = 0; i < MAX_TS - 1; i++) sampled.push(sortedTs[Math.floor(i * stride)])
      sampled.push(sortedTs[sortedTs.length - 1])
      sortedTs = sampled
    }

    const staticPoints = []
    const dataPoints = sortedTs.map((ts) => {
      let total = 0
      let staticSubtotal = 0

      staticItems.forEach((it) => {
        const acqTs = it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0
        // Hold-flat items (IBKR import-date positions) keep their current value back
        // through the whole period — their acquisitionDate is a sync stamp, not a
        // real purchase date, so it must not zero out the past.
        if (!it._holdFlat && ts < acqTs) return
        let v = (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
        // The current value already includes interest/dividends paid INTO this
        // asset (a bond that reinvests, or a cash account credited by another
        // asset's dividend). So reconstruct the past by REVERSING income that
        // happened AFTER ts — the value steps down before each payment. Market
        // assets get their reinvested shares via lots (qtyAtTime) instead, so
        // this applies only to static items, avoiding double-counting.
        if (incomeEvents.length > 0) {
          const itId = it.id || null
          const itSym = (it.symbol || '').toUpperCase().trim() || null
          for (const ev of incomeEvents) {
            if (ev.ts <= ts) continue
            const match = (ev.itemId && itId && ev.itemId === itId)
              || (!ev.itemId && ev.symbol && itSym && ev.symbol === itSym)
            if (match) v -= ev.amount
          }
          if (v < 0) v = 0
        }
        staticSubtotal += v
        total += v
      })
      staticPoints.push({ ts, value: Math.round(staticSubtotal * 100) / 100 })

      Object.entries(allTimeSeries).forEach(([, data]) => {
        let price = null
        for (let i = data.history.length - 1; i >= 0; i--) {
          if (data.history[i].ts <= ts) { price = data.history[i].close; break }
        }
        if (price == null && data.history.length > 0) price = data.history[0].close

        if (data.holdFlat) {
          // IBKR import-date position: no reliable acquisition date and no genuine
          // trade history, so hold the current quantity flat back through the period
          // (Σ current qty × historical price) instead of zeroing it before the sync
          // stamp. Mirrors the dateUnreliable path in lib/historicalValues.js.
          total += (data.qty || 0) * (price || 0)
        } else if (data.lots) {
          let qtyAtTime = 0
          for (const lot of data.lots) {
            if (ts >= lot.acquiredTs && (!lot.closedTs || ts < lot.closedTs)) {
              qtyAtTime += lot.qty
            }
          }
          total += qtyAtTime * (price || 0)
        } else {
          if (ts < data.acquiredTs) return
          total += (data.qty || 0) * (price || 0)
        }
      })

      return { ts, total: Math.round(total * 100) / 100 }
    })

    const staticTotal = staticItems.reduce((s, it) => {
      return s + (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
    }, 0)

    return NextResponse.json({ dataPoints, staticTotal, staticPoints })
  } catch (err) {
    console.error('portfolio-history error:', err)
    return NextResponse.json({ error: 'Internal server error', errorCode: 'INTERNAL', dataPoints: [] }, { status: 500 })
  }
}
