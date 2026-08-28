'use client'

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react'
import { formatCurrency, formatCompact, formatAxisTick, formatDate, getItemValue, buildIncomeEvents, isExcludedFromNetWorth, findYearStartAnchor, shouldHoldFlat, hasUnreliableAcqDate, SNAPSHOT_SRC_PRIORITY, BROKER_NAV_SOURCES, computeWindowGrowth, isMarketPriced, effectiveAcqTs, accountKeyOfItem } from './utils'
import { buildTxEvents, buildCashFlows, rewindableTradeSymbols, brokerAccountTransactions } from '@/lib/portfolioRewind'
import { niceScale, pctDecimals } from '@/lib/niceAxis'
import { indexBalanceEvents } from '@/lib/historicalValues'
import { isBankLikeItem } from '@/lib/contributions'
import { preferFullPortfolioPerDay } from '@/lib/snapshotSelect'
import { buildNavByDate, composeDailyTotals, divergentDailyDates, staleBackfillDates, windowDates, navAsOf, brokerConnectedTsOf } from '@/lib/snapshotBackfill'
import { buildHistoryRequestBody } from '@/lib/historyPayload'
import { staticValueAt } from '@/lib/staticOverlay'
import { computeTWRSeries, computeAnchoredReturnSeries, computeAnchoredMWRSeries, filterValueSpikes } from './analytics'
import { authFetch, safeJson } from '@/lib/authFetch'
import ErrorState from '@/components/ui/ErrorState'
import InlineNotice from '@/components/ui/InlineNotice'
import { useEdgeFade } from '@/hooks/useEdgeFade'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import BusyLabel, { BusyRing } from '@/components/ui/BusyLabel'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'

function polyline(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// Canonical institution key: trim, collapse whitespace, case-fold — so casing or
// stray spaces in user data never split one custodian into two.
function normInst(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Los helpers de eje redondo viven en lib/niceAxis.js desde FASE KK: la
// pagina compartida dibuja el MISMO eje y una segunda copia divergiria.

function buildGeometry(values, mode, height, width, pad, extraSeries, timestamps) {
  const ch = height - pad.top - pad.bottom
  const cw = width - pad.left - pad.right

  let allVals = values.filter(v => isFinite(v))
  // extraSeries shares the Y scale (the invested-capital line in value mode) —
  // both lines must live on ONE axis or the comparison lies.
  if (extraSeries && extraSeries.length > 0) {
    allVals = [...allVals, ...extraSeries.filter(v => isFinite(v))]
  }
  if (allVals.length === 0) allVals = [0]
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  let paddingVal = mode === 'performance' ? 0 : (max - min) * 0.05
  // A genuinely flat series (a fully static portfolio over a few days) can
  // still differ by a few cents or dollars between points — rounding, a
  // slightly different rate snapshot. With no floor the Y-axis auto-zooms to
  // that sliver of a range and draws sub-1%-of-value noise as a dramatic
  // plunge on an otherwise unmoved total — the headline says flat, the line
  // says it crashed (FASE EI). Floor the padding at a fraction of the value
  // LEVEL itself, not just the local max-min, so that reads as the flat line
  // it actually is; a real move bigger than the floor still shows normally.
  if (mode !== 'performance') {
    const level = Math.max(Math.abs(max), Math.abs(min), 1)
    paddingVal = Math.max(paddingVal, level * 0.0075)
  }
  let adjustedMin = mode === 'performance' ? Math.min(min, 0) - Math.abs(min || 1) * 0.1 : min - paddingVal
  let adjustedMax = mode === 'performance' ? Math.max(max, 0) + Math.abs(max || 1) * 0.1 : max + paddingVal

  // Los extremos se llevan al múltiplo redondo más cercano hacia afuera, así que
  // toda marca cae en un número entero de pasos. En modo rendimiento eso además
  // garantiza que el 0% caiga EXACTO sobre una línea de la cuadrícula (0 es
  // múltiplo de cualquier paso), y el 0% ya está adentro del rango por
  // construcción, así que ensanchar no lo puede dejar fuera.
  const tickCount = 5
  const nice = niceScale(adjustedMin, adjustedMax, tickCount)
  if (nice) {
    adjustedMin = nice.min
    adjustedMax = nice.max
  }
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

  const tickStep = nice ? nice.step : range / (tickCount - 1)
  const yTicks = nice
    ? Array.from({ length: nice.count }, (_, i) => {
        const val = parseFloat((nice.min + nice.step * i).toPrecision(12))
        return { val, y: pad.top + ch - ((val - adjustedMin) / range) * ch, step: nice.step, nice: true }
      })
    : Array.from({ length: tickCount }, (_, i) => ({
        val: adjustedMin + (range * i) / (tickCount - 1),
        y: pad.top + ch - (i / (tickCount - 1)) * ch,
        step: tickStep,
        nice: false,
      }))

  return { points, baselineY, yTicks, cw, ch, adjustedMin, range }
}

// repairItems / repairSnapshots (FASE JU): "Reparar ahora" escribe los MISMOS
// docs que el backfill automático, así que tiene que mirar los MISMOS datos.
// `items` viene escopado por portafolio/entidad (correcto para la gráfica,
// incorrecto para archivar el patrimonio) y `snapshots` trae además los docs
// sintéticos de calibración, que no existen en Firestore y hacen que fechas sin
// dato real se lean como cubiertas. Sin estos props el comportamiento es el de
// antes.
export default function PortfolioGrowthChart({ items, lots, snapshots, transactions, lang, convert, baseCurrency, onSaveSnapshot, ibkrSyncSummary = null, onImportBroker = null, repairItems = null, repairSnapshots = null, onMigrateNav = null }) {
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
  // FASE FP. Three tabs: 'value' (untouched), 'performance' (the frozen
  // anchored series, labeled TWR, the DEFAULT return view) and
  // 'performance-mwr' (money-weighted sibling). Everything that used to gate
  // on shownMode === 'performance' and means "any return view" gates on
  // isPerf instead; everything gating on shownMode === 'value' is untouched
  // by construction (a third mode can never equal 'value').
  const [viewMode, setViewMode] = useState('value')
  // FASE HG. DOS estados para una sola elección, a propósito.
  //
  // `viewMode` es lo que el usuario acaba de tocar y manda SOLO en el resaltado
  // de las pestañas: cambia en el mismo frame del toque, así que la respuesta
  // se siente inmediata pase lo que pase después.
  //
  // `shownMode` es lo que la gráfica está mostrando de verdad, y va detrás. El
  // cambio de pestaña dispara un recálculo pesado (una pasada Dietz completa
  // sobre toda la serie) que antes corría de forma síncrona y congelaba la
  // interfaz: la pestaña no se marcaba hasta que terminaba, y por eso se sentía
  // trabada. useDeferredValue lo saca del camino crítico y deja que React
  // pinte el resaltado primero.
  //
  // TODO lo que es CONTENIDO (encabezado, chip, caption, geometría, datos) lee
  // shownMode, nunca viewMode. Si leyera viewMode se vería un instante el
  // rótulo "MWR" sobre datos de TWR: un número equivocado bajo una etiqueta
  // equivocada, que es peor que esperar. Así, lo que se ve siempre es
  // coherente consigo mismo; solo llega un momento después.
  const shownMode = useDeferredValue(viewMode)
  const modeSwitching = shownMode !== viewMode
  const isPerf = shownMode === 'performance' || shownMode === 'performance-mwr'
  // Opt-in, not opt-on: a second dashed line that diverges sharply from the
  // value line (money invested vs. what it's worth today) reads as a stray
  // rendering glitch to someone who hasn't been told what it means. Showing
  // it by default put that on every user on every load; the toggle is one tap
  // away for whoever wants the comparison.
  const [showContributions, setShowContributions] = useState(false)
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [showSnapshotImport, setShowSnapshotImport] = useState(false)
  const [snapshotRows, setSnapshotRows] = useState([{ date: '', value: '' }])
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const containerRef = useRef(null)
  const mountedRef = useRef(true)
  const [chartWidth, setChartWidth] = useState(650)
  const [selectedInst, setSelectedInst] = useState('ALL')
  // Misma división que shownMode: la pastilla se marca en el frame del toque,
  // y el contenido (que puede tener que pedir historial y recalcular la serie
  // entera) llega detrás sin bloquear. Cambiar de cuenta era lo OTRO que el
  // usuario reportó como trabado.
  const shownInst = useDeferredValue(selectedInst)
  const instSwitching = shownInst !== selectedInst
  const switching = modeSwitching || instSwitching

  // La FORMA de la serie. Solo cambia cuando el usuario pide otra cosa
  // (otro período, otra cuenta, otra pestaña), nunca con un tick de precios: es
  // la `key` que hace que la línea se REDIBUJE en esos tres casos y se quede
  // quieta en los refrescos de fondo. Redibujar la gráfica entera cada cinco
  // minutos sería más molesto que no animar nada.
  const shapeKey = `${shownMode}|${shownInst}|${period}`

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

  // FASE GP: fade the scroll edge only where the row actually hides content —
  // scrollbarWidth:'none' hides the native bar on these rows, so without this
  // the last pill just clips at the phone's edge with no sign there's more.
  // La fila de períodos ya no la necesita: `SegmentedTabs` trae su propio
  // difuminado adentro, así que declararla acá sería medir dos veces la misma
  // fila. El filtro de institución sigue siendo una fila propia.
  const instFade = useEdgeFade([institutions.length])

  const scopedItems = useMemo(() => {
    if (shownInst === 'ALL') return items || []
    const inst = institutions.find((i) => i.key === shownInst)
    return inst ? inst.items : []
  }, [shownInst, items, institutions])

  // Transactions belonging to the selected institution. TWR/MWR/markers must use
  // this scoped list: with the full list, a deposit into Interactive Brokers would
  // count as a cash flow against an IDC-only value series and distort its return.
  // Los ids de TODOS los activos, keyeados por CONTENIDO y no por la identidad
  // de `items`: esa identidad se rehace en cada tick de precio, y meterla a las
  // dependencias de abajo recalcularía el scope (y con él la línea de capital y
  // los marcadores) cada pocos segundos. Es la enfermedad que documentan las
  // FASES DW/DY.
  const allItemIdsSig = (items || []).map((it) => it.id).filter(Boolean).sort().join('|')
  const allItemIds = useMemo(
    () => new Set(allItemIdsSig ? allItemIdsSig.split('|') : []),
    [allItemIdsSig]
  )
  const scopedTransactions = useMemo(() => {
    if (!transactions || shownInst === 'ALL') return transactions
    const scopedIds = new Set(scopedItems.map((it) => it.id).filter(Boolean))
    const scopedSyms = new Set(scopedItems.map((it) => (it.symbol || '').toUpperCase()).filter(Boolean))
    // FASE IT (extensión de la superficie congelada D, confirmada por el
    // usuario; spec actualizada en el mismo commit). Un movimiento que trae un
    // `_linkedItemId` VÁLIDO ya dijo a qué activo pertenece, y si ese activo no
    // está en este scope, el movimiento tampoco. Sin esto caía hasta la regla
    // del símbolo de abajo y se colaba igual cuando el mismo símbolo existe en
    // dos cuentas: un depósito ajeno aparecía como marcador de "Entró dinero" y
    // se restaba como capital nuevo de una cuenta que no lo recibió, así que su
    // gráfica y su fila del desglose (que sí respeta el vínculo) divergían por
    // un monto FIJO. Un vínculo MUERTO (el activo ya no existe) sigue cayendo a
    // la regla del símbolo, igual que antes: ahí el vínculo no dice nada.
    // IBKR deposit/withdrawal flows carry symbol 'CASH', but the cash HOLDING is
    // 'CASH-USD' etc — a plain symbol match drops every flow in the scoped view. If
    // this scope holds a cash/bank position, include the bare-CASH flows too.
    const scopedHasCash = scopedItems.some((it) => /^CASH/i.test(it.symbol || ''))
    // FASE GF: una fila del ledger de IBKR (depósito/retiro con símbolo 'CASH',
    // sin _linkedItemId) pertenece al scope de IBKR por su FUENTE, no por que
    // sobreviva un holding de efectivo. Un depósito gastado completo en
    // acciones no deja ningún item CASH-* vivo, y exigirlo (la regla vieja de
    // scopedHasCash como única puerta) filtraba TODOS los flujos de la vista
    // escopada: cero flujos neteados, así que Valor, TWR y MWR imprimían el
    // MISMO +84.25% (el cambio crudo de valor, depósitos leídos como
    // ganancia) y ningún marcador de "Entró dinero" aparecía. El mismo test
    // por fuente mantiene esas filas FUERA de cualquier scope sin IBKR, donde
    // el heurístico /^CASH/ podía colarlas si una cuenta manual usara un
    // símbolo que empiece con CASH. Un flujo inferido (FASE DQ) tiene la misma
    // semántica de cuenta de broker y viaja por la misma puerta.
    const scopedHasIbkr = scopedItems.some((it) => it._source === 'ibkr')
    return transactions.filter((tx) => {
      const sym = (tx.symbol || '').toUpperCase()
      if (tx._linkedItemId && scopedIds.has(tx._linkedItemId)) return true
      if (tx._linkedItemId && allItemIds.has(tx._linkedItemId)) return false
      if ((tx._source === 'ibkr' || tx._source === 'inferred_flow') && sym.startsWith('CASH')) return scopedHasIbkr
      return (tx.symbol && scopedSyms.has(sym)) ||
        (scopedHasCash && sym.startsWith('CASH'))
    })
  }, [transactions, scopedItems, shownInst, allItemIds])

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
  // FASE GP: same price-free signature as itemsSig, but over ALL items, not
  // just the currently-scoped ones. itemsSig is scoped to shownInst ON
  // PURPOSE (it has to differ per institution, since that IS the network
  // request differentiator) — using it as the cache guard below would clear
  // the whole history cache on every single institution switch, since a
  // different scope always produces a different scoped signature even when
  // nothing was actually edited. This one stays stable across institution
  // switches and only changes on a real add/edit/delete anywhere.
  const allItemsSig = useMemo(() =>
    (items || [])
      .map((i) => `${i.id}:${i.quantity}:${i.symbol || ''}:${i.acquisitionDate || ''}:${i.isDebt ? 1 : 0}`)
      .sort()
      .join('|'),
  [items])

  // FASE GP: cache the server response per (institución, apiPeriod) so
  // switching back and forth between institutions/períodos the user already
  // visited is instant instead of a fresh network round trip every time.
  // Invalidated WHOLESALE, never partially, the instant anything that could
  // change the request body changes — never a stale number surviving a real
  // edit. `allItemsSig` is a price-free content signature (a price tick alone
  // never invalidates it), scoped to ALL items so it doesn't churn on every
  // institution switch the way `itemsSig` does (see comment above); `transactions`/
  // `lots` are the RAW props (not the scoped/derived copies, which get a
  // fresh identity every price tick because they derive from `items`) — a
  // separate Firestore collection each, so their reference is stable except
  // on a real write, exactly the signal this needs. DAY and CUSTOM are never
  // cached: DAY is intraday (stale within minutes, and already has its own
  // anti-staleness generation logic) and CUSTOM's range is too varied to be
  // worth the bookkeeping.
  const historyCacheRef = useRef(new Map())
  const cacheGuardRef = useRef({ allItemsSig: null, transactions: null, lots: null })

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
    const guard = cacheGuardRef.current
    if (guard.allItemsSig !== allItemsSig || guard.transactions !== transactions || guard.lots !== lots) {
      historyCacheRef.current.clear()
      cacheGuardRef.current = { allItemsSig, transactions, lots }
    }
    const cacheable = period !== 'DAY' && period !== 'CUSTOM'
    const cacheKey = `${shownInst}|${period}`
    const cachedData = cacheable ? historyCacheRef.current.get(cacheKey) : undefined
    const gen = ++fetchGenRef.current
    // A cache hit skips the loading flash entirely — that IS the point.
    if (!cachedData) setLoading(true)
    setFetchError(null)
    // A period switch TO DAY must not let the previous period's dataPoints (e.g.
    // months of YTD data) bleed into the DAY splice while this fetch is in
    // flight — chartData's DAY branch maps whatever is in dataPoints without a
    // period check, so a stale point that happens to fall in the last-3-days
    // window would flash on screen until the real intraday response lands.
    if (period === 'DAY') setDataPoints([])
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
      const instFilter = shownInst === 'ALL' ? null : shownInst
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
      // FASE IX. La caja del broker solo lleva movimientos de ESA cuenta, y solo
      // se deshacen los trades cuyas acciones el server también rebobina. Sin lo
      // primero, cada depósito de apertura de una cuenta MANUAL se deshace dos
      // veces (en su propio ítem y otra vez acá) y el efectivo del broker en el
      // pasado se hunde por la suma de todos ellos; sin lo segundo, la venta de
      // una posición que hoy ya no existe le resta sus ingresos sin devolver las
      // acciones que los produjeron. Las dos formas hacen que el portafolio
      // reconstruido pueda terminar en NEGATIVO, que es lo que dibujaba la vista
      // "Todas" arrancando en -$6.3K. Ver lib/portfolioRewind.js.
      const brokerItemsInScope = chartItems.filter((it) => it?._source === 'ibkr')
      const brokerTx = brokerAccountTransactions(scopedTransactions, brokerItemsInScope)
      const accountCashFlows = buildCashFlows(brokerTx,
        (amt, cur2) => convert ? convert(amt, cur2, 'USD') : amt,
        { rewindableSymbols: rewindableTradeSymbols(chartItems, txEventsBySym) })
      // The whole account ledger attaches to ONE cash item (the broker's cash line).
      // Only rewind cash when there's a REAL external flow (deposit/withdrawal): with
      // hold-flat stocks, rewinding by BUY/SELL double-counts and wrecks the baseline.
      const hasExternalFlow = brokerTx.some((t) => /^(DEPOSIT|WITHDRAWAL)$/i.test(t.type || ''))
      // Prefer the CASH-{ccy} holding; fall back to any single IBKR bank-type item so
      // the flows still rebuild the cash line when the symbol isn't exactly CASH-*.
      const cashItem = (accountCashFlows.length > 0 && hasExternalFlow)
        ? (chartItems.find((it) => it._source === 'ibkr' && /^CASH-/i.test(it.symbol || ''))
           || chartItems.find((it) => it._source === 'ibkr' && /bank|cash/i.test(it.type || '')))
        : null
      // Manual bank-like items (bonds, cash accounts, alternatives — anything
      // with no market price series) don't ride the IBKR cash line above. A
      // later "aporte" (EditAccountModal's contribution flow) just bumps the
      // balance directly with no dated event the static reconstruction could
      // otherwise see, so the whole balance showed flat since the item's
      // original acquisitionDate instead of stepping up on the contribution's
      // real date. Rewind each such item by its OWN linked DEPOSIT/WITHDRAWAL/
      // DIVIDEND transactions — same mechanism as the IBKR cash line, just
      // scoped per item instead of to one designated account.
      //
      // A DIVIDEND is special: it's linked to the SOURCE asset (a bond paying
      // interest) for bookkeeping, but the source's own value never changes —
      // only the destination it was routed to does. Naively attributing it to
      // the linked item subtracted the payout from the bond's own past value
      // instead of crediting it to the account it actually landed in (real
      // bug: a $6,000 bond with a $240 payout showed $5,760, flat, forever —
      // the payout never reached the destination's reconstruction either).
      // Mirrors the redirect lib/historicalValues.js already does for the
      // spreadsheet: reinvested (or destination-less) dividends stay with the
      // source; everything else moves to incomeDestination.
      // ONE indexer for "which transaction moves which item's balance", shared
      // with the spreadsheet (lib/historicalValues.js) and with the YTD baseline
      // (useDashboardData's fetchJan1). This block used to re-implement it, and
      // the copies drifted: this one only fed BANK-like items, so a bond's own
      // opening deposit never rewound it and the chart held it flat across the
      // whole year — the value line read +0.00% while the net-worth card, using
      // the other copy, read +4% on the very same holdings (FASE EA).
      const { balanceEventsById } = indexBalanceEvents(scopedTransactions, chartItems, convert, 'USD')
      const perItemCashFlows = {}
      chartItems.forEach((it) => {
        if (it._source === 'ibkr') return
        const flows = balanceEventsById[it.id]
        if (flows && flows.length > 0) perItemCashFlows[it.id] = flows
      })
      // FASE GP: a cache hit skips the network round trip entirely — see the
      // block comment above fetchHistory for what makes this safe to reuse.
      let data = cachedData
      if (!data) {
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
                // FASE HL: ver hasUnreliableAcqDate (utils.js). Sin esto, una
                // posición de broker desaparecía del pasado reconstruido.
                _dateUnreliable: hasUnreliableAcqDate(it),
                txEvents: txEventsBySym[(it.symbol || '').toUpperCase()] || undefined,
                // _flowIsAccountLevel: only the broker's real reconciled cash line
                // promotes the response to "transactional" server-side — see the
                // comment next to usedTransactional in the API route.
                ...(cashItem && it.id === cashItem.id ? { cashFlows: accountCashFlows, _flowIsAccountLevel: true } : {}),
                // _flowClampZero: an opening deposit can exceed the asset it funded
                // (it carries the entry fee), so rewinding past it lands on a negative
                // that means "did not exist yet", not "was worth less than nothing".
                ...(perItemCashFlows[it.id] ? { cashFlows: perItemCashFlows[it.id], _flowClampZero: true } : {}),
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
          data = await safeJson(res)
          if (cacheable) historyCacheRef.current.set(cacheKey, data)
        } else if (mountedRef.current && gen === fetchGenRef.current) {
          // FASE HJ. Un error del server (500, o el 504 del límite de duración
          // de Vercel con la petición pesada de "Todas") se tragaba en
          // silencio: la gráfica seguía sin dataPoints NI staticPoints, con el
          // overlay de activos manuales apagado y los NAV de broker dibujados
          // pelados como si fueran el portafolio entero. Ahora se reporta.
          setFetchError(t('Error cargando historial', 'Failed to load history'))
        }
      }
      if (data) {
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
  }, [itemsSig, transactions, lots, period, baseCurrency, customRange, shownInst])

  useEffect(() => {
    mountedRef.current = true
    fetchHistory()
    // 5 min, not 1 — each poll re-downloads the FULL history for every symbol
    // (Yahoo+CoinGecko fan-out server-side) and daily NAV barely moves minute to
    // minute. 60s polling burned quota and flirted with the route's rate limit.
    const interval = setInterval(fetchHistory, 300000)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [fetchHistory])

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
    if (shownInst !== 'ALL' && scopedItems.length > 0 && scopedItems.every(it => it._source !== 'ibkr')) return []
    // FASE FU. Con los docs paralelos de NAV (`fecha~nav~ibkr`) una fecha puede
    // traer la observación de portafolio COMPLETO y el NAV de UNA cuenta. La
    // vista "Todas" mide el portafolio entero: un día con ambos usa la
    // observación completa (idéntico a antes de que los docs paralelos
    // existieran); un día solo-broker se queda y el overlay lo completa, como
    // siempre. La vista escopada hace lo contrario más abajo (solo
    // BROKER_NAV_SOURCES), donde los docs paralelos son exactamente el NAV
    // real denso que antes se descartaba al importar.
    const sourceSnaps = shownInst === 'ALL' ? preferFullPortfolioPerDay(snapshots) : snapshots
    const now = Date.now()
    const bc = baseCurrency || 'USD'
    const convertVal = (s) => {
      if (s._source === 'manual' && s._rawValue != null && s._rawCurrency === bc) return s._rawValue
      return convert ? convert(s.netWorthUSD ?? s.totalActivosUSD ?? 0, 'USD', bc) : (s.netWorthUSD ?? s.totalActivosUSD ?? 0)
    }

    if (period === 'DAY') {
      const threeDaysAgo = now - 3 * 86400000
      const recentSnaps = [...sourceSnaps]
        .filter(s => s.date && new Date(s.date).getTime() >= threeDaysAgo
          && (shownInst === 'ALL' ? !s._calibrated : BROKER_NAV_SOURCES.includes(s._source)))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(s => ({ ts: new Date(s.date).getTime(), date: new Date(s.date), value: convertVal(s), src: s._source || null, transactional: !!s._transactional }))
        .filter(p => p.value > 0)
      if (currentTotal > 0) {
        // The live "now" point is real current NAV, not an estimate — tag it as
        // a real source so flowAware (below) treats a same-day IBKR deposit the
        // same way every other period does: netted out of the return, not read
        // as market gain (the +1.98% vs +10.99% TWR bug this file documents).
        recentSnaps.push({ ts: Date.now(), date: new Date(), value: currentTotal, src: 'daily' })
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

    let pts = [...sourceSnaps]
      .filter((s) => {
        if (!s.date) return false
        // A calibration anchor (chartSnapshots in useDashboardData) is always a
        // WHOLE-PORTFOLIO value, solved from one account's % but combined with
        // every other account's current held-flat share. Scoped to "Todas" that
        // is exactly right; scoped to one institution it is a portfolio total
        // masquerading as that institution's own value — an "Interactive
        // Brokers" view once showed a lone $16K spike from a 1M calibration
        // because VITALI's $6,000 (a different institution entirely) rode
        // along inside the same anchor. Real per-broker NAV (`ibkr`,
        // `ibkr_quarterly`) carries no such ambiguity — it IS that account's
        // value by construction.
        //
        // The SAME ambiguity applies to the daily/manual/backfill docs the
        // whole-portfolio snapshot effect writes once a day — they are not
        // flagged _calibrated but they are exactly as whole-portfolio. Left
        // unfiltered, a day with no real IBKR NAV sync (or any day before one
        // ever ran) let that day's full-portfolio total plot as if it were
        // IBKR's own value: a lone ~$24K spike on top of the correctly scoped
        // ~$10K "now" point, both dated the same day, read as a same-day
        // "-56.8% drawdown" that never happened (FASE FG). So when scoped to
        // one institution, only real per-broker NAV sources are trusted —
        // everything else falls back to the (correctly scoped) API series
        // below, same as any institution with no synced broker at all.
        if (shownInst !== 'ALL' && !BROKER_NAV_SOURCES.includes(s._source)) return false
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
        transactional: !!s._transactional,
      }))
      .filter((p) => p.value > 0)

    // One point per calendar day: a day holding both an IBKR NAV doc and a
    // daily/manual doc plots two different values at the same x — a vertical
    // spike. Real observations always outrank a reconstructed estimate (see
    // SNAPSHOT_SRC_PRIORITY in utils.js).
    {
      const byDay = new Map()
      for (const p of pts) {
        const key = p.date.toISOString().slice(0, 10)
        const prev = byDay.get(key)
        if (!prev) { byDay.set(key, p); continue }
        const a = SNAPSHOT_SRC_PRIORITY[p.src] || 0
        const b = SNAPSHOT_SRC_PRIORITY[prev.src] || 0
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
      const sorted = [...sourceSnaps]
        .filter(s => s.date && new Date(s.date).getTime() < cutoff
          && (shownInst === 'ALL' ? !s._calibrated : BROKER_NAV_SOURCES.includes(s._source)))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
      if (sorted.length > 0) {
        const prevSnap = sorted[0]
        const val = convertVal(prevSnap)
        if (val > 0) {
          // Carry the source doc's identity: flowAware (below) reads the FIRST
          // point, and a bare point here read as "not real, not transactional"
          // even when the anchor snapshot was either.
          pts.unshift({ ts: cutoff, date: new Date(cutoff), value: val, src: prevSnap._source || null, transactional: !!prevSnap._transactional })
        }
      }
    }

    // Drop an isolated corrupt/stale NAV doc (e.g. a one-off bad value a later
    // sync never overwrote): a V-shaped dip OR a Λ-shaped spike, both more than
    // 80% off BOTH neighbors. Real crashes and rallies are gradual, not
    // single-point round trips. Shared with analytics.js (computeMWRSeries/TWR
    // callers) so a discarded point can't disagree between the chart and the
    // return math reading the same series.
    pts = filterValueSpikes(pts)

    return pts
  }, [snapshots, period, convert, baseCurrency, customRange, currentTotal, shownInst, scopedItems])

  // "Estimado" is not the same question as "incierto" — the lesson FASE DS
  // already settled for the spreadsheet, now applied to the chart.
  //
  // A portfolio made only of STATIC assets (a bond, a bank balance: no market
  // price of their own) moves exclusively through events we have on file, so
  // rewinding it from today's balance is EXACT, not a guess. Marking that region
  // as unreliable had three visible consequences at once: the value line drew
  // dotted over data that was complete, the change collapsed to "+0.00% desde 5
  // ago" (a 2-day window), and the performance view rebased to those same two
  // days so it showed nothing at all (FASE EB).
  //
  // A market-priced or broker-synced position is the opposite: holding today's
  // quantity flat backwards genuinely assumes something we do not know, and
  // there the estimate framing stays exactly as it was.
  // ⛔ LÓGICA CONGELADA (D). reconstructionIsExact, el ancla del primer punto
  // fondeado y el re-base final de returnData son las tres piezas que hacen que
  // esta grafica muestre el MISMO % que las tarjetas. Antes de tocarlas, leer
  // lib/assetLogic/corporateBondWithEntryFee.js y seguir el protocolo de su
  // cabecera: hay que PREGUNTAR antes de cambiarlas.
  const reconstructionIsExact = useMemo(() => {
    const list = scopedItems || []
    if (list.length === 0) return false
    return list.every((it) => it && it._source !== 'ibkr'
      && !(/stock|crypto|fund|etf/i.test(it.type || '') && !/realestate|inmueble/i.test(it.type || '')))
  }, [scopedItems])

  // First timestamp with REAL broker NAV (vs reconstructed estimates). Drives the
  // performance-view rebase, the flow gating, and the short-history banner.
  const firstRealTs = useMemo(() => {
    if (reconstructionIsExact) return null
    const p = snapshotData.find((s) => ['ibkr', 'ibkr_quarterly', 'daily', 'manual'].includes(s?.src))
    return p ? p.ts : null
  }, [snapshotData, reconstructionIsExact])

  // Which broker the hold-flat estimate belongs to, so the short-history notice
  // points at the RIGHT place to fix it (only IBKR has a Flex Query "period" to
  // widen; every other synced broker's only real fix is uploading a file with
  // the full history). Majority vote over the scoped items' _source.
  const primaryBrokerId = useMemo(() => {
    const counts = {}
    for (const it of scopedItems || []) {
      const src = it._source
      if (!src || src === 'manual' || src === 'demo') continue
      counts[src] = (counts[src] || 0) + 1
    }
    const entries = Object.entries(counts)
    if (entries.length === 0) return null
    entries.sort((a, b) => b[1] - a[1])
    return entries[0][0]
  }, [scopedItems])

  // WHICH account the notice is talking about. "Datos reales de tu broker" is
  // ambiguous the moment the portfolio holds more than one thing: this chart is
  // meant to carry many assets across IBKR + banks + exchanges at once, and only
  // the account that supplied the real NAV history is the one whose sync window
  // needs widening. Name the institution, plus the broker's own account id when
  // we have it (IBKR stamps _ibkrAccountId on every position), so the user knows
  // exactly which query to go fix instead of guessing among their accounts.
  const estimateScopeLabel = useMemo(() => {
    const fromBroker = (scopedItems || []).filter((it) => primaryBrokerId && it._source === primaryBrokerId)
    const base = fromBroker.length > 0 ? fromBroker : (scopedItems || [])
    const names = [...new Set(base.map((it) => (it.institution || '').trim()).filter(Boolean))]
    if (names.length === 0) return null
    const accounts = [...new Set(base.map((it) => (it._ibkrAccountId || '').trim()).filter(Boolean))]
    let label = names.length <= 2 ? names.join(' + ') : `${names[0]} +${names.length - 1}`
    if (accounts.length > 0) {
      const shown = accounts.slice(0, 3).join(', ')
      label += ` (${shown}${accounts.length > 3 ? `, +${accounts.length - 3}` : ''})`
    }
    return label
  }, [scopedItems, primaryBrokerId])

  // Dismiss the short-history notice, but only until the situation it describes
  // actually changes: keyed by broker + the real-data anchor date, so re-syncing
  // with a wider window (more real history) un-dismisses it instead of hiding a
  // NEW, more actionable version of the same message forever.
  const estimateNoticeKey = firstRealTs != null ? `chispudo-estimate-notice-dismissed:${primaryBrokerId || 'ibkr'}:${firstRealTs}` : null
  const [estimateNoticeDismissed, setEstimateNoticeDismissed] = useState(false)
  useEffect(() => {
    if (!estimateNoticeKey) return
    try { setEstimateNoticeDismissed(localStorage.getItem(estimateNoticeKey) === '1') } catch { setEstimateNoticeDismissed(false) }
  }, [estimateNoticeKey])
  const dismissEstimateNotice = useCallback(() => {
    if (estimateNoticeKey) { try { localStorage.setItem(estimateNoticeKey, '1') } catch {} }
    setEstimateNoticeDismissed(true)
  }, [estimateNoticeKey])

  // How far back the overlay is allowed to hold its earliest known value: the
  // first acquisition among the very items that produce it (the API rebuilds
  // exactly the non-market-priced ones). Before that date the assets did not
  // exist, so zero is the answer rather than a gap.
  const earliestStaticAcqTs = useMemo(() => {
    const times = (scopedItems || [])
      .filter((it) => it && !isMarketPriced(it))
      .map((it) => effectiveAcqTs(it))
      .filter((t) => t != null && isFinite(t))
    return times.length > 0 ? Math.min(...times) : null
  }, [scopedItems])

  const chartData = useMemo(() => {
    // IBKR-sourced snapshots are the broker's account NAV only — they predate any
    // manually-added assets (a bond, a cash fund), so on the "Todas" (all) view
    // those assets would otherwise pop in only at the present. Overlay their
    // reconstructed historical value (staticPoints, from the API) onto each
    // snapshot that does NOT already include them: IBKR-source snapshots (always
    // broker-only), and daily snapshots taken before the manual assets were added.
    // Daily snapshots from after they were added already include them, so skip
    // those to avoid double-counting (which created a phantom mid-year crash).
    // FASE GS: the lookup lives in lib/staticOverlay.js. Its left edge used to
    // return 0 for any timestamp older than the reconstruction's first point,
    // which drew a broker NAV from that era as though it were the whole
    // portfolio (a $17K portfolio plotted at $4K, headlining "+475%" off it).
    // It now holds the earliest known value backwards, bounded by when those
    // assets were actually acquired.
    const staticAt = (ts) => staticValueAt(ts, staticPoints, { earliestAcqTs: earliestStaticAcqTs })
    // The overlay only ever exists to patch a snapshot that is BROKER-ONLY. With
    // no synced broker position in the portfolio there is no such snapshot: every
    // row is a whole-portfolio figure that already contains these very assets, so
    // adding them again just doubles the portfolio. That is how a $6,240 portfolio
    // drew a flat $12,480 line and a -50% "drawdown" into its own real value
    // (FASE DY) — same shape as the orphaned-NAV bug, one layer up.
    const hasBrokerItems = (items || []).some((it) => it && it._source === 'ibkr')
    const overlay = shownInst === 'ALL' && staticPoints.length > 0 && hasBrokerItems
    // FASE HJ. Un NAV de broker mide UNA cuenta. En la vista "Todas" solo es
    // dibujable una vez que el overlay le suma los activos que están FUERA del
    // broker; si el overlay no está disponible (el API de historial falló: sin
    // staticPoints) y el portafolio SÍ tiene activos manuales, dibujar el NAV
    // pelado afirma que el portafolio entero vale lo que esa sola cuenta: la
    // cola a ~$10K sobre un patrimonio de ~$23K y su "Max drawdown: -60.8%"
    // falso. Esos puntos se excluyen y el día queda como hueco honesto. Un
    // portafolio SOLO-broker conserva el comportamiento de siempre: ahí el NAV
    // pelado ES la cifra completa (mismo criterio que lib/staticOverlay.js).
    const hasManualItems = (items || []).some((it) => it && it._source !== 'ibkr' && !isExcludedFromNetWorth(it))
    const drawableSnaps = (!overlay && shownInst === 'ALL' && hasBrokerItems && hasManualItems)
      ? snapshotData.filter((p) => p.src !== 'ibkr')
      : snapshotData
    // NOTE: 'backfill' snapshots are deliberately NOT overlaid — the backfill API
    // call already includes manual assets (gated by acquisitionDate, exactly like
    // staticAt), so adding staticAt again would double-count them.
    //
    // The date test runs on whole DAYS on purpose: a snapshot's ts is its date at
    // UTC midnight while createdAt is a moment during that day, so a same-day
    // snapshot (written minutes AFTER the asset was added, and therefore already
    // holding it) still compared as "before" and got overlaid on top of itself.
    const manualAddedDay = manualAddedTs > 0 ? Math.floor(manualAddedTs / 86400000) : 0
    // FASE HQ. La regla de manualAddedDay existe para un doc 'daily' escrito
    // EN VIVO antes de que los activos manuales existieran en la app: ese
    // total no los contiene y hay que sumárselos. Pero no llevaba ninguna
    // condición de FUENTE, así que también se le aplicaba a un 'backfill', que
    // es exactamente lo contrario: una reconstrucción que YA los incluye
    // (gateada por acquisitionDate, igual que staticAt). El comentario de
    // arriba dice literalmente que un 'backfill' no debe llevar overlay; la
    // condición no lo cumplía.
    //
    // Con los docs compuestos de FASE HN (NAV real + manual, TODOS los días)
    // el error pasó de invisible a dominante: la serie entera se dibujaba
    // ~$12K arriba (el valor de las cuentas manuales, contado dos veces) y
    // caía de golpe al llegar a manualAddedDay, con un "drawdown" de -72%
    // que nunca ocurrió. Los datos guardados estaban BIEN: el defecto era
    // solo de dibujo.
    const needsOverlay = (p) => p.src === 'ibkr'
      || (p.src !== 'backfill' && manualAddedDay > 0 && Math.floor(p.ts / 86400000) < manualAddedDay)
    // FASE HR. Un NAV de broker mide UNA cuenta, así que en la vista "Todas"
    // solo es dibujable con su otra mitad sumada. staticAt() la resuelve por
    // fecha, pero devuelve 0 cuando el ts cae fuera del rango que la
    // reconstrucción alcanzó: el caso real es el punto de HOY en UTC (el sync
    // de IBKR ya escribió el NAV de mañana-en-UTC y todavía no existe ninguna
    // observación de portafolio completo para esa fecha). Dibujado pelado,
    // ese único punto se lee como una caída del portafolio entero a ~$9.4K y
    // produce un "Max drawdown: -57.9%" que nunca pasó. `staticTotal` es el
    // valor de HOY de esos mismos activos, que es exactamente el addend
    // correcto para un punto de hoy.
    const overlayAddend = (ts) => {
      const v = staticAt(ts)
      if (v > 0) return v
      return staticTotal > 0 ? staticTotal : 0
    }
    let snapSource = overlay
      ? drawableSnaps.map((p) => needsOverlay(p) ? { ...p, value: p.value + overlayAddend(p.ts) } : p)
      : drawableSnaps
    // Y si NI ASÍ hay con qué completarlo (cero datos de la mitad manual),
    // el punto se descarta en vez de afirmar que el portafolio vale lo que
    // una sola cuenta: mismo criterio que el filtro de arriba.
    //
    // El NAV de HOY se descarta SIEMPRE (fuera de la vista DAY): el punto en
    // vivo de más abajo usa `currentTotal`, que es el patrimonio completo de
    // este instante, o sea la mejor medición que existe para hoy. Un NAV de
    // broker de la misma fecha solo puede ser una fracción de eso, y compite
    // con él dibujando una caída al valor de una sola cuenta (el "-57.9%"
    // que quedaba). No es una carrera que valga la pena ganar por márgenes:
    // para hoy, el valor en vivo manda.
    if (hasBrokerItems && hasManualItems) {
      const todayStart = period !== 'DAY' && currentTotal > 0
        ? Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
        : Infinity
      const filtered = snapSource.filter((p) => p.src !== 'ibkr'
        || (overlayAddend(p.ts) > 0 && p.ts < todayStart))
      if (filtered.length >= 2) snapSource = filtered
    }

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
      // ALL used to never prepend older API history, full stop — the older
      // segment is an ESTIMATE for a broker-synced position (a real IBKR
      // account's true inception isn't knowable from a hold-flat guess, and
      // the Flex Query's own 365-day cap means "estimate" there can mean
      // "invented"), so the caution made sense there. It made no sense for a
      // portfolio of only static assets (a bond, a bank balance): that
      // reconstruction is EXACT, not a guess (reconstructionIsExact, same
      // signal the dotted-line/rebase logic above already trusts), so ALL
      // was truncating to whatever real Firestore snapshots happened to exist
      // (the last ~30 days) instead of starting from the account's actual
      // first recorded movement (FASE EJ).
      if (period !== 'ALL' || reconstructionIsExact) {
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
    } else if (period === 'DAY' && reconstructionIsExact && currentTotal > 0) {
      // FASE HT. Un scope 100% ESTÁTICO (bonos, saldos bancarios, alternativos)
      // no tiene precio intradía por definición: no es que "el mercado esté
      // cerrado", es que estos activos no cotizan. Y su valor de hoy es plano,
      // porque solo se mueven por eventos que ya están en el archivo
      // (reconstructionIsExact, la misma señal que FASE EB usa para no marcar
      // esa reconstrucción como estimada).
      //
      // Sin esto, la vista DAY de una institución así caía al estado vacío: el
      // API sintetiza dos puntos (ayer y ahora) y el filtro de DAY, que recorta
      // desde las 7:00 de hoy, dejaba UNO solo. Con un punto no hay serie, y la
      // pantalla culpaba al mercado por algo que no depende del mercado. La
      // respuesta correcta es la que da el cálculo de referencia del usuario
      // para todos los períodos sin eventos: 0.00%.
      const now = Date.now()
      const d = new Date(now)
      let dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0, 0).getTime()
      if (dayStart >= now) dayStart = now - 86400000
      pts = [
        { ts: dayStart, date: new Date(dayStart), value: currentTotal },
        { ts: now, date: new Date(now), value: currentTotal },
      ]
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
        //
        // findYearStartAnchor picks by DATE only — it has no idea a snapshot is
        // whole-portfolio. Feeding it the unscoped list for an institution view
        // handed back a portfolio-wide Jan-1 total as "IBKR's" own starting
        // value: firstVal (below) came out wrong while lastVal (currentTotal)
        // stayed correctly scoped, inflating the year's % return (FASE FG,
        // same root cause as the snapshotData filter above). Scope the anchor
        // search the same way: real per-broker NAV only, or (if none exists
        // near Jan 1) the existing pts[0].value fallback — never a whole-
        // portfolio figure standing in for one institution's slice of it.
        const bc = baseCurrency || 'USD'
        // FASE FU: mismo criterio que snapshotData. El ancla de la vista
        // "Todas" nunca debe caer en un doc paralelo de NAV (una sola cuenta
        // haciéndose pasar por el arranque del portafolio completo).
        const anchorSource = shownInst === 'ALL' ? preferFullPortfolioPerDay(snapshots) : (snapshots || []).filter(s => BROKER_NAV_SOURCES.includes(s._source))
        const anchorSnap = findYearStartAnchor(anchorSource, year)
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
    if (isPerf && !apiTransactional && firstRealTs != null && pts.length > 1
      && pts[0].ts < firstRealTs - 3600000) {
      const real = pts.filter((p) => p.ts >= firstRealTs - 3600000)
      if (real.length >= 2) return real
    }
    return pts
  }, [dataPoints, snapshotData, currentTotal, period, staticPoints, earliestStaticAcqTs, shownInst, manualAddedTs, snapshots, items, convert, baseCurrency, shownMode, isPerf, firstRealTs, apiTransactional, reconstructionIsExact])

  // Whether the auto-imported IBKR cash flows (_source:'ibkr') enter the return math
  // depends on the SOURCE of the value series (lesson from the +1.98% vs IBKR's
  // +10.99% TWR bug):
  // - Real broker NAV snapshots (ibkr/daily/manual) already contain the effect of
  //   deposits/withdrawals, so a flow-blind TWR/MWR reads every withdrawal as a market
  //   loss and every deposit as a gain. Flows MUST be included.
  // - Reconstructed baselines (hold-flat Σqty×price, 'backfill' snapshots) pre-date
  //   deposits implicitly (current qty held flat), so subtracting the flows again
  //   double-counts. Flows must be excluded (the original AD2 rationale).
  // FASE GE: a TRANSACTIONAL backfill doc (rewound through the real imported
  // deposit/trade ledger, marked _transactional by the backfill effect) reflects
  // flow timing exactly like a real NAV series does: mid-year buys do not exist
  // in its January value, so the deposits that funded them MUST be netted. The
  // sources-only rule dates from when 'backfill' meant pure hold-flat (deposits
  // implicitly pre-dated); applied to a lot-aware backfill it read every IBKR
  // deposit as market gain.
  const flowAware = useMemo(
    () => snapshotData.length >= 2 && (['ibkr', 'ibkr_quarterly', 'daily', 'manual'].includes(snapshotData[0]?.src) || !!snapshotData[0]?.transactional),
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
  // ⛔ LÓGICA CONGELADA (D). Ver lib/assetLogic/corporateBondWithEntryFee.js:
  // PREGUNTAR antes de cambiar el ancla o el re-base de esta serie. La
  // fórmula vive en computeAnchoredReturnSeries (analytics.js) — recalculada
  // con las funciones reales en lib/__tests__/corporateBondWithEntryFee.test.js.
  const returnData = useMemo(
    () => computeAnchoredReturnSeries(chartData, returnTransactions, convert, baseCurrency, { firstRealTs, apiTransactional }),
    [chartData, returnTransactions, convert, baseCurrency, firstRealTs, apiTransactional]
  )
  // FASE FP. The money-weighted sibling tab: same anchor, same window, same
  // inputs, only the formula differs (one Dietz window, timing of the user's
  // own flows counts, instead of chained timing-stripped segments). ADDITIVE
  // next to the frozen series, never replacing it: the frozen TWR stays the
  // default return tab, and computeAnchoredMWRSeries lives in analytics.js
  // as its own function precisely so the frozen one is never edited. Only
  // computed while its tab is active — no reason to run a second Dietz pass
  // on every price tick for a series nobody is looking at.
  const returnDataMWR = useMemo(
    () => shownMode === 'performance-mwr'
      ? computeAnchoredMWRSeries(chartData, returnTransactions, convert, baseCurrency, { firstRealTs, apiTransactional })
      : [],
    [shownMode, chartData, returnTransactions, convert, baseCurrency, firstRealTs, apiTransactional]
  )
  const activeReturnData = shownMode === 'performance-mwr' ? returnDataMWR : returnData

  // Non-null when the performance view was rebased to the first real broker
  // datapoint (IBKR's "Jan 1 or account open, whichever is later" convention).
  // Drives the "Retorno desde {fecha}" label so the number is never presented
  // as a full-year return it isn't.
  const perfRebasedFrom = isPerf && !apiTransactional && firstRealTs != null
    && (period === 'YTD' || period === 'ALL')
    && firstRealTs > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000
    && chartData.length > 0 && chartData[0].ts >= firstRealTs - 3600000
    ? firstRealTs : null

  const contributionLine = useMemo(() => {
    if (shownMode !== 'value' || chartData.length < 2) return null
    const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
    // scopedTransactions already restricts to the selected institution, so a
    // deposit into another account never shows as invested capital here.
    const txEvents = (scopedTransactions || [])
      .filter(tx => flowTypes[tx.type] != null)
      // FASE LT: el registro del dinero de un préstamo no es capital invertido
      // (pedir prestado no es invertir). SOLO se excluye de esta LÍNEA de
      // display: como flujo del TWR/MWR sí cuenta, que es lo que hace que
      // registrar una deuda nueva no se dibuje como pérdida.
      .filter(tx => tx._source !== 'manual_loan_proceeds')
      .map(tx => {
        const amt = tx.totalAmount || tx.amount || 0
        const convertedAmt = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
        return { ts: new Date(tx.date).getTime(), amt: (flowTypes[tx.type] || 0) * convertedAmt }
      })
    // A one-time entry/brokerage fee is real cash that left your pocket at
    // purchase, same as a deposit — without this, "capital invertido" (and
    // any return % that divides gain by it) silently ignored fees you told
    // the app about, even though costsSummary.js already counts them.
    //
    // ...unless a DEPOSIT already carries it. AddAccountModal writes the
    // opening deposit as principal + entryFee (that IS the cash that left the
    // pocket) and tags it `_source:'manual_new_account'`, so adding the fee
    // here again charged a $98 brokerage twice (FASE DV). Same double-count
    // reason the 'deducted' mode is skipped, just a different place the fee is
    // already accounted for.
    const feeAlreadyInDeposit = new Set(
      (scopedTransactions || [])
        .filter(tx => tx._source === 'manual_new_account' && tx.type === 'DEPOSIT' && tx._linkedItemId)
        .map(tx => tx._linkedItemId)
    )
    const feeEvents = (scopedItems || [])
      // 'deducted' fees are already inside the deposit that funded the asset,
      // so adding them again would double-count the invested capital.
      .filter(it => Number(it.entryFee) > 0 && it.acquisitionDate && it.entryFeeMode !== 'deducted'
        && !feeAlreadyInDeposit.has(it.id))
      .map(it => {
        const cur = it._originalCurrency || it.currency || 'USD'
        const amt = convert ? convert(Number(it.entryFee), cur, baseCurrency || 'USD') : Number(it.entryFee)
        return { ts: new Date(`${it.acquisitionDate}T00:00:00`).getTime(), amt }
      })
    const events = [...txEvents, ...feeEvents]
      .filter(e => Number.isFinite(e.ts) && e.amt)
      .sort((a, b) => a.ts - b.ts)
    // No real flows → no line: a flat "invested capital" at the start value
    // suggests a contribution that never happened.
    if (events.length === 0) return null

    // What was ALREADY invested when the window opened. Seeding with the value
    // at the window's start is the right guess for a position that predates our
    // records (an IBKR account whose deposit ledger only reaches 365 days back:
    // its value on day one IS the capital we can't see the flows for).
    //
    // It is flat wrong when nothing predates the window: there, the value on the
    // left edge exists only because the reconstruction holds today's positions
    // flat backwards, and the deposits that funded them are ALSO added as events
    // below. That counted the same money twice — a $6,000 bond bought Jan 6 with
    // a $98 fee showed ~$12.2K of "capital invertido" (FASE DV).
    //
    // "Predates the window" is per item: a real earlier acquisition date, no date
    // at all, or an unreliable one (shouldHoldFlat — an IBKR position stamped
    // with the sync date, which is exactly the case the seed exists for).
    const windowStartTs = chartData[0].ts
    const anyPredatesWindow = (scopedItems || []).some(it => {
      if (shouldHoldFlat(it, scopedTransactions, lots)) return true
      if (!it.acquisitionDate) return true
      const acqTs = new Date(`${it.acquisitionDate}T00:00:00`).getTime()
      return !Number.isFinite(acqTs) || acqTs < windowStartTs
    })
    const startVal = anyPredatesWindow ? chartData[0].value : 0
    return chartData.map(dp => {
      let cum = startVal
      for (const ev of events) {
        if (ev.ts <= windowStartTs) continue
        if (ev.ts > dp.ts) break
        cum += ev.amt
      }
      return cum
    })
  }, [chartData, scopedTransactions, scopedItems, shownMode, convert, baseCurrency, lots])

  // FASE HP. La MISMA reparación que corre sola en useDashboardData, pero
  // disparada por el usuario y con reporte a la vista. Reusa los helpers puros
  // (nada de una segunda implementación que pueda derivar) y escribe con el
  // onSaveSnapshot que este componente ya recibe.
  const [repairState, setRepairState] = useState(null)
  const runHistoryRepair = useCallback(async () => {
    const lines = []
    const push = (s) => { lines.push(s); setRepairState({ running: true, lines: [...lines] }) }
    setRepairState({ running: true, lines: [] })
    try {
      const srcItems = repairItems || items
      const srcSnapshots = repairSnapshots || snapshots
      const all = (srcItems || []).filter((it) => !isExcludedFromNetWorth(it))
      const hasBroker = all.some((it) => it && it._source === 'ibkr')
      // ⛔ FASE JZ, ANTES de cualquier escritura. Un NAV de broker atrapado en
      // el slot plano de la fecha (id === fecha) hace que ese día cuente como
      // HUECO (staleBackfillDates, rank 0), así que este botón escribía su
      // total compuesto con id = fecha y saveSnapshot lo fusionaba ENCIMA del
      // NAV: la medición real del broker reemplazada por una estimación, y el
      // día perdido para la vista escopada. El backfill automático ya migraba
      // esos docs a su id paralelo; el botón, que escribe los MISMOS docs, no.
      // Si la migración falla se aborta: un hueco es mejor que un dato real
      // destruido.
      if (onMigrateNav) {
        try {
          const moved = await onMigrateNav(srcSnapshots)
          if (moved > 0) push(`${t('NAV del broker movido a su propio doc', 'Broker NAV moved to its own doc')}: ${moved}`)
        } catch (e) {
          push(`${t('No se pudo proteger el NAV del broker: no se escribe nada.', 'Could not protect the broker NAV: nothing written.')} (${e?.message || ''})`)
          setRepairState({ running: false, lines })
          return
        }
      }
      const navByDate = buildNavByDate(srcSnapshots)
      const composing = hasBroker && navByDate.size > 0
      push(`${t('NAV real del broker', 'Real broker NAV')}: ${navByDate.size} ${t('días', 'days')}`)
      if (hasBroker && navByDate.size === 0) {
        push(t('Sin NAV del broker: sincronizá IBKR primero.', 'No broker NAV: sync IBKR first.'))
      }

      const assets = all.filter((it) => !it.isDebt && (!composing || it._source !== 'ibkr'))
      const debtUSD = all.reduce((s, it) => {
        if (!it.isDebt) return s
        const cur = it._originalCurrency || it.currency || 'USD'
        const v = (it.quantity || 0) * (it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0)
        return s + Math.abs(convert ? convert(v, cur, 'USD') : v)
      }, 0)

      // ⛔ FASE JU. El MISMO cuerpo que el backfill automático, armado en
      // lib/historyPayload.js. Este bloque tenía su propia copia y le faltaban
      // DOS campos: `lots` (la cantidad reconstruida de cada posición de
      // mercado) e `income` (el rendimiento REINVERTIDO, que nunca entra a
      // balanceEventsById y por lo tanto solo viaja por ese canal). Sin
      // `income`, cada cuenta que compone se archivaba pegada a su valor de
      // HOY: el ancla del 1 de enero quedaba arriba y la diferencia salía en la
      // fila "Sin atribuir" del panel del YTD. No falla ruidosamente, se ve
      // como una reconstrucción plana que parece funcionar.
      //
      // breakdown (FASE IX9): el desglose por ítem del MISMO punto que se
      // archiva, para poder imprimir la mitad manual del ancla cuenta por
      // cuenta. Sin él, comparar el ancla contra el panel obliga a deducir de
      // la resta.
      const res = await authFetch('/api/prices/portfolio-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildHistoryRequestBody({
          items: assets, transactions, lots, convert,
          period: 'YTD', breakdown: true,
        })),
      })
      if (!res.ok) { push(`${t('El servidor de historial falló', 'History server failed')} (${res.status}).`); setRepairState({ running: false, lines }); return }
      const data = await safeJson(res)
      // ⛔ FASE JU. El backfill automático REHÚSA persistir desde una respuesta
      // degradada (FASE HJ): cada sesión puede fallar un subconjunto distinto
      // de símbolos, así que escribir estos totales deja docs 'backfill' a un
      // nivel distinto por pasada, el churn exacto del diente de sierra. Este
      // botón escribe los MISMOS docs, así que se rige por la MISMA regla, con
      // el mismo tope por PESO (un símbolo muerto o dust que falla siempre no
      // debe congelar la reparación para siempre). Antes solo lo avisaba.
      if (data.degraded) {
        const failed = (data.failedSymbols || []).map((s) => String(s).toUpperCase())
        const failedSet = new Set(failed)
        const val = (it) => Math.abs(getItemValue(it))
        const failedVal = assets.reduce((s, it) => failedSet.has((it.symbol || '').toUpperCase()) ? s + val(it) : s, 0)
        const totalVal = assets.reduce((s, it) => s + val(it), 0)
        push(`${t('Aviso: faltaron precios de', 'Note: missing prices for')} ${failed.join(', ')}`)
        if (totalVal > 0 && failedVal > totalVal * 0.02) {
          push(t('No se escribe nada: eso es demasiado del portafolio como para archivarlo. Reintentá en un rato.',
            'Nothing written: that is too much of the portfolio to archive. Try again in a while.'))
          setRepairState({ running: false, lines })
          return
        }
      }
      // FASE HS: si el respaldo de precios (Upstash/KV) está activo, un hipo
      // del proveedor deja de degradar la reconstrucción. Se muestra para que
      // "¿está configurado?" se pueda VER en vez de deducirlo de los síntomas.
      if (data.cache) {
        push(data.cache === 'upstash'
          ? t('Respaldo de precios: activo', 'Price fallback cache: active')
          : t('Respaldo de precios: NO configurado (Vercel > Storage > Redis)', 'Price fallback cache: NOT configured (Vercel > Storage > Redis)'))
      }
      const pts = data.dataPoints || []
      push(`${t('Reconstrucción de cuentas manuales', 'Manual accounts rebuilt')}: ${pts.length} ${t('puntos', 'points')}`)

      const composed = composeDailyTotals({
        gaps: windowDates(366), manualPoints: pts, navByDate, hasBrokerItems: composing,
      })
      // ⛔ FASE IX9. El ancla del YTD es EL doc de esta misma composición para el
      // 1 de enero, y el panel la descompone por cuenta. Cuando las dos no
      // cuadran, la resta sola no dice de qué lado está la diferencia, y eso ha
      // costado varias rondas de capturas. Acá se imprime la composición TAL
      // COMO se archiva: sus dos mitades, y la manual cuenta por cuenta, con el
      // MISMO criterio de agrupación que usa el panel (accountKeyOfItem). La
      // fila que no coincida con la del panel es la respuesta.
      const anchorDate = `${new Date().getUTCFullYear()}-01-01`
      const anchorEntry = composed.find((c) => c.date === anchorDate)
      if (anchorEntry) {
        const navHalf = navAsOf(navByDate, anchorDate)
        const manualHalf = navHalf == null ? anchorEntry.total : anchorEntry.total - navHalf
        push(`${formatDate(`${anchorDate}T00:00:00Z`)}: ${t('manual', 'manual')} ${manualHalf.toFixed(2)}`
          + (navHalf == null ? '' : ` + NAV ${navHalf.toFixed(2)}`)
          + ` = ${anchorEntry.total.toFixed(2)}`)
        // resolveGapFills se queda con el ÚLTIMO punto del día, así que el
        // desglose se lee del mismo para describir lo que de verdad se archivó.
        const dayPts = pts.filter((p) => p && p.byKey
          && new Date(p.ts).toISOString().split('T')[0] === anchorDate)
        const dayPt = dayPts.length > 0 ? dayPts[dayPts.length - 1] : null
        if (dayPt) {
          const byAccount = new Map()
          const nameByKey = new Map()
          assets.forEach((it) => {
            const k = accountKeyOfItem(it) || (it.institution || it.name || '?')
            nameByKey.set(k, it.institution || it.name || k)
            const v = dayPt.byKey[it.id] ?? dayPt.byKey[(it.symbol || '').toUpperCase()]
            if (Number.isFinite(v)) byAccount.set(k, (byAccount.get(k) || 0) + v)
          })
          const parts = [...byAccount.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${nameByKey.get(k) || k} ${v.toFixed(2)}`)
          if (parts.length > 0) push(`  ${parts.join(' · ')}`)
        } else {
          push(`  ${t('sin punto propio de esa fecha (se arrastró)', 'no point on that date (carried)')}`)
        }
      } else {
        // Que el ancla NO esté en la composición es tan informativo como sus
        // números: significa que la reparación no la reescribe, y entonces el
        // doc archivado es de otra época y no de esta corrida.
        push(`${formatDate(`${anchorDate}T00:00:00Z`)}: ${t('fuera de la composición (no se reescribe)', 'not in the composition (never rewritten)')}`)
      }
      // FASE JU: `brokerConnectedTs`, la MISMA señal (y el mismo helper) que el
      // backfill automático. Un doc 'daily' escrito ANTES de conectar el broker
      // suma solo las cuentas manuales y es intocable sin esto (FASE HG): la
      // reparación lo dejaba congelado mientras el backfill sí lo rellenaba, o
      // sea las dos escribían historias distintas.
      const gaps = staleBackfillDates(srcSnapshots, {
        windowDays: 366,
        treatDailyAsStale: !hasBroker,
        brokerConnectedTs: brokerConnectedTsOf(srcItems),
      })
      const divergent = divergentDailyDates(srcSnapshots, composed)
      const targets = new Set([...gaps, ...divergent])
      const fills = composed.filter((f) => targets.has(f.date))
      push(`${t('Huecos', 'Gaps')}: ${gaps.length} · ${t('escrituras corruptas', 'corrupt writes')}: ${divergent.length}`)

      if (fills.length === 0) {
        push(t('Nada que corregir: el historial ya está bien.', 'Nothing to fix: history is already correct.'))
        setRepairState({ running: false, lines })
        return
      }
      let written = 0
      for (const f of fills) {
        await onSaveSnapshot({
          date: f.date,
          netWorthUSD: f.total - debtUSD,
          totalActivosUSD: f.total,
          totalDebtUSD: debtUSD,
          _source: 'backfill',
          // FASE JU: mismo criterio que el backfill automático. Un doc
          // compuesto es flow-aware por construcción (su mitad de broker ES la
          // medición del broker); si no, manda lo que el server reportó. Antes
          // se ignoraba `data.transactional`, así que una serie rebobinada a
          // través del ledger real se archivaba marcada como si no lo fuera.
          _transactional: f.composed ? true : !!data.transactional,
        })
        written++
        if (written % 25 === 0) push(`${t('Escribiendo', 'Writing')}... ${written}/${fills.length}`)
      }
      push(`${t('Listo', 'Done')}: ${written} ${t('días reescritos con datos reales', 'days rewritten from real data')}.`)
      setRepairState({ running: false, lines })
    } catch (err) {
      lines.push(`Error: ${err?.message || err}`)
      setRepairState({ running: false, lines })
    }
  }, [items, snapshots, repairItems, repairSnapshots, transactions, lots, convert, onSaveSnapshot, onMigrateNav, t])

  const drawdown = useMemo(() => {
    if (chartData.length < 3) return null
    // A drawdown measured across the RECONSTRUCTED prefix is fiction: holding today's
    // positions flat backwards replays this year's market swings on shares the user may
    // not have owned, which produced a scary "-20.1%" that never happened to them.
    // Only measure once real broker data starts.
    const realStart = (!apiTransactional && firstRealTs != null)
      ? chartData.findIndex((p) => p.ts >= firstRealTs - 3600000)
      : 0
    if (realStart < 0) return null
    const series = realStart > 0 ? chartData.slice(realStart) : chartData
    if (series.length < 3) return null
    let peak = series[0].value, peakIdx = 0
    let maxDd = 0, ddStart = 0, ddEnd = 0
    for (let i = 1; i < series.length; i++) {
      if (series[i].value > peak) { peak = series[i].value; peakIdx = i }
      const dd = peak > 0 ? (peak - series[i].value) / peak : 0
      if (dd > maxDd) { maxDd = dd; ddStart = peakIdx; ddEnd = i }
    }
    if (maxDd < 0.01) return null
    // Indices are consumed against chartData (banner labels + the SVG shading rect).
    return { start: ddStart + realStart, end: ddEnd + realStart, pct: maxDd * 100 }
  }, [chartData, apiTransactional, firstRealTs])

  const txMarkers = useMemo(() => {
    if (!scopedTransactions || chartData.length < 2) return []
    // ONLY real money in and out. A buy or a sell does not change net worth,
    // it just moves value between cash and shares, so drawing them here filled
    // the axis with red "sale" flags on a chart about how much you HAVE: a user
    // with 27 routine sells and a single $10 withdrawal saw a wall of red and
    // read it as money leaving. Deposits and withdrawals are the only events
    // that actually move the line for a reason outside the market.
    const actionTypes = ['DEPOSIT', 'WITHDRAWAL']
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
  // Sube 18px respecto de los 200/260 de antes, exactamente lo que crecieron
  // `pad.top` (rótulo de unidad del eje) y `pad.bottom` (carril propio para los
  // marcadores de dinero que entra y sale). El ÁREA DE TRAZO queda idéntica a la
  // de siempre: la línea se dibuja igual, la card es un poco más alta.
  const chartHeight = width < 480 ? 218 : 278
  // `top` sube de 16 a 26 para que quepa el rótulo de unidad del eje. Repetir el
  // símbolo de moneda en las cinco marcas es tinta que no informa: la unidad se
  // dice UNA vez arriba del eje (la convención de cualquier factsheet) y las
  // marcas quedan siendo solo el número.
  const pad = { top: 26, right: 16, bottom: 40, left: 52 }

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
    const vals = shownMode === 'value' ? growthValues : activeReturnData
    if (vals.length < 2) return null
    // Extra series shares the axis: invested capital, in value mode only, when
    // the user opts into showing it. Including it here is what keeps both
    // lines on ONE scale.
    const extra = shownMode === 'value' && showContributions ? contributionLine : null
    const timestamps = chartData.map((d) => d.ts)
    return buildGeometry(vals, shownMode === 'value' ? 'value' : 'performance', chartHeight, width, pad, extra, timestamps)
  }, [shownMode, growthValues, activeReturnData, contributionLine, showContributions, chartData, width])

  const contributionGeoPoints = useMemo(() => {
    if (!geo || !contributionLine || shownMode !== 'value' || !showContributions) return null
    // Derive from geo — same X (time-scaled) and same Y scale as the value line.
    // Recomputing a private range here drew the two lines on different axes.
    const ch = chartHeight - pad.top - pad.bottom
    return contributionLine.map((v, i) => ({
      x: geo.points[i]?.x ?? pad.left,
      y: pad.top + ch - ((v - geo.adjustedMin) / geo.range) * ch,
      v,
    }))
  }, [geo, contributionLine, shownMode, showContributions, chartHeight, pad])

  // FASE IX3. Las etiquetas se eligen por ÍNDICE (cada `step` puntos) pero se
  // dibujan en X proporcional al TIEMPO, y las dos cosas no coinciden cuando la
  // serie tiene densidad despareja: en ALL, los años viejos son puntos semanales
  // sintetizados y los meses recientes son diarios, así que índices repartidos
  // parejo caen amontonados en el tramo denso. El resultado es el eje ilegible
  // de la captura del usuario ("ago0ct25ene26feb26mar26abr26jun26ago 26", todo
  // encimado). Se filtra por SEPARACIÓN REAL en píxeles, que es la unidad en la
  // que de verdad chocan; un eje que ya venía separado no cambia.
  const resolvedXLabels = useMemo(() => {
    if (!geo) return []
    const placed = xLabels
      .map((xl) => ({ ...xl, x: geo.points[xl.idx]?.x }))
      .filter((xl) => xl.x != null)
      .sort((a, b) => a.x - b.x)
    const MIN_GAP_PX = 46
    const out = []
    for (const xl of placed) {
      if (out.length === 0 || xl.x - out[out.length - 1].x >= MIN_GAP_PX) out.push(xl)
    }
    return out
  }, [xLabels, geo])


  // The value headline must never be computed against a RECONSTRUCTED start. With only
  // a few days of real broker data, the hold-flat prefix projects today's positions back
  // to January prices, and comparing today against that invented January produced a
  // confident, wrong number (a real case showed "-4.86% este año" for an account that
  // was actually up ~10%). Measure from the first REAL point instead, and say since when.
  const valueRebasedFrom = !apiTransactional && firstRealTs != null && chartData.length > 1
    && chartData[0].ts < firstRealTs - 3600000
    ? firstRealTs : null

  // Pixel split between the estimated (hold-flat) prefix and real broker data, shared
  // by the area fill, the line stroke and the legend so the three never disagree. The
  // dashed line alone was too subtle to read as "not real" (blue-on-blue at low zoom),
  // so the fill gets a visibly different color for the estimated stretch too.
  const splitIdx = valueRebasedFrom != null && geo
    ? (() => {
        const idx = chartData.findIndex((p) => p.ts >= valueRebasedFrom - 3600000)
        return idx > 0 && idx < geo.points.length ? idx : -1
      })()
    : -1
  const measuredData = valueRebasedFrom
    ? chartData.filter((p) => p.ts >= valueRebasedFrom - 3600000)
    : chartData
  const firstVal = measuredData.length > 0 ? measuredData[0].value : 0
  const lastVal = measuredData.length > 0 ? measuredData[measuredData.length - 1].value : 0
  const growthAbs = lastVal - firstVal
  // FASE EH. New capital that arrives DURING the window is not return, full
  // stop — whether the window opened at $0 (a brand-new account) or already
  // holding value (XOCHI, bought 2024, giving the YTD window a $2,203 start
  // before VITALI's own $6,098 deposit landed in January on top of it). A
  // branch that only netted the deposit out when firstVal was exactly zero
  // missed that second case and took the raw diff as pure gain:
  // "+$6,318.70 (+286.75%) este año" on a portfolio that actually made
  // $318.70. computeWindowGrowth (utils.js) needs only ONE formula for both:
  // contributionLine seeds AT chartData[0]'s own value whenever something
  // predates the window (its own header comment), so investedBase - firstVal
  // IS the new piece cleanly either way — no branch needed. No contribution
  // history at all → null hides the percentage rather than lying with a 0%.
  const investedBase = contributionLine && contributionLine.length > 0
    ? contributionLine[contributionLine.length - 1]
    : null
  // Entry fees are a cost of ENTERING, not a performance loss — the convention
  // the whole app measures by (see the VITALI reference case in CLAUDE.md):
  // gain measures against the principal, the % divides by the all-in cost.
  // Putting the fee on both sides charges it twice and lands on 2.33% where
  // every other card says 3.94% (FASE EC). Scoped to items acquired AFTER the
  // window opened: a fee paid before the window is already inside firstVal,
  // not part of newCapital, and must not be subtracted from it twice.
  const windowStartTs = measuredData.length > 0 ? measuredData[0].ts : null
  const entryFeesInScope = (scopedItems || []).reduce((sum, it) => {
    const fee = Number(it.entryFee) || 0
    if (!(fee > 0) || it.entryFeeMode === 'deducted') return sum
    if (windowStartTs != null && it.acquisitionDate) {
      const acqTs = new Date(`${it.acquisitionDate}T00:00:00`).getTime()
      if (Number.isFinite(acqTs) && acqTs <= windowStartTs) return sum
    }
    const cur = it._originalCurrency || it.currency || 'USD'
    const conv = convert ? convert(fee, cur, baseCurrency || 'USD') : fee
    return sum + (isFinite(conv) ? conv : 0)
  }, 0)
  // The actual math lives in computeWindowGrowth (utils.js), pinned by a test
  // that recalculates the XOCHI+VITALI regression case above with the real
  // function.
  const { growthPct, displayAbs, newCapitalPrincipal } = computeWindowGrowth({ firstVal, lastVal, investedBase, entryFeesInScope })
  const lastReturn = activeReturnData.length > 0 ? activeReturnData[activeReturnData.length - 1] : 0
  // Annualized (CAGR) companion for multi-year spans — "+180% ALL" over 6 years is
  // easy to misread as a yearly figure.
  const spanYears = chartData.length > 1 ? (chartData[chartData.length - 1].ts - chartData[0].ts) / (365.25 * 86400000) : 0
  // FASE IX3. Anualiza LA MISMA cantidad que el encabezado, no el crecimiento
  // bruto del saldo. Con `lastVal / firstVal` el acompañante medía la razón
  // cruda entre el primer y el último punto, que en un portafolio que recibió
  // aportes es sobre todo el dinero que metiste: al lado de un encabezado que
  // dice "+14.82% ALL · sin contar $19,063.81 de aportes" imprimía
  // "≈ +76.0%/año", o sea el mismo período anualizado a cinco veces su propio
  // encabezado. Es la misma contradicción de FASE IX2 (un acompañante que no
  // netea lo que su número sí netea), una línea más abajo. Ahora es el espejo
  // exacto de annualizedReturn, que ya hacía lo correcto para las pestañas de
  // rendimiento. Guard de la base (1 + r) > 0: un -100% no tiene raíz real.
  const cagrPct = spanYears > 1.5 && growthPct != null && (1 + growthPct / 100) > 0
    ? (Math.pow(1 + growthPct / 100, 1 / spanYears) - 1) * 100
    : null
  // Same annualized companion for the performance modes: a cumulative "+180%
  // TWR" over 6 years reads as a yearly figure without it. Guard the base
  // (1 + r) > 0 — a −100% cumulative return has no real annualized root.
  const annualizedReturn = spanYears > 1.5 && isFinite(lastReturn) && (1 + lastReturn / 100) > 0
    ? (Math.pow(1 + lastReturn / 100, 1 / spanYears) - 1) * 100
    : null

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
        // parseAmount y no parseFloat: este campo archiva un valor historico
        // del patrimonio, asi que '25.000' leido como 25 se guarda mal para
        // siempre en un doc de snapshot.
        const raw = parseAmount(row.value)
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
    <SegmentedTabs
      variant="range"
      tabs={periods.map((p) => ({ key: p, label: p === 'CUSTOM' ? (lang === 'es' ? 'Rango' : 'Range') : p }))}
      value={period}
      onChange={(p) => {
        setPeriod(p)
        setShowCustomRange(p === 'CUSTOM')
      }}
      deps={[lang, periods.length]}
      ariaLabel={t('Período', 'Period')}
    />
  )

  if (loading && chartData.length < 2) {
    return (
      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-center min-h-[260px]">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <BusyRing size="16px" />
            {t('Cargando datos...', 'Loading data...')}
          </div>
        </div>
      </div>
    )
  }

  if (fetchError && chartData.length < 2) {
    return (
      <div className="card p-4 sm:p-5">
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
      <div className="card p-4 sm:p-5">
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
    <div ref={containerRef} className="card p-4 sm:p-5">
      {/* Tab bar: Value | Performance TWR | Performance MWR (FASE FP).
          Value is untouched. TWR is the frozen anchored series and the
          default return view (the strategy's return, IBKR's headline
          methodology); MWR is the money-weighted sibling where the timing
          of the user's own deposits counts. Both run over whatever
          institution scope is selected below. */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {/* Era el TERCER lenguaje de pestaña de la pantalla (subrayado), al lado
            de las pastillas de Análisis y de Asignación. Mismo primitivo; qué
            hace cada modo no cambia. */}
        <SegmentedTabs
          tabs={[
            { key: 'value', label: t('Valor', 'Value') },
            { key: 'performance', label: t('Rendimiento TWR', 'Performance TWR'),
              title: t('Retorno ponderado por tiempo: mide la estrategia, ignora el timing de tus aportes', 'Time-weighted return: measures the strategy, ignores the timing of your contributions') },
            { key: 'performance-mwr', label: t('Rendimiento MWR', 'Performance MWR'),
              title: t('Retorno ponderado por dinero: tu rendimiento real, el timing de tus aportes cuenta', 'Money-weighted return: your actual return, the timing of your contributions counts') },
          ]}
          value={viewMode}
          onChange={setViewMode}
          deps={[lang]}
          ariaLabel={t('Qué muestra la gráfica', 'What the chart shows')}
        />
        <div className="ml-auto flex items-center gap-2">
          {shownMode === 'value' && contributionLine && (
            <button onClick={() => setShowContributions(!showContributions)}
              className="px-2 py-1 text-xs font-medium rounded-md transition-all"
              style={showContributions ? { backgroundColor: 'var(--accent-blue)', color: '#fff' } : { color: 'var(--text-muted)' }}
              title={t('Compara con cuánto dinero has puesto en total (línea punteada), aparte de cuánto vale hoy', 'Compares against how much money you\'ve put in total (dotted line), separate from what it\'s worth today')}>
              {t('Invertido', 'Invested')}
            </button>
          )}
        </div>
      </div>

      {/* Institution filter: selecting one sums its holdings (e.g. bond + the
          cash account it pays into) into a single combined line. */}
      {institutions.length > 1 && (
        <div ref={instFade.ref} className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1" style={{ scrollbarWidth: 'none', ...instFade.maskStyle }}>
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
      {/* El encabezado se atenúa junto con la gráfica: dejar el número VIEJO
          nítido al lado de una gráfica atenuada se lee como si ese número ya
          fuera el nuevo. */}
      <div className="transition-opacity duration-200"
        style={switching ? { opacity: 0.45 } : undefined}>
      {shownMode === 'value' ? (
        <div className="mb-3">
          <p className="text-3xl font-bold text-white font-mono tabular-nums">{formatCurrency(hd ? hd.value : currentTotal)}</p>
          <p className="text-sm mt-0.5" style={{ color: displayAbs >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            <span className="font-mono tabular-nums">
              {displayAbs >= 0 ? '+' : ''}{formatCurrency(displayAbs)}
              {growthPct != null && ` (${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(2)}%)`}
            </span>
            {/* Never claim "this year" when the measured window starts at the first
                real data point instead of January. */}
            <span className="text-slate-500 ml-1">
              {valueRebasedFrom
                ? `${t('desde', 'since')} ${formatDate(new Date(valueRebasedFrom).toISOString())}`
                : period === 'YTD' ? t('este año', 'this year') : period === 'DAY' ? t('hoy', 'today') : period === 'CUSTOM' ? t('rango', 'range') : period}
            </span>
            {/* FASE IX2. Este rótulo decía "incluye depósitos" y el comentario que
                tenía encima decía "raw NAV delta - deposits count as growth here",
                pero el número que está a su lado es `displayAbs`, y desde FASE EC
                computeWindowGrowth le RESTA el capital nuevo (growthAbs -
                newCapitalPrincipal). O sea el rótulo afirmaba lo contrario de lo
                que imprime: una vista de 1 año cuya línea va de ~$12.5K a ~$27.2K
                encabezaba "-$1,257.95 · incluye depósitos", que solo se puede leer
                como que algo está roto. Lo que de verdad pasó es que la ventana
                trajo ~$15K de aportes y el portafolio, sin contarlos, perdió eso.
                Ahora el rótulo dice qué se descontó, y solo aparece cuando de
                verdad se descontó algo (sin aportes en la ventana no hay nada que
                aclarar). Cero contacto con el número: la fórmula no se tocó. */}
            {newCapitalPrincipal > 0.005 && (
              <span className="text-xs text-slate-600 ml-1.5">
                {t('· sin contar', '· net of')} {formatCurrency(newCapitalPrincipal)} {t('de aportes', 'in contributions')}
              </span>
            )}
            {cagrPct != null && (
              <span className="text-xs text-slate-500 ml-1.5 font-mono tabular-nums">≈ {cagrPct >= 0 ? '+' : ''}{cagrPct.toFixed(1)}%/{t('año', 'yr')}</span>
            )}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-3xl font-bold font-mono tabular-nums flex items-center gap-2" style={{ color: lastReturn >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {lastReturn >= 0 ? '+' : ''}{(hoverIdx != null && activeReturnData[hoverIdx] != null ? activeReturnData[hoverIdx] : lastReturn).toFixed(2)}%
            {/* Mode chip inline with the number — the tiny caption below was easy
                to miss, and an unlabeled return % invites misreading. Since FASE
                FP the chip matches the ACTIVE tab: the frozen anchored series
                (chained sub-periods, IBKR's methodology) is TWR; the sibling
                money-weighted tab is MWR. */}
            <span className="text-xs font-sans font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
              title={shownMode === 'performance-mwr'
                ? t('Retorno ponderado por dinero (Dietz modificado): el timing de tus aportes cuenta, igual que el MWR de tu broker', 'Money-weighted return (Modified Dietz): the timing of your contributions counts, same as your broker\'s MWR')
                : t('Retorno ponderado por tiempo: cadena el retorno de cada sub-período, la misma metodología que usa tu broker', 'Time-weighted return: chains each sub-period\'s return, the same methodology your broker uses')}>
              {shownMode === 'performance-mwr' ? 'MWR' : 'TWR'}
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
              {shownMode === 'performance-mwr'
                ? t('Tu rendimiento real: el timing de tus aportes cuenta', 'Your actual return: the timing of your contributions counts')
                : t('El rendimiento de la estrategia: ignora el timing de tus aportes', 'The strategy\'s return: ignores the timing of your contributions')}
            </span>
          </div>
        </div>
      )}
      </div>


      {/* FASE HJ: el fetch de historial falló pero la gráfica igual se dibuja
          desde snapshots. Antes esto era 100% silencioso (el EmptyState de
          error solo aparece con la gráfica vacía) y el usuario no tenía forma
          de saber que la serie estaba incompleta. */}
      {/* Este es literalmente la firma de `InlineNotice`: aviso ámbar compacto
          dentro de una card, con una salida para reintentar. El comentario de
          cabecera de ese componente ya nombraba a este archivo como uno de los
          dos originales duplicados a mano. */}
      {fetchError && chartData.length >= 2 && (
        <InlineNotice
          tone="warn"
          actionLabel={t('Reintentar', 'Retry')}
          onAction={fetchHistory}
          className="mb-3"
        >
          {t('Historial de mercado incompleto esta sesión: la línea puede tener huecos.', 'Market history incomplete this session: the line may have gaps.')}
        </InlineNotice>
      )}

      {/* La caída máxima es un HECHO del período, no una alarma: toda gráfica de
          patrimonio con historia suficiente tiene una, y venía envuelta en la
          misma caja roja con borde que la app usa para un error que hay que
          atender. Dos razones para sacarla de ahí. La de producto: en esta app
          el rojo está reservado para algo grave (`lib/toastStyle.js`), y esto es
          una estadística descriptiva. La dura: Chartability (POUR-CAF, EuroVis
          2022) pide limitar las áreas rojas prominentes por riesgo de
          fotosensibilidad, no por gusto.

          Pasa a ser una línea de anotación bajo el encabezado. El porcentaje y
          las dos fechas se conservan íntegros: no se quita información, cambia
          dónde y con qué peso se dice. */}
      {shownMode === 'value' && drawdown && (
        <p className="text-caption mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <span aria-hidden="true">↓</span>
          <span>
            {t('Mayor caída del período', 'Largest drop in the period')}{' '}
            <span className="font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              -{drawdown.pct.toFixed(1)}%
            </span>
            <span className="ml-1">
              ({chartData[drawdown.start] && formatDate(chartData[drawdown.start].date.toISOString())} → {chartData[drawdown.end] && formatDate(chartData[drawdown.end].date.toISOString())})
            </span>
          </span>
        </p>
      )}

      {/* Short-history notice: real broker NAV starts well after Jan 1. The Value
          view shows a labeled estimate before that date; the Performance view is
          rebased to the real region (IBKR's own convention). Two remedies, not
          one: widen the sync window (IBKR only — other brokers have no history
          API at all) for the API-synced estimate, or upload a file with the full
          history for whatever the sync can't reach (multi-year "ALL" in
          particular, which 365 days never covers). Dismissible per (broker,
          anchor date): re-syncing with MORE real history changes the anchor and
          un-dismisses it, instead of hiding a newer, more actionable message.

          Requires a SYNCED BROKER in scope (`primaryBrokerId != null`). Every
          remedy this notice offers is a broker action — widen a Flex Query
          period, upload the broker's export — so on a scope with no synced
          broker at all (a manually-typed bond and its cash account, say) it had
          nothing true to say and said it anyway: `primaryBrokerId == null` used
          to fall into the IBKR branch, so a manual IDC bond got told to go fix
          its "Flex Queries → Period", plus a forensic line counting IBKR XML
          sections it never had. A manual asset held flat between its own tracked
          events is not a broker sync gap, and pointing at IBKR to fix it is just
          wrong (FASE DV). */}
      {(period === 'YTD' || period === 'ALL') && !apiTransactional && firstRealTs != null && chartData.length > 1
        && !estimateNoticeDismissed && primaryBrokerId != null
        && firstRealTs > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000
        && (isPerf || chartData[0].ts < firstRealTs - 3600000) && (
        <div className="relative flex items-start gap-2 px-2.5 py-1.5 pr-7 rounded-lg text-xs mb-3"
          style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)', color: 'var(--alert-info-icon)' }}>
          <span>ℹ</span>
          <span>
            {/* The account is named FIRST and in bold: with many assets on this
                chart, "which of my accounts is this about?" is the question the
                notice has to answer before anything else. */}
            <span className="font-semibold">{estimateScopeLabel || t('Tu broker', 'Your broker')}: </span>
            {isPerf
              ? t(`el retorno se mide desde ${formatDate(new Date(firstRealTs).toISOString())}, el primer día con datos reales de esta cuenta (igual que haría IBKR con una cuenta nueva).`,
                  `return is measured from ${formatDate(new Date(firstRealTs).toISOString())}, the first day with real data for this account (just like IBKR would for a new account).`)
              : t(`datos reales desde ${formatDate(new Date(firstRealTs).toISOString())}; antes es un estimado.`,
                  `real data starts ${formatDate(new Date(firstRealTs).toISOString())}; earlier values are an estimate.`)}
            {' '}
            {primaryBrokerId === 'ibkr'
              ? t('En IBKR: Flex Queries → tu query → Period → "Last 365 Calendar Days", y vuelve a sincronizar.',
                  'In IBKR: Flex Queries → your query → Period → "Last 365 Calendar Days", then sync again.')
              : t('Este broker no sincroniza historial por API: la única forma de tener el año completo es subir tu archivo.',
                  'This broker doesn\'t sync history via API: uploading your file is the only way to get the full year.')}
            {' '}
            {t('¿Querés tu historial COMPLETO ya, sin depender de eso?', 'Want your FULL history right now, without depending on that?')}
            {onImportBroker && (
              <button onClick={() => onImportBroker(primaryBrokerId)}
                className="block mt-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
                style={{ backgroundColor: 'var(--alert-info-icon)', color: 'var(--bg-card)' }}>
                {t('Subir historial completo (archivo)', 'Upload full history (file)')}
              </button>
            )}
            {/* The escape hatch for history that exists only as an image. IBKR's
                PortfolioAnalyst is the one view that reaches account inception and
                its dashboard offers no download, so for many users a screenshot is
                genuinely all there is. The import modal carries a prompt that turns
                that picture into the history sheet we can read. */}
            {onImportBroker && (
              <span className="block mt-1 text-[10px] opacity-80">
                {t('¿Tu historial solo existe como captura (ej. PortfolioAnalyst)? Ahí mismo hay un prompt para convertirla en archivo.',
                   'History only exists as a screenshot (e.g. PortfolioAnalyst)? There is a prompt in there to turn it into a file.')}
              </span>
            )}
            {/* Persistent forensic line: raw per-section counts from the last sync's
                XML vs what got imported. Survives the transient toast so ANY
                screenshot of this banner pins down where the data stops flowing.
                IBKR-only (Flex Query XML sections) — showing it under a different
                broker's notice would reference sections that broker doesn't have. */}
            {primaryBrokerId === 'ibkr' && ibkrSyncSummary?.sections && (
              <span className="block mt-1.5 font-mono text-[10px] opacity-80">
                {t('Último sync', 'Last sync')} {ibkrSyncSummary.at ? formatDate(ibkrSyncSummary.at) : ''}: XML{' '}
                {ibkrSyncSummary.sections.trades ?? 0} trades, {ibkrSyncSummary.sections.cashTransactions ?? 0} cash tx,{' '}
                {ibkrSyncSummary.sections.equitySummary ?? 0} NAV, {ibkrSyncSummary.sections.cashReport ?? 0} cash rep ·{' '}
                {t('importado', 'imported')}: {ibkrSyncSummary.trades ?? 0} trades, {(ibkrSyncSummary.flows ?? 0) + (ibkrSyncSummary.dividends ?? 0)} {t('flujos', 'flows')}, {ibkrSyncSummary.equityDays ?? 0} {t('días NAV', 'NAV days')}
              </span>
            )}
          </span>
          <button onClick={dismissEstimateNotice} aria-label={t('Cerrar aviso', 'Close notice')}
            className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-md opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--alert-info-icon)' }}>
            &times;
          </button>
        </div>
      )}

      {/* Chart. Mientras el recálculo está en vuelo se atenúa en vez de
          congelarse: la pestaña ya se marcó, así que esto dice "sí, va a
          cambiar" sin mentir sobre qué se está viendo (lo dibujado sigue
          siendo la vista anterior, completa y coherente, hasta que la nueva
          esté lista). `pointer-events-none` evita que el hover lea la serie
          vieja mientras tanto. */}
      {geo && (
        <div className="relative transition-opacity duration-200"
          style={switching ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
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
            {/* Rótulo de unidad: la moneda (o el "%") se dice una vez, arriba del
                eje, en vez de repetirse en cada marca. */}
            <text x={0} y={11} textAnchor="start" fill="var(--text-muted)" fontSize="10" fontWeight="600">
              {isPerf ? '%' : (baseCurrency || 'USD')}
            </text>

            {geo.yTicks.map((tk, i) => {
              const collidesWithBaseline = isPerf && Math.abs(tk.y - geo.baselineY) < 12
              return (
                <g key={i}>
                  <line x1={pad.left} y1={tk.y} x2={width - pad.right} y2={tk.y} stroke="var(--card-border)" strokeDasharray="4 4" strokeOpacity="0.8" />
                  {!collidesWithBaseline && (
                    <text x={pad.left - 8} y={tk.y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10"
                      style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {isPerf
                        ? `${tk.val > 0 ? '+' : ''}${tk.val.toFixed(pctDecimals(tk.step))}`
                        : formatAxisTick(tk.val, tk.step, baseCurrency, { symbol: false, exactSteps: tk.nice })}
                    </text>
                  )}
                </g>
              )
            })}

            {shownMode === 'value' ? (
              <>
                <defs>
                  <linearGradient id="grad-value" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.02" />
                  </linearGradient>
                  {splitIdx > 0 && (
                    <>
                      <clipPath id="clip-estimate-value">
                        <rect x={pad.left} y={pad.top} width={Math.max(0, geo.points[splitIdx].x - pad.left)} height={chartHeight - pad.top - pad.bottom} />
                      </clipPath>
                      <clipPath id="clip-real-value">
                        <rect x={geo.points[splitIdx].x} y={pad.top} width={Math.max(0, width - pad.right - geo.points[splitIdx].x)} height={chartHeight - pad.top - pad.bottom} />
                      </clipPath>
                    </>
                  )}
                </defs>

                {/* Drawdown shaded zone. En neutro, no en rojo: la banda marca
                    DÓNDE ocurrió la mayor caída, que es orientación, y pintarla
                    del color de error decía que ese tramo está mal. */}
                {drawdown && geo.points[drawdown.start] && geo.points[drawdown.end] && (
                  <rect
                    x={geo.points[drawdown.start].x}
                    y={pad.top}
                    width={geo.points[drawdown.end].x - geo.points[drawdown.start].x}
                    height={chartHeight - pad.top - pad.bottom}
                    fill="var(--text-muted)" opacity="0.07" rx="2" />
                )}

                {/* Main value area + line. When part of the curve is a reconstruction
                    (today's positions projected backwards), that stretch gets a flat
                    muted-grey fill (not the blue "real value" gradient) plus a dashed
                    grey line, so it reads as an estimate rather than as recorded
                    history even at a glance / small zoom — a blue-on-blue dashed line
                    alone was too subtle to notice. */}
                {(() => {
                  const areaPath = `${polyline(geo.points)} L ${geo.points[geo.points.length - 1].x} ${geo.baselineY} L ${geo.points[0].x} ${geo.baselineY} Z`
                  if (splitIdx <= 0 || splitIdx >= geo.points.length) {
                    return (
                      <>
                        <path key={`a-${shapeKey}`} className="chart-area-fade" d={areaPath} fill="url(#grad-value)" />
                        {/* pathLength="1" normaliza el largo del trazo, así que
                            el dibujado no necesita medir el path con JS: el
                            dasharray es 1 y el offset va de 1 a 0 sirva la serie
                            que sirva. La `key` es lo que lo re-dispara. */}
                        <path key={`l-${shapeKey}`} className="chart-line-draw" pathLength="1"
                          d={polyline(geo.points)} fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </>
                    )
                  }
                  const splitX = geo.points[splitIdx].x
                  // Flip the label to the left of the divider when there isn't room on
                  // the right (a case just like this one: only the last day or two is
                  // real, so the "real data" side of the split is a thin sliver).
                  const labelOnLeft = (width - pad.right - splitX) < 70
                  return (
                    <>
                      <path d={areaPath} fill="var(--text-muted)" opacity="0.1" clipPath="url(#clip-estimate-value)" />
                      <path d={areaPath} fill="url(#grad-value)" clipPath="url(#clip-real-value)" />
                      <line x1={splitX} y1={pad.top} x2={splitX} y2={chartHeight - pad.bottom} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.6" />
                      <text x={splitX + (labelOnLeft ? -4 : 4)} y={pad.top + 10} textAnchor={labelOnLeft ? 'end' : 'start'} fill="var(--text-muted)" fontSize="9">
                        {t('datos reales →', 'real data →')}
                      </text>
                      {/* El tramo estimado conserva su propio dasharray (es
                          lo que lo marca como estimado), así que ahí el
                          dibujado no se puede usar: se desvanece. */}
                      <path key={`e-${shapeKey}`} className="chart-area-fade" d={polyline(geo.points.slice(0, splitIdx + 1))} fill="none" stroke="var(--text-muted)" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" strokeOpacity="0.7" />
                      <path key={`r-${shapeKey}`} className="chart-line-draw" pathLength="1"
                        d={polyline(geo.points.slice(splitIdx))} fill="none" stroke="var(--accent-blue)" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )
                })()}

                {/* Contributions line (invested capital) */}
                {contributionGeoPoints && contributionGeoPoints.length >= 2 && showContributions && (
                  <path d={polyline(contributionGeoPoints)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 3" opacity="0.5" />
                )}

                {/* Transaction markers (aggregated: one triangle per point+direction) */}
                {/* Carril propio, separado del piso del eje. Antes los triángulos
                    colgaban pegados a la última línea de la cuadrícula, así que se
                    leían como parte de la serie; ahora viven en la banda que
                    `pad.bottom` reserva para ellos, con aire arriba y abajo.
                    El `×N` sube de 8px a 12px: 8px queda por debajo del piso de
                    legibilidad de Chartability, y ese contador es la única pista
                    de que un punto agrupa varios movimientos. */}
                {txMarkers.map((m, i) => {
                  const pt = geo.points[m.chartIdx]
                  if (!pt) return null
                  const markerY = chartHeight - pad.bottom
                  const color = m.isBuy ? 'var(--accent-green)' : 'var(--text-negative)'
                  return (
                    <g key={i}>
                      <polygon
                        points={m.isBuy
                          ? `${pt.x},${markerY + 6} ${pt.x - 4},${markerY + 14} ${pt.x + 4},${markerY + 14}`
                          : `${pt.x},${markerY + 14} ${pt.x - 4},${markerY + 6} ${pt.x + 4},${markerY + 6}`}
                        fill={color} opacity="0.6" />
                      {m.count > 1 && (
                        <text x={pt.x + 6} y={markerY + 15} fill={color} fontSize="12" opacity="0.9"
                          style={{ fontVariantNumeric: 'tabular-nums' }}>×{m.count}</text>
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
                {/* Sin "%": la unidad la dice el rótulo del eje, igual que las
                    demás marcas. Con eje redondo el cero cae EXACTO sobre esta
                    línea, así que la marca de 0 se suprime por colisión y esta
                    etiqueta es la única que lo nombra. */}
                <text x={pad.left - 8} y={geo.baselineY + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontWeight="600"
                  style={{ fontVariantNumeric: 'tabular-nums' }}>0</text>

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
              </>
            )}

            {/* X-axis labels */}
            {resolvedXLabels.map((xl, i) => (
              <text key={i} x={xl.x} y={chartHeight - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="10">{xl.label}</text>
            ))}

            {/* Hover crosshair */}
            {hp && (
              <g>
                <line x1={hp.x} y1={pad.top} x2={hp.x} y2={chartHeight - pad.bottom} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" />
                <circle cx={hp.x} cy={hp.y} r="4.5"
                  fill={shownMode === 'value' ? 'var(--accent-blue)' : (hp.v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')}
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
              {shownMode === 'value' ? (
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
                  <div className="font-bold" style={{ color: (activeReturnData[hoverIdx] ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {t('Portafolio', 'Portfolio')}: {(activeReturnData[hoverIdx] ?? 0) >= 0 ? '+' : ''}{(activeReturnData[hoverIdx] ?? 0).toFixed(2)}%
                  </div>
                  <div className="text-slate-300">{formatCurrency(hd.value)}</div>
                  <div className="text-slate-500">{formatTooltipDate(hd.date)}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend + Period selector */}
      {shownMode === 'value' && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: 'var(--accent-blue)' }} />
            {t('Valor actual', 'Current value')}
          </span>
          {splitIdx > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block opacity-70" style={{ backgroundColor: 'var(--text-muted)', borderBottom: '1px dashed' }} />
              {t('Estimado (posición actual proyectada hacia atrás)', 'Estimate (current position projected backward)')}
            </span>
          )}
          {showContributions && contributionLine && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block opacity-50" style={{ backgroundColor: 'var(--text-muted)', borderBottom: '1px dashed' }} />
              {t('Capital invertido (lo que has puesto, no lo que vale)', 'Invested capital (what you\'ve put in, not what it\'s worth)')}
            </span>
          )}
          {/* The floor triangles were never explained anywhere */}
          {txMarkers.length > 0 && (
            <span className="flex items-center gap-1">
              <span style={{ color: 'var(--accent-green)' }}>▲</span>{t('Entró dinero', 'Money in')}
              <span className="ml-1" style={{ color: 'var(--text-negative)' }}>▼</span>{t('Salió dinero', 'Money out')}
            </span>
          )}
        </div>
      )}
      {isPerf && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
          {/* The line renders green above 0% and red below — document both colors */}
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: 'var(--accent-green)' }} />
            <span className="w-1.5 h-1.5 rounded-full inline-block -ml-1" style={{ backgroundColor: 'var(--text-negative)' }} />
            {shownMode === 'performance-mwr'
              ? t('Tu portafolio (MWR): verde sobre 0%, rojo debajo', 'Your portfolio (MWR): green above 0%, red below')
              : t('Tu portafolio (TWR): verde sobre 0%, rojo debajo', 'Your portfolio (TWR): green above 0%, red below')}
          </span>
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
            className="px-2 py-1 bg-theme-base border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[var(--accent-blue)]" />
          <label className="text-xs text-slate-400">{t('Hasta', 'To')}:</label>
          <input type="date" value={customRange.to}
            onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
            max={new Date().toISOString().split('T')[0]}
            className="px-2 py-1 bg-theme-base border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[var(--accent-blue)]" />
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
          {/* FASE HP: reparación VISIBLE. Hasta ahora esto corría solo, en
              segundo plano y detrás de una docena de condiciones (sync en
              curso, precios refrescando, una vez por sesión...), así que
              cuando no pasaba nada era imposible saber si había corrido, si
              había escrito, o qué lo bloqueó. Acá el usuario lo dispara y ve
              el resultado. */}
          <div className="mb-3 pb-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {t('Reconstruir el historial con datos reales', 'Rebuild history from real data')}
              </span>
              <button
                onClick={runHistoryRepair}
                disabled={!!repairState?.running}
                className="px-2.5 py-1 rounded text-xs font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#fff', opacity: repairState?.running ? 0.6 : 1 }}
              >
                {repairState?.running ? t('Reparando...', 'Repairing...') : t('Reparar ahora', 'Repair now')}
              </button>
            </div>
            {repairState?.lines?.length > 0 && (
              <div className="mt-2 space-y-0.5 font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {repairState.lines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-2">
            {t('Agrega valores pasados de tu portafolio para completar la gráfica.',
               'Add past portfolio values to complete the chart.')}
          </p>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {snapshotRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input type="date" value={row.date}
                  onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, date: e.target.value } : r))}
                  className="px-2 py-1 bg-theme-card border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[var(--accent-blue)] w-36" />
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-xs text-slate-500">$</span>
                  <AmountInput value={row.value} placeholder={t('Valor total', 'Total value')}
                    onChange={e => setSnapshotRows(prev => prev.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                    className="w-full px-2 py-1 bg-theme-card border border-glass-border rounded text-xs text-white focus:outline-none focus:border-[var(--accent-blue)]" />
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
                {<BusyLabel busy={snapshotSaving} lang={lang}>{t('Guardar', 'Save')}</BusyLabel>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
