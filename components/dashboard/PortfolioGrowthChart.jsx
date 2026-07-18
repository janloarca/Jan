'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { formatCurrency, formatCompact, formatAxisTick, formatDate, getItemValue, buildIncomeEvents, isExcludedFromNetWorth, findYearStartAnchor, shouldHoldFlat } from './utils'
import { buildTxEvents, buildCashFlows } from '@/lib/portfolioRewind'
import { computeTWRSeries } from './analytics'
import { authFetch, safeJson } from '@/lib/authFetch'
import ErrorState from '@/components/ui/ErrorState'

function polyline(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// Canonical institution key: trim, collapse whitespace, case-fold — so casing or
// stray spaces in user data never split one custodian into two.
function normInst(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildGeometry(values, mode, height, width, pad, extraSeries, timestamps) {
  const ch = height - pad.top - pad.bottom
  const cw = width - pad.left - pad.right

  let allVals = values.filter(v => isFinite(v))
  // extraSeries shares the Y scale (benchmark in performance mode, invested-capital
  // line in value mode) — both lines must live on ONE axis or comparisons lie.
  if (extraSeries && extraSeries.length > 0) {
    allVals = [...allVals, ...extraSeries.filter(v => isFinite(v))]
  }
  if (allVals.length === 0) allVals = [0]
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const paddingVal = mode === 'performance' ? 0 : (max - min) * 0.05
  const adjustedMin = mode === 'performance' ? Math.min(min, 0) - Math.abs(min || 1) * 0.1 : min - paddingVal
  const adjustedMax = mode === 'performance' ? Math.max(max, 0) + Math.abs(max || 1) * 0.1 : max + paddingVal
  const range = adjustedMax - adjustedMin || 1

  // X positions proportional to TIME when timestamps are supplied — index-based
  // spacing drew sparse early snapshots and dense recent days at equal widths,
  // visually lying about the time axis (a 5-month gap looked like one month).
  const t0 = timestamps?.[0]
  const tN = timestamps?.[timestamps.length - 1]
  const timeScaled = timestamps && timestamps.length === values.length && isFinite(t0) && isFinite(tN) && tN > t0
  const xAt = (i) => timeScaled
    ? pad.left + ((timestamps[i] - t0) / (tN - t0)) * cw
    : pad.left + (i / Math.max(values.length - 1, 1)) * cw

  const points = values.map((v, i) => ({
    x: xAt(i),
    y: pad.top + ch - ((v - adjustedMin) / range) * ch,
    v,
  }))

  const baselineY = mode === 'performance'
    ? pad.top + ch - ((0 - adjustedMin) / range) * ch
    : pad.top + ch

  const tickCount = 5
  const tickStep = range / (tickCount - 1)
  const yTicks = Array.from({ length: tickCount }, (_, i) => ({
    val: adjustedMin + (range * i) / (tickCount - 1),
    y: pad.top + ch - (i / (tickCount - 1)) * ch,
    step: tickStep,
  }))

  return { points, baselineY, yTicks, cw, ch, adjustedMin, range }
}

function findClosestBenchmark(sorted, targetTs) {
  let lo = 0, hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].ts < targetTs) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(sorted[lo - 1].ts - targetTs) < Math.abs(sorted[lo].ts - targetTs)) lo--
  return sorted[lo]
}

export default function PortfolioGrowthChart({ items, lots, snapshots, transactions, lang, convert, baseCurrency, benchmarkSymbol, benchmarkName, onSaveSnapshot }) {
  const [period, setPeriod] = useState('YTD')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [dataPoints, setDataPoints] = useState([])
  // True when the API rebuilt the past from imported transactions (deposits,
  // buys, sells, dividends) rather than holding today's state flat: that series
  // CONTAINS flow effects, so returns must net flows over the whole range and
  // the estimated-prefix rebase/banner no longer apply.
  const [apiTransactional, setApiTransactional] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [staticTotal, setStaticTotal] = useState(0)
  const [staticPoints, setStaticPoints] = useState([])
  const [viewMode, setViewMode] = useState('value')
  const [benchmarkPts, setBenchmarkPts] = useState(null)
  const [showContributions, setShowContributions] = useState(true)
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [showSnapshotImport, setShowSnapshotImport] = useState(false)
  const [snapshotRows, setSnapshotRows] = useState([{ date: '', value: '' }])
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const containerRef = useRef(null)
  const mountedRef = useRef(true)
  const [chartWidth, setChartWidth] = useState(650)
  const [selectedInst, setSelectedInst] = useState('ALL')

  const periods = ['DAY', '1W', 'MTD', '1M', '3M', 'YTD', '1Y', 'ALL', 'CUSTOM']
  const t = (es, en) => lang === 'es' ? es : en

  // Group holdings by institution so the chart can show a single institution's
  // combined behaviour (e.g. a bond + the cash account it pays into move together).
  // Grouping key is NORMALIZED (trim + collapse spaces + case-fold): "IDC VALORES"
  // and "IDC Valores" are the same custodian, not two pills with a split book —
  // and the lots filter below must agree with the pill on that.
  const institutions = useMemo(() => {
    if (!items || items.length === 0) return []
    const map = {}
    items.forEach((it) => {
      if (isExcludedFromNetWorth(it)) return
      const rawName = it.institution || t('Sin institución', 'No institution')
      const key = normInst(rawName)
      if (!map[key]) map[key] = { key, name: rawName, value: 0, items: [] }
      map[key].value += getItemValue(it)
      map[key].items.push(it)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [items, lang])

  const scopedItems = useMemo(() => {
    if (selectedInst === 'ALL') return items || []
    const inst = institutions.find((i) => i.key === selectedInst)
    return inst ? inst.items : []
  }, [selectedInst, items, institutions])

  // Transactions belonging to the selected institution. TWR/MWR/markers must use
  // this scoped list: with the full list, a deposit into Interactive Brokers would
  // count as a cash flow against an IDC-only value series and distort its return.
  const scopedTransactions = useMemo(() => {
    if (!transactions || selectedInst === 'ALL') return transactions
    const scopedIds = new Set(scopedItems.map((it) => it.id).filter(Boolean))
    const scopedSyms = new Set(scopedItems.map((it) => (it.symbol || '').toUpperCase()).filter(Boolean))
    return transactions.filter((tx) =>
      (tx._linkedItemId && scopedIds.has(tx._linkedItemId)) ||
      (tx.symbol && scopedSyms.has((tx.symbol || '').toUpperCase()))
    )
  }, [transactions, scopedItems, selectedInst])

  // When the manually-added (non-IBKR) assets were first created. Daily snapshots
  // from before this date are broker-only and need the manual-asset overlay; later
  // ones already include them.
  const manualAddedTs = useMemo(() => {
    const ts = (items || [])
      .filter((it) => it._source !== 'ibkr' && it.createdAt)
      .map((it) => new Date(it.createdAt).getTime())
      .filter((t) => isFinite(t))
    return ts.length > 0 ? Math.min(...ts) : 0
  }, [items])
  const benchmarkPeriodMap = { DAY: '1M', '1W': '1M', MTD: '1M', '1M': '1M', '3M': '3M', '6M': '6M', YTD: 'YTD', '1Y': '1Y', ALL: 'ALL' }

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 100) setChartWidth(Math.round(w))
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const formatTooltipDate = useCallback((date) => {
    if (period === 'DAY') {
      return date.toLocaleTimeString(lang === 'es' ? 'es' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    }
    return formatDate(date.toISOString())
  }, [period, lang])

  // Generation token: without it, switching periods fast lets a SLOW response
  // from the previous period resolve last and overwrite the current one — the
  // chart would show YTD data labeled as 1M. mountedRef alone can't catch this
  // (it's true again by the time the stale response lands).
  const fetchGenRef = useRef(0)

  // The 60s price poll rewrites every item's currentPrice, giving scopedItems /
  // scopedTransactions / convert a fresh identity each tick — with them as raw
  // deps, fetchHistory was recreated every minute and its effect re-fired the
  // FULL portfolio-history POST (and reset the 5-min interval). Historical
  // series don't change when live prices tick, so: read the live values through
  // refs, and depend on a price-free signature that only changes on real edits
  // (id/quantity/symbol/acquisitionDate).
  const scopedItemsRef = useRef(scopedItems)
  scopedItemsRef.current = scopedItems
  const scopedTxRef = useRef(scopedTransactions)
  scopedTxRef.current = scopedTransactions
  const convertRef = useRef(convert)
  convertRef.current = convert
  const itemsSig = useMemo(() =>
    (scopedItems || [])
      .map((i) => `${i.id}:${i.quantity}:${i.symbol || ''}:${i.acquisitionDate || ''}:${i.isDebt ? 1 : 0}`)
      .sort()
      .join('|'),
  [scopedItems])

  const fetchHistory = useCallback(async () => {
    // Shadow the reactive values with their refs: the body below reads the
    // freshest data without the callback depending on their identity.
    const scopedItems = scopedItemsRef.current
    const scopedTransactions = scopedTxRef.current
    const convert = convertRef.current
    if (!scopedItems || scopedItems.length === 0) return
    if (period === 'CUSTOM' && !customRange.from) return
    if (period === 'CUSTOM' && customRange.to && customRange.from > customRange.to) {
      setFetchError(t('El rango está invertido: "desde" es posterior a "hasta".', 'Range is inverted: "from" is after "to".'))
      return
    }
    if (period === 'DAY') {
      // Clear leftover points from the previous period — the DAY splice mixes any
      // recent API points into the intraday snapshots.
      setDataPoints([])
      setLoading(false)
      return
    }
    const gen = ++fetchGenRef.current
    setLoading(true)
    setFetchError(null)
    try {
      let apiPeriod = period === 'MTD' ? '1M' : period
      if (period === 'CUSTOM') {
        const fromDate = new Date(customRange.from)
        const toDate = customRange.to ? new Date(customRange.to) : new Date()
        const diffDays = Math.ceil((toDate - fromDate) / 86400000)
        if (diffDays <= 30) apiPeriod = '1M'
        else if (diffDays <= 90) apiPeriod = '3M'
        else if (diffDays <= 180) apiPeriod = '6M'
        else if (diffDays <= 365) apiPeriod = '1Y'
        else apiPeriod = 'ALL'
      }
      // Assets only — the API has no isDebt notion and would sum a debt as a
      // POSITIVE holding (the backfill path already filters this way). Excluded
      // receivables are dropped to match the snapshot/net-worth baseline. Debt is
      // held flat and subtracted from the returned points below, like backfill.
      const chartItems = scopedItems.filter(it => !it.isDebt && !isExcludedFromNetWorth(it))
      const debtUSD = scopedItems.reduce((s, it) => {
        if (!it.isDebt) return s
        const cur = it._originalCurrency || it.currency || 'USD'
        const v = (it.quantity || 0) * (it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0)
        return s + Math.abs(convert ? convert(v, cur, 'USD') : v)
      }, 0)
      const scopedSymbols = new Set(chartItems.map(it => (it.symbol || '').toUpperCase()).filter(Boolean))
      const instFilter = selectedInst === 'ALL' ? null : selectedInst
      const allLots = (lots || []).filter(l =>
        l.quantity > 0
        && scopedSymbols.has((l.symbol || '').toUpperCase())
        && (!instFilter || normInst(l.institution) === instFilter)
      )
      // Transaction rewind (lib/portfolioRewind): per-symbol BUY/SELL deltas and
      // the account cash-flow ledger, so the API reconstructs the TRUE past
      // (deposits step in, buys move cash into shares) like the broker's own chart,
      // instead of holding today's positions flat backwards.
      const txEventsBySym = buildTxEvents(scopedTransactions)
      const accountCashFlows = buildCashFlows(scopedTransactions,
        (amt, cur2) => convert ? convert(amt, cur2, 'USD') : amt)
      // The whole account ledger attaches to ONE cash item (the broker's cash line).
      const cashItem = accountCashFlows.length > 0
        ? chartItems.find((it) => it._source === 'ibkr' && /^CASH-/i.test(it.symbol || ''))
        : null
      const res = await authFetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chartItems.map((it) => {
            // The API sums values assuming USD — convert original-currency prices first
            const cur = it._originalCurrency || it.currency || 'USD'
            const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
            return {
              id: it.id,
              symbol: it.symbol, type: it.type, quantity: it.quantity,
              currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
              purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
              currency: 'USD',
              acquisitionDate: it.acquisitionDate,
              _holdFlat: shouldHoldFlat(it, scopedTransactions, lots),
              txEvents: txEventsBySym[(it.symbol || '').toUpperCase()] || undefined,
              ...(cashItem && it.id === cashItem.id ? { cashFlows: accountCashFlows } : {}),
            }
          }),
          lots: allLots.length > 0 ? allLots.map(l => ({
            symbol: l.symbol, quantity: l.quantity,
            acquisitionDate: l.acquisitionDate,
            closedDate: l.closedDate || null,
            costBasis: l.costBasis,
          })) : undefined,
          income: buildIncomeEvents(scopedTransactions, chartItems, convert, 'USD'),
          period: apiPeriod,
        }),
      })
      if (res.ok) {
        const data = await safeJson(res)
        if (!mountedRef.current || gen !== fetchGenRef.current) return
        let pts = data.dataPoints || []
        // Net worth semantics: subtract held-flat debt (same as the backfill path)
        if (debtUSD > 0) pts = pts.map(dp => ({ ...dp, total: dp.total - debtUSD }))
        if (baseCurrency !== 'USD' && convert) {
          pts = pts.map(dp => ({ ...dp, total: convert(dp.total, 'USD', baseCurrency) }))
        }
        if (period === 'CUSTOM' && customRange.from) {
          const fromTs = new Date(customRange.from).getTime()
          const toTs = customRange.to ? new Date(customRange.to + 'T23:59:59').getTime() : Date.now()
          pts = pts.filter(dp => dp.ts >= fromTs && dp.ts <= toTs)
        }
        if (period === 'YTD') {
          const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1)
          pts = pts.filter((dp) => dp.ts >= yearStart)
        }
        if (period === 'MTD') {
          const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
          pts = pts.filter((dp) => dp.ts >= monthStart)
        }
        if (period === 'DAY' && pts.length > 0) {
          const latestTs = pts[pts.length - 1].ts
          const latestDate = new Date(latestTs)
          const dayStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate(), 7, 0, 0).getTime()
          pts = pts.filter(dp => dp.ts >= dayStart)
        }
        setDataPoints(pts)
        setApiTransactional(!!data.transactional)
        setStaticTotal(data.staticTotal != null
          ? (baseCurrency !== 'USD' && convert ? convert(data.staticTotal, 'USD', baseCurrency) : data.staticTotal)
          : 0)
        let sp = data.staticPoints || []
        if (baseCurrency !== 'USD' && convert) sp = sp.map(p => ({ ts: p.ts, value: convert(p.value, 'USD', baseCurrency) }))
        setStaticPoints(sp)
      }
    } catch (err) {
      if (!mountedRef.current || gen !== fetchGenRef.current) return
      console.error('Failed to fetch portfolio history:', err)
      setFetchError(t('Error cargando historial', 'Failed to load history'))
    }
    if (mountedRef.current && gen === fetchGenRef.current) setLoading(false)
    // itemsSig (not scopedItems) + transactions (raw prop, only changes on real
    // writes) — price ticks no longer recreate this callback. convert is read
    // via ref; a rates refresh alone doesn't warrant re-downloading history
    // (the 5-min interval picks it up).
  }, [itemsSig, transactions, lots, period, baseCurrency, customRange, selectedInst])

  useEffect(() => {
    mountedRef.current = true
    fetchHistory()
    // 5 min, not 1 — each poll re-downloads the FULL history for every symbol
    // (Yahoo+CoinGecko fan-out server-side) and daily NAV barely moves minute to
    // minute. 60s polling burned quota and flirted with the route's rate limit.
    const interval = setInterval(fetchHistory, 300000)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [fetchHistory])

  useEffect(() => {
    let bp = benchmarkPeriodMap[period] || 'YTD'
    // CUSTOM used to silently fall back to YTD — the "vs SPX" box then compared
    // your custom window against the index's year-to-date. Match the window.
    if (period === 'CUSTOM' && customRange.from) {
      const fromDate = new Date(customRange.from)
      const toDate = customRange.to ? new Date(customRange.to) : new Date()
      const diffDays = Math.ceil((toDate - fromDate) / 86400000)
      bp = diffDays <= 30 ? '1M' : diffDays <= 90 ? '3M' : diffDays <= 180 ? '6M' : diffDays <= 365 ? '1Y' : 'ALL'
    }
    let cancelled = false
    const sym = benchmarkSymbol || '%5EGSPC'
    authFetch(`/api/prices/benchmark?period=${encodeURIComponent(bp)}&symbol=${encodeURIComponent(sym)}`)
      .then((res) => res.ok ? safeJson(res) : null)
      .then((data) => { if (!cancelled && data) setBenchmarkPts(data.dataPoints || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [period, benchmarkSymbol, customRange])

  const currentTotal = useMemo(() => {
    if (!scopedItems) return 0
    // Match the snapshot/net-worth baseline: excluded receivables don't count
    // (the daily snapshot writer drops them too) — otherwise the live "today"
    // point steps above the snapshot series.
    return scopedItems
      .filter((it) => !isExcludedFromNetWorth(it))
      .reduce((s, it) => s + getItemValue(it), 0)
  }, [scopedItems])

  const snapshotData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return []
    // Whole-portfolio NAV snapshots can't be split per account. When viewing a
    // single manual (non-IBKR) institution they would draw the entire portfolio's
    // curve and then crash to the scoped value at the end — so fall back to the
    // (correctly scoped) API series. IBKR-backed views keep using snapshots.
    if (selectedInst !== 'ALL' && scopedItems.length > 0 && scopedItems.every(it => it._source !== 'ibkr')) return []
    const now = Date.now()
    const bc = baseCurrency || 'USD'
    const convertVal = (s) => {
      if (s._source === 'manual' && s._rawValue != null && s._rawCurrency === bc) return s._rawValue
      return convert ? convert(s.netWorthUSD ?? s.totalActivosUSD ?? 0, 'USD', bc) : (s.netWorthUSD ?? s.totalActivosUSD ?? 0)
    }

    if (period === 'DAY') {
      const threeDaysAgo = now - 3 * 86400000
      const recentSnaps = [...snapshots]
        .filter(s => s.date && new Date(s.date).getTime() >= threeDaysAgo)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(s => ({ ts: new Date(s.date).getTime(), date: new Date(s.date), value: convertVal(s) }))
        .filter(p => p.value > 0)
      if (currentTotal > 0) {
        recentSnaps.push({ ts: Date.now(), date: new Date(), value: currentTotal })
      }
      return recentSnaps
    }

    const periodDays = { '1W': 7, MTD: null, '1M': 30, '3M': 90, '6M': 180, YTD: null, '1Y': 365, ALL: null, CUSTOM: null }
    let cutoff, ceiling

    if (period === 'CUSTOM' && customRange.from) {
      cutoff = new Date(customRange.from).getTime()
      ceiling = customRange.to ? new Date(customRange.to + 'T23:59:59').getTime() : now
    } else if (period === 'YTD') cutoff = Date.UTC(new Date().getUTCFullYear(), 0, 1)
    else if (period === 'MTD') cutoff = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
    else if (period === 'ALL') cutoff = 0
    else cutoff = now - (periodDays[period] || 365) * 86400000

    let pts = [...snapshots]
      .filter((s) => {
        if (!s.date) return false
        const ts = new Date(s.date).getTime()
        if (ts < cutoff) return false
        if (ceiling && ts > ceiling) return false
        return true
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((s) => ({
        ts: new Date(s.date).getTime(),
        date: new Date(s.date),
        value: convertVal(s),
        src: s._source || null,
      }))
      .filter((p) => p.value > 0)

    // One point per calendar day: a day holding both an IBKR NAV doc and a
    // daily/manual doc plots two different values at the same x — a vertical
    // spike. Broker NAV wins, then backfill, then the daily writer.
    {
      const SRC_PRIORITY = { ibkr: 4, backfill: 3, daily: 2, manual: 1 }
      const byDay = new Map()
      for (const p of pts) {
        const key = p.date.toISOString().slice(0, 10)
        const prev = byDay.get(key)
        if (!prev) { byDay.set(key, p); continue }
        const a = SRC_PRIORITY[p.src] || 0
        const b = SRC_PRIORITY[prev.src] || 0
        if (a > b || (a === b && p.ts >= prev.ts)) byDay.set(key, p)
      }
      if (byDay.size < pts.length) pts = [...byDay.values()].sort((a, b) => a.ts - b.ts)
    }

    // ALL spans years: daily-dense recent data next to sparse old data reads as
    // sawtooth on the time-proportional axis. Bucket to one point per week
    // (last value wins), matching the weekly cadence of the ALL API series.
    if (period === 'ALL' && pts.length > 60) {
      const byWeek = new Map()
      for (const p of pts) byWeek.set(Math.floor(p.ts / (7 * 86400000)), p)
      pts = [...byWeek.values()].sort((a, b) => a.ts - b.ts)
    }

    if (period === 'MTD' && pts.length < 2) {
      const sorted = [...snapshots]
        .filter(s => s.date && new Date(s.date).getTime() < cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
      if (sorted.length > 0) {
        const prevSnap = sorted[0]
        const val = convertVal(prevSnap)
        if (val > 0) {
          pts.unshift({ ts: cutoff, date: new Date(cutoff), value: val })
        }
      }
    }

    // Drop an isolated corrupt/stale NAV doc (e.g. a one-off bad value a later
    // sync never overwrote). Detect V-shaped dips: a point that is more than 45%
    // below BOTH neighbors is almost certainly corrupt data, not a real market move.
    // Real crashes produce gradual declines, not single-point dips.
    if (pts.length >= 3) {
      pts = pts.filter((p, i) => {
        if (i === 0 || i === pts.length - 1) return true
        const prev = pts[i - 1].value, next = pts[i + 1].value
        if (prev <= 0 || next <= 0) return true
        return !(p.value < prev * 0.55 && p.value < next * 0.55)
      })
    }

    return pts
  }, [snapshots, period, convert, baseCurrency, customRange, currentTotal, selectedInst, scopedItems])

  // First timestamp with REAL broker NAV (vs reconstructed estimates). Drives the
  // performance-view rebase, the flow gating, and the short-history banner.
  const firstRealTs = useMemo(() => {
    const p = snapshotData.find((s) => ['ibkr', 'daily', 'manual'].includes(s?.src))
    return p ? p.ts : null
  }, [snapshotData])

  const chartData = useMemo(() => {
    // IBKR-sourced snapshots are the broker's account NAV only — they predate any
    // manually-added assets (a bond, a cash fund), so on the "Todas" (all) view
    // those assets would otherwise pop in only at the present. Overlay their
    // reconstructed historical value (staticPoints, from the API) onto each
    // snapshot that does NOT already include them: IBKR-source snapshots (always
    // broker-only), and daily snapshots taken before the manual assets were added.
    // Daily snapshots from after they were added already include them, so skip
    // those to avoid double-counting (which created a phantom mid-year crash).
    const staticAt = (ts) => {
      if (!staticPoints || staticPoints.length === 0) return 0
      let v = 0
      for (const sp of staticPoints) { if (sp.ts <= ts) v = sp.value; else break }
      return v
    }
    const overlay = selectedInst === 'ALL' && staticPoints.length > 0
    // NOTE: 'backfill' snapshots are deliberately NOT overlaid — the backfill API
    // call already includes manual assets (gated by acquisitionDate, exactly like
    // staticAt), so adding staticAt again would double-count them.
    const needsOverlay = (p) => p.src === 'ibkr' || (manualAddedTs > 0 && p.ts < manualAddedTs)
    let snapSource = overlay
      ? snapshotData.map((p) => needsOverlay(p) ? { ...p, value: p.value + staticAt(p.ts) } : p)
      : snapshotData

    // Short-run outlier guard, applied AFTER the overlay (mixed-source snapshot
    // docs + per-point overlay can alternate levels). Drops runs of 1-3
    // consecutive points that sit >1.8× or <0.55× off the level BOTH before and
    // after the run — the single-point test this replaces let 2-3 point corrupt
    // clusters through because they held each other's level. Genuine deposits
    // are kept: their new level persists, so the run never "returns" to the old
    // level and fails the drop condition.
    if (snapSource.length >= 4) {
      const drop = new Set()
      const MAX_RUN = 3
      let i = 1
      while (i < snapSource.length - 1) {
        const prevVal = snapSource[i - 1].value
        if (!(prevVal > 0) || drop.has(i - 1)) { i++; continue }
        const isOut = (v) => v > prevVal * 1.8 || v < prevVal * 0.55
        if (!isOut(snapSource[i].value)) { i++; continue }
        let j = i
        while (j < snapSource.length && isOut(snapSource[j].value) && (j - i) < MAX_RUN) j++
        const next = snapSource[j]
        if (next && next.value > 0 && !isOut(next.value)) {
          for (let k = i; k < j; k++) drop.add(k)
        }
        i = j
      }
      if (drop.size > 0) snapSource = snapSource.filter((_, idx) => !drop.has(idx))
    }

    const apiPts = dataPoints.length >= 2
      ? dataPoints.map((dp) => ({ ts: dp.ts, date: new Date(dp.ts), value: dp.total }))
      : []
    const snapPts = snapSource.length >= 2 ? [...snapSource] : []

    let pts

    if (period === 'DAY' && snapPts.length >= 2) {
      pts = [...snapPts]
      const recentApi = apiPts.filter(p => p.ts > snapPts[0].ts && p.ts < snapPts[snapPts.length - 1].ts)
      if (recentApi.length > 0) {
        pts = [...snapPts.slice(0, -1), ...recentApi, snapPts[snapPts.length - 1]]
          .sort((a, b) => a.ts - b.ts)
      }
    } else if (period === '1W' && apiPts.length >= 2) {
      pts = apiPts
    } else if (snapPts.length >= 2) {
      pts = [...snapPts]
      const firstSnapTs = snapPts[0].ts
      const firstSnapVal = snapPts[0].value
      const lastSnapTs = snapPts[snapPts.length - 1].ts
      if (period !== 'ALL') {
        const olderApi = apiPts.filter(p => p.ts < firstSnapTs - 3600000)
        if (olderApi.length > 0) {
          // The API segment is an ESTIMATE (Σ qty×historical price) and can sit at
          // a different level than the true snapshot NAV — splicing it in raw
          // creates a fake cliff (and a phantom drawdown) at the seam. Scale it so
          // its last point meets the first snapshot value, joining continuously.
          const apiSeam = olderApi[olderApi.length - 1].value
          const scale = apiSeam > 0 && firstSnapVal > 0 ? firstSnapVal / apiSeam : 1
          const scaled = Math.abs(scale - 1) > 0.02 ? olderApi.map(p => ({ ...p, value: p.value * scale })) : olderApi
          pts.unshift(...scaled)
        }
      }
      // Same seam treatment on the trailing side: API points appended after the
      // last snapshot are estimates too, so scale them to meet the snapshot NAV —
      // otherwise a level difference shows up as a fake step at "today".
      const lastSnapVal = snapPts[snapPts.length - 1].value
      let recentApi = apiPts.filter(p => p.ts > lastSnapTs + 3600000)
      if (recentApi.length > 0 && lastSnapVal > 0) {
        const apiSeamStart = recentApi[0].value
        const scaleR = apiSeamStart > 0 ? lastSnapVal / apiSeamStart : 1
        if (Math.abs(scaleR - 1) > 0.02) recentApi = recentApi.map(p => ({ ...p, value: p.value * scaleR }))
      }
      pts.push(...recentApi)
      pts.sort((a, b) => a.ts - b.ts)
    } else if (apiPts.length >= 2) {
      pts = apiPts
    } else {
      return []
    }

    const keepLeadingZeros = ['YTD', 'MTD'].includes(period)
    if (!keepLeadingZeros) {
      while (pts.length > 2 && pts[0].value === 0) {
        pts.shift()
      }
    }

    if (period === 'YTD' && pts.length > 0) {
      const year = new Date().getUTCFullYear()
      const yearStart = Date.UTC(year, 0, 1)
      if (pts[0].ts > yearStart + 86400000) {
        // Anchor the synthetic year-start point on the SAME snapshot the Dietz
        // badge uses (findYearStartAnchor) so card and chart start the year from
        // the same value; converted with this chart's own path so the point stays
        // consistent with the rest of the series. Flat backfill only when no
        // anchor snapshot exists.
        const bc = baseCurrency || 'USD'
        const anchorSnap = findYearStartAnchor(snapshots, year)
        const anchorVal = anchorSnap
          ? (anchorSnap._source === 'manual' && anchorSnap._rawValue != null && anchorSnap._rawCurrency === bc
            ? anchorSnap._rawValue
            : (convert ? convert(anchorSnap.netWorthUSD ?? anchorSnap.totalActivosUSD ?? 0, 'USD', bc) : (anchorSnap.netWorthUSD ?? anchorSnap.totalActivosUSD ?? 0)))
          : null
        pts.unshift({ ts: yearStart, date: new Date(yearStart), value: anchorVal > 0 ? anchorVal : pts[0].value })
      }
    }
    if (period === 'MTD' && pts.length > 0) {
      const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
      if (pts[0].ts > monthStart + 86400000) {
        pts.unshift({ ts: monthStart, date: new Date(monthStart), value: pts[0].value })
      }
    }

    if (currentTotal > 0) {
      const now = Date.now()
      const last = pts[pts.length - 1]
      if (last && Math.abs(last.ts - now) > 60000) {
        pts.push({ ts: now, date: new Date(), value: currentTotal })
      } else if (last) {
        pts[pts.length - 1] = { ts: now, date: new Date(), value: currentTotal }
      }
    }

    // IBKR convention: the Performance view runs "from Jan 1 or the account open
    // date, whichever is later". Our analog of "account open" is the first REAL
    // broker datapoint: when everything earlier is only a reconstruction, a
    // full-period TWR invents a number the broker never reported (user saw +0.32%
    // vs IBKR's +9.98%). Rebase the performance view to the real region; the
    // Value view keeps the (labeled) estimated history for wealth trajectory.
    if (viewMode === 'performance' && !apiTransactional && firstRealTs != null && pts.length > 1
      && pts[0].ts < firstRealTs - 3600000) {
      const real = pts.filter((p) => p.ts >= firstRealTs - 3600000)
      if (real.length >= 2) return real
    }
    return pts
  }, [dataPoints, snapshotData, currentTotal, period, staticPoints, selectedInst, manualAddedTs, snapshots, convert, baseCurrency, viewMode, firstRealTs, apiTransactional])

  // Whether the auto-imported IBKR cash flows (_source:'ibkr') enter the return math
  // depends on the SOURCE of the value series (lesson from the +1.98% vs IBKR's
  // +10.99% TWR bug):
  // - Real broker NAV snapshots (ibkr/daily/manual) already contain the effect of
  //   deposits/withdrawals, so a flow-blind TWR/MWR reads every withdrawal as a market
  //   loss and every deposit as a gain. Flows MUST be included.
  // - Reconstructed baselines (hold-flat Σqty×price, 'backfill' snapshots) pre-date
  //   deposits implicitly (current qty held flat), so subtracting the flows again
  //   double-counts. Flows must be excluded (the original AD2 rationale).
  const flowAware = useMemo(
    () => snapshotData.length >= 2 && ['ibkr', 'daily', 'manual'].includes(snapshotData[0]?.src),
    [snapshotData]
  )
  const returnTransactions = useMemo(
    () => (flowAware || apiTransactional) ? (scopedTransactions || []) : (scopedTransactions || []).filter((tx) => tx._source !== 'ibkr'),
    [flowAware, apiTransactional, scopedTransactions]
  )
  // Single return series: TWR with the broker's own methodology (chained
  // sub-period returns off the NAV series, external flows at the start of each
  // sub-period). The MWR alternative was dropped: two numbers for "my return"
  // that disagreed with the broker's app eroded trust; one number, one truth.
  const returnData = useMemo(() => {
    if (chartData.length < 2) return []
    // Hold-flat prefixes pre-date flows implicitly, so flows inside them are
    // ignored (flowFromTs). A TRANSACTIONAL prefix contains real flow effects,
    // so every flow nets, exactly like a broker's full-year TWR.
    const hasHoldFlatPrefix = !apiTransactional && firstRealTs != null && chartData[0].ts < firstRealTs - 3600000
    return computeTWRSeries(chartData, returnTransactions, convert, baseCurrency,
      hasHoldFlatPrefix ? { flowFromTs: firstRealTs } : {})
  }, [chartData, returnTransactions, convert, baseCurrency, firstRealTs, apiTransactional])

  // Non-null when the performance view was rebased to the first real broker
  // datapoint (IBKR's "Jan 1 or account open, whichever is later" convention).
  // Drives the "Retorno desde {fecha}" label so the number is never presented
  // as a full-year return it isn't.
  const perfRebasedFrom = viewMode === 'performance' && !apiTransactional && firstRealTs != null
    && (period === 'YTD' || period === 'ALL')
    && firstRealTs > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000
    && chartData.length > 0 && chartData[0].ts >= firstRealTs - 3600000
    ? firstRealTs : null

  const sortedBenchmark = useMemo(() => {
    if (!benchmarkPts || benchmarkPts.length < 2) return null
    return [...benchmarkPts].sort((a, b) => a.ts - b.ts)
  }, [benchmarkPts])

  const benchmarkReturn = useMemo(() => {
    if (!sortedBenchmark || chartData.length < 2) return null
    const bStart = findClosestBenchmark(sortedBenchmark, chartData[0].ts)
    const bEnd = findClosestBenchmark(sortedBenchmark, chartData[chartData.length - 1].ts)
    return bStart.close > 0 ? ((bEnd.close - bStart.close) / bStart.close) * 100 : null
  }, [sortedBenchmark, chartData])

  const benchmarkReturnSeries = useMemo(() => {
    if (!sortedBenchmark || chartData.length < 2) return null
    // Rebase to the benchmark close at the PORTFOLIO's start — the benchmark
    // window can be wider than the chart (DAY/1W/MTD fetch 1M of data), and
    // rebasing to its own first point made the SPX line start above/below 0%
    // and disagree with the "vs SPX" figure in the insight box.
    const baseClose = findClosestBenchmark(sortedBenchmark, chartData[0].ts).close
    if (baseClose <= 0) return null
    return chartData.map((dp) => {
      const closest = findClosestBenchmark(sortedBenchmark, dp.ts)
      return ((closest.close - baseClose) / baseClose) * 100
    })
  }, [sortedBenchmark, chartData])

  const contributionLine = useMemo(() => {
    if (viewMode !== 'value' || !scopedTransactions?.length || chartData.length < 2) return null
    const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
    // scopedTransactions already restricts to the selected institution, so a
    // deposit into another account never shows as invested capital here.
    const txs = scopedTransactions
      .filter(tx => flowTypes[tx.type] != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    // No real flows → no line: a flat "invested capital" at the start value
    // suggests a contribution that never happened.
    if (txs.length === 0) return null

    const startVal = chartData[0].value
    return chartData.map(dp => {
      let cum = startVal
      for (const tx of txs) {
        const txTs = new Date(tx.date).getTime()
        if (txTs <= chartData[0].ts) continue
        if (txTs > dp.ts) break
        const amt = tx.totalAmount || tx.amount || 0
        const convertedAmt = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
        cum += (flowTypes[tx.type] || 0) * convertedAmt
      }
      return cum
    })
  }, [chartData, scopedTransactions, viewMode, convert, baseCurrency])

  const drawdown = useMemo(() => {
    if (chartData.length < 3) return null
    let peak = chartData[0].value, peakIdx = 0
    let maxDd = 0, ddStart = 0, ddEnd = 0
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i].value > peak) { peak = chartData[i].value; peakIdx = i }
      const dd = peak > 0 ? (peak - chartData[i].value) / peak : 0
      if (dd > maxDd) { maxDd = dd; ddStart = peakIdx; ddEnd = i }
    }
    if (maxDd < 0.01) return null
    return { start: ddStart, end: ddEnd, pct: maxDd * 100 }
  }, [chartData])

  const txMarkers = useMemo(() => {
    if (!scopedTransactions || chartData.length < 2) return []
    const actionTypes = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL']
    const startTs = chartData[0].ts
    const endTs = chartData[chartData.length - 1].ts
    return scopedTransactions
      .filter(tx => actionTypes.includes(tx.type))
      .filter(tx => {
        const txTs = new Date(tx.date).getTime()
        return txTs >= startTs && txTs <= endTs
      })
      .map(tx => {
        const txTs = new Date(tx.date).getTime()
        let closest = 0
        let minDist = Infinity
        for (let i = 0; i < chartData.length; i++) {
          const dist = Math.abs(chartData[i].ts - txTs)
          if (dist < minDist) { minDist = dist; closest = i }
        }
        return { ...tx, chartIdx: closest }
      })
      // Aggregate per chart point & direction: several same-day transactions used
      // to stack N identical triangles on one x — now one marker + "×N" badge.
      .reduce((acc, tx) => {
        const isBuy = tx.type === 'BUY' || tx.type === 'DEPOSIT'
        const key = `${tx.chartIdx}:${isBuy ? 'b' : 's'}`
        const existing = acc.map.get(key)
        if (existing) existing.count++
        else {
          const m = { chartIdx: tx.chartIdx, isBuy, count: 1 }
          acc.map.set(key, m)
          acc.list.push(m)
        }
        return acc
      }, { map: new Map(), list: [] }).list
  }, [scopedTransactions, chartData])

  const width = chartWidth
  // 200px on phones — the card stacks header+banner+legend+pills and 260 made it
  // very tall on small screens; buildGeometry takes height as a param.
  const chartHeight = width < 480 ? 200 : 260
  const pad = { top: 16, right: 16, bottom: 32, left: 52 }

  const step = Math.max(1, Math.floor(chartData.length / 6))
  const xLabels = useMemo(() => {
    if (chartData.length === 0) return []
    const spanDays = (chartData[chartData.length - 1].ts - chartData[0].ts) / 86400000
    const useDay = spanDays < 120 || ['1W', 'MTD', '1M', '3M'].includes(period)
    const raw = chartData
      .map((d, i) => ({
        label: period === 'DAY'
          ? `${d.date.getHours().toString().padStart(2, '0')}:${d.date.getMinutes().toString().padStart(2, '0')}`
          : useDay
            ? d.date.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
            : d.date.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        idx: i,
      }))
      .filter((_, i) => i % step === 0 || i === chartData.length - 1)
    return raw.filter((xl, i) => i === 0 || xl.label !== raw[i - 1].label)
  }, [chartData, step, period, lang])

  const growthValues = useMemo(() => chartData.map((d) => d.value), [chartData])

  const geo = useMemo(() => {
    const vals = viewMode === 'value' ? growthValues : returnData
    if (vals.length < 2) return null
    // Extra series shares the axis: benchmark (performance) / invested capital
    // (value). Including it here is what keeps both lines on ONE scale.
    const extra = viewMode === 'performance'
      ? (benchmarkReturnSeries || null)
      : (showContributions ? contributionLine : null)
    const timestamps = chartData.map((d) => d.ts)
    return buildGeometry(vals, viewMode === 'value' ? 'value' : 'performance', chartHeight, width, pad, extra, timestamps)
  }, [viewMode, growthValues, returnData, benchmarkReturnSeries, contributionLine, showContributions, chartData, width])

  const contributionGeoPoints = useMemo(() => {
    if (!geo || !contributionLine || viewMode !== 'value' || !showContributions) return null
    // Derive from geo — same X (time-scaled) and same Y scale as the value line.
    // Recomputing a private range here drew the two lines on different axes.
    const ch = chartHeight - pad.top - pad.bottom
    return contributionLine.map((v, i) => ({
      x: geo.points[i]?.x ?? pad.left,
      y: pad.top + ch - ((v - geo.adjustedMin) / geo.range) * ch,
      v,
    }))
  }, [geo, contributionLine, viewMode, showContributions, chartHeight, pad])

  const resolvedXLabels = useMemo(() => {
    if (!geo) return []
    return xLabels.map((xl) => ({ ...xl, x: geo.points[xl.idx]?.x })).filter((xl) => xl.x != null)
  }, [xLabels, geo])

  const benchmarkGeoPoints = useMemo(() => {
    if (!geo || !benchmarkReturnSeries || viewMode !== 'performance') return null
    // Derive from geo (which already includes the benchmark in its extent) so the
    // SPX line is guaranteed to share axis AND time-scaled X with the portfolio.
    const ch = chartHeight - pad.top - pad.bottom
    return benchmarkReturnSeries.map((v, i) => ({
      x: geo.points[i]?.x ?? pad.left,
      y: pad.top + ch - ((v - geo.adjustedMin) / geo.range) * ch,
      v,
    }))
  }, [geo, benchmarkReturnSeries, viewMode, chartHeight, pad])

  const firstVal = chartData.length > 0 ? chartData[0].value : 0
  const lastVal = chartData.length > 0 ? chartData[chartData.length - 1].value : 0
  const growthAbs = lastVal - firstVal
  const growthPct = firstVal > 0 ? (growthAbs / firstVal) * 100 : 0
  const lastReturn = returnData.length > 0 ? returnData[returnData.length - 1] : 0
  // Annualized (CAGR) companion for multi-year spans — "+180% ALL" over 6 years is
  // easy to misread as a yearly figure.
  const spanYears = chartData.length > 1 ? (chartData[chartData.length - 1].ts - chartData[0].ts) / (365.25 * 86400000) : 0
  const cagrPct = spanYears > 1.5 && firstVal > 0 && lastVal > 0
    ? (Math.pow(lastVal / firstVal, 1 / spanYears) - 1) * 100
    : null
  // Same annualized companion for the performance modes: a cumulative "+180%
  // TWR" over 6 years reads as a yearly figure without it. Guard the base
  // (1 + r) > 0 — a −100% cumulative return has no real annualized root.
  const annualizedReturn = spanYears > 1.5 && isFinite(lastReturn) && (1 + lastReturn / 100) > 0
    ? (Math.pow(1 + lastReturn / 100, 1 / spanYears) - 1) * 100
    : null

  const microInsight = useMemo(() => {
    if (benchmarkReturn == null || returnData.length < 2) return null
    // Sanity bound: a degenerate portfolio figure shouldn't be broadcast as a
    // triumphant "you beat the S&P by 500%" box.
    if (!isFinite(lastReturn) || Math.abs(lastReturn) > 200) return null
    const delta = lastReturn - benchmarkReturn
    return { portfolioRet: lastReturn, benchmarkRet: benchmarkReturn, delta, isOut: delta >= 0 }
  }, [benchmarkReturn, lastReturn, returnData])

  const handleSaveSnapshots = useCallback(async () => {
    if (!onSaveSnapshot) return
    const todayStr = new Date().toISOString().split('T')[0]
    // Sanity gates: a fat-fingered extra zero or a future date silently corrupts
    // the chart's scale/history. Zero/negative rows also used to "save" and then
    // vanish (the chart filters value>0) with no explanation.
    const valid = snapshotRows.filter(r => {
      const v = parseFloat(r.value)
      return r.date && r.date <= todayStr && isFinite(v) && v > 0
    })
    if (valid.length === 0) {
      setFetchError(t('Revisa las filas: fecha pasada y valor mayor a 0.', 'Check the rows: past date and value above 0.'))
      return
    }
    setSnapshotSaving(true)
    try {
      for (const row of valid) {
        const raw = parseFloat(row.value)
        const inUSD = (baseCurrency !== 'USD' && convert) ? convert(raw, baseCurrency, 'USD') : raw
        await onSaveSnapshot({
          date: row.date,
          totalActivosUSD: inUSD,
          totalDebtUSD: 0,
          netWorthUSD: inUSD,
          baseCurrency: baseCurrency || 'USD',
          _rawValue: raw,
          _rawCurrency: baseCurrency || 'USD',
          _source: 'manual',
        })
      }
      setShowSnapshotImport(false)
      setSnapshotRows([{ date: '', value: '' }])
    } catch (err) {
      console.error('[chart] manual snapshot save failed:', err)
      setFetchError(t('Error guardando: algunos valores pueden haberse guardado.', 'Save failed: some rows may have been saved.'))
    } finally {
      // Without this, a mid-batch failure left the button stuck on "..."
      setSnapshotSaving(false)
    }
  }, [snapshotRows, onSaveSnapshot, baseCurrency, convert])

  const periodSelector = (
    // Single row with horizontal scroll on mobile (9 pills used to wrap to 2 rows
    // and fatten the card); desktop unaffected because everything fits.
    <div className="flex flex-nowrap sm:flex-wrap overflow-x-auto max-w-full gap-0.5 bg-theme-base rounded-lg p-0.5 border border-glass-border/50" style={{ scrollbarWidth: 'none' }}>
      {periods.map((p) => (
        <button key={p} onClick={() => {
          setPeriod(p)
          if (p === 'CUSTOM') setShowCustomRange(true)
          else setShowCustomRange(false)
        }}
          className={`px-3 py-2 text-xs font-semibold rounded-md transition-all border ${period === p ? 'pill-active' : 'border-transparent'}`}
          style={period === p ? { color: 'var(--text-primary)' } : { color: 'var(--text-muted)' }}>{p === 'CUSTOM' ? (lang === 'es' ? 'Rango' : 'Range') : p}</button>
      ))}
    </div>
  )

  if (loading && chartData.length < 2) {
    return (
      <div className="card-glass rounded-2xl p-5">
        <div className="flex items-center justify-center min-h-[260px]">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            {t('Cargando datos...', 'Loading data...')}
          </div>
        </div>
      </div>
    )
  }

  if (fetchError && chartData.length < 2) {
    return (
      <div className="card-glass rounded-2xl p-5">
        <ErrorState
          title={t('Error cargando gráfico', 'Error loading chart')}
          message={fetchError}
          onRetry={fetchHistory}
          lang={lang}
        />
      </div>
    )
  }

  if (chartData.length < 2) {
    return (
      <div className="card-glass rounded-2xl p-5">
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-2 text-slate-500 text-sm">
          {period === 'DAY' ? (
            <>
              <p>{t('Sin datos intradía: el mercado puede estar cerrado.', 'No intraday data: market may be closed.')}</p>
              <button onClick={() => setPeriod('1W')} className="text-xs" style={{ color: 'var(--accent-blue)' }}>
                {t('Ver última semana', 'View last week')}
              </button>
            </>
          ) : (
            <p>{t('Agrega activos para ver la gráfica.', 'Add assets to see the chart.')}</p>
          )}
        </div>
        <div className="flex justify-center mt-2">{periodSelector}</div>
      </div>
    )
  }

  const hp = hoverIdx != null && geo ? geo.points[hoverIdx] : null
  const hd = hoverIdx != null ? chartData[hoverIdx] : null

  return (
    <div ref={containerRef} className="card-glass rounded-2xl p-5">
      {/* Tab bar: Value | Performance */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setViewMode('value')}
          className="text-sm font-medium pb-1 transition-all border-b-2"
          style={viewMode === 'value'
            ? { color: 'var(--text-primary)', borderColor: 'var(--text-primary)' }
            : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
          {t('Valor', 'Value')}
        </button>
        <button onClick={() => setViewMode('performance')}
          className="text-sm font-medium pb-1 transition-all border-b-2"
          style={viewMode === 'performance'
            ? { color: 'var(--text-primary)', borderColor: 'var(--text-primary)' }
            : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
          {t('Rendimiento', 'Performance')}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {viewMode === 'value' && contributionLine && (
            <button onClick={() => setShowContributions(!showContributions)}
              className="px-2 py-1 text-xs font-medium rounded-md transition-all"
              style={showContributions ? { backgroundColor: 'var(--accent-blue)', color: '#fff' } : { color: 'var(--text-muted)' }}
              title={t('Mostrar/ocultar capital invertido', 'Show/hide invested capital')}>
              {t('Invertido', 'Invested')}
            </button>
          )}
          {/* Single return metric: TWR with IBKR's methodology (chained sub-period
              returns, flows at start of period). The TWR/MWR toggle confused users
              and the two numbers disagreed with the broker; one number, one truth. */}
        </div>
      </div>

      {/* Institution filter: selecting one sums its holdings (e.g. bond + the
          cash account it pays into) into a single combined line. */}
      {institutions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          <button onClick={() => { setSelectedInst('ALL'); setHoverIdx(null) }}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
            style={selectedInst === 'ALL'
              ? { backgroundColor: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' }
              : { backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
            {t('Todas', 'All')}
          </button>
          {institutions.map((inst) => (
            <button key={inst.key} onClick={() => { setSelectedInst(inst.key); setHoverIdx(null) }}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
              style={selectedInst === inst.key
                ? { backgroundColor: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' }
                : { backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
              {inst.name}
              <span className="ml-1.5 opacity-70">{formatCompact(inst.value, baseCurrency)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Header stats */}
      {viewMode === 'value' ? (
        <div className="mb-3">
          <p className="text-3xl font-bold text-white font-mono tabular-nums">{formatCurrency(hd ? hd.value : currentTotal)}</p>
          <p className="text-sm mt-0.5" style={{ color: growthAbs >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            <span className="font-mono tabular-nums">{growthAbs >= 0 ? '+' : ''}{formatCurrency(growthAbs)} ({growthAbs >= 0 ? '+' : ''}{growthPct.toFixed(2)}%)</span>
            <span className="text-slate-500 ml-1">{period === 'YTD' ? t('este año', 'this year') : period === 'DAY' ? t('hoy', 'today') : period === 'CUSTOM' ? t('rango', 'range') : period}</span>
            {/* Raw NAV delta — deposits count as "growth" here. The deposit-adjusted
                return lives in the YTD badge (Dietz) and the Performance tab. */}
            <span className="text-xs text-slate-600 ml-1.5">{t('· incluye depósitos', '· includes deposits')}</span>
            {cagrPct != null && (
              <span className="text-xs text-slate-500 ml-1.5 font-mono tabular-nums">≈ {cagrPct >= 0 ? '+' : ''}{cagrPct.toFixed(1)}%/{t('año', 'yr')}</span>
            )}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-3xl font-bold font-mono tabular-nums flex items-center gap-2" style={{ color: lastReturn >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {lastReturn >= 0 ? '+' : ''}{(hoverIdx != null && returnData[hoverIdx] != null ? returnData[hoverIdx] : lastReturn).toFixed(2)}%
            {/* Mode chip inline with the number — the tiny caption below was easy
                to miss, and an unlabeled return % invites misreading. */}
            <span className="text-xs font-sans font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
              title={t('Retorno ponderado por tiempo, el mismo método que usa tu broker', 'Time-weighted return, the same method your broker uses')}>
              TWR
            </span>
            {annualizedReturn != null && hoverIdx == null && (
              <span className="text-xs font-sans font-normal text-slate-500 font-mono tabular-nums">
                ≈ {annualizedReturn >= 0 ? '+' : ''}{annualizedReturn.toFixed(1)}%/{t('año', 'yr')}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-sm text-slate-400">
              {perfRebasedFrom
                ? `${t('Retorno desde', 'Return since')} ${formatDate(new Date(perfRebasedFrom).toISOString())}`
                : period === 'YTD' ? t('Retorno total del año', 'Total return this year') : period === 'DAY' ? t('Retorno hoy', 'Return today') : `${t('Retorno', 'Return')} ${period}`}
            </span>
            <span className="text-xs text-slate-600">
              {t('Sin efecto de tus depósitos, igual que tu broker', 'Without your deposits’ effect, same as your broker')}
            </span>
          </div>
        </div>
      )}

      {/* Benchmark insight (performance mode only). Alert tokens (not hardcoded
          rgba) so light theme works; the DELTA leads — three raw percentages in
          one line were hard to scan, especially on mobile. */}
      {viewMode === 'performance' && microInsight && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-3"
          style={microInsight.isOut
            ? { backgroundColor: 'var(--alert-success-bg)', border: '1px solid var(--alert-success-border)', color: 'var(--accent-green)' }
            : { backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)', color: 'var(--text-negative)' }
          }>
          <span>{microInsight.isOut ? '▲' : '▼'}</span>
          <span>
            <span className="font-semibold">
              {microInsight.isOut
                ? t(`Superas al ${benchmarkName || 'S&P 500'} por +${Math.abs(microInsight.delta).toFixed(2)}%`, `Beating ${benchmarkName || 'S&P 500'} by +${Math.abs(microInsight.delta).toFixed(2)}%`)
                : t(`Vas debajo del ${benchmarkName || 'S&P 500'} por ${Math.abs(microInsight.delta).toFixed(2)}%`, `Trailing ${benchmarkName || 'S&P 500'} by ${Math.abs(microInsight.delta).toFixed(2)}%`)}
            </span>
            <span className="opacity-70 ml-1.5">
              ({t('tú', 'you')} {microInsight.portfolioRet >= 0 ? '+' : ''}{microInsight.portfolioRet.toFixed(2)}% · {benchmarkName || 'SPX'} {microInsight.benchmarkRet >= 0 ? '+' : ''}{microInsight.benchmarkRet.toFixed(2)}%)
            </span>
          </span>
        </div>
      )}

      {/* Drawdown indicator */}
      {viewMode === 'value' && drawdown && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-3"
          style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)', color: 'var(--text-negative)' }}>
          <span>↓</span>
          <span>
            Max drawdown: -{drawdown.pct.toFixed(1)}%
            <span className="text-slate-500 ml-1">
              ({chartData[drawdown.start] && formatDate(chartData[drawdown.start].date.toISOString())} → {chartData[drawdown.end] && formatDate(chartData[drawdown.end].date.toISOString())})
            </span>
          </span>
        </div>
      )}

      {/* Short-history notice: real broker NAV starts well after Jan 1. The Value
          view shows a labeled estimate before that date; the Performance view is
          rebased to the real region (IBKR's own convention). Either way the fix is
          the same: widen the Flex Query period and re-sync. */}
      {(period === 'YTD' || period === 'ALL') && !apiTransactional && firstRealTs != null && chartData.length > 1
        && firstRealTs > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000
        && (viewMode === 'performance' || chartData[0].ts < firstRealTs - 3600000) && (
        <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-3"
          style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)', color: 'var(--alert-info-icon)' }}>
          <span>ℹ</span>
          <span>
            {viewMode === 'performance'
              ? t(`Tu retorno se mide desde ${formatDate(new Date(firstRealTs).toISOString())}, el primer día con datos reales de tu broker (igual que haría IBKR con una cuenta nueva). Para medir el año completo, pon el período de tu Flex Query en "Year to Date" y vuelve a sincronizar.`,
                  `Your return is measured from ${formatDate(new Date(firstRealTs).toISOString())}, the first day with real broker data (just like IBKR would for a new account). To measure the full year, set your Flex Query period to "Year to Date" and sync again.`)
              : t(`Datos reales de tu broker desde ${formatDate(new Date(firstRealTs).toISOString())}; antes es un estimado. Para ver tu año completo igual que tu broker, pon el período de tu Flex Query en "Year to Date" y vuelve a sincronizar.`,
                  `Real broker data starts ${formatDate(new Date(firstRealTs).toISOString())}; earlier values are an estimate. To see your full year exactly like your broker, set your Flex Query period to "Year to Date" and sync again.`)}
          </span>
        </div>
      )}

      {/* Chart */}
      {geo && (
        <div className="relative">
          <svg role="img" aria-label={t('Gráfico de crecimiento del portafolio', 'Portfolio growth chart')} viewBox={`0 0 ${width} ${chartHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet"
            onMouseLeave={() => setHoverIdx(null)}
            onTouchEnd={() => setHoverIdx(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = ((e.clientX - rect.left) / rect.width) * width
              if (geo.points.length === 0) return
              let lo = 0, hi = geo.points.length - 1
              while (lo < hi - 1) {
                const mid = (lo + hi) >> 1
                if (geo.points[mid].x < mx) lo = mid; else hi = mid
              }
              setHoverIdx(Math.abs(geo.points[lo].x - mx) <= Math.abs(geo.points[hi].x - mx) ? lo : hi)
            }}
            onTouchMove={(e) => {
              const touch = e.touches[0]
              if (!touch) return
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = ((touch.clientX - rect.left) / rect.width) * width
              if (geo.points.length === 0) return
              let lo = 0, hi = geo.points.length - 1
              while (lo < hi - 1) {
                const mid = (lo + hi) >> 1
                if (geo.points[mid].x < mx) lo = mid; else hi = mid
              }
              setHoverIdx(Math.abs(geo.points[lo].x - mx) <= Math.abs(geo.points[hi].x - mx) ? lo : hi)
            }}>

            {/* Y-axis grid lines and labels. In performance mode a tick can land a
                few px from the dedicated "0%" baseline label — skip its text (keep
                the gridline) so the two never collide ("-1.20%" over "0%"). */}
            {geo.yTicks.map((tk, i) => {
              const collidesWithBaseline = viewMode === 'performance' && Math.abs(tk.y - geo.baselineY) < 12
              return (
                <g key={i}>
                  <line x1={pad.left} y1={tk.y} x2={width - pad.right} y2={tk.y} stroke="var(--card-border)" strokeDasharray="4 4" strokeOpacity="0.8" />
                  {!collidesWithBaseline && (
                    <text x={pad.left - 8} y={tk.y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontFamily="system-ui">
                      {viewMode === 'performance' ? `${tk.val >= 0 ? '+' : ''}${tk.val.toFixed(tk.val === 0 ? 0 : 2)}%` : formatAxisTick(tk.val, tk.step, baseCurrency)}
                    </text>
                  )}
                </g>
              )
            })}

            {viewMode === 'value' ? (
              <>
                <defs>
                  <linearGradient id="grad-value" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Drawdown shaded zone */}
                {drawdown && geo.points[drawdown.start] && geo.points[drawdown.end] && (
                  <rect
                    x={geo.points[drawdown.start].x}
                    y={pad.top}
                    width={geo.points[drawdown.end].x - geo.points[drawdown.start].x}
                    height={chartHeight - pad.top - pad.bottom}
                    fill="var(--text-negative)" opacity="0.06" rx="2" />
                )}

                {/* Main value area + line */}
                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-value)" />
                <path d={polyline(geo.points)} fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Contributions line (invested capital) */}
                {contributionGeoPoints && contributionGeoPoints.length >= 2 && showContributions && (
                  <path d={polyline(contributionGeoPoints)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 3" opacity="0.5" />
                )}

                {/* Transaction markers (aggregated: one triangle per point+direction) */}
                {txMarkers.map((m, i) => {
                  const pt = geo.points[m.chartIdx]
                  if (!pt) return null
                  const markerY = chartHeight - pad.bottom
                  const color = m.isBuy ? 'var(--accent-green)' : 'var(--text-negative)'
                  return (
                    <g key={i}>
                      <polygon
                        points={m.isBuy
                          ? `${pt.x},${markerY + 2} ${pt.x - 4},${markerY + 10} ${pt.x + 4},${markerY + 10}`
                          : `${pt.x},${markerY + 10} ${pt.x - 4},${markerY + 2} ${pt.x + 4},${markerY + 2}`}
                        fill={color} opacity="0.6" />
                      {m.count > 1 && (
                        <text x={pt.x + 6} y={markerY + 9} fill={color} fontSize="8" fontFamily="system-ui" opacity="0.8">×{m.count}</text>
                      )}
                    </g>
                  )
                })}
              </>
            ) : (
              <>
                <defs>
                  <linearGradient id="grad-perf-green" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-green)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="var(--accent-green)" stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="grad-perf-red" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--text-negative)" stopOpacity="0.02" />
                    <stop offset="100%" stopColor="var(--text-negative)" stopOpacity="0.3" />
                  </linearGradient>
                  {/* 1px overlap between the clips: the strokeWidth-2 line lost ~1px
                      of each color exactly at the crossover, leaving a visible notch. */}
                  <clipPath id="clip-above-baseline">
                    <rect x={pad.left} y={pad.top} width={geo.cw} height={Math.max(0, geo.baselineY - pad.top + 1)} />
                  </clipPath>
                  <clipPath id="clip-below-baseline">
                    <rect x={pad.left} y={geo.baselineY - 1} width={geo.cw} height={Math.max(0, chartHeight - pad.bottom - geo.baselineY + 1)} />
                  </clipPath>
                </defs>

                <line x1={pad.left} y1={geo.baselineY} x2={width - pad.right} y2={geo.baselineY}
                  stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="6 4" />
                <text x={pad.left - 8} y={geo.baselineY + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontFamily="system-ui" fontWeight="600">0%</text>

                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-green)" clipPath="url(#clip-above-baseline)" />

                <path
                  d={`${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`}
                  fill="url(#grad-perf-red)" clipPath="url(#clip-below-baseline)" />

                <path d={polyline(geo.points)} fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  clipPath="url(#clip-above-baseline)" />

                <path d={polyline(geo.points)} fill="none" stroke="var(--text-negative)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  clipPath="url(#clip-below-baseline)" />

                {/* No in-chart label: the legend already names the benchmark, and the
                    old label started 12px from the right edge → always clipped ("SP"). */}
                {benchmarkGeoPoints && benchmarkGeoPoints.length >= 2 && (
                  <path d={polyline(benchmarkGeoPoints)} fill="none" stroke="var(--accent-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" strokeOpacity="0.85" />
                )}
              </>
            )}

            {/* X-axis labels */}
            {resolvedXLabels.map((xl, i) => (
              <text key={i} x={xl.x} y={chartHeight - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="system-ui">{xl.label}</text>
            ))}

            {/* Hover crosshair */}
            {hp && (
              <g>
                <line x1={hp.x} y1={pad.top} x2={hp.x} y2={chartHeight - pad.bottom} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" />
                <circle cx={hp.x} cy={hp.y} r="4.5"
                  fill={viewMode === 'value' ? 'var(--accent-blue)' : (hp.v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')}
                  stroke="var(--bg-card)" strokeWidth="2" />
              </g>
            )}
          </svg>

          {/* Hover tooltip */}
          {hd && hp && (
            <div className="absolute pointer-events-none text-white text-xs rounded-lg px-3 py-2 z-10"
              style={{
                background: 'var(--bg-card)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                border: 'var(--glass-border)',
                boxShadow: 'var(--shadow-elevated)',
                left: `${Math.min(85, Math.max(15, (hp.x / width) * 100))}%`,
                // Flip below the point when it sits in the top third — the tooltip
                // used to clip past the top of the chart there.
                top: hp.y < chartHeight / 3
                  ? `${(hp.y / chartHeight) * 100 + 8}%`
                  : `${(hp.y / chartHeight) * 100 - 14}%`,
                transform: hp.y < chartHeight / 3 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              }}>
              {viewMode === 'value' ? (
                <>
                  <div className="font-bold">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-400">{formatTooltipDate(hd.date)}</div>
                  {hoverIdx > 0 && (() => {
                    const prev = chartData[hoverIdx - 1]
                    const chg = hd.value - prev.value
                    const chgPct = prev.value > 0 ? (chg / prev.value) * 100 : 0
                    return (
                      <div style={{ color: chg >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                        {chg >= 0 ? '+' : ''}{formatCurrency(chg)} ({chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%)
                      </div>
                    )
                  })()}
                  {(() => {
                    const chgFromStart = hd.value - firstVal
                    const chgPctFromStart = firstVal > 0 ? (chgFromStart / firstVal) * 100 : 0
                    return (
                      <div className="text-slate-500">
                        {chgFromStart >= 0 ? '+' : ''}{formatCurrency(chgFromStart)} ({chgPctFromStart >= 0 ? '+' : ''}{chgPctFromStart.toFixed(2)}%) {t('desde inicio', 'from start')}
                      </div>
                    )
                  })()}
                </>
              ) : (
                <>
                  <div className="font-bold" style={{ color: (returnData[hoverIdx] ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {t('Portafolio', 'Portfolio')}: {(returnData[hoverIdx] ?? 0) >= 0 ? '+' : ''}{(returnData[hoverIdx] ?? 0).toFixed(2)}%
                  </div>
                  {benchmarkReturnSeries && benchmarkReturnSeries[hoverIdx] != null && (
                    <div style={{ color: 'var(--accent-orange)' }}>
                      {benchmarkName || 'S&P 500'}: {benchmarkReturnSeries[hoverIdx] >= 0 ? '+' : ''}{benchmarkReturnSeries[hoverIdx].toFixed(2)}%
                    </div>
                  )}
                  <div className="text-slate-300">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-500">{formatTooltipDate(hd.date)}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend + Period selector */}
      {viewMode === 'value' && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: 'var(--accent-blue)' }} />
            {t('Valor actual', 'Current value')}
          </span>
          {showContributions && contributionLine && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block opacity-50" style={{ backgroundColor: 'var(--text-muted)', borderBottom: '1px dashed' }} />
              {t('Capital invertido', 'Invested capital')}
            </span>
          )}
          {/* The floor triangles were never explained anywhere */}
          {txMarkers.length > 0 && (
            <span className="flex items-center gap-1">
              <span style={{ color: 'var(--accent-green)' }}>▲</span>{t('Compra/Depósito', 'Buy/Deposit')}
              <span className="ml-1" style={{ color: 'var(--text-negative)' }}>▼</span>{t('Venta/Retiro', 'Sell/Withdrawal')}
            </span>
          )}
        </div>
      )}
      {viewMode === 'performance' && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
          {/* The line renders green above 0% and red below — document both colors */}
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: 'var(--accent-green)' }} />
            <span className="w-1.5 h-1.5 rounded-full inline-block -ml-1" style={{ backgroundColor: 'var(--text-negative)' }} />
            {t('Tu portafolio (TWR): verde sobre 0%, rojo debajo', 'Your portfolio (TWR): green above 0%, red below')}
          </span>
          {benchmarkReturnSeries && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: 'var(--accent-orange)', borderBottom: '1px dashed' }} />
              {benchmarkName || 'S&P 500'}
            </span>
          )}
        </div>
      )}
      <div className="flex justify-center mt-2">
        {periodSelector}
      </div>

      {/* Custom date range inputs */}
      {showCustomRange && period === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 mt-3 justify-center">
          <label className="text-xs text-slate-400">{t('Desde', 'From')}:</label>
          <input type="date" value={customRange.from}
            onChange={e => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
            max={customRange.to || new Date().toISOString().split('T')[0]}
            className="px-2 py-1 bg-theme-base border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]" />
          <label className="text-xs text-slate-400">{t('Hasta', 'To')}:</label>
          <input type="date" value={customRange.to}
            onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
            max={new Date().toISOString().split('T')[0]}
            className="px-2 py-1 bg-theme-base border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]" />
        </div>
      )}

      {/* Snapshot import section */}
      <div className="flex justify-center mt-3">
        <button onClick={() => setShowSnapshotImport(!showSnapshotImport)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {showSnapshotImport ? '▾' : '▸'} {t('Agregar datos históricos', 'Add historical data')}
        </button>
      </div>

      {showSnapshotImport && (
        <div className="mt-2 p-3 bg-theme-base border border-glass-border rounded-lg">
          <p className="text-xs text-slate-400 mb-2">
            {t('Agrega valores pasados de tu portafolio para completar la gráfica.',
               'Add past portfolio values to complete the chart.')}
          </p>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {snapshotRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input type="date" value={row.date}
                  onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, date: e.target.value } : r))}
                  className="px-2 py-1 bg-theme-card border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[#3b82f6] w-36" />
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-xs text-slate-500">$</span>
                  <input type="number" value={row.value} placeholder={t('Valor total', 'Total value')}
                    onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                    className="w-full px-2 py-1 bg-theme-card border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]" />
                </div>
                {snapshotRows.length > 1 && (
                  <button onClick={() => setSnapshotRows(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-500 hover:text-red-400 text-sm px-1">×</button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => setSnapshotRows(prev => [...prev, { date: '', value: '' }])}
              className="text-xs" style={{ color: 'var(--accent-blue)' }}>
              + {t('Agregar fila', 'Add row')}
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setShowSnapshotImport(false); setSnapshotRows([{ date: '', value: '' }]) }}
                className="px-3 py-1 text-xs text-slate-400 hover:text-white transition-colors">
                {t('Cancelar', 'Cancel')}
              </button>
              <button onClick={handleSaveSnapshots} disabled={snapshotSaving || !snapshotRows.some(r => r.date && r.value)}
                className="px-3 py-1 text-xs rounded disabled:opacity-40 transition-colors"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                {snapshotSaving ? '...' : t('Guardar', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
