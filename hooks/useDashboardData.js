import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useFirestoreItems } from './useFirestoreItems'
import { useMarketPrices } from './useMarketPrices'
import { useExchangeRates } from './useExchangeRates'
import { useBenchmark } from './useBenchmark'
import { useTabCoordination } from './useTabCoordination'
import { authFetch, safeJson } from '@/lib/authFetch'
import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, getTypeCategory, getInvestmentClass, isExcludedFromNetWorth, computeDayChange, augmentSnapshots, projectItemAnnualIncome, findYearStartAnchor, findMonthStartAnchor, computeScopedReturns, shouldHoldFlat, hasUnreliableAcqDate, combineAccountCalibrations, accountKeyOfItem, BROKER_NAV_SOURCES, heldFlatAccountValueUSD, isMarketPriced, effectiveAcqTs, getEffectiveYield } from '@/components/dashboard/utils'
import { buildTxEvents, buildCashFlows } from '@/lib/portfolioRewind'
import { indexBalanceEvents } from '@/lib/historicalValues'
import { hasDividendInMonth, redundantAutoDividendIds, creditableBackfills, creditDestinationBalance, dividendCreditTarget } from '@/lib/autoDividends'
import { unlinkedOpeningDeposits } from '@/lib/originDeposits'
import { corruptSnapshotRunIds, feEraSuspectDailyIds } from '@/lib/corruptSnapshots'
import { planEquitySnapshotWrites, misplacedPlainNavMigrations } from '@/lib/ibkrSnapshotPlan'
import { preferFullPortfolioPerDay } from '@/lib/snapshotSelect'
import { staleBackfillDates, buildNavByDate, composeDailyTotals, windowDates, divergentDailyDates } from '@/lib/snapshotBackfill'
import { hasCompleteBrokerData, ibkrSnapshotSpanDays as computeIbkrSnapshotSpanDays, earliestNeededDays as computeEarliestNeededDays } from '@/lib/brokerCompletion'
import { detectInferredFlows, quarterlyOnlyPoints, staleInferredFlowIds, applyLifetimeNetConstraint } from '@/lib/inferredFlows'
import { ibkrReconciliationReport } from '@/lib/ibkrReconciliation'
import { knownContributions, computeLiquidYield, yieldSignature, supersededYieldTxIds } from '@/lib/liquidYield'
import { clampPayDay, payDateFor, impossiblePayDateFixes } from '@/lib/incomeSchedule'
import { attributeYtd } from '@/lib/ytdAttribution'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights, computeAssetAttribution, inferPeriodsPerYear, filterValueSpikes } from '@/components/dashboard/analytics'
import { checkPriceAlerts } from '@/lib/notifications'

// What changed since the previous sync. Because a wide Flex Query (Year to Date)
// re-delivers the whole year every run and dedup collapses what we already have,
// the growth of each total IS the new activity: new trades, new deposits/withdrawals,
// new dividends, new costs. This is the auto-detection the sync already does, made
// visible. Returns null on the first sync (no baseline) or when nothing is new.
export function ibkrSyncChanges(prev, next) {
  if (!prev || !next) return null
  const d = (k) => Math.max(0, (next[k] || 0) - (prev[k] || 0))
  const changes = { trades: d('trades'), flows: d('flows'), dividends: d('dividends'), fees: d('fees'), equityDays: d('equityDays') }
  const any = changes.trades || changes.flows || changes.dividends || changes.fees || changes.equityDays
  return any ? changes : null
}

// FASE GE. Un solo constructor del payload de items para
// /api/prices/portfolio-history, compartido por el cálculo de jan1Value y por
// el backfill. Antes el backfill mandaba items SIN txEvents/cashFlows: los
// docs 'backfill' que escribía eran lot-aware para las posiciones con trades
// reales (las compras de mitad de año NO existen en el valor de enero) pero
// ciegos al timing de los depósitos, y el YTD anclado en uno de esos docs
// excluía además los flujos de IBKR (regla de FASE AI, pensada para
// reconstrucciones hold-flat puras donde el depósito ya vive dentro del valor
// de arranque): cada depósito al broker durante el año se leía como ganancia.
function buildHistoryItemsPayload({ items, transactions, lots, convert }) {
  const txEventsBySym = buildTxEvents(transactions)
  const accountCashFlows = buildCashFlows(transactions,
    (amt, cur2) => convert ? convert(amt, cur2, 'USD') : amt)
  // Only rewind the cash line when there is a REAL external flow
  // (deposit/withdrawal). With hold-flat stocks, rewinding cash by BUY/SELL
  // double-counts (the flat holding already implies the shares were owned),
  // which collapses the January baseline and blows up the YTD Dietz. Without
  // deposits, leave cash flat.
  const hasExternalFlow = (transactions || []).some((t) => /^(DEPOSIT|WITHDRAWAL)$/i.test(t.type || ''))
  // Prefer the CASH-{ccy} holding; fall back to any single IBKR bank-type item
  // so the ledger still rebuilds cash when the symbol isn't exactly CASH-*.
  const cashItem = (accountCashFlows.length > 0 && hasExternalFlow)
    ? (items.find((it) => it._source === 'ibkr' && /^CASH-/i.test(it.symbol || ''))
       || items.find((it) => it._source === 'ibkr' && /bank|cash/i.test(it.type || '')))
    : null
  // Per-item balance history for the MANUAL side, from the same index the
  // spreadsheet reconstructs with. Without it a destination account was held
  // flat at today's balance all the way back, so a coupon earned in May was
  // already sitting there on Jan 1: start and end matched and YTD read +0.00%
  // on a bond that had really paid 240 (FASE DW). Note these never carry
  // _flowIsAccountLevel — only the broker's own reconciled cash ledger
  // promotes the whole response to "transactional".
  const { balanceEventsById } = indexBalanceEvents(transactions, items, convert, 'USD')
  return items.map((it) => {
    const cur = it._originalCurrency || it.currency || 'USD'
    const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
    return {
      id: it.id,
      symbol: it.symbol, type: it.type, quantity: it.quantity,
      currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
      purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
      currency: 'USD',
      acquisitionDate: it.acquisitionDate,
      _holdFlat: shouldHoldFlat(it, transactions, lots),
      // FASE HL: la fecha es un sello de sync, así que el server no puede
      // usarla como puerta de existencia (ni los lots que ese import creó).
      _dateUnreliable: hasUnreliableAcqDate(it),
      txEvents: txEventsBySym[(it.symbol || '').toUpperCase()] || undefined,
      // The broker's own reconciled ledger keeps the shape it always had. A
      // manual account's flows are marked _flowClampZero: an opening DEPOSIT
      // can exceed the asset's own value (it carries the entry fee: 6,098
      // deposited into a 6,000 bond), and rewinding past it would leave the
      // asset at -98 instead of "did not exist yet".
      ...(cashItem && it.id === cashItem.id
        ? { cashFlows: accountCashFlows }
        : (balanceEventsById[it.id]?.length
          ? { cashFlows: balanceEventsById[it.id], _flowClampZero: true }
          : {})),
    }
  })
}

export function useDashboardData({ user, lang, activePortfolio, activeEntity = '__all__' }) {
  const firestoreData = useFirestoreItems()
  const {
    items, snapshots: rawSnapshots, transactions, goals, settings, profile,
    loading: dataLoading, addItem, updateItem, deleteItem,
    deleteAllItems, deleteItemGroup, saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    alerts, addAlert, deleteAlert, updateAlert,
    lots, addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution, bulkImport, bulkWriting, deletionEpoch,
    portfolios, addPortfolio, deletePortfolio,
    financeTransactions, addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    saveGoals, saveSettings, saveProfile,
    saveItemSnapshots, loadItemSnapshots,
  } = firestoreData

  // Per-account calibration anchors (_account) hold ONE account's solved start
  // value, not portfolio NAV: they must never enter the NAV series (chart,
  // dedup, backfill, scoped returns) or they would read as catastrophic drops.
  // Every consumer below uses the filtered `snapshots`; only the calibration
  // math in the returnYTD memo reads `accountCalibrations`.
  const accountCalibrations = useMemo(
    () => (rawSnapshots || []).filter((s) => s && s._account && s._calibrated && s.date),
    [rawSnapshots]
  )
  const snapshots = useMemo(
    () => (rawSnapshots || []).filter((s) => !(s && s._account)),
    [rawSnapshots]
  )

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => { setBaseCurrency(baseCurrency) }, [baseCurrency])
  useEffect(() => { setUtilsLang(lang) }, [lang])

  const { enrichedItems: rawEnriched, prices: marketPrices, loading: pricesLoading, isFetching: pricesFetching, error: pricesError, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, error: ratesError, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

  // FASE GB. Declarada AQUÍ (antes de los efectos escritores que la llevan en
  // sus deps) porque una deps array se evalúa en render: referenciarla antes
  // de su declaración sería un ReferenceError, no un undefined silencioso.
  // La consume el bloque de auto-sync de IBKR más abajo.
  const [ibkrAutoSyncing, setIbkrAutoSyncing] = useState(false)

  const alertsCheckedRef = useRef(null)
  useEffect(() => {
    if (settings?.notifPriceAlerts === false) return
    if (!marketPrices || Object.keys(marketPrices).length === 0 || !alerts || alerts.length === 0) return
    const key = pricesUpdate || Date.now()
    if (alertsCheckedRef.current === key) return
    alertsCheckedRef.current = key
    checkPriceAlerts(alerts, marketPrices, (alertId) => {
      updateAlert(alertId, { triggered: true, triggeredAt: new Date().toISOString() })
    })
  }, [marketPrices, alerts, pricesUpdate, updateAlert, settings?.notifPriceAlerts])

  const enrichedItems = useMemo(() => {
    if (!rates) return rawEnriched
    return rawEnriched.map((it) => {
      const itemCurrency = it.marketCurrency || it.currency || 'USD'
      const price = it.currentPrice || it.purchasePrice || it.price || it.cost || 0
      const convertedPrice = convert(price, itemCurrency, baseCurrency)
      const purchaseConverted = it.purchasePrice ? convert(it.purchasePrice, it.currency || 'USD', baseCurrency) : 0
      return {
        ...it,
        currentPrice: convertedPrice,
        purchasePrice: purchaseConverted != null ? purchaseConverted : it.purchasePrice,
        _originalPrice: price,
        _originalPurchasePrice: it.purchasePrice || 0,
        _originalCurrency: itemCurrency,
        _displayCurrency: baseCurrency,
      }
    })
  }, [rawEnriched, rates, convert, baseCurrency])

  const entityItems = useMemo(() => {
    if (activeEntity === '__all__') return enrichedItems
    return enrichedItems.filter((it) => (it.entityId || 'default') === activeEntity)
  }, [enrichedItems, activeEntity])

  const entityTransactions = useMemo(() => {
    if (activeEntity === '__all__') return transactions
    return transactions.filter((tx) => (tx.entityId || 'default') === activeEntity)
  }, [transactions, activeEntity])

  const entityFinanceTransactions = useMemo(() => {
    if (activeEntity === '__all__') return financeTransactions
    return financeTransactions.filter((tx) => (tx.entityId || 'default') === activeEntity)
  }, [financeTransactions, activeEntity])

  const portfolioItems = useMemo(() => {
    if (activePortfolio === '__all__') return entityItems
    return entityItems.filter((it) => (it.portfolioId || '__default__') === activePortfolio)
  }, [entityItems, activePortfolio])

  // Daily snapshot
  const snapshotSavedRef = useRef(null)
  useEffect(() => {
    const todayStr = new Date().toLocaleDateString('en-CA')
    if (snapshotSavedRef.current === todayStr) return
    // pricesFetching (not just pricesLoading) guards every write here: loading
    // only ever arms on the session's FIRST price fetch (see useMarketPrices),
    // so without pricesFetching a background poll returning a transiently bad
    // price could get written straight into a permanent snapshot/transaction
    // before the next poll corrects it — the value-chart "bumps" a sync in
    // progress can leave behind.
    if (!user || dataLoading || pricesLoading || pricesFetching || ratesLoading || bulkWriting || ibkrAutoSyncing) return
    if (enrichedItems.length === 0) return
    const alreadyExists = snapshots.some((s) => s.date === todayStr || s.id === todayStr)
    // FASE EI. A 'daily' doc for TODAY, once written, used to be final for the
    // rest of the day no matter what — a price tick, a new item added mid-day
    // (XOCHI, this morning), nothing could refresh it, so the value chart's
    // very last point stayed stuck at whatever total happened to be true the
    // moment it first wrote, while every day before it (self-healed by the
    // trailing-30-day backfill, FASE EG) was correct: a cliff appears at
    // "today" even though the headline number is right. With no broker-synced
    // item, 'daily' is just a live computation, not an external truth, same
    // reasoning as FASE EG — let ONE mount overwrite it if the live total
    // now differs, never mid-session (the ref below still guards that).
    const hasBrokerItem = enrichedItems.some((it) => it && it._source === 'ibkr')
    if (alreadyExists && hasBrokerItem) { snapshotSavedRef.current = todayStr; return }
    let totalAssetsUSD = 0
    let totalDebtUSD = 0
    enrichedItems.forEach((it) => {
      // Keep the snapshot baseline consistent with the live netWorth, which drops
      // receivables the user excluded from net worth (otherwise daily change / returns
      // would compare against a baseline that counts assets the headline does not).
      if (isExcludedFromNetWorth(it)) return
      const origPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
      const origCurrency = it._originalCurrency ?? baseCurrency ?? 'USD'
      let value = (it.quantity || 0) * origPrice
      value = convert ? convert(value, origCurrency, 'USD') : value
      if (it.isDebt) totalDebtUSD += Math.abs(value)
      else totalAssetsUSD += value
    })
    const netWorthUSD = totalAssetsUSD - totalDebtUSD
    if (totalAssetsUSD > 0 || totalDebtUSD > 0) {
      const { netContributions: totalContributedUSD } = computeNetContributions(transactions, convert, 'USD')
      // _source:'daily' marks this as a FULL-portfolio snapshot (all enriched
      // items) so other writers (IBKR sync = broker-only NAV) know not to
      // overwrite it with a poorer value for the same date.
      saveSnapshot({ date: todayStr, totalActivosUSD: totalAssetsUSD, totalDebtUSD, netWorthUSD, totalContributedUSD, rates: rates || {}, baseCurrency, _source: 'daily' })
      snapshotSavedRef.current = todayStr
    }
  }, [user, dataLoading, pricesLoading, pricesFetching, ratesLoading, bulkWriting, ibkrAutoSyncing, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency, transactions])

  // Backfill missing snapshots for the last 30 days.
  // A 'backfill' doc is a RECONSTRUCTION from whatever items existed the
  // moment it was written, not an observation — so a day already covered by
  // an OLD backfill estimate is exactly as re-fillable as a day with no doc
  // at all, or an asset added later with a real past acquisitionDate (a
  // second bond, backdated to a prior year) leaves it stuck forever excluding
  // that asset while fresher days include it, sawtoothing by its whole value
  // (FASE EG, see lib/snapshotBackfill.js for the full story and the test
  // that pins this down).
  const backfillRef = useRef(false)
  // FASE GM2. Un borrado de cuentas a mitad de sesión re-arma el backfill: la
  // regeneración del historial de portafolio completo ya corrió al inicio de
  // la sesión, y sin este reset el auto-reparado post-borrado (re-derivar los
  // días que aún contenían la cuenta borrada, incluido el snapshot de AYER
  // que se queda como un pico gigante) no ocurría hasta la próxima recarga.
  const deletionEpochRef = useRef(deletionEpoch)
  useEffect(() => {
    if (deletionEpoch !== deletionEpochRef.current) {
      deletionEpochRef.current = deletionEpoch
      backfillRef.current = false
    }
  }, [deletionEpoch])
  useEffect(() => {
    if (backfillRef.current) return
    // pricesFetching (not just pricesLoading) guards every write here: loading
    // only ever arms on the session's FIRST price fetch (see useMarketPrices),
    // so without pricesFetching a background poll returning a transiently bad
    // price could get written straight into a permanent snapshot/transaction
    // before the next poll corrects it — the value-chart "bumps" a sync in
    // progress can leave behind.
    if (!user || dataLoading || pricesLoading || pricesFetching || ratesLoading || bulkWriting || ibkrAutoSyncing) return
    if (enrichedItems.length === 0 || !snapshots) return
    // With no broker-synced item, a 'daily' doc is not an external truth
    // either — it is the SAME "sum of whatever items the app knew about that
    // day" that 'backfill' is, just computed live instead of after the fact.
    // A fresh reconstruction (with everything now on file) is at least as
    // good, and it is the only way a backdated asset stops flip-flopping
    // between two different pasts (lib/snapshotBackfill.js). A broker-synced
    // portfolio never opts in: its old 'daily' total cannot be recomputed
    // from a hold-flat guess without a real accuracy downgrade.
    const hasBrokerItem = enrichedItems.some((it) => it && it._source === 'ibkr')
    // FASE HG. La fecha del ítem de IBKR más antiguo: los 'daily' escritos
    // ANTES de esa fecha se escribieron cuando el broker todavía no era parte
    // del portafolio, así que su total (correcto para ESE día) hoy se ve
    // "congelado" sin el broker mientras los días de al lado sí lo incluyen —
    // el diente de sierra de la vista "Todas" con IBKR conectado. Mismo patrón
    // que manualAddedTs en PortfolioGrowthChart.jsx, del lado del broker.
    const brokerAddedTs = (() => {
      const ts = enrichedItems
        .filter((it) => it && it._source === 'ibkr' && it.createdAt)
        .map((it) => new Date(it.createdAt).getTime())
        .filter((t) => isFinite(t))
      return ts.length > 0 ? Math.min(...ts) : null
    })()
    // FASE GD: ventana de un año, no 30 días. Desde que un NAV de broker no
    // cuenta como cobertura del día completo (staleBackfillDates), los meses
    // que quedaron solo-broker (la regla de reemplazo que GD eliminó destruyó
    // sus backfills) se regeneran completos con precios históricos reales.
    // Cada día se llena UNA vez y queda cubierto: el costo grande es solo la
    // primera pasada.
    const gaps = staleBackfillDates(snapshots, { treatDailyAsStale: !hasBrokerItem, windowDays: 366, brokerConnectedTs: brokerAddedTs })
    const navMigrations = misplacedPlainNavMigrations(snapshots)
    // FASE HO: con un broker conectado la corrida no se salta aunque no haya
    // huecos: la composición (NAV real + manual) es la vara que detecta un doc
    // 'daily' corrupto, y esos docs NO son huecos (están protegidos justo por
    // ser observaciones). Es una sola llamada por sesión, y sin nada que
    // corregir no escribe nada.
    if (gaps.length === 0 && navMigrations.length === 0 && !hasBrokerItem) { backfillRef.current = true; return }
    backfillRef.current = true

    let cancelled = false
    async function doBackfill() {
      try {
        if (cancelled) return
        // FASE GD, ANTES de rellenar: mover los NAV de broker atrapados en el
        // slot plano de la fecha a su doc paralelo. Si se rellenara primero,
        // el saveSnapshot del gap escribiría ENCIMA del NAV y lo destruiría.
        if (navMigrations.length > 0) {
          try {
            await bulkImport({ snapshots: navMigrations.map((m) => m.snap) })
            for (const m of navMigrations) {
              if (cancelled) return
              await deleteSnapshot(m.plainId)
            }
            console.info(`[nav-migration] moved ${navMigrations.length} broker NAV doc(s) to parallel ids`)
          } catch (e) { console.error('[nav-migration]', e?.message) }
        }
        if (cancelled) return
        const allLots = (lots || []).filter(l => l.quantity > 0)
        // Only ASSETS go to portfolio-history (it has no isDebt notion, so a debt
        // would be summed as a positive asset). Debt is held flat and subtracted below.
        const allAssetItems = enrichedItems.filter(it => !it.isDebt && !isExcludedFromNetWorth(it))
        // FASE HN. Con un broker conectado, su mitad del portafolio NO se
        // reconstruye: el Equity Summary del Flex ya dejó el NAV diario REAL en
        // Firestore. Así que el API solo reconstruye lo MANUAL y las dos
        // mitades se componen abajo. Antes se le pedía adivinar la cuenta del
        // broker (hold-flat, o cero antes del sello de sync: FASE HL), que es
        // de donde salían los niveles distintos día a día.
        const navByDate = buildNavByDate(snapshots)
        const composing = hasBrokerItem && navByDate.size > 0
        const assetItems = composing
          ? allAssetItems.filter((it) => it._source !== 'ibkr')
          : allAssetItems
        const currentDebtUSD = enrichedItems.reduce((s, it) => {
          if (!it.isDebt) return s
          const cur = it._originalCurrency || it.currency || 'USD'
          const v = (it.quantity || 0) * (it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0)
          return s + Math.abs(convert ? convert(v, cur, 'USD') : v)
        }, 0)
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // FASE GE: el MISMO payload transaccional que jan1Value, no una
            // versión recortada. Sin txEvents/cashFlows los docs 'backfill'
            // ignoraban el timing de los depósitos, y el YTD/TWR anclado en
            // ellos leía cada depósito a IBKR como ganancia (+27% sobre un
            // año real menor).
            items: buildHistoryItemsPayload({ items: assetItems, transactions, lots, convert }),
            lots: allLots.length > 0 ? allLots.map(l => ({
              symbol: l.symbol, quantity: l.quantity,
              acquisitionDate: l.acquisitionDate, closedDate: l.closedDate || null,
            })) : undefined,
            // FASE GD: con huecos más viejos que la ventana clásica de 30 días
            // se pide el año completo (resolución diaria en la ruta); los gaps
            // fuera del rango devuelto simplemente no matchean ningún punto.
            period: gaps.some((d) => (Date.now() - new Date(`${d}T00:00:00Z`).getTime()) > 32 * 86400000) ? 'YTD' : '1M',
          }),
        })
        if (!res.ok) {
          console.warn('[backfill] portfolio-history respondió', res.status, ': no se escribe nada esta sesión')
          return
        }
        const data = await safeJson(res)
        // FASE HJ. Una respuesta degradada (algún símbolo cayó al camino plano
        // porque su fetch de historial falló) es aceptable para MOSTRAR, nunca
        // para PERSISTIR: cada sesión puede fallar un subconjunto distinto de
        // símbolos, así que escribir estos totales deja docs 'backfill' a un
        // nivel distinto por pasada, el churn exacto del diente de sierra de
        // la vista "Todas". Acotado por PESO, no absoluto: un símbolo muerto
        // (deslistado, dust) que falla crónicamente no debe congelar el
        // backfill para siempre; solo se rehúsa cuando lo caído es una
        // fracción real del portafolio.
        if (data.degraded) {
          const failedSet = new Set((data.failedSymbols || []).map((s) => String(s).toUpperCase()))
          const failedVal = assetItems.reduce((s, it) => failedSet.has((it.symbol || '').toUpperCase()) ? s + Math.abs(getItemValue(it)) : s, 0)
          const totalVal = assetItems.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
          if (totalVal > 0 && failedVal > totalVal * 0.02) {
            console.warn('[backfill] historial degradado (', (data.failedSymbols || []).join(', '), '): no se escribe nada esta sesión')
            return
          }
        }
        const pts = data.dataPoints || []
        if (pts.length === 0) return
        // FASE GE: serie rebobinada a través del ledger real de depósitos y
        // trades (transactional:true). Un doc marcado así refleja el timing de
        // los flujos igual que un NAV real, y el YTD/TWR debe NETEARLOS contra
        // él (incluidos los _source:'ibkr'). Se escribe SIEMPRE el booleano
        // (nunca se omite): saveSnapshot fusiona con merge, y omitirlo dejaría
        // un flag viejo pegado si una corrida futura deja de ser transaccional.
        const isTransactional = !!data.transactional
        // FASE HI: fin de semana y feriados valen el último cierre de mercado
        // (la serie del API solo trae días hábiles). FASE HN: y con broker
        // conectado, cada día se COMPONE con el NAV real del broker en vez de
        // estimarlo, así que ningún día puede archivarse a un nivel que omita
        // la cuenta. Un día sin NAV disponible se salta a propósito.
        //
        // FASE HO: se compone TODA la ventana, no solo los huecos, porque la
        // composición es ahora la vara con la que se detecta un doc 'daily'
        // corrupto (los picos de fin de semana). Escribir se sigue limitando a
        // lo necesario: un hueco, o un 'daily' que contradice la composición.
        const composedAll = composeDailyTotals({
          gaps: windowDates(366), manualPoints: pts, navByDate, hasBrokerItems: composing,
        })
        const rewriteSet = new Set([
          ...gaps,
          ...divergentDailyDates(snapshots, composedAll),
        ])
        const fills = composedAll.filter((f) => rewriteSet.has(f.date))
        for (const f of fills) {
          await saveSnapshot({
            date: f.date,
            netWorthUSD: f.total - currentDebtUSD,
            totalActivosUSD: f.total,
            totalDebtUSD: currentDebtUSD,
            _source: 'backfill',
            // Un doc compuesto es tan flow-aware como un NAV real: su mitad de
            // broker ES la medición del broker (que ya contiene el efecto de
            // los depósitos) y la manual es reconstrucción transaccional.
            _transactional: f.composed ? true : isTransactional,
          })
        }
        if (fills.length > 0) {
          console.info(`[backfill] ${fills.length} día(s) escritos${composing ? ' componiendo NAV real del broker' : ''}`)
        }
      } catch (err) {
        console.error('[backfill] Failed:', err.message)
      }
    }
    doBackfill()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, pricesFetching, ratesLoading, bulkWriting, ibkrAutoSyncing, enrichedItems, snapshots, lots, transactions, saveSnapshot, convert, bulkImport, deleteSnapshot])

  // Dividend processing
  const dividendsProcessedRef = useRef(null)
  useEffect(() => {
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    if (dividendsProcessedRef.current === todayKey) return
    // pricesFetching (not just pricesLoading) guards every write here: loading
    // only ever arms on the session's FIRST price fetch (see useMarketPrices),
    // so without pricesFetching a background poll returning a transiently bad
    // price could get written straight into a permanent snapshot/transaction
    // before the next poll corrects it — the value-chart "bumps" a sync in
    // progress can leave behind.
    if (!user || dataLoading || pricesLoading || pricesFetching || ratesLoading || bulkWriting || ibkrAutoSyncing) return
    if (enrichedItems.length === 0) return
    // Demo mode: never auto-generate real dividend transactions or credit
    // balances from sample data (snapshot writers are vetoed at the data layer).
    if (enrichedItems.some((it) => it._source === 'demo')) return
    let cancelled = false

    const scheduled = enrichedItems.filter((it) =>
      (it.incomeAmount > 0 || it.incomeRate > 0 || (it.rateType === 'variable' && it.rateMin > 0) || it.rateType === 'continuous')
    )
    if (scheduled.length === 0) { dividendsProcessedRef.current = todayKey; return }

    const todayDay = now.getUTCDate()
    const currentMonth = now.getUTCMonth()

    function getEffectivePayDay(payDay, businessDayRule) {
      if (businessDayRule !== 'next_business_day') return payDay
      const testDate = new Date(Date.UTC(now.getUTCFullYear(), currentMonth, payDay))
      const dow = testDate.getUTCDay()
      if (dow === 0) return payDay + 1
      if (dow === 6) return payDay + 2
      return payDay
    }

    // FASE EL. Shared across EVERY addToDestination call in this processDividends
    // run, keyed by destination id — the running balance a second bond sharing
    // the same destination (XOCHI + CrediCorp, both into Fondo Líquido Q) needs
    // to build on instead of clobbering. See creditDestinationBalance
    // (lib/autoDividends.js) for the bug this fixes and why.
    const destRunningBalances = {}
    async function addToDestination(dest, amount, sourceCurrency) {
      const cat = getTypeCategory(dest)
      if (cat === 'stocks' || cat === 'crypto' || cat === 'funds') return
      const { newPrice } = creditDestinationBalance(destRunningBalances, dest, amount, sourceCurrency, convert)
      // Banks track their balance in purchasePrice; for bonds/alternatives purchasePrice
      // is the cost basis and must survive income payments
      const isBankDest = /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(dest.type || '')
      await updateItem(dest.id, isBankDest
        ? { currentPrice: newPrice, purchasePrice: newPrice }
        : { currentPrice: newPrice })
    }

    async function processDividends() {
      // Clean up stale auto-dividends so a previous schedule doesn't leave ghost
      // payments behind (e.g. monthly dividends lingering after switching to a
      // May+December schedule, which showed up as a staircase on the chart).
      // Any deleted payment that had been credited to a destination account must
      // also be reversed out of that account's balance — accumulate per
      // destination and apply once so the balance lands on the right figure.
      const destReversal = {}
      const queueReversal = (it, tx) => {
        if (!it.incomeDestination) return
        // Never un-credit what was never credited: backfilled payments are
        // written as history without touching the destination's balance, and
        // they carry _destinationCredited:false to say so. Older payments have
        // no flag at all and were all credited, so they still reverse.
        if (tx._destinationCredited === false) return
        const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
        if (!(amt > 0)) return
        const key = it.incomeDestination
        if (!destReversal[key]) destReversal[key] = { amount: 0, currency: tx.currency || it._originalCurrency || 'USD' }
        destReversal[key].amount += amt
      }
      for (const it of scheduled) {
        if (cancelled) return
        // Auto payments that should no longer exist: a month the schedule
        // dropped, a second auto payment in the same month, or an auto payment
        // in a month where the REAL one is already recorded. Deleting them also
        // reverses the credit out of the destination account, which is the whole
        // point: a duplicated coupon leaves the destination permanently high.
        const stale = new Set(
          redundantAutoDividendIds(transactions, it, it.incomeMonths, it.incomeMonthsExplicit === true)
        )
        if (stale.size > 0 && deleteTransaction) {
          for (const tx of transactions) {
            if (!tx.id || !stale.has(tx.id)) continue
            queueReversal(it, tx)
            await deleteTransaction(tx.id)
          }
        }
      }
      // Apply each destination's total reversal once (reading its balance fresh).
      for (const [destKey, rev] of Object.entries(destReversal)) {
        if (cancelled) return
        const dest = enrichedItems.find((d) => (d.id || d.symbol) === destKey)
        if (dest && rev.amount > 0) {
          try { await addToDestination(dest, -rev.amount, rev.currency) } catch (e) { console.error('[dividend-cleanup-reversal]', e.message) }
        }
      }

      // Repair pass: a backfilled coupon skips crediting its destination because
      // the balance the user typed is assumed to already contain it. On a
      // destination sitting at ZERO that assumption is provably false (nothing
      // is inside an empty account), and the payment ended up existing as a
      // transaction while contributing to no balance and to no month of the
      // reconstructed history. Credit it now and flip the flag, so a later
      // cleanup reverses a credit that really happened. See creditableBackfills.
      for (const it of scheduled) {
        if (cancelled) return
        const dest = it.incomeDestination
          ? enrichedItems.find((d) => (d.id || d.symbol) === it.incomeDestination)
          : null
        if (!dest) continue
        const destBalance = (dest.quantity || 1) * (dest._originalPrice ?? dest.purchasePrice ?? 0)
        const pending = creditableBackfills(transactions, it, destBalance)
        if (pending.length === 0) continue
        // One credit for the whole batch, same reason the reversal above batches:
        // addToDestination reads the balance off the item object it was handed,
        // so calling it per payment would have every call start from the SAME
        // stale balance and the last write would win instead of accumulating.
        const total = pending.reduce((s, tx) => s + Number(tx.totalAmount ?? tx.amount ?? 0), 0)
        const cur = pending[0].currency || it._originalCurrency || 'USD'
        try {
          await addToDestination(dest, total, cur)
          if (updateTransaction) {
            for (const tx of pending) {
              if (cancelled) return
              await updateTransaction(tx.id, { _destinationCredited: true })
            }
          }
        } catch (e) { console.error('[dividend-backfill-credit]', e.message) }
      }

      for (const it of scheduled) {
        if (cancelled) return
        const payMonths = Array.isArray(it.incomeMonths) ? it.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
        const canBackfill = it.incomeMonthsExplicit === true

        const monthsToCheck = []
        const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
        if (canBackfill) {
          const lookbackMonths = acqDate
            ? Math.min(24, Math.ceil((now.getTime() - acqDate.getTime()) / (30 * 86400000)))
            : 3
          for (let offset = lookbackMonths; offset >= 0; offset--) {
            const checkDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
            const checkMonth = checkDate.getUTCMonth()
            const checkYear = checkDate.getUTCFullYear()
            if (acqDate && checkDate < new Date(Date.UTC(acqDate.getFullYear(), acqDate.getMonth(), 1))) continue
            if (!payMonths.includes(checkMonth)) continue
            const payDay = it.incomePayDay || 1
            // Recortado al último día real del mes: ver clampPayDay
            // (lib/incomeSchedule.js) y el "2026-02-31" que desbordaba a marzo.
            if (offset === 0 && todayDay < clampPayDay(payDay, checkYear, checkMonth)) continue
            const dateStr = payDateFor(checkYear, checkMonth, payDay)
            // FASE HV. Un ingreso que se REINVIERTE en la propia cuenta ya está
            // adentro del saldo que el usuario tecleó: el saldo de hoy de una
            // cuenta que compone contiene todo lo que compuso hasta hoy. Backfillear
            // esos meses le suma cantidad ENCIMA del saldo real (la rama de reinvest
            // hace updateItem con quantity + newShares), así que una cuenta creada
            // hoy con calendario explícito se inflaba hasta 24 meses de interés
            // sobre un número que ya lo incluía. Solo aplica a reinvest: un bono que
            // paga a OTRA cuenta no crece por su cuenta, y su backfill de cupones
            // (el que trajo los pagos de 2025 de XOCHI) tiene que seguir corriendo.
            if (it.dividendAction === 'reinvest' && it.balanceAsOf && dateStr <= it.balanceAsOf) continue
            // offset > 0 = a month that already closed, so this is RECONSTRUCTED
            // history, not money arriving now. See the credit below.
            monthsToCheck.push({ dateStr, month: checkMonth, year: checkYear, backfill: offset > 0 })
          }
        } else {
          // Without explicit months, only process current month
          if (payMonths.includes(currentMonth)) {
            const payDay = it.incomePayDay || 1
            if (todayDay >= clampPayDay(payDay, now.getUTCFullYear(), currentMonth)) {
              const dateStr = payDateFor(now.getUTCFullYear(), currentMonth, payDay)
              monthsToCheck.push({ dateStr, month: currentMonth, year: now.getUTCFullYear(), backfill: false })
            }
          }
        }

        for (const { dateStr, backfill } of monthsToCheck) {
          if (cancelled) return
          // Dates the user explicitly said did NOT happen (asked at account
          // creation, when the schedule implied a payment already due) —
          // never fabricate history for those, however the schedule reads.
          if (Array.isArray(it.excludedPayDates) && it.excludedPayDates.includes(dateStr)) continue
          // Matched by MONTH, not by exact date. The schedule pays on
          // `incomePayDay` while a coupon recorded by hand carries the day it
          // really landed, so an exact-date check saw no payment and wrote a
          // second one, crediting the destination account twice for good.
          if (hasDividendInMonth(transactions, it, dateStr)) continue

        try {
          const originalPrice = it._originalPrice || it.currentPrice || it.purchasePrice || 0
          const qty = it.quantity || 1
          const balance = qty * originalPrice
          const incomeCurrency = it._originalCurrency || it.currency || 'USD'
          let amount = 0

          if (it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) {
            const midRate = (it.rateMin + it.rateMax) / 2
            amount = (balance * (midRate / 100)) / (payMonths.length || 12)
          } else if (it.rateType === 'continuous' && it.incomeRate > 0) {
            const annual = balance * (Math.exp(it.incomeRate / 100) - 1)
            amount = annual / 12
          } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
            amount = (balance * (it.incomeRate / 100)) / (payMonths.length || 12)
          } else if (it.incomeAmount > 0) {
            const isPerShare = /stock|etf|fund|crypto/i.test(it.type || '')
            amount = isPerShare ? it.incomeAmount * qty : it.incomeAmount
          }

          // Net recurring fees out of each payment so the income reflects what
          // actually lands after management/expense costs.
          if (amount > 0) {
            const divisor = payMonths.length || 12
            let feePerPayment = 0
            if (it.managementFee > 0) {
              feePerPayment += (it.managementFeeType === 'fixed'
                ? it.managementFee
                : balance * (it.managementFee / 100)) / divisor
            }
            if (it.expenseRatio > 0) feePerPayment += (balance * (it.expenseRatio / 100)) / divisor
            amount = Math.max(0, amount - feePerPayment)
          }

          if (amount <= 0) continue

          const isReinvest = it.dividendAction === 'reinvest'
          // FASE HV. ¿Este pago mueve el saldo de la cuenta destino, o esa
          // cuenta ya lo contiene? Con `balanceAsOf` la pregunta se contesta
          // exacto: el saldo que el usuario tecleó vale desde esa fecha, así que
          // todo pago anterior o igual ya está adentro y todo posterior es
          // dinero que llega después de la foto. Sin el campo (cuentas creadas
          // antes de que existiera) se conserva la regla vieja, "solo el mes en
          // curso acredita", tal cual estaba.
          const destForCredit = !isReinvest && it.incomeDestination
            ? enrichedItems.find((d) => (d.id || d.symbol) === it.incomeDestination)
            : null
          const credited = destForCredit?.balanceAsOf
            ? dateStr > destForCredit.balanceAsOf
            : !backfill
          await addTransaction({
            date: dateStr,
            type: 'DIVIDEND',
            symbol: it.symbol || it.name,
            description: `Dividend from ${it.name || it.symbol}`,
            totalAmount: amount,
            currency: incomeCurrency,
            _source: 'auto',
            _linkedItemId: it.id,
            ...(isReinvest ? { _reinvested: true } : {}),
            // Whether this payment also moved the destination account's stored
            // balance. Backfilled history does not (see below), so a later
            // cleanup must not "reverse" a credit that never happened.
            ...(!isReinvest && it.incomeDestination ? { _destinationCredited: credited } : {}),
          })

          if (isReinvest) {
            const priceForReinvest = originalPrice > 0 ? originalPrice : 1
            const newShares = amount / priceForReinvest
            await updateItem(it.id, { quantity: qty + newShares })
            try {
              await addLot({
                symbol: it.symbol,
                quantity: newShares,
                costBasis: priceForReinvest,
                currency: incomeCurrency,
                acquisitionDate: dateStr,
                institution: it.institution || '',
              })
            } catch (e) { console.error('[dividend-reinvest-lot]', e.message) }
          } else if (it.incomeDestination && credited) {
            // Only money arriving NOW moves the destination's balance.
            //
            // A backfilled payment is reconstructed history: the balance the
            // user typed for the destination is a figure for TODAY, so every
            // past coupon is already inside it. Crediting those again pushes
            // the account permanently above the real number (a $240 coupon
            // recorded in May left a cash account reading $480 in August, with
            // a single transaction on file to explain it). The transaction is
            // still written above, because the history is real; only the
            // balance is left alone.
            if (destForCredit) {
              await addToDestination(destForCredit, amount, incomeCurrency)
            }
          }

          if (it.capitalReturn > 0) {
            const origPrice = it._originalPrice ?? it._originalPurchasePrice ?? it.purchasePrice ?? 0
            const newPrice = Math.max(0, origPrice - it.capitalReturn)
            await updateItem(it.id, { currentPrice: newPrice, purchasePrice: newPrice })
            if (it.capitalDestination) {
              const dest = enrichedItems.find((d) => (d.id || d.symbol) === it.capitalDestination)
              if (dest) {
                await addToDestination(dest, it.capitalReturn, incomeCurrency)
              }
            }
          }
        } catch (err) {
          console.error(`[dividends] Failed for ${it.symbol}:`, err.message)
        }
        }
      }
    }

    processDividends().then(() => {
      dividendsProcessedRef.current = todayKey
    }).catch((err) => console.error('[dividends]', err))
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, pricesFetching, ratesLoading, bulkWriting, ibkrAutoSyncing, enrichedItems, transactions, addTransaction, deleteTransaction, updateTransaction, updateItem, convert])

  // handleRefresh is declared further below, right after useBenchmark() — it
  // needs refetchBenchmark in its dependency array, and that array is
  // evaluated eagerly on every render, so referencing a `const` from before
  // its own declaration here would throw (temporal dead zone), not just
  // misbehave silently.

  // IBKR auto-sync
  const { acquireLock, releaseLock } = useTabCoordination()
  const ibkrAutoSyncRef = useRef(false)
  // FASE GC. Id de la corrida de sync más reciente. El finally del auto-sync
  // apagaba el spinner solo `if (!cancelled)`, pero el efecto se re-ejecuta
  // cuando `settings` cambia y el PROPIO sync escribe settings a mitad de
  // corrida: el cleanup marcaba cancelled en la corrida en vuelo, su finally
  // se saltaba el apagado y `ibkrAutoSyncing` quedaba pegada en true para
  // siempre (pill girando sin fin; y desde FASE GB, además, los cuatro
  // escritores y la limpieza quedaban bloqueados). Con el id, CUALQUIER
  // corrida apaga el spinner al terminar salvo que una corrida más nueva ya
  // lo haya vuelto a prender.
  const ibkrSyncRunIdRef = useRef(0)

  const handleIBKRSync = useCallback(async (data, mode = 'merge', onProgress) => {
    const newItems = []
    const updateOps = []
    const newLots = []
    const deleteIds = []

    // Tag imported items with the active portfolio/entity so they're never
    // filtered out of the current view (items without these fields get hidden
    // when a specific portfolio/entity is selected).
    const tag = {}
    if (activePortfolio && activePortfolio !== '__all__') tag.portfolioId = activePortfolio
    if (activeEntity && activeEntity !== '__all__' && activeEntity !== 'default') tag.entityId = activeEntity

    if (mode === 'replace') {
      items.filter(it =>
        it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      ).forEach(it => deleteIds.push(it.id))
    }

    for (const item of data.items) {
      let existing = null
      if (mode === 'merge') {
        existing = items.find(it => {
          if (it.conid && it.conid === item.conid) return true
          const isIbkr = (it.institution || '').toLowerCase().includes('interactive brokers') || it._source === 'ibkr'
          if (!isIbkr) return false
          if ((it.symbol || '').toUpperCase() !== item.symbol) return false
          if (item._ibkrAccountId && it._ibkrAccountId && item._ibkrAccountId !== it._ibkrAccountId) return false
          return true
        })
      }
      if (existing) {
        updateOps.push({
          id: existing.id,
          fields: {
            currentPrice: item.currentPrice,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            conid: item.conid,
            _ibkrAccountId: item._ibkrAccountId,
            _source: 'ibkr',
            // Repair the acquisition date when the incoming (real trade) date is
            // earlier than what's stored — fixes positions previously stamped with
            // the import date, which collapsed historical share counts to zero.
            ...(item.acquisitionDate && (!existing.acquisitionDate || new Date(item.acquisitionDate) < new Date(existing.acquisitionDate))
              ? { acquisitionDate: item.acquisitionDate } : {}),
          },
        })
      } else {
        newItems.push({ ...item, ...tag })
        if (item.quantity > 0 && item.purchasePrice > 0 && item.type !== 'Bank') {
          newLots.push({
            symbol: item.symbol,
            quantity: item.quantity,
            costBasis: item.purchasePrice,
            currency: item.currency || 'USD',
            acquisitionDate: item.acquisitionDate || new Date().toLocaleDateString('en-CA'),
            institution: item.institution || 'Interactive Brokers',
            ...(tag.portfolioId ? { portfolioId: tag.portfolioId } : {}),
          })
        }
      }
    }

    // FASE FU. El NAV real del broker se guarda SIEMPRE. La regla vieja ("una
    // fecha ocupada por el snapshot diario completo solo acepta el NAV si es
    // mayor") descartaba casi TODO el Equity Summary: el usuario abre la app a
    // diario, así que casi cada fecha tenía doc 'daily' (~portafolio completo,
    // siempre mayor que una sola cuenta) y la vista escopada a IBKR quedaba
    // dibujada con reconstrucción estimada en vez de los números del broker.
    // planEquitySnapshotWrites resuelve la colisión escribiendo un doc
    // PARALELO (`fecha~nav~ibkr`) cuando la fecha la ocupa una observación
    // completa; preferFullPortfolioPerDay mantiene la vista "Todas" usando la
    // observación completa, así que el twin-spike que la regla vieja evitaba
    // no puede volver. La conversión usa el FX actual (no hay FX histórico):
    // aproximación, pero muchísimo mejor que tratar EUR/etc. como USD.
    const toUSDFrom = (v, cur) => (cur && cur !== 'USD' && convert ? convert(v || 0, cur, 'USD') : (v || 0))
    const newSnaps = planEquitySnapshotWrites(data.equityHistory || [], snapshots, toUSDFrom)

    const incomingSymbols = new Set(data.items.filter(it => it.symbol).map(it => it.symbol.toUpperCase()))
    items.forEach(it => {
      if (deleteIds.includes(it.id)) return
      const isIbkr = it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      if (isIbkr && (it.quantity ?? 0) <= 0 && incomingSymbols.has((it.symbol || '').toUpperCase())) {
        deleteIds.push(it.id)
      }
    })
    const deleteSet = new Set(deleteIds)
    const afterCleanup = items.filter(it => !deleteSet.has(it.id))
    afterCleanup.forEach(it => {
      if (it._source === 'ibkr') return
      const sym = (it.symbol || '').toUpperCase()
      if (!sym) return
      const ibkrMatch = afterCleanup.find(other =>
        other.id !== it.id && other._source === 'ibkr' && (other.symbol || '').toUpperCase() === sym
      )
      if (ibkrMatch && (it.quantity ?? 0) <= 0) deleteIds.push(it.id)
    })

    await bulkImport({
      items: newItems,
      lots: newLots,
      transactions: data.transactions || [],
      snapshots: newSnaps,
      updateItems: updateOps,
      deleteIds,
    }, onProgress)

    // Persist a forensic summary of THIS sync (any path: modal, header pill, auto).
    // The chart banner and the sync card read it, so a single screenshot always
    // shows what the Flex XML delivered vs what got imported.
    try {
      const eqH = data.equityHistory || []
      const txAll = data.transactions || []
      const tc = (types) => txAll.filter((t) => types.includes((t.type || '').toUpperCase())).length
      const nextSummary = {
        at: new Date().toISOString(),
        items: (data.items || []).length,
        equityDays: eqH.length,
        equityOldest: eqH.reduce((min, e) => (!min || (e.date && e.date < min)) ? e.date : min, null),
        trades: tc(['BUY', 'SELL']),
        flows: tc(['DEPOSIT', 'WITHDRAWAL']),
        dividends: tc(['DIVIDEND']),
        fees: tc(['FEE', 'TAX', 'INTEREST']),
        sections: data.sections || null,
      }
      saveSettings({ _ibkrLastSyncSummary: { ...nextSummary, changes: ibkrSyncChanges(settings?._ibkrLastSyncSummary, nextSummary) } })
    } catch {}
  }, [items, snapshots, bulkImport, activePortfolio, activeEntity, saveSettings])

  // TOKEN_EXPIRED / INVALID_QUERY need user action (regenerate token / fix query),
  // so they permanently halt auto-sync. LOCKED is TEMPORARY — IBKR unlocks the token
  // on its own after a cooldown — so it is NOT fatal; instead auto-sync retries it on
  // a long cadence (below) and a success clears the banner. Treating LOCKED as fatal
  // used to deadlock the sync: it could never self-heal and the red banner stuck over
  // fresh data forever.
  const FATAL_ERROR_CODES = ['TOKEN_EXPIRED', 'INVALID_QUERY']

  useEffect(() => {
    if (dataLoading) return
    // Proceed if there's a legacy client-stored token OR creds already migrated to
    // the server vault (_ibkrVaultMigrated), as long as a query id exists.
    if ((!settings?.ibkrToken && !settings?._ibkrVaultMigrated) || !settings?.ibkrQueryId) return
    if (FATAL_ERROR_CODES.includes(settings?._ibkrAutoSyncErrorCode)) {
      ibkrAutoSyncRef.current = false
      return
    }
    if (ibkrAutoSyncRef.current) return
    ibkrAutoSyncRef.current = true
    // After a LOCKED error, back off to a long cadence so we let IBKR's temporary
    // lock expire (retrying too soon can refresh it) — but still retry, so a working
    // token self-heals and the banner clears without manual action.
    const isLocked = settings?._ibkrAutoSyncErrorCode === 'LOCKED'
    const SYNC_INTERVAL = isLocked ? 12 * 60 * 60 * 1000 : 30 * 60 * 1000
    // Space attempts by the LAST ATTEMPT, not the last success — otherwise every
    // page load while in an error state fired another immediate try, hammering
    // IBKR with failed logins (which is what triggers its lockout).
    const lastSync = settings._ibkrLastAutoSync ? new Date(settings._ibkrLastAutoSync).getTime() : 0
    const lastAttempt = settings._ibkrLastAutoSyncAttempt ? new Date(settings._ibkrLastAutoSyncAttempt).getTime() : 0
    const shouldSync = Date.now() - Math.max(lastSync, lastAttempt) > SYNC_INTERVAL

    let cancelled = false
    const doAutoSync = async () => {
      if (cancelled || !acquireLock('ibkr-sync')) return
      const runId = ++ibkrSyncRunIdRef.current
      setIbkrAutoSyncing(true)
      try {
        const { syncIBKR } = await import('@/lib/ibkrSync')
        let token = '__stored__'
        if (settings.ibkrToken) {
          // Legacy client-encrypted token: decrypt it for this run AND migrate it
          // into the server vault (encrypted server-side with the master key), then
          // drop the weak client copy. Best-effort — sync still runs if migration fails.
          const { decryptToken } = await import('@/lib/crypto')
          token = await decryptToken(settings.ibkrToken, user?.uid)
          try {
            await authFetch('/api/brokers/ibkr', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'save-credentials', token, queryId: settings.ibkrQueryId }),
            })
            saveSettings({ ibkrToken: null, _ibkrVaultMigrated: true })
          } catch (e) { console.error('[ibkr] vault migration failed (will retry next sync):', e?.message) }
        }
        const data = await syncIBKR(token, settings.ibkrQueryId)
        if (cancelled) return
        await handleIBKRSync(data, 'merge')
        const eq = data?.equityHistory || []
        const txs = data?.transactions || []
        const typeCount = (types) => txs.filter((t) => types.includes((t.type || '').toUpperCase())).length
        const autoSummary = {
          at: new Date().toISOString(),
          items: data?.items?.length || 0,
          equityDays: eq.length,
          equityOldest: eq.reduce((min, e) => (!min || (e.date && e.date < min)) ? e.date : min, null),
          trades: typeCount(['BUY', 'SELL']),
          flows: typeCount(['DEPOSIT', 'WITHDRAWAL']),
          dividends: typeCount(['DIVIDEND']),
          fees: typeCount(['FEE', 'TAX', 'INTEREST']),
          sections: data?.sections || null,
        }
        saveSettings({
          _ibkrLastAutoSync: new Date().toISOString(),
          _ibkrAutoSyncStatus: 'ok',
          _ibkrAutoSyncError: null,
          _ibkrAutoSyncErrorCode: null,
          _ibkrLastSyncSummary: { ...autoSummary, changes: ibkrSyncChanges(settings?._ibkrLastSyncSummary, autoSummary) },
        })
      } catch (err) {
        if (cancelled) return
        const code = err.errorCode || 'UNKNOWN'
        saveSettings({
          _ibkrAutoSyncStatus: 'error',
          _ibkrAutoSyncError: err.message,
          _ibkrAutoSyncErrorCode: code,
          _ibkrLastAutoSyncAttempt: new Date().toISOString(),
        })
      } finally {
        // SIEMPRE, aunque cancelled: la bandera es estado del hook (vive entre
        // re-ejecuciones del efecto) y dejarla prendida congela el pipeline.
        if (ibkrSyncRunIdRef.current === runId) setIbkrAutoSyncing(false)
        releaseLock('ibkr-sync')
      }
    }

    if (shouldSync) doAutoSync()
    const interval = setInterval(doAutoSync, SYNC_INTERVAL)
    return () => { cancelled = true; clearInterval(interval) }
  }, [dataLoading, settings, user, handleIBKRSync, saveSettings])

  // Manual, on-demand IBKR sync that runs in the BACKGROUND (no blocking modal). Same
  // path as the auto-sync above (syncIBKR '__stored__' → handleIBKRSync('merge')) but
  // forced now, ignoring the cadence gate. The header pill spins via ibkrAutoSyncing;
  // the caller (page.jsx) toasts the outcome. Returns { ok, count } / { ok:false, error }.
  const triggerIBKRSync = useCallback(async () => {
    if ((!settings?.ibkrToken && !settings?._ibkrVaultMigrated) || !settings?.ibkrQueryId) {
      return { ok: false, error: 'NOT_CONNECTED' }
    }
    if (!acquireLock('ibkr-sync')) return { ok: false, error: 'BUSY' }
    const runId = ++ibkrSyncRunIdRef.current
    setIbkrAutoSyncing(true)
    try {
      const { syncIBKR } = await import('@/lib/ibkrSync')
      let token = '__stored__'
      if (settings.ibkrToken) {
        const { decryptToken } = await import('@/lib/crypto')
        token = await decryptToken(settings.ibkrToken, user?.uid)
        try {
          await authFetch('/api/brokers/ibkr', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save-credentials', token, queryId: settings.ibkrQueryId }),
          })
          saveSettings({ ibkrToken: null, _ibkrVaultMigrated: true })
        } catch (e) { console.error('[ibkr] vault migration failed (manual sync):', e.message) }
      }
      const data = await syncIBKR(token, settings.ibkrQueryId)
      await handleIBKRSync(data, 'merge')
      saveSettings({
        _ibkrLastAutoSync: new Date().toISOString(),
        _ibkrLastSync: new Date().toISOString(),
        _ibkrAutoSyncStatus: 'ok',
        _ibkrAutoSyncError: null,
        _ibkrAutoSyncErrorCode: null,
      })
      // Surface how much VALUE HISTORY the Flex actually delivered: the whole
      // "returns don't match the broker" class of bugs came down to a short query
      // period, and the background toast was the only feedback channel that never
      // said so.
      const eq = data?.equityHistory || []
      const equityOldest = eq.reduce((min, e) => (!min || (e.date && e.date < min)) ? e.date : min, null)
      const txs = data?.transactions || []
      const typeCount = (types) => txs.filter((t) => types.includes((t.type || '').toUpperCase())).length
      const summary = {
        at: new Date().toISOString(),
        items: data?.items?.length || 0,
        equityDays: eq.length,
        equityOldest: equityOldest || null,
        trades: typeCount(['BUY', 'SELL']),
        flows: typeCount(['DEPOSIT', 'WITHDRAWAL']),
        dividends: typeCount(['DIVIDEND']),
        fees: typeCount(['FEE', 'TAX', 'INTEREST']),
        sections: data?.sections || null,
      }
      // Persisted so the diagnosis survives the 7-second toast: the chart banner
      // and the IBKR modal render this, and any screenshot then tells us whether
      // the Flex XML carried each section and whether the import kept it.
      const changes = ibkrSyncChanges(settings?._ibkrLastSyncSummary, summary)
      saveSettings({ _ibkrLastSyncSummary: { ...summary, changes } })
      return { ok: true, count: summary.items, equityDays: summary.equityDays, equityOldest: summary.equityOldest, trades: summary.trades, flows: summary.flows, dividends: summary.dividends, fees: summary.fees, changes }
    } catch (err) {
      const code = err.errorCode || 'UNKNOWN'
      saveSettings({
        _ibkrAutoSyncStatus: 'error',
        _ibkrAutoSyncError: err.message,
        _ibkrAutoSyncErrorCode: code,
        _ibkrLastAutoSyncAttempt: new Date().toISOString(),
      })
      return { ok: false, error: err.message, errorCode: code }
    } finally {
      if (ibkrSyncRunIdRef.current === runId) setIbkrAutoSyncing(false)
      releaseLock('ibkr-sync')
    }
  }, [settings, user, authFetch, saveSettings, handleIBKRSync, acquireLock, releaseLock])

  // Derived values
  // IBKR-only snapshots omit manually-added assets; augment them with the held-flat
  // value of non-IBKR items so returns/changes below reflect the FULL portfolio.
  // (The growth chart and spreadsheet get the raw snapshots and do their own thing.)
  // FASE FU: con los docs paralelos de NAV (`fecha~nav~ibkr`) una fecha puede
  // traer la observación completa Y el NAV del broker; todo lo que mide el
  // portafolio ENTERO (anclas YTD/MTD, drawdown, insights) debe seguir usando
  // la observación completa, exactamente como antes de que los docs paralelos
  // existieran. Un día que solo tiene NAV de broker se queda y el augment lo
  // completa, comportamiento de siempre.
  const augmentedSnapshots = useMemo(
    () => augmentSnapshots(preferFullPortfolioPerDay(snapshots), portfolioItems, convert),
    [snapshots, portfolioItems, convert]
  )
  const latestSnapshot = augmentedSnapshots.length > 0 ? augmentedSnapshots[augmentedSnapshots.length - 1] : null

  const { totalFromItems, totalDebt: liveDebt } = useMemo(() => {
    let assets = 0, debt = 0
    portfolioItems.forEach(it => {
      // Skip receivables the user explicitly excluded from net worth
      if (isExcludedFromNetWorth(it)) return
      // getItemValue honors illiquid manual valuations and returns signed values
      const val = getItemValue(it)
      if (it.isDebt) debt += Math.abs(val)
      else assets += val
    })
    return { totalFromItems: assets, totalDebt: debt }
  }, [portfolioItems])

  const convertSnapshot = useCallback((val) => convert(val, 'USD', baseCurrency), [convert, baseCurrency])

  const totalAssets = useMemo(() =>
    totalFromItems > 0 ? totalFromItems : (latestSnapshot ? convertSnapshot(latestSnapshot.totalActivosUSD ?? 0) : 0),
    [totalFromItems, latestSnapshot, convertSnapshot]
  )
  const netWorth = totalAssets - liveDebt

  // "HOY" = what TODAY did, built from today's own events instead of a
  // snapshot-to-snapshot diff.
  //
  // The old version was `netWorth - prevSnapshot - netFlowsSincePrevSnapshot`,
  // which quietly turned bookkeeping into profit: entering a position you have
  // held since January (or backfilling its history) makes today's net worth
  // jump by the whole balance while yesterday's snapshot knows nothing about
  // it, and the flow-netting missed it because the deposit is DATED in January,
  // not today. A $6,000 bond typed in this afternoon read as "+$6,119.62 today
  // (+60.94%)" while the movers list right below it added up to about $58.
  //
  // Today's real change has exactly two parts:
  //   1. Prices that moved today: Σ value × change1d (the same numbers the
  //      "biggest movers" list shows, so the card finally agrees with itself).
  //   2. Income that LANDED today: a coupon or dividend credited today is a
  //      genuine gain on its payment date, and only on that date. VITALI's $240
  //      belongs to May 15 and to December 15, never to whatever day it happens
  //      to get typed in.
  // New capital never appears in either, so a deposit can't masquerade as gain.
  // The math itself is a pure helper (computeDayChange) so it can be tested.
  const dailyChange = useMemo(
    () => computeDayChange({ items: portfolioItems, transactions, netWorth, convert, baseCurrency }),
    [netWorth, portfolioItems, transactions, convert, baseCurrency]
  )

  const yearlyChange = useMemo(() => {
    if (augmentedSnapshots.length < 2) return null
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    let yearAgoSnapshot = null
    for (let i = augmentedSnapshots.length - 1; i >= 0; i--) {
      if (augmentedSnapshots[i].date && new Date(augmentedSnapshots[i].date) <= oneYearAgo) { yearAgoSnapshot = augmentedSnapshots[i]; break }
    }
    if (!yearAgoSnapshot) return null
    const prev = convertSnapshot(yearAgoSnapshot.netWorthUSD ?? yearAgoSnapshot.totalActivosUSD ?? 0)
    if (prev === 0) return null
    return ((netWorth - prev) / prev) * 100
  }, [augmentedSnapshots, netWorth, convertSnapshot])

  const [jan1Value, setJan1Value] = useState(null)
  // WHEN jan1Value is the value of. It is the first point of the YTD series with
  // a non-zero total, which is NOT always Jan 1: a position acquired mid-year
  // (a bond bought Jan 6) makes every earlier point legitimately 0, so the first
  // real point is the day the money arrived. Measuring Dietz from Jan 1 while
  // the start VALUE is really Jan 6's then subtracts the very deposit that
  // created it: a $6,000 bond funded with a $6,098 deposit read as
  // -$6,098 (-51%) YTD on a portfolio that had not moved a cent (FASE DV).
  // The anchor's date has to travel with the anchor's value.
  const [jan1Ts, setJan1Ts] = useState(null)
  // True when jan1Value came from a TRANSACTIONAL reconstruction (rewound through
  // imported deposits/buys/sells): that baseline reflects real flow timing, so the
  // YTD Dietz must net the flows like it would against a real snapshot anchor.
  const [jan1Transactional, setJan1Transactional] = useState(false)
  // Per-holding value at the first and last point of the YTD series, straight
  // from the same engine that produced jan1Value. Feeds the "what drove my YTD"
  // breakdown, so the parts are guaranteed to reconcile with the headline.
  const [ytdEndpoints, setYtdEndpoints] = useState(null)
  useEffect(() => {
    if (!enrichedItems || enrichedItems.length === 0) return
    let cancelled = false
    async function fetchJan1() {
      try {
        const allLots = (lots || []).filter(l => l.quantity > 0)
        // Reconstruct the SAME portfolio that netWorth (endValue) measures — same
        // predicate as the chart (PortfolioGrowthChart) and the netWorth loop. Sending
        // raw enrichedItems here included excluded/debt items (e.g. an IBKR bank line)
        // that received the whole BUY/SELL ledger and got rewound strongly negative,
        // collapsing jan1Value while netWorth excluded it → the YTD Dietz exploded
        // (start and end measuring different portfolios).
        const jan1Items = enrichedItems.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: buildHistoryItemsPayload({ items: jan1Items, transactions, lots, convert }),
            lots: allLots.length > 0 ? allLots.map(l => ({
              symbol: l.symbol, quantity: l.quantity,
              acquisitionDate: l.acquisitionDate,
              closedDate: l.closedDate || null,
            })) : undefined,
            period: 'YTD',
            breakdown: true,
          }),
        })
        if (!res.ok || cancelled) return
        const data = await safeJson(res)
        const pts = data.dataPoints || []
        if (pts.length > 0) {
          const firstReal = pts.find(p => p.total > 0)
          if (!cancelled && firstReal) {
            const val = (baseCurrency !== 'USD' && convert)
              ? convert(firstReal.total, 'USD', baseCurrency)
              : firstReal.total
            setJan1Value(val)
            setJan1Ts(Number.isFinite(firstReal.ts) ? firstReal.ts : null)
            setJan1Transactional(!!data.transactional)
          }
          // The breakdown is only published when its start point IS the anchor
          // the headline used. jan1Value takes the first point with a real
          // total, which can be later than the first point of the series; if
          // the two disagree, the parts would not add up to the number they
          // claim to explain, and a breakdown that does not reconcile is worse
          // than none.
          const withKeys = pts.filter((p) => p.byKey)
          if (!cancelled && withKeys.length >= 2 && firstReal && withKeys[0].ts === firstReal.ts) {
            const toBase = (v) => (baseCurrency !== 'USD' && convert) ? convert(v, 'USD', baseCurrency) : v
            const scale = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toBase(v)]))
            setYtdEndpoints({
              start: scale(withKeys[0].byKey),
              end: scale(withKeys[withKeys.length - 1].byKey),
            })
          } else if (!cancelled) {
            setYtdEndpoints(null)
          }
        }
      } catch {}
    }
    fetchJan1()
    return () => { cancelled = true }
  }, [enrichedItems, lots, transactions, convert, baseCurrency])

  // Whether the auto-imported IBKR cash flows (_source:'ibkr') enter the Dietz math
  // depends on the SOURCE of the start anchor:
  // - Real snapshot anchor (ibkr/daily/manual): the NAV already reflects deposits and
  //   withdrawals, so the flows MUST be netted out or every withdrawal reads as a
  //   market loss (bug: our TWR showed +1.98% vs IBKR's +10.99%).
  // - Reconstructed baseline (jan1Value hold-flat, 'backfill' snapshots): the current
  //   quantity is held flat backwards, which pre-dates deposits implicitly, so
  //   subtracting the flows again double-counts. Exclude them there.
  // Manual deposits (no _source:'ibkr') always count.
  const dietzTransactions = useMemo(
    // Inferred flows carry the same "real account-level money movement"
    // semantics as a synced ibkr transaction, so a hold-flat baseline that
    // pre-dates deposits implicitly must exclude them too, for the same
    // double-count reason ibkr transactions are excluded here.
    () => (transactions || []).filter((tx) => tx._source !== 'ibkr' && tx._source !== 'inferred_flow'),
    [transactions]
  )
  // A transcribed quarter-end NAV is a real broker observation too: it already
  // contains deposits and withdrawals, so the Dietz must net the flows against
  // it exactly like a synced NAV.
  const REAL_SNAPSHOT_SOURCES = ['ibkr', 'ibkr_quarterly', 'daily', 'manual']

  // A per-account calibration holds ONE account's solved value, which is why it
  // is kept out of the NAV series. But the user typed those percentages off the
  // broker's screen precisely so the curve would stop guessing, and a number
  // nothing reads is a number that was typed for nothing.
  //
  // So the 1W/1M/3M/1Y anchors are turned into PORTFOLIO values once, here,
  // with the same helper the YTD math uses (swap the account's estimated share
  // of that date for the solved one) and handed to the chart. 'ytd' and 'all'
  // are deliberately excluded: the returns memo below applies those itself, and
  // applying them twice would count the correction twice. Anchors are only
  // added where no real observation exists: a real one always wins.
  const chartSnapshots = useMemo(() => {
    // 'day' and 'mtd' (FASE GI) ride the same rail as the other chart-only
    // kinds: a solved yesterday-close / month-start value is a portfolio point
    // like any other, added only where no real observation exists.
    const CHART_ONLY_KINDS = new Set(['day', '1w', 'mtd', '1m', '3m', '1y'])
    const extra = []
    for (const cal of accountCalibrations) {
      if (!CHART_ONLY_KINDS.has(cal._calibrationKind)) continue
      if ((snapshots || []).some((s) => s.date === cal.date && !s._calibrated)) continue
      const anchorTs = new Date(`${cal.date}T00:00:00Z`).getTime()
      if (!isFinite(anchorTs)) continue
      const combined = combineAccountCalibrations({
        baseValueUSD: null, anchorTs, calibrations: [cal], items: portfolioItems, convert,
      })
      const v = combined?.startValueUSD
      if (v == null || !isFinite(v) || v <= 0) continue
      extra.push({
        id: `cal~${cal._calibrationKind}~${cal.date}`,
        date: cal.date, netWorthUSD: v, totalActivosUSD: v,
        _source: 'manual', _calibrated: true,
      })
    }
    if (extra.length === 0) return snapshots
    return [...snapshots, ...extra].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [accountCalibrations, snapshots, portfolioItems, convert])

  const { returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdCalibrated, ytdStartValue, ytdStartTs, ytdFlowsUsed } = useMemo(() => {
    const year = new Date().getUTCFullYear()
    const yearStartTs = Date.UTC(year, 0, 1)
    const todayStr = new Date().toISOString().split('T')[0]
    const ytdCals = accountCalibrations.filter((c) => c._calibrationKind === 'ytd' && c.date <= todayStr)
    const allCals = accountCalibrations.filter((c) => c._calibrationKind === 'all' && c.date <= todayStr)
    const toUSD = (v) => convert(v, baseCurrency, 'USD')
    let startVal = null
    let flowAware = false
    let anchorUSD = null
    let anchorCalibrated = false
    // When the start value is not actually Jan 1's, the window starts where the
    // value does (see jan1Ts). Only ever moves FORWARD from Jan 1.
    let startTs = yearStartTs
    if (augmentedSnapshots.length >= 2) {
      // Shared anchor (also used by the chart's YTD starting point) so the
      // Dietz badge and the chart never start the year from different values.
      const bestSnap = findYearStartAnchor(augmentedSnapshots, year)
      if (bestSnap) {
        anchorUSD = bestSnap.netWorthUSD ?? bestSnap.totalActivosUSD ?? 0
        startVal = convertSnapshot(anchorUSD)
        // FASE GE: un doc 'backfill' TRANSACCIONAL (rebobinado a través del
        // ledger real de depósitos/trades, ver el efecto de backfill) refleja
        // el timing de los flujos igual que un NAV real: las compras de mitad
        // de año NO existen en su valor de enero, así que los depósitos que
        // las fondearon son posteriores al ancla y DEBEN netearse. La regla
        // vieja (solo fuentes reales) venía del mundo hold-flat puro, donde el
        // depósito ya vivía dentro del valor de arranque; aplicada a un
        // backfill lot-aware leía cada depósito a IBKR como ganancia.
        flowAware = REAL_SNAPSHOT_SOURCES.includes(bestSnap._source) || !!bestSnap._transactional
        anchorCalibrated = !!bestSnap._calibrated
      }
    }
    if (startVal == null || startVal <= 0) {
      startVal = jan1Value
      flowAware = jan1Transactional
      if (jan1Ts != null && jan1Ts > yearStartTs) startTs = jan1Ts
    }

    // Per-account calibration: swap each calibrated account's ESTIMATED share
    // of the year-start anchor for the start value solved from the % that
    // broker's own app shows. A single % for the whole portfolio cannot
    // represent accounts with different returns (that mix is what clamped the
    // badge at ±200%).
    let ytdCalApplied = false
    if (ytdCals.length > 0) {
      const baseUSD = (anchorUSD != null && anchorUSD > 0)
        ? anchorUSD
        : (startVal != null && startVal > 0 ? toUSD(startVal) : null)
      const combined = combineAccountCalibrations({
        baseValueUSD: baseUSD, anchorTs: yearStartTs,
        calibrations: ytdCals, items: portfolioItems, convert,
      })
      if (combined && isFinite(combined.startValueUSD) && combined.startValueUSD > 0) {
        startVal = convertSnapshot(combined.startValueUSD)
        flowAware = true
        ytdCalApplied = true
      }
    }

    let returnSinceStart = null
    let sinceStartDate = null
    if ((startVal == null || startVal <= 0) && augmentedSnapshots.length >= 2) {
      const sorted = [...augmentedSnapshots]
        .filter(s => s.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
      const first = sorted.find(s => (s.netWorthUSD ?? s.totalActivosUSD ?? 0) > 0)
      if (first) {
        const firstUSD = first.netWorthUSD ?? first.totalActivosUSD ?? 0
        let firstVal = convertSnapshot(firstUSD)
        let firstFlowAware = REAL_SNAPSHOT_SOURCES.includes(first._source) || !!first._transactional
        // Same per-account swap for the since-inception anchor.
        const cals = allCals.filter((c) => c.date <= first.date)
        if (cals.length > 0) {
          const combined = combineAccountCalibrations({
            baseValueUSD: firstUSD > 0 ? firstUSD : null,
            anchorTs: new Date(first.date).getTime(),
            calibrations: cals, items: portfolioItems, convert,
          })
          if (combined && isFinite(combined.startValueUSD) && combined.startValueUSD > 0) {
            firstVal = convertSnapshot(combined.startValueUSD)
            firstFlowAware = true
          }
        }
        if (firstVal > 0 && netWorth > 0) {
          const firstTs = new Date(first.date).getTime()
          const { pct, abs } = computeModifiedDietz({
            startValue: firstVal, endValue: netWorth,
            startTs: firstTs, endTs: Date.now(),
            transactions: firstFlowAware ? transactions : dietzTransactions,
            convert, baseCurrency,
          })
          returnSinceStart = Math.max(-200, Math.min(200, pct))
          sinceStartDate = first.date
          if (startVal == null || startVal <= 0) {
            startVal = firstVal
            flowAware = firstFlowAware
            // Same rule as jan1Ts: this value is the FIRST snapshot's, which is
            // usually well after Jan 1, so the YTD window starts there too.
            if (firstTs > yearStartTs) startTs = firstTs
          }
        }
      }
    }

    const calibrated = ytdCalApplied || anchorCalibrated
    if (startVal == null || startVal <= 0) return { returnYTD: null, ytdChange: null, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated, ytdStartValue: null, ytdStartTs: null, ytdFlowsUsed: null }
    let ytdFlows = flowAware ? transactions : dietzTransactions
    // Denominator override: stays null unless the anchor moved and the capital
    // that created it was larger than the value it bought (see below).
    // ⛔ LÓGICA CONGELADA (C). Este bloque (jan1Ts + ytdCostBase) es la version
    // YTD de la misma formula de las tarjetas. Antes de tocarlo, leer
    // lib/assetLogic/corporateBondWithEntryFee.js y seguir el protocolo de su
    // cabecera: hay que PREGUNTAR antes de cambiarlo. En corto: la comision va
    // en el DENOMINADOR y solo ahi. Subir startVal en su lugar la mete tambien
    // en el numerador y devuelve el 2.33% que ese archivo documenta como bug.
    let ytdCostBase = null
    // The anchor moved off Jan 1 because that is where the money first appeared,
    // so the flow that PUT it there is already inside startVal. Dietz counts a
    // flow dated exactly on startTs (`txTs >= startTs`), so moving the window is
    // not enough on its own: the flows at or before the anchor have to go too,
    // or the deposit is subtracted from a start value that already contains it.
    if (startTs > yearStartTs) {
      let droppedIn = 0
      ytdFlows = (ytdFlows || []).filter((tx) => {
        const txTs = tx.date ? new Date(tx.date).getTime() : NaN
        if (!isFinite(txTs) || txTs > startTs) return true
        const ty = (tx.type || '').toUpperCase()
        const amt = convert
          ? convert(Number(tx.totalAmount ?? 0), tx.currency || 'USD', baseCurrency || 'USD')
          : Number(tx.totalAmount ?? 0)
        if (isFinite(amt)) droppedIn += ty === 'DEPOSIT' ? amt : ty === 'WITHDRAWAL' ? -amt : 0
        return false
      })
      // Those dropped deposits ARE the capital that created startVal, and they
      // can exceed the value they bought: an opening deposit carries the entry
      // fee (6,098 into a 6,000 bond). That fee belongs in the DENOMINATOR only.
      // Raising startVal instead puts it on both sides and charges it twice, as
      // a capital loss in the numerator AND as a bigger base — the exact error
      // the VITALI reference case in CLAUDE.md warns about, which lands on
      // 2.33% instead of 3.94%. So the gain keeps measuring against the value
      // (240), and only the base it divides by becomes the all-in cost.
      if (droppedIn > startVal) ytdCostBase = droppedIn
    }
    const { pct, abs } = computeModifiedDietz({
      startValue: startVal, endValue: netWorth,
      startTs, endTs: Date.now(),
      transactions: ytdFlows, convert, baseCurrency,
    })
    // With every flow dropped, Dietz's weighted capital IS startVal, so swapping
    // the base is just re-dividing the same gain. This is the one place the
    // headline can be made to agree, to the decimal, with AssetAllocation and
    // InstitutionPerformance, which have always divided by all-in cost.
    const effPct = (ytdCostBase > 0 && startVal > 0) ? (abs / ytdCostBase) * 100 : pct
    const clampedPct = Math.max(-200, Math.min(200, effPct))
    // FASE GR, purely additive: the three terms this memo measured with, handed
    // out unchanged so the "where your YTD comes from" panel can partition the
    // SAME quantities instead of rebuilding its own version of them (which is
    // how it ended up contradicting this very number). No value computed above
    // is touched; nothing here alters the frozen YTD formula.
    return { returnYTD: clampedPct, ytdChange: abs, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated, ytdStartValue: startVal, ytdStartTs: startTs, ytdFlowsUsed: ytdFlows }
  }, [jan1Value, jan1Ts, jan1Transactional, netWorth, transactions, dietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot, accountCalibrations, portfolioItems])

  // FASE GR3: per-account year-start values from the SPREADSHEET's own monthly
  // reconstruction -- the engine (lib/historicalValues.js) the user validated as
  // correct end to end, and the only one that rebuilds a manual account from its
  // real balance events (an opening deposit, a reinvested coupon) instead of
  // holding it flat. December of the previous year is the right column: those
  // snapshots are month-END values, so Dec 31 is one day off the Jan 1 anchor,
  // while January's column would be a full month late.
  //
  // Purely an input upgrade: these are still ESTIMATES and are still pinned to
  // the anchor the headline used, so a better shape here just means less
  // stretching, never a number that escapes the reconciliation guarantee.
  const [spreadsheetStart, setSpreadsheetStart] = useState(null)
  // Read through a ref and key the effect on a CONTENT signature, never on the
  // array identity: portfolioItems is rebuilt on every price tick, so depending
  // on it would re-read Firestore every few seconds forever (the exact disease
  // FASE DW/DY documents). Only which items exist and which account each one
  // belongs to can change this result.
  const portfolioItemsRef = useRef(portfolioItems)
  portfolioItemsRef.current = portfolioItems
  const accountMembershipSig = useMemo(
    () => (portfolioItems || []).map((it) => `${it.id}:${accountKeyOfItem(it) || ''}:${it.isDebt ? 1 : 0}`).sort().join('|'),
    [portfolioItems]
  )
  useEffect(() => {
    const portfolioItems = portfolioItemsRef.current
    if (!loadItemSnapshots || dataLoading || !portfolioItems || portfolioItems.length === 0) return
    let cancelled = false
    const key = `${new Date().getFullYear() - 1}-12`
    ;(async () => {
      try {
        const data = await loadItemSnapshots([key])
        if (cancelled || !data) return
        const { __currencies = {} } = data
        const monthItems = data[key]
        if (!monthItems || Object.keys(monthItems).length === 0) { setSpreadsheetStart(null); return }
        const savedCur = __currencies[key]
        const byItem = {}
        Object.entries(monthItems).forEach(([itemId, v]) => {
          const owner = portfolioItems.find((it) => it && it.id === itemId)
          // Synthetic buckets (the IBKR per-institution key) own no item, and
          // IBKR takes its real broker NAV anyway.
          if (!owner) return
          // Taken ONLY where the Spreadsheet is the authority: an asset whose
          // value moves by BALANCE EVENTS (a deposit, a reinvested coupon),
          // which it rebuilds exactly. For a market-priced holding the right
          // source is the historical PRICE series, not this: the Spreadsheet
          // holds those flat when it has no price and flags the value
          // `estimated`, and taking that flat figure as the year-start made
          // LEGDER (crypto) read -$40 against its own chart's -$667.
          if (isMarketPriced(owner) || v?.estimated) return
          const raw = Number(v?.value) || 0
          const val = (savedCur && savedCur !== baseCurrency && convert)
            ? convert(raw, savedCur, baseCurrency)
            : raw
          if (!isFinite(val)) return
          byItem[itemId] = owner.isDebt ? -Math.abs(val) : val
        })
        if (!cancelled) setSpreadsheetStart(Object.keys(byItem).length > 0 ? byItem : null)
      } catch { if (!cancelled) setSpreadsheetStart(null) }
    })()
    return () => { cancelled = true }
  }, [loadItemSnapshots, dataLoading, accountMembershipSig, baseCurrency, convert])

  // "What is actually driving my YTD", rebuilt per ACCOUNT (FASE GR).
  //
  // The previous version decomposed the year position by position straight from
  // the historical reconstruction, and on real data produced three separate
  // species of wrong at once: broker deposits counted as profit, whole accounts
  // silently absent, and per-account figures contradicting those accounts' own
  // charts. Patching it further was the wrong move; the foundation was.
  //
  // The engine (lib/ytdAttribution.js) partitions the exact three terms the
  // headline measured with -- gain = end - start - flows -- so the parts add up
  // to the headline BY CONSTRUCTION. This memo's whole job is to feed it an
  // honest partition:
  //
  //   endVal  exact: the same per-item sum netWorth itself is built from,
  //           including the debt sign, so the account totals rebuild netWorth.
  //   flow    exact: attributed with the rule the calibration flow already
  //           proved (a broker's own ledger by _source, manual money by the
  //           item it is linked to). Anything unattributable is reported, never
  //           swallowed -- the engine refuses rather than lose it.
  //   start   the only estimate, and therefore the only place error can enter.
  //           A broker's REAL year-start NAV is used where one exists and is
  //           never adjusted; the rest carry the reconstruction's estimate and
  //           get pinned to the portfolio anchor.
  const ytdBreakdown = useMemo(() => {
    if (ytdStartValue == null || ytdChange == null) return null
    const start = ytdEndpoints?.start || {}

    // Which account each item belongs to, using the shared rule.
    const accountOf = new Map()
    const nameOf = new Map()
    ;(portfolioItems || []).forEach((it) => {
      const k = accountKeyOfItem(it)
      if (!k) return
      accountOf.set(it.id, k)
      if (!nameOf.has(k)) {
        nameOf.set(k, k === 'ibkr' ? 'Interactive Brokers' : (it.institution || '').trim() || k)
      }
    })
    if (accountOf.size === 0) return null

    // endVal: the identical loop netWorth is computed from, kept per account so
    // the account totals reconstruct netWorth exactly rather than approximately.
    const endByAccount = new Map()
    ;(portfolioItems || []).forEach((it) => {
      if (isExcludedFromNetWorth(it)) return
      const k = accountOf.get(it.id)
      if (!k) return
      const val = getItemValue(it)
      const signed = it.isDebt ? -Math.abs(val) : val
      endByAccount.set(k, (endByAccount.get(k) || 0) + signed)
    })

    // flow: the SAME transaction list the headline netted, attributed by account.
    // A broker's account-level movement carries no item link, which is precisely
    // what broke the old panel; here it is matched by source instead.
    const nowTs = Date.now()
    const windowMs = Math.max(1, nowTs - ytdStartTs)
    const flowByAccount = new Map()
    // The Dietz denominator, per account: each flow weighted by the share of the
    // window it was actually invested for. Same weighting computeModifiedDietz
    // applies to the portfolio, so a row's return is measured the way the
    // headline above it is.
    const flowBaseByAccount = new Map()
    let unattributedFlow = 0
    const addFlow = (key, amt, ts) => {
      flowByAccount.set(key, (flowByAccount.get(key) || 0) + amt)
      flowBaseByAccount.set(key, (flowBaseByAccount.get(key) || 0) + amt * ((nowTs - ts) / windowMs))
    }
    ;(ytdFlowsUsed || []).forEach((tx) => {
      const type = (tx.type || '').toUpperCase()
      if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') return
      const txTs = tx.date ? new Date(tx.date).getTime() : NaN
      if (!isFinite(txTs) || txTs < ytdStartTs || txTs > nowTs) return
      const raw = Math.abs(Number(tx.totalAmount ?? 0))
      if (!isFinite(raw)) return
      const amt = (convert ? convert(raw, tx.currency || 'USD', baseCurrency || 'USD') : raw)
        * (type === 'DEPOSIT' ? 1 : -1)
      // Link id first, then symbol: a manual deposit typed without a link still
      // names the asset it went into, and dropping it would count as money we
      // could not place -- which makes the engine refuse the whole panel over a
      // movement we can in fact locate.
      const bySymbol = () => {
        const sym = (tx.symbol || '').toUpperCase()
        if (!sym) return null
        const owner = (portfolioItems || []).find((it) => (it.symbol || '').toUpperCase() === sym)
        return owner ? accountOf.get(owner.id) : null
      }
      const key = (tx._source === 'ibkr' || tx._source === 'inferred_flow')
        ? 'ibkr'
        : ((tx._linkedItemId && accountOf.get(tx._linkedItemId)) || bySymbol())
      if (!key) { unattributedFlow += amt; return }
      addFlow(key, amt, txTs)
    })

    // Money moving BETWEEN two of the user's own accounts is not a return for
    // either side: the account receiving it did not earn it, and the one sending
    // it did not lose it. The portfolio-level Dietz never sees these movements
    // (it nets DEPOSIT/WITHDRAWAL only), which is exactly right for the headline
    // and exactly wrong for a per-account split, so they are netted here as an
    // outflow on one side and an inflow on the other. Equal and opposite, they
    // cancel across accounts, so the rows still add up to the headline.
    //
    // Two forms of it:
    //   - an explicit TRANSFER between two accounts.
    //   - a coupon or dividend an asset GENERATED but that was paid out in cash
    //     to a different account (incomeDestination). Netting the arriving cash
    //     out of the receiver and back into the generator is what reproduces the
    //     convention the rest of the app already uses: the bond earned the
    //     coupon, the cash account merely holds it. Without this the generating
    //     account reads as flat for a year it did earn, and the cash account
    //     reads as having produced a return out of nowhere.
    //
    // Only when BOTH ends resolve to an account: crediting one side alone would
    // invent money at the portfolio level. A TransferModal row carries no item
    // ids at all, so it is skipped rather than half-applied.
    ;(transactions || []).forEach((tx) => {
      const txTs = tx.date ? new Date(tx.date).getTime() : NaN
      if (!isFinite(txTs) || txTs < ytdStartTs || txTs > nowTs) return
      const type = (tx.type || '').toUpperCase()
      let fromKey = null
      let toKey = null
      let cur = tx.currency || 'USD'
      if (type === 'TRANSFER') {
        fromKey = tx._originItemId ? accountOf.get(tx._originItemId) : null
        toKey = tx._linkedItemId ? accountOf.get(tx._linkedItemId) : null
      } else if (type === 'DIVIDEND') {
        // The shared rule for "did this payment move another account's balance,
        // and whose?" -- the same one the delete/edit reversal path uses, so the
        // two can never disagree about which payments landed elsewhere. It
        // already excludes reinvested payments (the money never left) and
        // backfilled ones (`_destinationCredited:false`: no balance was moved).
        const target = dividendCreditTarget(tx, portfolioItems)
        if (!target) return
        fromKey = tx._linkedItemId ? accountOf.get(tx._linkedItemId) : null
        toKey = accountOf.get(target.dest.id)
        cur = target.currency || cur
      } else return
      if (!fromKey || !toKey || fromKey === toKey) return
      const raw = Math.abs(Number(tx.totalAmount ?? 0))
      if (!isFinite(raw) || raw === 0) return
      const amt = convert ? convert(raw, cur, baseCurrency || 'USD') : raw
      if (!isFinite(amt)) return
      addFlow(toKey, amt, txTs)
      addFlow(fromKey, -amt, txTs)
    })

    // start, PER ITEM first so each holding can take its value from whichever
    // engine is authoritative for it, then folded up to accounts.
    const startByItem = new Map()
    Object.entries(start || {}).forEach(([k, v]) => {
      // A byKey entry is keyed by item id, or by symbol when the item had none.
      const ownerId = accountOf.has(k)
        ? k
        : (portfolioItems || []).find((it) => (it.symbol || '').toUpperCase() === k)?.id
      if (!ownerId) return
      startByItem.set(ownerId, (startByItem.get(ownerId) || 0) + (Number(v) || 0))
    })
    // The Spreadsheet overrides only the holdings it can rebuild from real
    // balance events (the loader already filtered to those). That is what took
    // ClubCashIn from +$7.57 to +$71.33; crypto keeps the historical-price
    // reconstruction, which is the engine that actually knows what it was worth.
    if (spreadsheetStart) {
      Object.entries(spreadsheetStart).forEach(([itemId, v]) => {
        if (accountOf.has(itemId) && isFinite(v)) startByItem.set(itemId, v)
      })
    }
    // An asset bought AFTER the anchor was worth nothing at the anchor. That is
    // not an estimate, it is a fact, and it outranks every reconstruction: OSMO
    // was opened in February and the price-history engine still handed it a
    // ~$400 January value, which turned a real -$27 into an impossible -$408 on
    // an account holding $117. Skipped for holdings whose date is a broker sync
    // stamp rather than a purchase (shouldHoldFlat marks exactly those), and for
    // IBKR, which takes its real NAV anyway.
    startByItem.forEach((_v, itemId) => {
      const it = (portfolioItems || []).find((x) => x && x.id === itemId)
      if (!it || it._source === 'ibkr') return
      if (shouldHoldFlat(it, transactions, lots)) return
      const acq = effectiveAcqTs(it)
      if (acq != null && acq > ytdStartTs) startByItem.set(itemId, 0)
    })
    const startByAccount = new Map()
    startByItem.forEach((v, itemId) => {
      const acct = accountOf.get(itemId)
      if (!acct) return
      startByAccount.set(acct, (startByAccount.get(acct) || 0) + v)
    })
    // The per-item reconstruction is not always available (its endpoints only
    // publish when the series' first point IS the anchor the headline used), and
    // the panel should not vanish for that: these starts are estimates that get
    // pinned to the anchor anyway, so the shape is all that is needed. Fall back
    // to the same held-flat per-account estimate the calibration flow uses.
    if (startByAccount.size === 0) {
      ;[...endByAccount.keys()].forEach((k) => {
        const est = heldFlatAccountValueUSD(portfolioItems, k, ytdStartTs, convert)
        if (isFinite(est) && est > 0) startByAccount.set(k, convertSnapshot(est))
      })
    }

    // A broker's own year-start NAV is an observation, not an estimate, so it is
    // handed over as real and the engine leaves it untouched while pinning the
    // rest. Anything else keeps the reconstruction's figure.
    // RAW snapshots, never augmentedSnapshots: augmentSnapshots deliberately
    // adds the manual holdings ON TOP of a broker NAV so the chart series
    // measures the whole portfolio. Read from there, "the broker's year-start
    // NAV" is actually the whole portfolio's, which makes the broker's start
    // swallow the entire anchor and leaves nothing for the other accounts --
    // the panel then refuses every time and the YTD figure stops being
    // tappable at all. The un-augmented doc is the broker's own balance.
    const brokerAnchor = findYearStartAnchor(
      (snapshots || []).filter((s) => s && BROKER_NAV_SOURCES.includes(s._source)),
      new Date().getFullYear()
    )
    const brokerStartUSD = brokerAnchor
      ? convertSnapshot(brokerAnchor.netWorthUSD ?? brokerAnchor.totalActivosUSD ?? 0)
      : null

    const build = (useRealBrokerStart) => [...endByAccount.keys()].map((k) => {
      const realStart = (useRealBrokerStart && k === 'ibkr' && brokerStartUSD != null && brokerStartUSD > 0)
        ? brokerStartUSD
        : null
      return {
        key: k,
        name: nameOf.get(k) || k,
        endVal: endByAccount.get(k) || 0,
        flow: flowByAccount.get(k) || 0,
        flowBase: flowBaseByAccount.get(k) || 0,
        start: realStart != null ? realStart : (startByAccount.get(k) || 0),
        startIsReal: realStart != null,
      }
    })

    const args = { portfolioStart: ytdStartValue, headlineGain: ytdChange, unattributedFlow }
    // The broker's real year-start NAV is the better input, so it is tried
    // first. But treating it as fixed truth can itself make the split
    // impossible (if that NAV and the portfolio anchor disagree, there is no
    // way to tell which one is off), and refusing outright would leave the
    // user with no breakdown at all over an improvement. So fall back to the
    // all-estimated split, which is internally consistent and still pinned to
    // the same anchor the headline used.
    return attributeYtd({ accounts: build(true), ...args })
      || attributeYtd({ accounts: build(false), ...args })
  }, [ytdEndpoints, portfolioItems, convert, baseCurrency, ytdChange, ytdStartValue, ytdStartTs, ytdFlowsUsed, snapshots, convertSnapshot, spreadsheetStart, transactions, lots])

  // Month-to-date return (Modified Dietz) — the "how are we doing THIS month"
  // number for the Friends monthly leaderboard. Same shape as YTD, anchored to
  // the prior month-end snapshot; null when there's no reliable month anchor.
  const returnMTD = useMemo(() => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()
    if (netWorth <= 0) return null
    const anchor = findMonthStartAnchor(augmentedSnapshots, year, month)
    let startVal = anchor ? convertSnapshot(anchor.netWorthUSD ?? anchor.totalActivosUSD ?? 0) : null
    if (startVal == null || startVal <= 0) return null
    const { pct } = computeModifiedDietz({
      startValue: startVal, endValue: netWorth,
      startTs: Date.UTC(year, month, 1), endTs: Date.now(),
      transactions: (REAL_SNAPSHOT_SOURCES.includes(anchor._source) || anchor._transactional) ? transactions : dietzTransactions,
      convert, baseCurrency,
    })
    return Math.max(-200, Math.min(200, pct))
  }, [netWorth, transactions, dietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot])

  // IBKR-only returns (Modified Dietz over the raw broker NAV + broker flows) for
  // the Friends "IBKR only" leaderboard scope. Uses RAW snapshots (not augmented,
  // which mix in manual assets). Null until the user has IBKR snapshots + flows.
  const ibkrReturns = useMemo(
    () => computeScopedReturns({ snapshots, items: enrichedItems, transactions, source: 'ibkr', convert, baseCurrency, nowTs: Date.now() }),
    [snapshots, enrichedItems, transactions, convert, baseCurrency]
  )

  const annualDividends = useMemo(() => {
    // Trailing 12 months only — this figure is labeled "Dividendos/año" in the UI
    // and the PDF report, so a lifetime sum would overstate it more every year.
    // Undated dividends can't be placed in time and are excluded.
    const cutoff = Date.now() - 365 * 86400000
    const divs = (transactions || []).filter((tx) => {
      if ((tx.type || '').toUpperCase() !== 'DIVIDEND' || tx._reinvested) return false
      const ts = tx.date ? new Date(tx.date).getTime() : NaN
      return !isNaN(ts) && ts >= cutoff
    })
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, convert, baseCurrency])

  const estimatedAnnualIncome = useMemo(() => {
    let total = 0
    portfolioItems.forEach((it) => {
      const qty = it.quantity || 1
      const origPrice = it._originalPrice ?? it._originalPurchasePrice ?? 0
      const itemCur = it._originalCurrency || it.currency || 'USD'
      const hasOriginal = origPrice > 0
      const price = hasOriginal ? origPrice : (it.currentPrice || it.purchasePrice || 0)
      const priceCur = hasOriginal ? itemCur : baseCurrency
      const balance = qty * price
      const annual = projectItemAnnualIncome(it, balance)
      if (annual > 0) {
        const cur = hasOriginal ? itemCur : priceCur
        total += convert(annual, cur, baseCurrency)
      }
    })
    return total
  }, [portfolioItems, convert, baseCurrency])

  const benchmarkSymbol = settings?.benchmarkSymbol || '%5EGSPC'
  const { benchmarkData, benchmarkReturn, benchmarkName, loading: benchmarkLoading, error: benchmarkError, refetch: refetchBenchmark } = useBenchmark('YTD', benchmarkSymbol)

  // Declared here (not up near refreshPrices/refreshRates) because it needs
  // refetchBenchmark, which only exists after the useBenchmark() call above —
  // see the comment left at the old call site. Not folding benchmarkError
  // into refreshError: unlike prices/rates, useBenchmark has no retry/
  // debounce and flips error after a single failed fetch, and that error is
  // surfaced nowhere else in the app today — wiring a never-before-visible,
  // single-failure signal into the header's most visible control would be a
  // disproportionate reaction to a hiccup nobody currently sees.
  const handleRefresh = useCallback(() => {
    refreshPrices()
    refreshRates()
    refetchBenchmark()
  }, [refreshPrices, refreshRates, refetchBenchmark])

  // Full summary (gross in / gross out / net) — the UI used to surface only the
  // net, leaving no way to see how much was actually deposited vs withdrawn.
  const contributionsSummary = useMemo(() => {
    return computeNetContributions(transactions, convert, baseCurrency)
  }, [transactions, convert, baseCurrency])
  const netContributions = contributionsSummary.netContributions

  const cashTotal = useMemo(() => {
    return portfolioItems
      .filter((it) => /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(it.type || ''))
      .reduce((s, it) => s + getItemValue(it), 0)
  }, [portfolioItems])

  const riskMetrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const ppy = inferPeriodsPerYear(snapshots)
    const sharpeResult = computeSharpeRatio({ returns, periodsPerYear: ppy })
    const vol = computeVolatility({ returns, periodsPerYear: ppy })
    const valueSeries = (snapshots || [])
      .map((s) => ({ ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
      .filter((p) => !isNaN(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(filterValueSpikes(valueSeries))
    return { sharpe: sharpeResult.sharpe, volatility: vol, maxDrawdown: drawdown.maxDrawdownPct }
  }, [snapshots, transactions, convert, baseCurrency])

  // ── Inferred deposits/withdrawals (FASE DQ) ──────────────────────────────
  // Fills the ONE gap real data can't reach: the quarterly-transcribed stretch
  // (Portfolio Analyst screenshot → ~4 numbers a year, no cash-transaction
  // detail). Everything else — the trailing ~365 days via Flex Query (API or
  // file, IBKR's cap is per account, not per file — see FASE DR) — already
  // has exact deposits/withdrawals imported as real transactions; nothing to
  // infer there.
  //
  // Gated hard on hasCompleteBrokerData: an account still missing a checklist
  // step (no quarterly transcription, no connection) never reaches this —
  // same "no data to guess from" reasoning as the plan this implements. Right
  // now only IBKR has real steps (lib/brokerCompletion.js); this block is
  // written broker-agnostic so a future broker's own steps slot in without
  // changes here.
  const brokerCompletionState = useMemo(() => ({
    ibkrConnected: !!((settings?.ibkrToken || settings?._ibkrVaultMigrated) && settings?.ibkrQueryId),
    ibkrSnapshotSpanDays: computeIbkrSnapshotSpanDays(snapshots),
    hasQuarterlyHistory: (snapshots || []).some((s) => s && s._source === 'ibkr_quarterly'),
    hasIbkrCalibration: accountCalibrations.some((c) => c && c._account === 'ibkr'),
    earliestNeededDays: computeEarliestNeededDays(portfolioItems),
  }), [settings, snapshots, accountCalibrations, portfolioItems])

  const ibkrDataComplete = useMemo(
    () => hasCompleteBrokerData('ibkr', null, brokerCompletionState),
    [brokerCompletionState]
  )

  // Real (day-level, synced) IBKR NAV only — never the quarterly-transcribed
  // points, which is exactly the series being tested against. This account's
  // OWN realized volatility, not a house constant: a genuinely volatile
  // account is held to its own bar for "is this move plausible market noise".
  const ibkrRealSnapshots = useMemo(
    () => (snapshots || []).filter((s) => s && s._source === 'ibkr' && s.date),
    [snapshots]
  )
  const ibkrRealCoverage = useMemo(() => {
    if (ibkrRealSnapshots.length === 0) return null
    const ts = ibkrRealSnapshots.map((s) => new Date(s.date).getTime()).filter((t) => isFinite(t))
    if (ts.length === 0) return null
    return { earliestTs: Math.min(...ts), latestTs: Math.max(...ts) }
  }, [ibkrRealSnapshots])
  const ibkrVolatility = useMemo(() => {
    if (ibkrRealSnapshots.length < 3) return null
    const returns = computePeriodicReturns(ibkrRealSnapshots, transactions, convert, 'USD')
    const ppy = inferPeriodsPerYear(ibkrRealSnapshots)
    return computeVolatility({ returns, periodsPerYear: ppy })
  }, [ibkrRealSnapshots, transactions, convert])

  // Candidates only ever surface for review — never written on their own. See
  // acceptInferredFlow/dismissInferredFlow below for the write path.
  // FASE GJ: when the user transcribed a PortfolioAnalyst screenshot whose
  // summary carried lifetime Net Deposits & Withdrawals
  // (settings.ibkrPaSummary, FASE GI), the per-gap candidates are reconciled
  // against it: their net must equal lifetime net minus the exact flows
  // already on file. Flows dated AFTER the screenshot was taken stay out of
  // the "known" side: the screenshot could not have contained them.
  const { inferredFlowCandidates, inferredFlowReconciliation } = useMemo(() => {
    if (!ibkrDataComplete || !ibkrRealCoverage) return { inferredFlowCandidates: [], inferredFlowReconciliation: null }
    const pts = quarterlyOnlyPoints(snapshots, ibkrRealCoverage.earliestTs)
    const raw = detectInferredFlows(pts, { annualizedVolatilityPct: ibkrVolatility })
    const pa = settings?.ibkrPaSummary
    if (!pa || !isFinite(pa.netFlows) || raw.length === 0) {
      return { inferredFlowCandidates: raw, inferredFlowReconciliation: null }
    }
    const asOf = typeof pa.savedAt === 'string' ? pa.savedAt.slice(0, 10) : null
    const toUSDAmt = (v, cur) => (convert ? convert(Number(v) || 0, cur || 'USD', 'USD') : Number(v) || 0)
    const lifetimeNetUSD = toUSDAmt(pa.netFlows, pa.currency)
    const knownNetUSD = (transactions || []).reduce((s, tx) => {
      if (!tx || (tx._source !== 'ibkr' && tx._source !== 'inferred_flow')) return s
      const ty = (tx.type || '').toUpperCase()
      if (ty !== 'DEPOSIT' && ty !== 'WITHDRAWAL') return s
      if (asOf && tx.date && tx.date > asOf) return s
      const amt = toUSDAmt(tx.totalAmount, tx.currency)
      if (!isFinite(amt)) return s
      return s + (ty === 'DEPOSIT' ? amt : -amt)
    }, 0)
    const { candidates, reconciliation } = applyLifetimeNetConstraint(raw, { lifetimeNetUSD, knownNetUSD })
    return { inferredFlowCandidates: candidates, inferredFlowReconciliation: reconciliation }
  }, [ibkrDataComplete, ibkrRealCoverage, snapshots, ibkrVolatility, settings, transactions, convert])

  // FASE GK (Fase 4 del plan): el tablero de conciliación contra la captura de
  // PortfolioAnalyst. Null hasta que el resumen esté transcrito (FASE GI).
  const ibkrReconciliation = useMemo(() => {
    const pa = settings?.ibkrPaSummary
    if (!pa) return null
    return ibkrReconciliationReport({
      paSummary: pa,
      transactions,
      snapshots,
      toUSD: (v, cur) => (convert ? convert(Number(v) || 0, cur || 'USD', 'USD') : Number(v) || 0),
    })
  }, [settings, transactions, snapshots, convert])

  // FASE HV. Cuentas líquidas cuyo saldo tecleado vale MÁS que todo lo que
  // sabemos que entró: ese sobrante solo pudo generarlo la cuenta, así que es su
  // rendimiento propio. Cada candidato es una PROPUESTA, nunca se escribe sola
  // (mismo trato que los flujos inferidos de FASE DQ).
  //
  // Corre sobre `items` crudos y NO sobre `enrichedItems` a propósito: la
  // identidad de los enriquecidos se rehace en cada tick de precio, y este memo
  // recorre todas las transacciones por ítem. Para una cuenta que no cotiza,
  // `purchasePrice`/`currentPrice` del ítem crudo YA están en su propia moneda,
  // que es justo lo que el motor necesita.
  const liquidYieldCandidates = useMemo(() => {
    const out = []
    for (const it of items || []) {
      if (!it?.id || !it.balanceAsOf) continue
      if (isMarketPriced(it) || it.type === 'Debt' || it.isReceivable) continue
      const asOfTs = new Date(`${it.balanceAsOf}T00:00:00Z`).getTime()
      if (!isFinite(asOfTs)) continue
      const finalBalance = (Number(it.quantity) || 1) * (Number(it.currentPrice ?? it.purchasePrice) || 0)
      if (!(finalBalance > 0)) continue
      const contributions = knownContributions({ item: it, items, transactions, convert, asOfTs })
      if (contributions.length === 0) continue
      const res = computeLiquidYield({
        contributions, finalBalance, asOfTs, declaredRatePct: getEffectiveYield(it) || 0,
      })
      if (!['ok', 'implausible-rate', 'negative-residual'].includes(res.status)) continue
      // Ya contestada: mientras el saldo, su fecha y los aportes sean los
      // mismos, la respuesta del usuario (aceptar o descartar) sigue valiendo.
      const signature = yieldSignature({ asOfTs, finalBalance, contributions })
      if (it._liquidYield?.signature === signature) continue
      out.push({
        ...res, id: it.id, itemId: it.id, name: it.name || it.symbol,
        currency: it.currency || 'USD', asOf: it.balanceAsOf, asOfTs, signature,
      })
    }
    return out
  }, [items, transactions, convert])

  // Reconciliation: once real Flex Query coverage reaches a date that used to
  // be inference-only (a new sync extended the window, or a prior-year XML
  // landed), whatever was guessed there is stale — the real Cash Transactions
  // import already wrote the true answer independently (or confirmed there
  // was none). An inferred flow never survives past the day the truth
  // arrives; it has nothing left to add once a real one covers its date.
  useEffect(() => {
    if (!ibkrRealCoverage || !deleteTransaction) return
    const staleIds = staleInferredFlowIds(transactions, ibkrRealCoverage)
    if (staleIds.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const id of staleIds) {
        if (cancelled) return
        try { await deleteTransaction(id) } catch (e) { console.error('[inferred-flow-reconcile]', e.message) }
      }
    })()
    return () => { cancelled = true }
  }, [transactions, ibkrRealCoverage, deleteTransaction])

  // FASE HV2 self-heal: pagos automáticos escritos con un día que no existe
  // ("2026-02-31", reportado por el usuario con captura). El motor ya dejó de
  // producirlos (clampPayDay), pero las filas viejas se quedan desbordando al
  // mes siguiente para siempre si nadie las corrige: solo se les cambia la
  // fecha al último día real de SU mes, sin tocar monto ni vínculos.
  const payDateFixRef = useRef(false)
  useEffect(() => {
    if (payDateFixRef.current || dataLoading || !updateTransaction) return
    const fixes = impossiblePayDateFixes(transactions)
    if (fixes.length === 0) return
    payDateFixRef.current = true
    let cancelled = false
    ;(async () => {
      for (const f of fixes) {
        if (cancelled) return
        try { await updateTransaction(f.id, { date: f.date }) } catch (e) { console.error('[paydate-fix]', e.message) }
      }
    })()
    return () => { cancelled = true }
  }, [transactions, dataLoading, updateTransaction])

  // FASE FR self-heal: corrupt daily-snapshot runs. The pre-FASE-FE hole let a
  // price refresh in flight write an inflated net worth into the permanent
  // daily snapshot; with a broker connected those docs never self-correct
  // (FASE EI) and a ~2-week run poisons the value chart and the chained TWR
  // (the single-window MWR is blind to mid-series points — that asymmetry is
  // how the bug was confirmed). corruptSnapshotRunIds is deliberately strict:
  // deletable sources only ('daily'/'backfill', both re-derivable), round-trip
  // required, aborted by any real broker NAV inside the run, and never when a
  // real deposit/withdrawal explains the level jump. Deleted days re-fill via
  // the 30-day backfill at correct levels. Runs ONCE per session, only after
  // every data stage settles (same gates as the snapshot writers: a cleanup
  // must never judge levels computed from half-loaded prices).
  const corruptSnapCleanupRef = useRef(false)
  useEffect(() => {
    if (corruptSnapCleanupRef.current) return
    if (!user || dataLoading || pricesLoading || pricesFetching || ratesLoading || bulkWriting || ibkrAutoSyncing) return
    if (!deleteSnapshot || !snapshots || snapshots.length < 4) return
    if ((items || []).some((it) => it && it._source === 'demo')) return
    const flowsUSD = (transactions || [])
      .filter((tx) => /^(DEPOSIT|WITHDRAWAL)$/i.test(tx.type || ''))
      .map((tx) => {
        const ts = tx.date ? new Date(tx.date).getTime() : NaN
        const amt = Math.abs(Number(tx.totalAmount ?? tx.amount ?? 0))
        const usd = convert ? convert(amt, tx.currency || 'USD', 'USD') : amt
        return { ts, amount: usd, type: (tx.type || '').toUpperCase() }
      })
      .filter((f) => isFinite(f.ts) && isFinite(f.amount) && f.amount > 0)
    // FASE GA: además de las rachas estadísticas, la purga guiada por era: los
    // docs 'daily' de la ventana en que el hueco de FASE FE estuvo abierto,
    // cuando se desvían >5% del nivel real post-era. Atrapa el residuo que
    // jumpExplained protege (un depósito real de la misma fecha, XOCHI, cubría
    // más de la mitad del salto corrupto).
    const runIds = corruptSnapshotRunIds(snapshots, flowsUSD)
    const eraIds = feEraSuspectDailyIds(snapshots)
    const ids = [...new Set([...runIds, ...eraIds])]
    corruptSnapCleanupRef.current = true
    if (ids.length === 0) return
    let cancelled = false
    ;(async () => {
      let removed = 0
      for (const id of ids) {
        if (cancelled) return
        try { await deleteSnapshot(id); removed++ }
        catch (e) { console.error('[corrupt-snapshot-cleanup]', e.message) }
      }
      if (removed > 0) console.info(`[corrupt-snapshot-cleanup] removed ${removed} corrupt snapshot(s); backfill will rebuild them`)
    })()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, pricesFetching, ratesLoading, bulkWriting, ibkrAutoSyncing, snapshots, transactions, items, convert, deleteSnapshot])

  // Self-heal: opening deposits our own onAdd wrapper left without a link
  // (FASE EA). Only unambiguous, self-inflicted rows — see
  // unlinkedOpeningDeposits. Runs once per orphan: patching it sets
  // _linkedItemId, so the next pass finds nothing.
  useEffect(() => {
    if (!updateTransaction) return
    const orphans = unlinkedOpeningDeposits(transactions, portfolioItems)
    if (orphans.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const { id, itemId } of orphans) {
        if (cancelled) return
        try { await updateTransaction(id, { _linkedItemId: itemId }) }
        catch (e) { console.error('[opening-deposit-relink]', e.message) }
      }
    })()
    return () => { cancelled = true }
  }, [transactions, portfolioItems, updateTransaction])

  // FASE EP. Deleting or editing a DIVIDEND transaction by hand (EditAccountModal's
  // per-row delete/edit, RecentTransactions' delete) used to just touch the
  // transaction doc, blind to whether the payment had already moved a
  // destination account's balance (addToDestination, above). A coupon the user
  // marked as paid by mistake, or one whose amount needed a correction, left the
  // destination permanently off by the stale amount, with no way to fix it
  // short of deleting the whole account and rebuilding it from zero.
  // dividendCreditTarget (lib/autoDividends.js) identifies whether a payment
  // touched a balance and where; applyDestinationDelta below reuses the SAME
  // credit math processDividends already runs on its own stale payments
  // (creditDestinationBalance). A fresh {} runningBalances per call is correct
  // here (unlike the shared accumulator above): each of these touches exactly
  // one destination, never a batch.
  const applyDestinationDelta = useCallback(async (dest, delta, currency) => {
    if (delta === 0) return
    const isBankDest = /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(dest.type || '')
    const { newPrice } = creditDestinationBalance({}, dest, delta, currency, convert)
    await updateItem(dest.id, isBankDest ? { currentPrice: newPrice, purchasePrice: newPrice } : { currentPrice: newPrice })
  }, [updateItem, convert])

  const deleteTransactionWithReversal = useCallback(async (txId) => {
    const tx = transactions.find((t) => t.id === txId)
    const credit = tx && dividendCreditTarget(tx, enrichedItems)
    if (credit) {
      const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
      await applyDestinationDelta(credit.dest, -amt, credit.currency)
    }
    await deleteTransaction(txId)
  }, [transactions, enrichedItems, applyDestinationDelta, deleteTransaction])

  const updateTransactionWithReversal = useCallback(async (txId, fields) => {
    const tx = transactions.find((t) => t.id === txId)
    const newAmt = Number(fields?.totalAmount)
    if (tx && Number.isFinite(newAmt)) {
      const credit = dividendCreditTarget(tx, enrichedItems)
      if (credit) {
        const oldAmt = Number(tx.totalAmount ?? tx.amount ?? 0)
        await applyDestinationDelta(credit.dest, newAmt - oldAmt, credit.currency)
      }
    }
    await updateTransaction(txId, fields)
  }, [transactions, enrichedItems, applyDestinationDelta, updateTransaction])

  // Accept: writes an ordinary DEPOSIT/WITHDRAWAL (symbol 'CASH', no
  // _linkedItemId — mirrors how a REAL IBKR cash transaction is shaped,
  // lib/parsers/ibkrFileParser.js) so computeModifiedDietz nets it out exactly
  // like any other flow, no special-casing anywhere downstream. Marks the
  // gap's end-point snapshot _flowReviewed so it never resurfaces.
  const acceptInferredFlow = useCallback(async (candidate) => {
    if (!candidate || !addTransaction || !saveSnapshot) return
    await addTransaction({
      type: candidate.type,
      symbol: 'CASH',
      description: candidate.type === 'DEPOSIT'
        ? 'Depósito inferido (histórico trimestral)'
        : 'Retiro inferido (histórico trimestral)',
      date: candidate.midDate,
      totalAmount: candidate.amount,
      currency: 'USD',
      institution: 'Interactive Brokers',
      _source: 'inferred_flow',
    })
    await saveSnapshot({ date: candidate.toDate, _flowReviewed: true })
  }, [addTransaction, saveSnapshot])

  // Dismiss: "no, that gap was pure market movement" — marks it reviewed
  // WITHOUT writing anything, so a legitimately-plausible-but-flagged edge
  // case (this account's own volatility estimate was too tight for one real
  // rally) doesn't force a fake transaction just to silence the nudge.
  const dismissInferredFlow = useCallback(async (candidate) => {
    if (!candidate || !saveSnapshot) return
    await saveSnapshot({ date: candidate.toDate, _flowReviewed: true })
  }, [saveSnapshot])

  // FASE HV. Aceptar el rendimiento deducido: escribe UN pago mensual
  // reinvertido en la propia cuenta, que es exactamente la forma que los dos
  // motores de reconstrucción ya saben rebobinar (ClubCashIn, FASE FD:
  // `indexBalanceEvents` lo manda a `reinvestBySym` y nunca a
  // `balanceEventsById`, así que no puede contarse dos veces). Ningún motor
  // aprende nada nuevo.
  //
  // El SALDO no se toca, y es el punto entero: estos montos se dedujeron de ese
  // saldo, así que sumárselos sería sumarle un número sacado de él mismo.
  //
  // Antes de escribir se borra todo el rendimiento que la app había booked para
  // esta cuenta dentro de la ventana (una corrida previa de esta inferencia, o
  // lo que el motor automático haya escrito ahí): hasta `balanceAsOf` la verdad
  // es el saldo, así que cualquier rendimiento anterior es una afirmación vieja
  // sobre el mismo dinero. Lo que el usuario escribió a mano nunca se toca.
  const acceptLiquidYield = useCallback(async (candidate) => {
    if (!candidate?.itemId || !addTransaction || !updateItem) return
    const item = (items || []).find((it) => it.id === candidate.itemId)
    if (!item) return
    const stale = supersededYieldTxIds(transactions, item, candidate.asOfTs)
    if (deleteTransaction) {
      for (const id of stale) {
        try { await deleteTransaction(id) } catch (e) { console.error('[liquid-yield-cleanup]', e.message) }
      }
    }
    for (const m of candidate.months || []) {
      await addTransaction({
        date: m.date,
        type: 'DIVIDEND',
        symbol: item.symbol || item.name,
        description: `Rendimiento de ${item.name || item.symbol}`,
        totalAmount: m.amount,
        currency: candidate.currency,
        _source: 'inferred_yield',
        _linkedItemId: item.id,
        _reinvested: true,
      })
    }
    await updateItem(item.id, {
      _liquidYield: {
        signature: candidate.signature,
        asOf: candidate.asOf,
        ratePct: candidate.ratePct,
        interest: candidate.interest,
        appliedAt: new Date().toISOString(),
      },
    })
  }, [items, transactions, addTransaction, deleteTransaction, updateItem])

  // Descartar: "ese sobrante no fue rendimiento". No escribe nada; solo deja
  // constancia de que la pregunta ya se hizo con ESTOS datos, así que vuelve a
  // aparecer si el saldo, su fecha o los aportes cambian (que es justo cuando
  // vuelve a ser una pregunta distinta).
  const dismissLiquidYield = useCallback(async (candidate) => {
    if (!candidate?.itemId || !updateItem) return
    await updateItem(candidate.itemId, {
      _liquidYield: { signature: candidate.signature, asOf: candidate.asOf, dismissed: true },
    })
  }, [updateItem])

  const insights = useMemo(() => {
    const hhiResult = computeHHI(portfolioItems.map((it) => ({ value: getItemValue(it) })))
    // Yield over total assets, not net worth — dividing by (assets − debt) would
    // inflate the yield for leveraged portfolios.
    const incomeYield = totalAssets > 0 && annualDividends > 0 ? (annualDividends / totalAssets) * 100 : 0
    const attribution = computeAssetAttribution(portfolioItems)
    const topContributor = attribution.length > 0 ? attribution[0] : null
    const topDrag = attribution.length > 0 ? attribution[attribution.length - 1] : null
    const now = new Date()
    const in90 = new Date(now.getTime() + 90 * 86400000)
    const maturingSoon = portfolioItems.filter((it) => {
      if (!it.maturityDate) return false
      const md = new Date(it.maturityDate)
      return md > now && md <= in90
    }).length
    const debtTotal = portfolioItems.filter((it) => it.isDebt).reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const debtRatio = totalAssets > 0 ? (debtTotal / totalAssets) * 100 : 0
    const classTotals = {}
    let classTotal = 0
    portfolioItems.filter(it => !it.isDebt).forEach(it => {
      const cls = getInvestmentClass(it)
      const val = Math.abs(getItemValue(it))
      classTotals[cls] = (classTotals[cls] || 0) + val
      classTotal += val
    })
    const investmentClassPcts = {}
    Object.entries(classTotals).forEach(([k, v]) => { investmentClassPcts[k] = classTotal > 0 ? (v / classTotal) * 100 : 0 })
    const depositCount = (transactions || []).filter(tx => (tx.type || '').toUpperCase() === 'DEPOSIT').length
    return generateInsights({
      netWorth, benchmarkReturn,
      portfolioReturn: returnYTD,
      sharpe: riskMetrics.sharpe, volatility: riskMetrics.volatility, maxDrawdown: riskMetrics.maxDrawdown,
      hhi: hhiResult.hhi, incomeYield, goals,
      topContributor, topDrag, maturingSoon, debtRatio, investmentClassPcts,
      netContributions, depositCount,
    })
  }, [netWorth, totalAssets, benchmarkReturn, returnYTD, riskMetrics, portfolioItems, annualDividends, goals, transactions, netContributions])

  const contributionWarning = useMemo(() => {
    if (netWorth <= 0 || !snapshots || snapshots.length < 2) return false
    const deposits = (transactions || []).filter(tx => (tx.type || '').toUpperCase() === 'DEPOSIT')
    if (deposits.length >= 3) return false
    const sorted = [...snapshots].filter(s => s.date).sort((a, b) => new Date(a.date) - new Date(b.date))
    const firstSnap = sorted.find(s => (s.netWorthUSD ?? s.totalActivosUSD ?? 0) > 0)
    if (!firstSnap) return false
    const firstVal = firstSnap.netWorthUSD ?? firstSnap.totalActivosUSD ?? 0
    if (firstVal <= 0) return false
    const growth = netWorth - convert(firstVal, 'USD', baseCurrency)
    const impliedPct = (growth / convert(firstVal, 'USD', baseCurrency)) * 100
    return impliedPct > 40 && deposits.length < 3
  }, [netWorth, snapshots, transactions, convert, baseCurrency])

  // How stale the numbers on screen are. The snapshot date alone was misleading:
  // a daily snapshot is written once per day, so the moment before today's got
  // written the banner claimed "hace 1d" on a dashboard whose prices had just
  // been refreshed. Freshness is whichever is MORE recent, the last price
  // refresh or the last snapshot, floored at 0 so a same-day figure never reads
  // as a day old (FASE EC).
  const dataAge = useMemo(() => {
    const snapTs = latestSnapshot ? new Date(latestSnapshot.date).getTime() : NaN
    const priceTs = pricesUpdate ? new Date(pricesUpdate).getTime() : NaN
    const freshest = Math.max(isFinite(snapTs) ? snapTs : -Infinity, isFinite(priceTs) ? priceTs : -Infinity)
    if (!isFinite(freshest)) return null
    return Math.max(0, Math.floor((Date.now() - freshest) / 86400000))
  }, [latestSnapshot, pricesUpdate])

  // Profile figures for insights. The user types monthlyIncome/monthlyExpenses by
  // hand in Settings, but also records the real thing as finance transactions —
  // two entries of the same money that silently diverge. When a manual figure is
  // missing, derive it from the last 3 closed months of finance transactions
  // (manual values always win; the current partial month is excluded).
  const effectiveProfile = useMemo(() => {
    const p = profile || {}
    if (p.monthlyIncome > 0 && p.monthlyExpenses > 0) return p
    const txs = entityFinanceTransactions || []
    if (txs.length === 0) return p
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()
    const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    let income = 0, expenses = 0
    const monthsSeen = new Set()
    txs.forEach(tx => {
      const ts = tx.date ? new Date(tx.date).getTime() : NaN
      if (isNaN(ts) || ts < start || ts >= end) return
      const type = (tx.type || '').toUpperCase()
      if (type !== 'INCOME' && type !== 'EXPENSE') return
      const amt = convert(Math.abs(tx.amount || 0), tx.currency || baseCurrency, baseCurrency)
      if (type === 'INCOME') income += amt
      else expenses += amt
      const d = new Date(tx.date)
      monthsSeen.add(`${d.getFullYear()}-${d.getMonth()}`)
    })
    const n = monthsSeen.size
    if (n === 0) return p
    return {
      ...p,
      monthlyIncome: p.monthlyIncome > 0 ? p.monthlyIncome : income / n,
      monthlyExpenses: p.monthlyExpenses > 0 ? p.monthlyExpenses : expenses / n,
      _derivedFromFinances: true,
    }
  }, [profile, entityFinanceTransactions, convert, baseCurrency])

  return {
    // Raw Firestore data
    items, snapshots, chartSnapshots, augmentedSnapshots, accountCalibrations, transactions, goals, settings, profile, effectiveProfile, alerts, lots, portfolios, financeTransactions,
    entityTransactions, entityFinanceTransactions,
    dataLoading,

    // Firestore actions
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    deleteTransactionWithReversal, updateTransactionWithReversal,
    addAlert, deleteAlert, updateAlert,
    addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    bulkImport,
    saveGoals, saveSettings, saveProfile,
    saveItemSnapshots, loadItemSnapshots,

    // Market data
    enrichedItems, portfolioItems, marketPrices,
    pricesLoading, pricesError, pricesUpdate,
    rates, convert, convertItemValue,
    ratesLoading, ratesError, ratesUpdate,
    handleRefresh,

    // Computed values
    baseCurrency, netWorth, totalAssets, dailyChange, yearlyChange,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate, returnMTD, ytdCalibrated, ytdBreakdown,
    ibkrReturnYTD: ibkrReturns.ytd, ibkrReturnMTD: ibkrReturns.mtd, ibkrDayChange: ibkrReturns.day,
    annualDividends, estimatedAnnualIncome,
    netContributions, contributionsSummary, cashTotal, riskMetrics, insights, dataAge, contributionWarning,
    brokerCompletionState, ibkrDataComplete, inferredFlowCandidates, inferredFlowReconciliation, ibkrReconciliation, acceptInferredFlow, dismissInferredFlow,
    liquidYieldCandidates, acceptLiquidYield, dismissLiquidYield,

    // Benchmark
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName, benchmarkLoading,

    // IBKR
    handleIBKRSync,
    // Connected = a usable token (legacy client copy OR migrated to the server vault)
    // AND a query id. Must mirror the auto-sync gate; without _ibkrVaultMigrated a
    // vault-only connection reads as disconnected (no header pill, no auto-sync).
    ibkrConnected: !!((settings?.ibkrToken || settings?._ibkrVaultMigrated) && settings?.ibkrQueryId),
    ibkrAutoSyncing,
    triggerIBKRSync,
    ibkrSyncStatus: settings?._ibkrAutoSyncStatus || null,
    ibkrSyncSummary: settings?._ibkrLastSyncSummary || null,
    ibkrSyncError: settings?._ibkrAutoSyncError || null,
    ibkrSyncErrorCode: settings?._ibkrAutoSyncErrorCode || null,
    ibkrLastSync: settings?._ibkrLastAutoSync || settings?._ibkrLastSync || null,
  }
}
