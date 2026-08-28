import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useFirestoreItems } from './useFirestoreItems'
import { useMarketPrices } from './useMarketPrices'
import { useExchangeRates } from './useExchangeRates'
import { useBenchmark } from './useBenchmark'
import { useTabCoordination } from './useTabCoordination'
import { authFetch, safeJson } from '@/lib/authFetch'
import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, getTypeCategory, getInvestmentClass, isExcludedFromNetWorth, isBankLike, computeDayChange, augmentSnapshots, projectItemAnnualIncome, findYearStartAnchor, findMonthStartAnchor, computeScopedReturns, shouldHoldFlat, combineAccountCalibrations, accountKeyOfItem, BROKER_NAV_SOURCES, heldFlatAccountValueUSD, isMarketPriced, effectiveAcqTs, entryFeeAddbacks, getEffectiveYield } from '@/components/dashboard/utils'
import { buildHistoryRequestBody } from '@/lib/historyPayload'
import { isReinvestedDividend, reinvestIndex } from '@/lib/dividendCash'
import { hasDividendInMonth, redundantAutoDividendIds, creditableBackfills, creditDestinationBalance, dividendCreditTarget } from '@/lib/autoDividends'
import { unlinkedOpeningDeposits } from '@/lib/originDeposits'
import { transferReversalPlan, reversalWritesSomething } from '@/lib/transferReversal'
import { staleTradeDateFixes } from '@/lib/ibkrTradeDateFix'
import { dropDeletesThatAreUpdated } from '@/lib/ibkrMergePlan'
import { nextFailCount, NORMAL_INTERVAL_MS } from '@/lib/ibkrRetryPolicy'
import { ibkrSyncDecision, bumpAttempts, ibkrDayKey } from '@/lib/ibkrSchedule'

// Cada cuánto se RE-EVALÚA la decisión de sincronizar (no cada cuánto se
// sincroniza: eso lo decide lib/ibkrSchedule.js). Solo existe para que una
// pestaña que queda abierta días cruce a un día nuevo sola.
const SYNC_HEARTBEAT_MS = NORMAL_INTERVAL_MS
import { vanishedIbkrPositionIds } from '@/lib/ibkrVanishedPositions'
import { corruptSnapshotRunIds, feEraSuspectDailyIds } from '@/lib/corruptSnapshots'
import { planEquitySnapshotWrites, misplacedPlainNavMigrations, applyNavMigrations } from '@/lib/ibkrSnapshotPlan'
import { saveIbkrCredentials } from '@/lib/ibkrVault'
import { preferFullPortfolioPerDay } from '@/lib/snapshotSelect'
import { staleBackfillDates, buildNavByDate, composeDailyTotals, windowDates, divergentDailyDates, navAsOf, navEntryAsOf, brokerConnectedTsOf } from '@/lib/snapshotBackfill'
import { hasCompleteBrokerData, ibkrSnapshotSpanDays as computeIbkrSnapshotSpanDays, earliestNeededDays as computeEarliestNeededDays } from '@/lib/brokerCompletion'
import { detectInferredFlows, quarterlyOnlyPoints, staleInferredFlowIds, applyLifetimeNetConstraint } from '@/lib/inferredFlows'
import { ibkrReconciliationReport } from '@/lib/ibkrReconciliation'
import { knownContributions, computeLiquidYield, yieldSignature, supersededYieldTxIds } from '@/lib/liquidYield'
import { clampPayDay, payDateFor, impossiblePayDateFixes, isPayDateExcluded, acquisitionDayISO, monthlyIncomeAmount } from '@/lib/incomeSchedule'
import { zeroQuantityBalanceFixes, resurrectedBalanceFixes } from '@/lib/zeroQuantityHeal'
import { isDailyAccrual } from '@/lib/dailyAccrual'
import { attributeYtd, deriveBrokerStart, pickAnchorBreakdown } from '@/lib/ytdAttribution'
import { snapshotAssetsUSD, assetOnlyFlows } from '@/lib/assetReturns'
import { buildPublishPayload, publishDayKey, shouldPublishToday } from '@/lib/friendsPublish'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights, computeAssetAttribution, inferPeriodsPerYear, filterValueSpikes, pairPortfolioWithBenchmark } from '@/components/dashboard/analytics'
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

// Version de la logica que produce los docs historicos derivados. SUBIRLA cada
// vez que cambie COMO se reconstruye el pasado (la ruta de portfolio-history, la
// composicion de FASE HN, el rebobinado por item), para que la reparacion diaria
// vuelva a correr en la siguiente sesion en vez de esperar al dia siguiente.
// 2: FASE IO, dos posiciones del mismo simbolo ya no colapsan en una sola.
// 3: FASE IX, la caja del broker deja de deshacer los depositos de las cuentas
//    manuales (y las ventas sin contraparte reconstruible), asi que todo doc
//    escrito con la logica vieja tiene el pasado hundido y hay que re-derivarlo.
// 4: FASE JU, "Reparar ahora" mandaba un cuerpo SIN income ni lots, asi que
//    todo doc que ese boton escribio dejo pegada a su valor de hoy cualquier
//    cuenta que compone su rendimiento. Se sube para que la pasada correcta
//    corra en la MISMA sesion en vez de esperar al dia siguiente.
const BACKFILL_LOGIC_VERSION = 4

// `publishFriends` lo prende SOLO el tablero. No es un default porque /friends
// publica por su cuenta al montar (y ahí eso es lo correcto: es el momento en
// que estás comparando), así que con los dos activos la misma visita escribiría
// dos veces. Ver lib/friendsPublish.js.
export function useDashboardData({ user, lang, activePortfolio, activeEntity = '__all__', publishFriends = false }) {
  const firestoreData = useFirestoreItems()
  const {
    items, snapshots: rawSnapshots, transactions, goals, settings, profile,
    loading: dataLoading, loadError, addItem, updateItem, deleteItem,
    deleteAllItems, deleteItemGroup, saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    alerts, addAlert, deleteAlert, updateAlert,
    lots, addLot, closeLotsFIFO, transferFunds, reverseTransfer, executeSaleAtomic, executeContribution, bulkImport, bulkWriting, bulkWritingRef, deletionEpoch,
    portfolios, addPortfolio, deletePortfolio,
    financeTransactions, addFinanceTransaction, updateFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    deleteFinanceTransactionsByIds,
    saveGoals, saveSettings, saveProfile,
    incomePlan, saveIncomePlan,
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

  // ⛔ FASE LH. Espejo en ref de items/snapshots para la reconciliación de
  // IBKR. handleIBKRSync corre DESPUÉS de una descarga de hasta ~90s, así que
  // leer `items` de su closure significaba reconciliar contra la foto de
  // cuando la corrida se armó: si un import escribió posiciones en el medio,
  // el sync no las veía y las volvía a crear (posiciones duplicadas, sin
  // heal posterior: dataCompleteness excluye los items de broker a propósito).
  // La asignación es en render a propósito: idempotente, y siempre la foto
  // más fresca que el cliente tiene. Tenerlas como ref además saca `items` y
  // `snapshots` de las deps de handleIBKRSync, lo que de paso deja de
  // re-ejecutar el efecto de auto-sync (y de CANCELAR una descarga en vuelo,
  // tirando un sync completo en silencio) con cada eco del listener.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const snapshotsRef = useRef(snapshots)
  snapshotsRef.current = snapshots

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => { setBaseCurrency(baseCurrency) }, [baseCurrency])
  useEffect(() => { setUtilsLang(lang) }, [lang])

  const { enrichedItems: rawEnriched, prices: marketPrices, loading: pricesLoading, isFetching: pricesFetching, error: pricesError, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, error: ratesError, stale: ratesStale, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

  // FASE GB. Declarada AQUÍ (antes de los efectos escritores que la llevan en
  // sus deps) porque una deps array se evalúa en render: referenciarla antes
  // de su declaración sería un ReferenceError, no un undefined silencioso.
  // La consume el bloque de auto-sync de IBKR más abajo.
  const [ibkrAutoSyncing, setIbkrAutoSyncing] = useState(false)
  // Por qué el auto-sync NO corrio, cuando no corre. Ver lib/ibkrSchedule.js.
  const [ibkrSkipReason, setIbkrSkipReason] = useState(null)

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
  // FASE HZ (pedido del usuario: "que chispu apache repair now solo, todos los
  // días, sin apachar botones de más"). El backfill era una-vez-por-SESIÓN
  // (`backfillRef` booleano): si esa única corrida caía en un mal momento (una
  // respuesta degradada de Yahoo, un 504, el sync de IBKR en vuelo), se rendía
  // hasta la próxima recarga, y en una pestaña de iPad que queda abierta días
  // esa recarga no llega nunca. Por eso el botón "Reparar ahora" (FASE HP)
  // funcionaba y el camino automático no: eran el mismo cómputo con distinta
  // persistencia. Ahora la unidad es el DÍA (UTC), con reintentos acotados:
  //   - backfillDayRef: el día cuya pasada ya COMPLETÓ con éxito. Solo se
  //     estampa al terminar bien (o cuando genuinamente no hay nada que
  //     corregir); un fallo lo deja sin estampar para reintentar.
  //   - backfillAttemptRef: backoff de 10 min entre intentos y techo de 4 por
  //     día, para que una API caída no se martille (las deps del efecto se
  //     re-evalúan con cada tick de precios, cada ~5 min).
  //   - backfillRunningRef: nunca dos pasadas concurrentes (una pasada que
  //     escribe cientos de docs puede tardar más que el backoff).
  // Con la fecha como unidad, una pestaña que cruza medianoche se re-arma sola:
  // la cadencia es exactamente la que el usuario pidió.
  const backfillDayRef = useRef(null)
  const backfillAttemptRef = useRef({ dayKey: null, ts: 0, tries: 0 })
  const backfillRunningRef = useRef(false)
  // FASE GM2. Un borrado de cuentas a mitad de sesión re-arma el backfill: la
  // regeneración del historial de portafolio completo ya corrió al inicio de
  // la sesión, y sin este reset el auto-reparado post-borrado (re-derivar los
  // días que aún contenían la cuenta borrada, incluido el snapshot de AYER
  // que se queda como un pico gigante) no ocurría hasta la próxima recarga.
  const deletionEpochRef = useRef(deletionEpoch)
  useEffect(() => {
    if (deletionEpoch !== deletionEpochRef.current) {
      deletionEpochRef.current = deletionEpoch
      backfillDayRef.current = null
      backfillAttemptRef.current = { dayKey: null, ts: 0, tries: 0 }
    }
  }, [deletionEpoch])
  // ⛔ FASE JZ. Liberar el slot plano de una fecha ocupado por un NAV de broker
  // (FASE GD). Se expone además de usarse acá porque "Reparar ahora"
  // (PortfolioGrowthChart) escribe los MISMOS docs y NO corría esta migración:
  // staleBackfillDates no cuenta un NAV de broker como cobertura del día, así
  // que esa fecha entra como hueco, el botón escribe su total compuesto con
  // id = fecha, y saveSnapshot fusiona encima del doc del NAV. La medición real
  // del broker quedaba reemplazada por una estimación, sin aviso, y el día
  // desaparecía de la vista escopada a IBKR. Una sola implementación para los
  // dos caminos: dos copias de esto es exactamente cómo una se queda atrás.
  const migrateMisplacedNav = useCallback(
    (snaps) => applyNavMigrations({ snapshots: snaps, bulkImport, deleteSnapshot }),
    [bulkImport, deleteSnapshot]
  )
  useEffect(() => {
    // FASE IR: la compuerta de "ya corri hoy" lleva la VERSION de la logica de
    // reconstruccion, no solo el dia. Una pasada que ya completo con el codigo
    // viejo dejaba el historico congelado hasta el dia siguiente aunque el
    // calculo hubiera cambiado en el medio: exactamente lo que le paso al ancla
    // del 1 de enero tras el arreglo de FASE IO (el doc quedo derivado con la
    // reconstruccion vieja, y el desglose acusaba el descuadre sin forma de
    // corregirse solo hasta el otro dia). Es la misma leccion que SNAPSHOT_VERSION
    // ya resuelve para el cache del Spreadsheet: una compuerta que no se entera
    // de que la logica cambio conserva datos derivados de la version anterior.
    // Al subir esta constante, la proxima sesion re-deriva la ventana entera una
    // vez, sin importar que la pasada del dia ya hubiera completado.
    const todayKey = `${new Date().toISOString().split('T')[0]}:${BACKFILL_LOGIC_VERSION}`
    if (backfillDayRef.current === todayKey) return
    if (backfillRunningRef.current) return
    const att = backfillAttemptRef.current
    if (att.dayKey === todayKey && (att.tries >= 4 || Date.now() - att.ts < 10 * 60 * 1000)) return
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
    const brokerAddedTs = brokerConnectedTsOf(enrichedItems)
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
    if (gaps.length === 0 && navMigrations.length === 0 && !hasBrokerItem) { backfillDayRef.current = todayKey; return }
    // El intento se cuenta AQUÍ, después de los gates: una evaluación bloqueada
    // por un sync en curso no consume reintentos, solo un fetch que sí arrancó.
    backfillAttemptRef.current = {
      dayKey: todayKey,
      ts: Date.now(),
      tries: (att.dayKey === todayKey ? att.tries : 0) + 1,
    }
    backfillRunningRef.current = true

    let cancelled = false
    async function doBackfill() {
      try {
        if (cancelled) return
        // FASE GD, ANTES de rellenar: mover los NAV de broker atrapados en el
        // slot plano de la fecha a su doc paralelo. Si se rellenara primero,
        // el saveSnapshot del gap escribiría ENCIMA del NAV y lo destruiría.
        if (navMigrations.length > 0) {
          // FASE JZ: si la migración FALLA no se sigue. Antes se logueaba y se
          // continuaba, o sea el fallo terminaba destruyendo justo lo que la
          // migración existe para proteger: el NAV sigue ocupando el slot
          // plano, esa fecha cuenta como hueco, y el saveSnapshot de abajo
          // escribe su total compuesto encima. Un hueco es mejor que eso.
          // (El chequeo de `cancelled` entre borrados también se fue: llegar
          // hasta acá significa que los docs paralelos YA se escribieron, y
          // dejar la migración a medias solo la repite la próxima sesión.)
          try {
            const moved = await migrateMisplacedNav(snapshots)
            console.info(`[nav-migration] moved ${moved} broker NAV doc(s) to parallel ids`)
          } catch (e) {
            console.error('[nav-migration] no se escribe nada esta sesión:', e?.message)
            return
          }
        }
        if (cancelled) return
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
          // FASE GE/JU: el MISMO cuerpo transaccional que jan1Value y que
          // "Reparar ahora", armado en lib/historyPayload.js, no una versión
          // recortada. Sin txEvents/cashFlows los docs 'backfill' ignoraban el
          // timing de los depósitos; sin `income`, el rendimiento reinvertido
          // (que nunca entra a balanceEventsById) queda invisible y la cuenta
          // que compone se archiva pegada a su valor de hoy.
          //
          // FASE GD: con huecos más viejos que la ventana clásica de 30 días se
          // pide el año completo (resolución diaria en la ruta); los gaps fuera
          // del rango devuelto simplemente no matchean ningún punto.
          body: JSON.stringify(buildHistoryRequestBody({
            items: assetItems, transactions, lots, convert,
            period: gaps.some((d) => (Date.now() - new Date(`${d}T00:00:00Z`).getTime()) > 32 * 86400000) ? 'YTD' : '1M',
          })),
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
        // Solo una pasada COMPLETA estampa el día (FASE HZ): un return temprano
        // (respuesta degradada, !res.ok, sin puntos) deja el día sin estampar y
        // el backoff reintenta más tarde, que es exactamente lo que la vieja
        // bandera de sesión no hacía. Se estampa aunque `cancelled` haya
        // cambiado a mitad: llegar a esta línea significa que TODAS las
        // escrituras de arriba ya ocurrieron (el loop no chequea cancelación),
        // y dejar el día sin estampar repetiría una pasada completa entera.
        backfillDayRef.current = todayKey
      } catch (err) {
        console.error('[backfill] Failed:', err.message)
      } finally {
        backfillRunningRef.current = false
      }
    }
    doBackfill()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, pricesFetching, ratesLoading, bulkWriting, ibkrAutoSyncing, enrichedItems, snapshots, lots, transactions, saveSnapshot, convert, migrateMisplacedNav])

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
      const { newPrice, newQuantity } = creditDestinationBalance(destRunningBalances, dest, amount, sourceCurrency, convert)
      // Banks track their balance in purchasePrice; for bonds/alternatives purchasePrice
      // is the cost basis and must survive income payments
      const isBankDest = isBankLike(dest)
      await updateItem(dest.id, {
        ...(isBankDest
          ? { currentPrice: newPrice, purchasePrice: newPrice }
          : { currentPrice: newPrice }),
        // Ver creditDestinationBalance: con cantidad 0 el saldo acreditado se
        // lee como CERO por más que el precio quede bien escrito.
        ...(newQuantity != null ? { quantity: newQuantity } : {}),
      })
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
        // FASE KS. El MISMO día de compra que ve la vista previa del
        // formulario, resuelto por el helper compartido: acá se leía con
        // getFullYear() LOCAL y allá con getUTCFullYear(), o sea las dos
        // superficies podían discrepar sobre en qué mes cae una compra.
        const acqDay = acquisitionDayISO(it.acquisitionDate)
        if (canBackfill) {
          const lookbackMonths = acqDate
            ? Math.min(24, Math.ceil((now.getTime() - acqDate.getTime()) / (30 * 86400000)))
            : 3
          for (let offset = lookbackMonths; offset >= 0; offset--) {
            const checkDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
            const checkMonth = checkDate.getUTCMonth()
            const checkYear = checkDate.getUTCFullYear()
            if (!payMonths.includes(checkMonth)) continue
            const payDay = it.incomePayDay || 1
            // Recortado al último día real del mes: ver clampPayDay
            // (lib/incomeSchedule.js) y el "2026-02-31" que desbordaba a marzo.
            if (offset === 0 && todayDay < clampPayDay(payDay, checkYear, checkMonth)) continue
            const dateStr = payDateFor(checkYear, checkMonth, payDay)
            // Un pago nunca es anterior a la compra. El guard viejo comparaba
            // contra el PRIMERO DEL MES de la compra, así que un día de pago
            // anterior dentro de ese mismo mes pasaba: comprando el 20 de
            // agosto con día de pago 1, se escribía un mes entero de interés
            // fechado el 1 de agosto.
            if (acqDay && dateStr < acqDay) continue
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
              // FASE KS. Esta rama no tenia NINGUN chequeo de fecha de compra,
              // asi que una cuenta creada el 20 de agosto con dia de pago 1
              // escribia su primer pago fechado el 1 de agosto.
              if (!acqDay || dateStr >= acqDay) {
                monthsToCheck.push({ dateStr, month: currentMonth, year: now.getUTCFullYear(), backfill: false })
              }
            }
          }
        }

        for (const { dateStr, month: payMonth, year: payYear, backfill } of monthsToCheck) {
          if (cancelled) return
          // Dates the user explicitly said did NOT happen (asked at account
          // creation, when the schedule implied a payment already due) —
          // never fabricate history for those, however the schedule reads.
          // Por MES, no por fecha exacta: ver isPayDateExcluded
          // (lib/incomeSchedule.js) y el "borro el pago y vuelve" que arregla.
          if (isPayDateExcluded(it.excludedPayDates, dateStr)) continue
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

          // FASE KT. Devengo DIARIO, asentado una vez a fin de mes: el monto
          // sale de los dias reales de ESE mes sobre el saldo de HOY, no de un
          // doceavo parejo. Va primero porque manda sobre cualquier otra rama
          // de tasa. De paso prorratea el mes de la compra, que el reparto
          // plano acreditaba entero por unos dias de tenencia.
          // FASE KY. El monto de un pago sale de UNA sola función compartida
          // (lib/incomeSchedule.js). Estaba escrito acá, en la vista previa del
          // alta, en la proyección anual y en la tarjeta de próximos pagos, y
          // las cuatro copias ya habían divergido; arreglar solo esta dejaría a
          // las otras contradiciendo al motor sobre el mismo activo.
          //
          // Y prorratea el primer período: comprar el 20 de agosto con día de
          // pago 1 acreditaba un mes COMPLETO el 1 de septiembre por once días
          // de tenencia. Solo las ramas de TASA; un monto fijo es contractual y
          // se paga entero (ver la cabecera de esa función).
          amount = monthlyIncomeAmount({
            balance, qty,
            isPerShare: /stock|etf|fund|crypto/i.test(it.type || ''),
            incomeMode: it.incomeMode, incomeRate: it.incomeRate, incomeAmount: it.incomeAmount,
            rateType: it.rateType, rateMin: it.rateMin, rateMax: it.rateMax,
            accrual: it.accrual, acquisitionDay: acqDay, payDate: dateStr,
            incomeMonths: payMonths, incomePayDay: it.incomePayDay || 1,
          }, payMonths.length || 12)

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
            // FASE KT: un devengo se ACUMULA, no se "paga", así que la
            // descripción lo dice. Se pregunta por el activo (`isDailyAccrual`)
            // y no por la tasa que antes se calculaba acá: es la misma
            // condición, y ahora el monto lo resuelve `monthlyIncomeAmount`.
            description: isDailyAccrual(it)
              ? `Accrued interest from ${it.name || it.symbol}`
              : `Dividend from ${it.name || it.symbol}`,
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
  // ⛔ FASE KD. Acá vivía `ibkrAutoSyncRef`, un booleano de "ya armé el
  // auto-sync en este mount" que hacía `return` en toda re-ejecución del
  // efecto. Con él, la cadencia recurrente estaba MUERTA en la práctica:
  //
  //   1. el efecto depende de `settings` Y de `handleIBKRSync`, cuyas deps
  //      incluyen `items`, o sea su identidad cambia con CADA tick de precios
  //      (~5 min) y con cualquier escritura de settings;
  //   2. la limpieza del efecto hacía `clearInterval`, así que el temporizador
  //      se destruía en la primera re-ejecución;
  //   3. la re-ejecución siguiente salía por el guard ANTES de crear uno nuevo.
  //
  // El propio sync escribe settings al terminar, así que eso pasaba siempre: de
  // ahí en adelante solo se sincronizaba al recargar la página. En una pestaña
  // que queda abierta días (el caso real del usuario) no volvía a correr nunca,
  // la misma enfermedad que FASE HZ arregló para el backfill. Y de paso, la
  // cadencia larga de FASE II3 tampoco podía aplicarse dentro de una sesión: el
  // intervalo quedaba capturado con el valor del primer arranque.
  //
  // Sin el guard, cada re-ejecución vuelve a evaluar la decisión
  // (`ibkrSyncDecision`, lib/ibkrSchedule.js) y re-arma el latido. No martillea:
  // desde FASE KN esa decisión permite un solo sync exitoso por día y como
  // mucho tres intentos, y `acquireLock('ibkr-sync')` se reparte entre pestañas
  // por BroadcastChannel, así que una re-ejecución a mitad de un sync no puede
  // arrancar un segundo.
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

  // FASE LH. El funnel de escritura: TODA reconciliación de IBKR (auto-sync,
  // pill manual, y los tres confirms de IBKRSyncModal llegan acá) espera a que
  // cualquier escritura masiva en curso termine, incluido el colchón de 1500ms
  // que deja aterrizar el eco del listener, y recién entonces toma su foto de
  // `items`. Techo de 30s: un bulkImport colgado más allá de eso es un estado
  // roto, y reconciliar contra una foto que se SABE vieja es exactamente el
  // bug que esto cierra, así que ahí se rehúsa en vez de proceder.
  const waitForBulkQuiet = useCallback(async () => {
    if (!bulkWritingRef) return true
    const deadline = Date.now() + 30000
    while (bulkWritingRef.current) {
      if (Date.now() > deadline) return false
      await new Promise((r) => setTimeout(r, 250))
    }
    return true
  }, [bulkWritingRef])

  const handleIBKRSync = useCallback(async (data, mode = 'merge', onProgress) => {
    // ⛔ FASE LH. Primero esperar, DESPUÉS tomar la foto: ese orden es lo que
    // la hace fresca. Ver waitForBulkQuiet y el espejo itemsRef arriba.
    const quiet = await waitForBulkQuiet()
    if (!quiet) throw new Error('Hay una importación escribiendo posiciones; el sync se saltó para no duplicar. Intenta de nuevo en un momento.')
    const itemsNow = itemsRef.current || []
    const snapshotsNow = snapshotsRef.current || []

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
      itemsNow.filter(it =>
        it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      ).forEach(it => deleteIds.push(it.id))
    }

    for (const item of data.items) {
      let existing = null
      if (mode === 'merge') {
        existing = itemsNow.find(it => {
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
    const newSnaps = planEquitySnapshotWrites(data.equityHistory || [], snapshotsNow, toUSDFrom)

    const incomingSymbols = new Set(data.items.filter(it => it.symbol).map(it => it.symbol.toUpperCase()))
    itemsNow.forEach(it => {
      if (deleteIds.includes(it.id)) return
      const isIbkr = it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      if (isIbkr && (it.quantity ?? 0) <= 0 && incomingSymbols.has((it.symbol || '').toUpperCase())) {
        deleteIds.push(it.id)
      }
    })
    // Y las que el broker YA NO reporta. La regla de arriba solo alcanza a lo
    // que SÍ viene en el feed, y el formateador filtra las posiciones en cero
    // antes de armarlo, así que una posición liquidada nunca volvía a aparecer
    // y por lo tanto nunca se borraba: seguía en el portafolio para siempre con
    // su última cantidad y precio. Los guardas que impiden que un reporte
    // parcial vacíe la cartera viven en lib/ibkrVanishedPositions.js.
    vanishedIbkrPositionIds({
      storedItems: itemsNow,
      feedItems: data.items || [],
      feedAccounts: data.accounts || [],
      hasCashSection: (data.sections?.cashReport || 0) > 0,
    }).forEach((id) => { if (!deleteIds.includes(id)) deleteIds.push(id) })
    const deleteSet = new Set(deleteIds)
    const afterCleanup = itemsNow.filter(it => !deleteSet.has(it.id))
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
      // ⛔ FASE KF: un id no puede estar en las dos listas. bulkImport encola los
      // borrados PRIMERO, así que un update sobre un doc ya borrado revienta el
      // commit entero. Ver lib/ibkrMergePlan.js para el caso que lo produce
      // (una posición vendida a cero que se vuelve a comprar).
      deleteIds: dropDeletesThatAreUpdated(deleteIds, updateOps),
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
    // FASE LH: items/snapshots salen de las deps a propósito (se leen de las
    // refs de arriba, más frescas que cualquier closure). `convert` y
    // `settings` ya se leían sin estar en deps desde antes; se conserva esa
    // identidad estable, que es lo que mantiene quieto al efecto de auto-sync.
  }, [waitForBulkQuiet, bulkImport, activePortfolio, activeEntity, saveSettings])

  useEffect(() => {
    if (dataLoading) return
    // Proceed if there's a legacy client-stored token OR creds already migrated to
    // the server vault (_ibkrVaultMigrated), as long as a query id exists.
    if ((!settings?.ibkrToken && !settings?._ibkrVaultMigrated) || !settings?.ibkrQueryId) return
    // ⛔ FASE KF. No arrancar mientras HAY una escritura masiva en curso. El
    // caso real es el paso 1→2 del viaje: el usuario acaba de guardar
    // credenciales (lo que destraba este efecto) y de inmediato sube su
    // archivo. Sin esta compuerta, el auto-sync corre encima del import y las
    // dos pasadas reconcilian contra la MISMA foto de `items`, así que la
    // segunda no encuentra lo que la primera acaba de crear y lo vuelve a
    // crear con id nuevo: posiciones duplicadas. Es la misma compuerta que los
    // cuatro escritores de snapshots ya usan (FASE GB).
    //
    // FASE LH cerró el alcance que esta compuerta dejaba abierto (la ventana
    // de DESCARGA): handleIBKRSync ahora espera a que toda escritura masiva
    // termine (waitForBulkQuiet, vía bulkWritingRef) y reconcilia contra la
    // foto FRESCA de itemsRef, así que un import que aterrice a mitad de una
    // descarga del Flex ya no puede producir posiciones duplicadas. Esta
    // compuerta de entrada se queda igual: es más barato ni arrancar.
    if (bulkWriting) return

    // ⛔ FASE KN. TODA la decisión de "¿sincronizo ahora?" vive en
    // lib/ibkrSchedule.js y devuelve su RAZÓN. Antes eran tres constantes de
    // tiempo evaluadas acá inline, así que cuando el sync no corría no había
    // forma de saber cuál compuerta lo paró. Las reglas nuevas: un sync
    // exitoso por día (IBKR actualiza el statement una sola vez, al cierre),
    // nunca dentro de su ventana de reset diaria, y un presupuesto de intentos
    // por día en vez de un techo que salía por accidente de la cadencia.
    const decide = () => ibkrSyncDecision({
      lastSuccess: [settings?._ibkrLastAutoSync, settings?._ibkrLastSync]
        .filter(Boolean).sort().pop() || null,
      lastAttempt: settings?._ibkrLastAutoSyncAttempt || null,
      attempts: settings?._ibkrAttemptsToday || null,
      errorCode: settings?._ibkrAutoSyncErrorCode,
      failCount: settings?._ibkrAutoSyncFailCount,
    })

    const first = decide()
    setIbkrSkipReason(first.sync ? null : first.reason)
    // Nada que esperar: estas dos razones no se levantan con el tiempo, así que
    // ni siquiera se arma el temporizador.
    if (!first.sync && (first.reason === 'fatal' || first.reason === 'lock-stuck')) return

    let cancelled = false
    const doAutoSync = async () => {
      // Se re-evalúa en CADA disparo, nunca solo al armar: el temporizador es un
      // latido, no una orden. Sin esto, un tick cada 30 minutos volvería a
      // sincronizar 48 veces al día por más que la regla diga una.
      const d = decide()
      if (!d.sync) { setIbkrSkipReason(d.reason); return }
      if (cancelled || !acquireLock('ibkr-sync')) return
      // ⚠ El intento NO se puede reclamar escribiendo settings ANTES de salir a
      // la red, por más natural que suene. Este efecto depende de `settings`,
      // así que esa escritura lo re-ejecuta, su cleanup marca `cancelled`, y el
      // `if (cancelled) return` de más abajo TIRA el resultado del sync que
      // acaba de volver: la sincronización se vuelve un no-op silencioso.
      // (Probado escribiéndolo así primero.) El presupuesto se estampa al
      // TERMINAR, en las dos ramas. Un sync que se cuelga no lo consume, y está
      // bien: si se colgó, tampoco soltó el lock, así que no hay un segundo
      // intento en esta sesión.
      setIbkrSkipReason(null)
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
            // FASE KC: lanza si el servidor no confirmó. Antes cualquier
            // respuesta contaba como guardada y la línea de abajo borraba el
            // token legacy: la única copia que existía.
            await saveIbkrCredentials(token, settings.ibkrQueryId)
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
          _ibkrLastAutoSyncAttempt: new Date().toISOString(),
          _ibkrAttemptsToday: bumpAttempts(settings?._ibkrAttemptsToday, ibkrDayKey()),
          _ibkrAutoSyncStatus: 'ok',
          _ibkrAutoSyncError: null,
          _ibkrAutoSyncErrorCode: null,
          _ibkrLastUpstreamError: null,
          _ibkrAutoSyncFailCount: 0,
          _ibkrLastSyncSummary: { ...autoSummary, changes: ibkrSyncChanges(settings?._ibkrLastSyncSummary, autoSummary) },
        })
      } catch (err) {
        if (cancelled) return
        const code = err.errorCode || 'UNKNOWN'
        saveSettings({
          _ibkrAutoSyncStatus: 'error',
          _ibkrAutoSyncError: err.message,
          _ibkrAutoSyncErrorCode: code,
          // ⛔ FASE KN. Lo que IBKR dijo LITERALMENTE. Para todo código que
          // mapeamos, `classifyError` reemplaza su texto por el nuestro, así que
          // hasta hoy las palabras exactas se perdían: el bloqueo que tuvo el
          // usuario no figura en los 19 códigos documentados, o sea es
          // justamente la clase de estado donde el texto crudo ES la evidencia.
          _ibkrLastUpstreamError: err.raw || null,
          _ibkrLastAutoSyncAttempt: new Date().toISOString(),
          _ibkrAttemptsToday: bumpAttempts(settings?._ibkrAttemptsToday, ibkrDayKey()),
          _ibkrAutoSyncFailCount: nextFailCount(settings?._ibkrAutoSyncFailCount),
        })
      } finally {
        // SIEMPRE, aunque cancelled: la bandera es estado del hook (vive entre
        // re-ejecuciones del efecto) y dejarla prendida congela el pipeline.
        if (ibkrSyncRunIdRef.current === runId) setIbkrAutoSyncing(false)
        releaseLock('ibkr-sync')
      }
    }

    if (first.sync) doAutoSync()
    // Latido, no cadencia: `doAutoSync` vuelve a decidir en cada disparo, así
    // que esto solo sirve para que una pestaña que queda abierta cruce a un día
    // nuevo o salga de la ventana de reset sin recargar.
    const interval = setInterval(doAutoSync, SYNC_HEARTBEAT_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [dataLoading, settings, user, handleIBKRSync, saveSettings, bulkWriting])

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
          await saveIbkrCredentials(token, settings.ibkrQueryId)
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
        // Un sync manual exitoso también saca al auto-sync de la cadencia larga:
        // si funcionó, lo que fallaba se arregló.
        _ibkrAutoSyncFailCount: 0,
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
  // ¿La reconstrucción del ancla del año ya contestó al menos una vez?
  //
  // Es un LATCH de una sola vía a propósito: este efecto se re-ejecuta con cada
  // tick de precios (su identidad de `enrichedItems` cambia), así que una
  // bandera que volviera a false en cada corrida haría parpadear a un esqueleto
  // cada pocos minutos. Misma distinción que `loading` vs `isFetching` de FASE
  // FE: lo que se quiere saber acá es si la PRIMERA respuesta ya llegó.
  //
  // Sin esto, un `returnYTD` en null es indistinguible entre "todavía no llega"
  // y "no se puede medir", y toda pantalla que imprima esos dos casos igual
  // (Amigos imprimía "-" para ambos) miente en uno de los dos.
  const [ytdResolved, setYtdResolved] = useState(false)
  useEffect(() => {
    // Sin activos no hay nada que reconstruir, y esa ausencia YA es la
    // respuesta: se marca resuelto en vez de dejar el latch colgado para
    // siempre en una cartera vacía.
    if (!enrichedItems || enrichedItems.length === 0) { setYtdResolved(true); return }
    let cancelled = false
    async function fetchJan1() {
      try {
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
          // FASE IG/JU: el MISMO cuerpo que el backfill que ARCHIVA el ancla.
          // El server levanta el valor del activo como escalón desde la fecha
          // de cada pago reinvertido; sin `income`, esta reconstrucción no veía
          // esos escalones y la de la gráfica sí, así que las dos daban enero
          // distinto para toda cuenta con rendimiento que se reinvierte
          // (ClubCashIn, los fondos líquidos de IDC).
          body: JSON.stringify(buildHistoryRequestBody({
            items: jan1Items, transactions, lots, convert,
            period: 'YTD', breakdown: true,
          })),
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
          // FASE IF: se busca el punto con desglose QUE CAE EN EL ANCLA, en vez
          // de exigir que sea el PRIMERO de la serie. La garantía es la misma
          // (las partes se miden exactamente en el ancla que usó el
          // encabezado), pero la versión vieja descartaba el desglose entero
          // cada vez que la serie traía algún punto anterior al primer total
          // positivo. Y descartarlo no dejaba al panel sin datos: lo mandaba a
          // los RESPALDOS, que es de donde salían las filas equivocadas. La
          // firma en el archivo del usuario: LEGDER con arranque IDÉNTICO a su
          // valor de hoy (el respaldo held-flat, que para una cripto que cayó
          // 40% en el año dice +0.00%), y de ahí el error se propagaba al
          // arranque despejado de IBKR (FASE IE lo calcula restando los
          // arranques manuales del ancla). Con byKey publicado, cada fila mide
          // en el mismo motor que su propia gráfica, que es el estándar fijado.
          // FASE IW: el desglose se mide en el ARRANQUE DEL AÑO cuando la serie
          // tiene un punto ahí, no en el primer punto con total positivo. Los
          // dos coinciden en un portafolio que nació a mitad de año (ahí el
          // ancla ES ese primer punto), pero no en uno que ya existía el 1 de
          // enero: la serie puede arrancar unos días después, y entonces cada
          // fila medía su cuenta en un día distinto al que el panel declaraba.
          // Sobre una cuenta volátil eso vale de verdad: LEGDER subió de ~$1,534
          // el 1 de enero a ~$1,780 el 15, así que medir el 6 le daba $1,661.52
          // y su fila quedaba $127 lejos de su propia gráfica, sin que ningún
          // otro término estuviera mal.
          const yearStartTs = Date.UTC(new Date().getUTCFullYear(), 0, 1)
          const atYearStart = pts.find((p) => p && p.byKey
            && new Date(p.ts).getUTCFullYear() === new Date(yearStartTs).getUTCFullYear()
            && new Date(p.ts).getUTCMonth() === 0 && new Date(p.ts).getUTCDate() === 1)
          const anchorTsForBreakdown = atYearStart ? atYearStart.ts : firstReal?.ts
          const picked = anchorTsForBreakdown != null ? pickAnchorBreakdown(pts, anchorTsForBreakdown) : null
          if (!cancelled && picked) {
            const toBase = (v) => (baseCurrency !== 'USD' && convert) ? convert(v, 'USD', baseCurrency) : v
            const scale = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toBase(v)]))
            // FASE IH: los símbolos cuyo precio histórico no se pudo traer NO
            // están medidos: el server cae a hold-flat y su valor de enero
            // termina siendo el de HOY. Aceptar eso como medición es la misma
            // degradación muda que el invariante 5 de la serie histórica
            // prohíbe, y su firma estaba en los números del usuario: una cripto
            // que cayó reporta menos pérdida de la real (arranque subestimado) y
            // una acción que subió reporta menos ganancia (arranque
            // sobrestimado). Viajan con el desglose para que el reparto sepa
            // cuáles cuentas no puede tratar como medidas.
            setYtdEndpoints({
              start: scale(picked.start),
              end: scale(picked.end),
              failedSymbols: data.degraded ? (data.failedSymbols || []) : [],
              // FASE IN: TODO activo de mercado que el server terminó
              // reconstruyendo como estático, incluida la rama determinista que
              // `failedSymbols` deja fuera a propósito (un símbolo que el
              // proveedor de precios no reconoce). Para el retorno las dos
              // rutas producen el mismo defecto: plano en el valor de HOY
              // aporta CERO al cambio del período, o sea la pérdida de ese
              // activo desaparece. Es la firma exacta del caso LEGDER: su
              // Bitcoin plano en $292.01 hace que el panel cuente solo la
              // pérdida del Ethereum.
              staticFallbackSymbols: data.staticFallbackSymbols || [],
              // FASE IU: el INSTANTE en el que de verdad se midio el desglose.
              // No tiene por que ser la fecha del ancla, y cuando se separan el
              // panel mide los arranques en un dia distinto al que declara.
              measuredTs: picked.startTs ?? null,
            })
          } else if (!cancelled) {
            setYtdEndpoints(null)
          }
        }
      } catch {} finally {
        // Se marca en el `finally`, así que un fetch que falla o vuelve !ok
        // también cuenta como "ya contestó": la pregunta que responde el latch
        // es si la espera terminó, no si el resultado fue bueno. Guardado por
        // `cancelled` porque una corrida abortada no terminó nada: la que la
        // reemplaza es la que va a marcarlo.
        if (!cancelled) setYtdResolved(true)
      }
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

  // ── FASE LU: el RENDIMIENTO mide activos, la deuda queda fuera ────────────
  // ⛔ Decisión del usuario (28 ago 2026): "la deuda tampoco debería de afectar
  // el YTD". Ver lib/assetReturns.js. La membresía viaja como FIRMA de
  // contenido y nunca como la identidad de portfolioItems (que se rehace con
  // cada tick de precios: la enfermedad de FASE DW/DY); sin deudas,
  // assetOnlyFlows devuelve la MISMA lista, así que un portafolio sin deuda
  // conserva identidades byte-idénticas aguas abajo.
  const debtIdsSig = useMemo(
    () => (portfolioItems || []).filter((it) => it?.isDebt && it.id).map((it) => it.id).sort().join('|'),
    [portfolioItems]
  )
  const debtIds = useMemo(() => new Set(debtIdsSig ? debtIdsSig.split('|') : []), [debtIdsSig])
  const assetTransactions = useMemo(() => assetOnlyFlows(transactions, debtIds), [transactions, debtIds])
  const assetDietzTransactions = useMemo(() => assetOnlyFlows(dietzTransactions, debtIds), [dietzTransactions, debtIds])

  const { returnYTD, returnYTDRaw, ytdChange, returnSinceStart, sinceStartDate, ytdCalibrated, ytdStartValue, ytdStartTs, ytdStartSrc, ytdFlowsUsed } = useMemo(() => {
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
    // FASE IQ: de qué DOC salió el ancla del año. Todo el YTD (el encabezado y
    // el reparto por cuenta) cuelga de este único documento, y sus dos formas
    // se comportan distinto ante la reparación diaria: un 'backfill' es
    // derivado y se re-deriva solo, un 'daily' es una observación y solo se
    // reescribe si difiere de la composición en más de 8%. Sin saber cuál es,
    // un descuadre chico contra ese ancla no se puede diagnosticar.
    let anchorSrc = null
    // When the start value is not actually Jan 1's, the window starts where the
    // value does (see jan1Ts). Only ever moves FORWARD from Jan 1.
    let startTs = yearStartTs
    if (augmentedSnapshots.length >= 2) {
      // Shared anchor (also used by the chart's YTD starting point) so the
      // Dietz badge and the chart never start the year from different values.
      const bestSnap = findYearStartAnchor(augmentedSnapshots, year)
      if (bestSnap) {
        // FASE LU: el ancla del año en SOLO-ACTIVOS. El campo lleva ahí
        // desde siempre (el escritor diario y el backfill guardan
        // totalActivosUSD/totalDebtUSD junto a netWorthUSD), así que no
        // hay que reescribir historia: solo dejar de leer el neto.
        anchorUSD = snapshotAssetsUSD(bestSnap)
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
        anchorSrc = bestSnap._source || 'daily'
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
      const first = sorted.find(s => snapshotAssetsUSD(s) > 0)
      if (first) {
        const firstUSD = snapshotAssetsUSD(first)
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
        if (firstVal > 0 && totalAssets > 0) {
          const firstTs = new Date(first.date).getTime()
          const { pct, abs } = computeModifiedDietz({
            startValue: firstVal, endValue: totalAssets,
            startTs: firstTs, endTs: Date.now(),
            transactions: firstFlowAware ? assetTransactions : assetDietzTransactions,
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
    if (startVal == null || startVal <= 0) return { returnYTD: null, ytdChange: null, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated, ytdStartValue: null, ytdStartTs: null, ytdStartSrc: null, ytdFlowsUsed: null }
    // FASE LU: la lista viene del universo de ACTIVOS (lib/assetReturns.js):
    // los flujos de una deuda no entran, y los que cruzan la frontera (pago
    // desde una cuenta, desembolso hacia una cuenta) entran como el flujo
    // externo que son. Sin deudas, es la lista de siempre, byte-idéntica.
    let ytdFlows = flowAware ? assetTransactions : assetDietzTransactions
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
    const endTsNow = Date.now()
    const { pct, abs, weightedCapital } = computeModifiedDietz({
      startValue: startVal, endValue: totalAssets,
      startTs, endTs: endTsNow,
      transactions: ytdFlows, convert, baseCurrency,
    })
    // FASE IA (extensión de la superficie congelada C, confirmada explícitamente
    // por el usuario; spec actualizada en el mismo commit). Una compra hecha
    // DENTRO de la ventana entra al Dietz como su DEPOSIT completo, comisión
    // adentro (6,098 = 6,000 + 98): restar ese flujo del valor final cobra la
    // comisión como pérdida en el numerador, la violación exacta que la spec
    // prohíbe ("la comisión va en el denominador y SOLO ahí"). La gráfica ya
    // medía contra el principal (computeWindowGrowth resta el capital nuevo
    // NETO de comisiones) y por eso encabezado y gráfica diferían $98.00
    // exactos (la comisión de VITALI) en las capturas del usuario. El addback
    // devuelve al numerador SOLO las comisiones cuyos depósitos este Dietz de
    // verdad neteó (el guard de entryFeeAddbacks lee la MISMA lista filtrada):
    // en el caso congelado del ancla movida los depósitos se descartaron, el
    // addback es cero y la rama ytdCostBase queda byte-idéntica (3.94%).
    // El denominador NO se toca: sigue siendo el capital all-in ponderado.
    const feeAddback = [...entryFeeAddbacks(portfolioItems, ytdFlows, {
      fromTs: startTs, toTs: endTsNow, convert, baseCurrency,
    }).values()].reduce((s, v) => s + v, 0)
    const adjAbs = abs + feeAddback
    // With every flow dropped, Dietz's weighted capital IS startVal, so swapping
    // the base is just re-dividing the same gain. This is the one place the
    // headline can be made to agree, to the decimal, with AssetAllocation and
    // InstitutionPerformance, which have always divided by all-in cost.
    let effPct
    if (ytdCostBase > 0 && startVal > 0) {
      effPct = (adjAbs / ytdCostBase) * 100
    } else if (feeAddback > 0 && isFinite(weightedCapital) && Math.abs(weightedCapital) > 0.01) {
      const p = (adjAbs / weightedCapital) * 100
      effPct = isFinite(p) ? p : pct
    } else {
      effPct = pct
    }
    const clampedPct = Math.max(-200, Math.min(200, effPct))
    // FASE GR, purely additive: the three terms this memo measured with, handed
    // out unchanged so the "where your YTD comes from" panel can partition the
    // SAME quantities instead of rebuilding its own version of them (which is
    // how it ended up contradicting this very number). No value computed above
    // is touched; nothing here alters the frozen YTD formula.
    // FASE LO: `returnYTDRaw` es el MISMO numero sin saturar a la banda de
    // +-200. `returnYTD` (clampeado) se sigue MOSTRANDO en el tablero; lo que
    // se PUBLICA a Amigos tiene que ser el crudo, porque `boundedPct`
    // (lib/friendsStats.js) decide ahi que fuera de banda no es medible y
    // publica null. Recibiendo un valor ya saturado nunca veia uno fuera de
    // banda, asi que el YTD mas roto se publicaba como +200.00% exacto y
    // encabezaba el ranking (el defecto que FASE JA5 vino a cerrar).
    return { returnYTD: clampedPct, returnYTDRaw: effPct, ytdChange: adjAbs, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated, ytdStartValue: startVal, ytdStartTs: startTs, ytdStartSrc: anchorSrc, ytdFlowsUsed: ytdFlows }
  }, [jan1Value, jan1Ts, jan1Transactional, totalAssets, assetTransactions, assetDietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot, accountCalibrations, portfolioItems])

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
          // FASE LU: una deuda no entra al universo del rendimiento, así
          // que su columna de diciembre tampoco es un arranque del año.
          if (owner.isDebt) return
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
  // Devuelve { breakdown, reason }: breakdown es lo de siempre (o null), y
  // reason nombra POR QUÉ el motor rehusó (FASE HT3), porque un rechazo mudo
  // dejaba al usuario tocando un YTD que no expande sin ninguna explicación.
  const { breakdown: ytdBreakdown, reason: ytdBreakdownReason, detail: ytdBreakdownDetail, terms: ytdBreakdownTerms, degradedAccounts: ytdDegradedAccounts } = useMemo(() => {
    if (ytdStartValue == null || ytdChange == null) return { breakdown: null, reason: 'no-anchor' }
    const start = ytdEndpoints?.start || {}

    // Which account each item belongs to, using the shared rule.
    const accountOf = new Map()
    const nameOf = new Map()
    ;(portfolioItems || []).forEach((it) => {
      // FASE LU: la deuda queda FUERA del universo del rendimiento (decisión
      // del usuario), así que no tiene fila ni cuenta acá. Sus flujos ya
      // llegan transformados en ytdFlowsUsed (lib/assetReturns.js): el pago
      // desde una cuenta es un WITHDRAWAL de esa cuenta y el desembolso de un
      // préstamo es un DEPOSIT en la que lo recibió.
      if (it.isDebt) return
      const k = accountKeyOfItem(it)
      if (!k) return
      accountOf.set(it.id, k)
      if (!nameOf.has(k)) {
        nameOf.set(k, k === 'ibkr' ? 'Interactive Brokers' : (it.institution || '').trim() || k)
      }
    })
    if (accountOf.size === 0) return { breakdown: null, reason: 'no-accounts' }

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
    // Cuánto de lo neteado por cuenta es dinero movido entre cuentas del propio
    // usuario (traspasos + ingreso generado por un activo y pagado a otra
    // cuenta), que es justo lo que la gráfica escopada NO netea.
    const internalByAccount = new Map()
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
        // FASE LU (reemplaza el neteo interno de deuda de FASE LT): con la
        // deuda fuera del universo, un TRANSFER que la cruza ya NO es interno:
        // es un flujo externo de la cuenta visible, y llega como el
        // DEPOSIT/WITHDRAWAL sintético de ytdFlowsUsed (lib/assetReturns.js),
        // atribuido arriba por _linkedItemId como cualquier otro flujo. Acá
        // solo se netean traspasos entre dos cuentas de ACTIVOS.
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
      // FASE IJ: se guarda CUÁNTO de la fila es movimiento interno. La gráfica
      // escopada netea solo DEPOSIT/WITHDRAWAL (flowTypes en
      // PortfolioGrowthChart), así que un traspaso entre cuentas propias lo lee
      // como rendimiento: pérdida en la que envía, ganancia en la que recibe. El
      // panel sí lo netea (tiene que hacerlo, o las filas no sumarían el
      // encabezado), y esa es toda la diferencia entre las dos cifras para una
      // cuenta con movimientos internos. Decir el monto convierte "estos dos
      // números se contradicen" en "esta cuenta movió X a otra cuenta tuya".
      internalByAccount.set(toKey, (internalByAccount.get(toKey) || 0) + amt)
      internalByAccount.set(fromKey, (internalByAccount.get(fromKey) || 0) - amt)
    })

    // FASE IA: el MISMO addback de comisiones de entrada que el encabezado (ver
    // el memo YTD arriba y la spec congelada). El DEPOSIT de una compra hecha
    // dentro de la ventana trae la comisión adentro; netearlo completo cobraba
    // la comisión como pérdida de ESA cuenta, y la fila divergía de la gráfica
    // escopada (IDC: fila +$207.57 contra gráfica +$379.74; la gráfica ya resta
    // el capital nuevo neto de comisiones). Se resta del FLUJO (no se suma al
    // gain) para que la identidad gain = end - start - flow siga siendo
    // literal; flowBase (el denominador del retorno) NO se toca: el % sigue
    // dividiendo entre el costo all-in, comisión incluida, igual que las
    // tarjetas (3.94%, no 4.00%). Como el encabezado recibe el mismo addback,
    // las filas siguen sumando el encabezado por construcción.
    entryFeeAddbacks(portfolioItems, ytdFlowsUsed, {
      fromTs: ytdStartTs, toTs: nowTs, convert, baseCurrency,
    }).forEach((fee, itemId) => {
      const k = accountOf.get(itemId)
      if (!k) return
      flowByAccount.set(k, (flowByAccount.get(k) || 0) - fee)
    })

    // start, PER ITEM first so each holding can take its value from whichever
    // engine is authoritative for it, then folded up to accounts.
    const startByItem = new Map()
    // FASE IL: de qué FUENTE salió el arranque de cada ítem. El arranque es el
    // único término estimado del reparto, así que es el único lugar por donde
    // entra error: saber si una fila se midió con el mismo motor que su gráfica
    // ('api'), o si cayó a un respaldo, es la diferencia entre diagnosticar y
    // deducir de los síntomas. Solo se ANOTA: cero cambio en qué valor se elige.
    const srcByItem = new Map()
    const staticFallbackSyms = new Set(
      (ytdEndpoints?.staticFallbackSymbols || []).map((s) => String(s).toUpperCase())
    )
    Object.entries(start || {}).forEach(([k, v]) => {
      // A byKey entry is keyed by item id, or by symbol when the item had none.
      const ownerId = accountOf.has(k)
        ? k
        : (portfolioItems || []).find((it) => (it.symbol || '').toUpperCase() === k)?.id
      if (!ownerId) return
      startByItem.set(ownerId, (startByItem.get(ownerId) || 0) + (Number(v) || 0))
      // FASE IN: byKey trae el valor igual cuando el server lo reconstruyó
      // PLANO, así que "vino del API" no equivale a "está medido". Sin esta
      // distinción la etiqueta decía `medido` sobre un activo cuyo arranque es
      // literalmente su valor de hoy, que es la afirmación más engañosa
      // posible: un activo plano aporta cero al retorno del período.
      const ownerSym = ((portfolioItems || []).find((it) => it.id === ownerId)?.symbol || '').toUpperCase()
      srcByItem.set(ownerId, (ownerSym && staticFallbackSyms.has(ownerSym)) ? 'flatprice' : 'api')
    })
    // FASE IC (regla del usuario: "la gráfica es el valor real"): la
    // reconstrucción por ítem del API (byKey) es EL MISMO MOTOR que dibuja la
    // gráfica escopada de cada cuenta (misma ruta, mismo payload, misma
    // convención de FX a tasa actual), así que tomarla PRIMERO hace que el
    // arranque de cada fila sea el de su gráfica POR CONSTRUCCIÓN. La columna
    // de diciembre del Spreadsheet baja de override a RESPALDO: solo cubre los
    // ítems que byKey no trajo (la sesión con el fetch caído, FASE IB). Por
    // qué ya no puede ser el override: su valor viene horneado en moneda base
    // con el FX de la época en que se calculó (el doc no guarda el monto en
    // moneda original, verificado), y esa diferencia de convención contra la
    // gráfica era exactamente el mismatch residual de IDC (fila $372.45 vs
    // gráfica $379.74: el Fondo Líquido en quetzales valuado con dos tasas
    // distintas). La razón de GR3 para preferir el Spreadsheet (byKey daba a
    // ClubCashIn un arranque que producía +$7.57) quedó obsoleta con FASE HV:
    // el rendimiento deducido del fondo ahora vive como transacciones REALES
    // (_source:'inferred_yield') que el rewind del API sí ve; y si el motor
    // compartido tuviera un defecto residual, la fila aterrizaría en el MISMO
    // número que la gráfica de esa cuenta, que es el estándar que el usuario
    // fijó.
    if (spreadsheetStart) {
      Object.entries(spreadsheetStart).forEach(([itemId, v]) => {
        if (!startByItem.has(itemId) && accountOf.has(itemId) && isFinite(v)) {
          startByItem.set(itemId, v)
          srcByItem.set(itemId, 'sheet')
        }
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
      if (acq != null && acq > ytdStartTs) {
        startByItem.set(itemId, 0)
        srcByItem.set(itemId, 'new')
      }
    })
    const startByAccount = new Map()
    // Las fuentes que compusieron el arranque de cada cuenta. Una cuenta con
    // ítems de fuentes distintas se reporta como mixta en vez de elegir una.
    const startSrcByAccount = new Map()
    // FASE IX8. Lo que el motor SÍ midió pero el panel no pudo colgar de ninguna
    // cuenta. Es una vía de pérdida silenciosa: la llave que devuelve el server
    // es el id del activo (o su símbolo si no tiene id), y si no resuelve contra
    // `accountOf` esa entrada simplemente se cae de la suma, con lo que el
    // arranque total queda por debajo del ancla y la diferencia aparece como
    // "Sin atribuir" sin decir de dónde salió. Se acumula para poder NOMBRARLA
    // en vez de deducirla: la lección de FASE HP, la única que de verdad ha
    // cortado estos casos.
    let unmappedStart = 0
    const unmappedKeys = []
    startByItem.forEach((v, itemId) => {
      const acct = accountOf.get(itemId)
      if (!acct) {
        if (Number.isFinite(v) && Math.abs(v) > 0.005) {
          unmappedStart += v
          unmappedKeys.push(itemId)
        }
        return
      }
      startByAccount.set(acct, (startByAccount.get(acct) || 0) + v)
      if (!startSrcByAccount.has(acct)) startSrcByAccount.set(acct, new Set())
      startSrcByAccount.get(acct).add(srcByItem.get(itemId) || 'api')
    })
    // The per-item reconstruction is not always available (its endpoints only
    // publish when the series' first point IS the anchor the headline used), and
    // the panel should not vanish for that: these starts are estimates that get
    // pinned to the anchor anyway, so the shape is all that is needed. Fall back
    // to the same held-flat per-account estimate the calibration flow uses.
    // FASE IB: POR CUENTA, no solo cuando el mapa entero quedó vacío. En una
    // sesión donde el fetch por ítem falla o llega degradado, startByItem queda
    // con cobertura PARCIAL (el Spreadsheet solo reconstruye lo estático):
    // IBKR y las cuentas de puro mercado quedaban con arranque $0 y sus saldos
    // COMPLETOS se leían como ganancia. Esa es la anatomía exacta del residuo
    // de $6,667.71 (la suma de los arranques faltantes) que hizo rehusar el
    // panel entero el 13 ago. Una cuenta cuyo único dato es el 0 del zeroing
    // de arriba (OSMO, abierta en febrero) SÍ tiene entrada y no cae aquí: ese
    // 0 es un hecho, no cobertura faltante. Para IBKR el held-flat también da
    // 0 (effectiveAcqTs es el sello del sync, posterior al ancla), pero su
    // rescate real es el NAV del broker que build(true) ya usa.
    // FASE IF: se anota CUÁLES cuentas cayeron al respaldo held-flat. Mantener
    // hoy el valor hacia atrás no es una medición: para una cuenta que se movió
    // dice exactamente "no pasó nada en el año" (LEGDER: −39.98% en su gráfica,
    // +0.00% en la fila). No se puede simplemente descartar la cuenta (la fila
    // desaparecería), pero sí se puede impedir que ese número contamine el
    // despeje del arranque del broker, que se calcula restando los arranques
    // manuales del ancla: un manual inflado le resta al broker lo mismo.
    const heldFlatAccounts = new Set()
    ;[...endByAccount.keys()].forEach((k) => {
      if (startByAccount.has(k)) return
      // Una cuenta ABIERTA DESPUÉS del ancla no tiene arranque que estimar: su
      // valor ese día era CERO, y eso es un hecho. Se reconoce por ausencia
      // porque un activo adquirido después del ancla no aporta ninguna entrada
      // al desglose en ese punto (el server lo salta antes de escribirla), así
      // que la cuenta llega hasta acá sin nada. Sin esta rama caía al respaldo
      // held-flat y su etiqueta pasaba de nombrar el hecho ("abrió este año") a
      // "sin fuente", que suena a dato faltante cuando es lo contrario.
      const own = (portfolioItems || []).filter((it) => accountOf.get(it.id) === k)
      const bornThisYear = own.length > 0 && own.every((it) => {
        if (it._source === 'ibkr' || shouldHoldFlat(it, transactions, lots)) return false
        const acq = effectiveAcqTs(it)
        return acq != null && acq > ytdStartTs
      })
      if (bornThisYear) {
        startByAccount.set(k, 0)
        startSrcByAccount.set(k, new Set(['new']))
        return
      }
      const est = heldFlatAccountValueUSD(portfolioItems, k, ytdStartTs, convert)
      if (isFinite(est) && est > 0) {
        startByAccount.set(k, convertSnapshot(est))
        heldFlatAccounts.add(k)
        startSrcByAccount.set(k, new Set(['flat']))
      }
    })
    // FASE IH: una cuenta cuyo arranque salió de un símbolo cuyo precio
    // histórico no se pudo traer tampoco está medida (el server lo mantuvo
    // plano al valor de HOY), así que cuenta como held-flat para todo lo que
    // sigue: no puede alimentar el despeje del arranque del broker.
    const failedSyms = new Set((ytdEndpoints?.failedSymbols || []).map((s) => String(s).toUpperCase()))
    const degradedAccounts = new Set()
    if (failedSyms.size > 0) {
      ;(portfolioItems || []).forEach((it) => {
        const sym = (it.symbol || '').toUpperCase()
        if (!sym || !failedSyms.has(sym)) return
        const k = accountOf.get(it.id)
        if (!k) return
        degradedAccounts.add(k)
        heldFlatAccounts.add(k)
        startSrcByAccount.set(k, new Set(['flat']))
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
    // FASE IX5. Primero, el NAV EN la fecha del ancla con la MISMA regla de
    // arrastre con la que se compuso ese doc (lib/snapshotBackfill.js). El panel
    // descompone el ancla que usa el encabezado, así que leer su mitad de broker
    // con otra regla hace que la resta no cierre: el 1 de enero es feriado, el
    // compositor arrastró el NAV del 31 de diciembre ($5,504.30) y
    // findYearStartAnchor tomaba el PRIMER doc de enero (el 2, $5,433.96). Esos
    // $70.34 eran el grueso del residuo "Sin atribuir".
    const anchorDateStr = ytdStartTs != null && isFinite(ytdStartTs)
      ? new Date(ytdStartTs).toISOString().split('T')[0]
      : null
    const navEntry = anchorDateStr
      ? navEntryAsOf(buildNavByDate(snapshots || []), anchorDateStr)
      : null
    const navAtAnchor = navEntry ? navEntry.value : null
    // Respaldo para un portafolio sin docs de NAV por fecha (nada compuesto
    // todavía): el comportamiento de siempre, la observación de arranque de año
    // más cercana.
    const brokerAnchor = navAtAnchor == null
      ? findYearStartAnchor(
        (snapshots || []).filter((s) => s && BROKER_NAV_SOURCES.includes(s._source)),
        new Date().getFullYear()
      )
      : null
    const brokerStartUSD = navAtAnchor != null
      ? convertSnapshot(navAtAnchor)
      : (brokerAnchor ? convertSnapshot(brokerAnchor.netWorthUSD ?? brokerAnchor.totalActivosUSD ?? 0) : null)

    // El arranque del broker despejado del ancla (lib/ytdAttribution.js): con
    // broker conectado el ancla es un doc compuesto (NAV real + reconstrucción
    // de lo manual), así que restarle los arranques manuales devuelve el NAV
    // real de esa fecha. Es la diferencia que hacía rehusar el panel cuando el
    // ancla del broker no se encuentra por fecha: los arranques usaban la
    // estimación por precios del broker y el ancla su NAV real.
    // Solo con TODOS los arranques manuales medidos: si alguno vino del
    // respaldo held-flat, su error entra entero al despeje y el broker termina
    // con una fila equivocada en vez de una ausencia honesta (le pasó a IBKR:
    // el arranque de LEGDER inflado ~$671 se lo restó al broker).
    const manualKeys = [...endByAccount.keys()].filter((k) => k !== 'ibkr')
    const derivedBrokerStart = endByAccount.has('ibkr') && !manualKeys.some((k) => heldFlatAccounts.has(k))
      ? deriveBrokerStart({
        anchor: ytdStartValue,
        manualStarts: manualKeys.map((k) => startByAccount.get(k) || 0),
      })
      : null

    const srcLabel = (k, realStart, brokerSrc) => {
      if (realStart != null) return brokerSrc
      const set = startSrcByAccount.get(k)
      if (!set || set.size === 0) return 'none'
      if (set.size > 1) return 'mixed'
      return [...set][0]
    }

    const build = (brokerStartOverride, brokerSrc) => [...endByAccount.keys()].map((k) => {
      const realStart = (k === 'ibkr' && brokerStartOverride != null && brokerStartOverride > 0)
        ? brokerStartOverride
        : null
      return {
        startSrc: srcLabel(k, realStart, brokerSrc),
        // FASE IX7: de QUÉ día salió el NAV del broker. Con arrastre, "el 1 de
        // enero" puede ser el cierre del 31 de diciembre, y esa fecha es lo que
        // permite ver si la regla de FASE IX5 se está aplicando y contra qué
        // día, en vez de deducirlo de que el número no cambió.
        startDate: (k === 'ibkr' && realStart != null && brokerSrc === 'nav') ? (navEntry?.date || null) : null,
        key: k,
        name: nameOf.get(k) || k,
        endVal: endByAccount.get(k) || 0,
        flow: flowByAccount.get(k) || 0,
        flowBase: flowBaseByAccount.get(k) || 0,
        start: realStart != null ? realStart : (startByAccount.get(k) || 0),
        startIsReal: realStart != null,
        internal: internalByAccount.get(k) || 0,
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
    // Se reporta la razón del intento TODO-ESTIMADO (el de último recurso):
    // que el intento con NAV real falle es esperado a veces y el fallback
    // existe justo para eso; lo que explica la ausencia del panel es por qué
    // falló también el último intento.
    // Tres intentos, del mejor dato al último recurso: NAV real del broker por
    // fecha; el mismo NAV despejado del ancla (exacto por construcción cuando
    // el ancla es un doc compuesto); y todo estimado por precios.
    const diagReal = {}
    const diagDerived = {}
    const diagEst = {}
    const attempts = [
      { accounts: build(brokerStartUSD, 'nav'), diag: diagReal },
      ...(derivedBrokerStart != null ? [{ accounts: build(derivedBrokerStart, 'derived'), diag: diagDerived }] : []),
      { accounts: build(null, null), diag: diagEst },
    ]
    let breakdown = null
    // Los términos del intento que DE VERDAD alimentó el panel: con tres
    // intentos posibles, mostrar los del último no describiría lo que el
    // usuario está viendo.
    let usedAccounts = null
    for (const at of attempts) {
      breakdown = attributeYtd({ accounts: at.accounts, ...args }, at.diag)
      if (breakdown) { usedAccounts = at.accounts; break }
    }
    // El detail viaja con la razón DEL MISMO intento (FASE HY): mezclar la
    // razón del intento estimado con los números del intento real describiría
    // un rechazo que no ocurrió.
    const chosen = diagEst.reason ? diagEst : diagReal
    // FASE IB: el detalle del rechazo lleva también los TÉRMINOS POR CUENTA del
    // intento reportado (arranque/hoy/flujos) y el ancla. Con solo el residuo
    // total ($6,667.71) supimos la escala pero no QUÉ cuenta faltaba: con esta
    // lista, la próxima captura es el diagnóstico completo (lección FASE HP).
    // FASE IK: los mismos términos, también cuando el panel SÍ muestra. Hasta
    // ahora solo existían en el estado de RECHAZO, así que una fila que no
    // coincide con la gráfica de su cuenta se podía ver pero no diagnosticar:
    // había que deducir de los síntomas si el desvío venía del arranque o de
    // los movimientos, que es exactamente lo que consume una ronda entera
    // (lección FASE HP). Van detrás de un toggle: es diagnóstico, no algo que
    // el usuario venga a leer.
    const termAccounts = (usedAccounts || build(null, null))
      .map((a) => ({ name: a.name, start: a.start, end: a.endVal, flow: a.flow, real: !!a.startIsReal, src: a.startSrc, srcDate: a.startDate || null }))
    return {
      breakdown,
      // La FECHA del ancla, no solo su valor: `findYearStartAnchor` acepta el
      // snapshot más cercano dentro de una ventana alrededor del 1 de enero, así
      // que el arranque puede estar parado semanas después. En una cuenta que se
      // movió fuerte en enero eso cambia por completo su número, y sin la fecha
      // no hay forma de distinguirlo de un arranque mal reconstruido.
      terms: {
        accounts: termAccounts, anchor: ytdStartValue,
        anchorTs: ytdStartTs, anchorSrc: ytdStartSrc,
        measuredTs: ytdEndpoints?.measuredTs ?? null,
        // FASE IX8: arranque que el motor midió y el panel no pudo colgar de
        // ninguna cuenta. Distinto de "Sin atribuir" (que es la diferencia
        // contra el ancla): esto dice si parte de esa diferencia se pierde
        // ACÁ, al agrupar, en vez de venir de que el ancla y el motor
        // reconstruyan distinto.
        unmappedStart: Math.abs(unmappedStart) > 0.005 ? unmappedStart : 0,
        unmappedCount: unmappedKeys.length,
      },
      // FASE II: nombres de las cuentas cuyo arranque de año NO está medido,
      // por cualquiera de las dos razones: la reconstrucción por ítem no las
      // cubrió (respaldo held-flat = valor de hoy hacia atrás) o sus precios
      // históricos no se pudieron traer. Las dos producen el mismo defecto (una
      // fila que no coincide con la gráfica de su propia cuenta) y el usuario
      // merece saber CUÁL fila mirar con desconfianza, en vez de dudar del
      // panel entero. De paso es el discriminador que faltaba para diagnosticar:
      // si una cuenta aparece acá, su arranque es un respaldo; si no aparece y
      // su fila igual no coincide, la causa está en otro lado.
      // El nombre de toda cuenta cuyo arranque NO está medido, por cualquiera de
      // las tres vías: cayó al respaldo held-flat, sus precios fallaron, o
      // (FASE IN) alguno de sus activos de mercado se reconstruyó plano. Las
      // tres producen el mismo defecto para el lector, así que se nombran
      // juntas. Ojo: esto es SOLO el texto del aviso; `heldFlatAccounts` (que
      // gatea el despeje del arranque del broker) no se toca acá.
      degradedAccounts: [...new Set([
        ...[...heldFlatAccounts],
        ...[...startSrcByAccount.entries()]
          .filter(([, set]) => set.has('flatprice'))
          .map(([k]) => k),
      ])].map((k) => nameOf.get(k) || k),
      pricesFailed: [...degradedAccounts].map((k) => nameOf.get(k) || k),
      reason: breakdown ? null : (chosen.reason || 'unknown'),
      detail: breakdown ? null : {
        ...(chosen.detail || {}),
        accounts: termAccounts,
        anchor: ytdStartValue,
        anchorTs: ytdStartTs,
        anchorSrc: ytdStartSrc,
        measuredTs: ytdEndpoints?.measuredTs ?? null,
        // Un solo bit que separa "el NAV del broker no se encontró por fecha"
        // de "se encontró y contradice al ancla": sin él, cada ronda de
        // diagnóstico se va en deducirlo de los síntomas (lección FASE HP).
        brokerAnchorFound: brokerStartUSD != null,
      },
    }
  }, [ytdEndpoints, portfolioItems, convert, baseCurrency, ytdChange, ytdStartValue, ytdStartTs, ytdStartSrc, ytdFlowsUsed, snapshots, convertSnapshot, spreadsheetStart, transactions, lots])

  // Month-to-date return (Modified Dietz) — the "how are we doing THIS month"
  // number for the Friends monthly leaderboard. Same shape as YTD, anchored to
  // the prior month-end snapshot; null when there's no reliable month anchor.
  const returnMTDRaw = useMemo(() => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()
    if (totalAssets <= 0) return null
    const anchor = findMonthStartAnchor(augmentedSnapshots, year, month)
    // FASE LU: mismo universo que el YTD, solo activos (se publica a Amigos).
    let startVal = anchor ? convertSnapshot(snapshotAssetsUSD(anchor)) : null
    if (startVal == null || startVal <= 0) return null
    const { pct } = computeModifiedDietz({
      startValue: startVal, endValue: totalAssets,
      startTs: Date.UTC(year, month, 1), endTs: Date.now(),
      transactions: (REAL_SNAPSHOT_SOURCES.includes(anchor._source) || anchor._transactional) ? assetTransactions : assetDietzTransactions,
      convert, baseCurrency,
    })
    // Crudo: la banda la aplica `boundedPct` al publicar (ver returnYTDRaw).
    // Quien lo MUESTRA lo clampea abajo.
    return pct
  }, [totalAssets, assetTransactions, assetDietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot])

  // Lo que se MUESTRA: el mismo MTD acotado a la banda representable.
  const returnMTD = useMemo(
    () => (returnMTDRaw == null ? null : Math.max(-200, Math.min(200, returnMTDRaw))),
    [returnMTDRaw]
  )

  // IBKR-only returns (Modified Dietz over the raw broker NAV + broker flows) for
  // the Friends "IBKR only" leaderboard scope. Uses RAW snapshots (not augmented,
  // which mix in manual assets). Null until the user has IBKR snapshots + flows.
  const ibkrReturns = useMemo(
    () => computeScopedReturns({ snapshots, items: enrichedItems, transactions, source: 'ibkr', convert, baseCurrency, nowTs: Date.now() }),
    [snapshots, enrichedItems, transactions, convert, baseCurrency]
  )

  // ⛔ Publicar a Amigos una vez por día, desde el TABLERO.
  //
  // El defecto que cierra: los números de una persona solo se publicaban al
  // abrir /friends. Quien no entra a esa pantalla deja su fila congelada en la
  // foto de la última vez que entró, y el grupo la sigue rankeando al lado de
  // filas de hoy sin que nada lo diga. El tablero es donde la gente sí entra a
  // diario, así que publicar desde acá es lo que hace que todas las filas del
  // grupo sean del mismo día.
  //
  // Las compuertas son las MISMAS que las de los escritores de snapshots, y por
  // la misma razón: publicar un número EQUIVOCADO es peor que publicar uno
  // viejo, y acá el número lo leen otras personas. En particular
  // `ytdResolved` (el ancla del año todavía reconstruyéndose) y `ratesLoading`
  // (sin tasas, `convert` devuelve el monto CRUDO, o sea una cartera en
  // quetzales publicaría pesos de mover calculados 1:1, FASE JA3).
  //
  // La cadencia es por DÍA UTC y se persiste en settings, no en un ref: un ref
  // solo cubre la pestaña. Se estampa DESPUÉS de que la publicación salga bien
  // (la lección de FASE KN: estampar antes re-ejecuta este efecto, su cleanup
  // marca `cancelled` y el resultado se tira), y el fallo se traga a propósito
  // porque esto es trabajo de fondo: nadie pidió publicar en este instante y un
  // aviso acá sería ruido sobre una pantalla que está haciendo otra cosa.
  const friendsPublishRunningRef = useRef(false)
  const friendsPublishAttemptRef = useRef({ dayKey: null, tries: 0 })
  useEffect(() => {
    if (!publishFriends) return
    if (!user || settings?.friendsEnabled === false) return
    if (friendsPublishRunningRef.current) return
    if (!shouldPublishToday({ lastDay: settings?._lastFriendsPublish })) return
    // Techo de intentos por día: las deps de este efecto se re-evalúan con cada
    // tick de precios (~5 min), así que sin esto un endpoint caído se
    // martillaría toda la sesión.
    const dayKey = publishDayKey()
    const att = friendsPublishAttemptRef.current
    if (att.dayKey === dayKey && att.tries >= 3) return
    if (dataLoading || pricesLoading || pricesFetching || ratesLoading || !ytdResolved) return
    const payload = buildPublishPayload({
      // Los CRUDOS, no los que muestra el tablero: la banda la aplica
      // `boundedPct` al publicar, y saturarlos antes la dejaba sin trabajo.
      enrichedItems, returnYTD: returnYTDRaw, returnMTD: returnMTDRaw, dailyChange, totalAssets,
      ibkrReturnYTD: ibkrReturns.ytd, ibkrReturnMTD: ibkrReturns.mtd, ibkrDayChange: ibkrReturns.day,
      profile, user,
    })
    if (!payload) return
    friendsPublishRunningRef.current = true
    friendsPublishAttemptRef.current = { dayKey, tries: (att.dayKey === dayKey ? att.tries : 0) + 1 }
    ;(async () => {
      try {
        const res = await authFetch('/api/friends', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync', ...payload }),
        })
        // authFetch NO lanza ante un 4xx/5xx (la lección de lib/ibkrVault.js):
        // sin leer el status, un fallo del servidor estampaba el día y la fila
        // quedaba sin publicar hasta mañana.
        if (!res.ok) return
        await saveSettings({ _lastFriendsPublish: dayKey })
      } catch {
        // Silencio a propósito: ver arriba.
      } finally {
        friendsPublishRunningRef.current = false
      }
    })()
  }, [
    publishFriends, user, settings?.friendsEnabled, settings?._lastFriendsPublish,
    dataLoading, pricesLoading, pricesFetching, ratesLoading, ytdResolved,
    enrichedItems, returnYTD, returnMTD, dailyChange, totalAssets, ibkrReturns, profile, saveSettings,
  ])

  const annualDividends = useMemo(() => {
    // Trailing 12 months only — this figure is labeled "Dividendos/año" in the UI
    // and the PDF report, so a lifetime sum would overstate it more every year.
    // Undated dividends can't be placed in time and are excluded.
    const cutoff = Date.now() - 365 * 86400000
    // FASE JW: la regla compartida, no la bandera sola. Un pago escrito cuando
    // la cuenta estaba en "recibo el efectivo" no lleva `_reinvested`, así que
    // se contaba como cobrado aunque la cuenta ahora reinvierta y el dinero
    // nunca haya salido del activo.
    const divIdx = reinvestIndex(enrichedItems)
    const divs = (transactions || []).filter((tx) => {
      if ((tx.type || '').toUpperCase() !== 'DIVIDEND') return false
      if (isReinvestedDividend(tx, divIdx)) return false
      const ts = tx.date ? new Date(tx.date).getTime() : NaN
      return !isNaN(ts) && ts >= cutoff
    })
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, enrichedItems, convert, baseCurrency])

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
      .filter((it) => isBankLike(it))
      .reduce((s, it) => s + getItemValue(it), 0)
  }, [portfolioItems])

  const riskMetrics = useMemo(() => {
    // Serie AUMENTADA, nunca los snapshots crudos (FASE HT4): un día cuyo
    // único doc es NAV solo-broker mide UNA cuenta, y mezclado con días de
    // portafolio completo fabrica retornos gigantes que no existieron. La
    // volatilidad salía 116.4% anualizada sobre un portafolio con drawdown
    // real de -5.6%. computePeriodicReturns además resuelve por día y excluye
    // anclas de calibración por su cuenta (defensa para cualquier caller).
    // FASE LV: mismos universos que el YTD (FASE LU): retornos y riesgo
    // miden activos, con la lista de flujos del universo de activos.
    const returns = computePeriodicReturns(augmentedSnapshots, assetTransactions, convert, baseCurrency)
    const ppy = inferPeriodsPerYear(augmentedSnapshots)
    const sharpeResult = computeSharpeRatio({ returns, periodsPerYear: ppy })
    const vol = computeVolatility({ returns, periodsPerYear: ppy })
    const valueSeries = (augmentedSnapshots || [])
      .filter((s) => !s._calibrated && !s._account)
      .map((s) => ({ ts: new Date(s.date).getTime(), value: snapshotAssetsUSD(s) }))
      .filter((p) => !isNaN(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(filterValueSpikes(valueSeries))
    // Beta vs benchmark con el MISMO emparejado que usa la pestaña de Riesgo
    // (pairPortfolioWithBenchmark, compartido): el reporte lo imprime.
    const { beta } = pairPortfolioWithBenchmark(filterValueSpikes(valueSeries), benchmarkData)
    return { sharpe: sharpeResult.sharpe, volatility: vol, maxDrawdown: drawdown.maxDrawdownPct, beta }
  }, [augmentedSnapshots, assetTransactions, convert, baseCurrency, benchmarkData])

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
    const returns = computePeriodicReturns(ibkrRealSnapshots, assetTransactions, convert, 'USD')
    const ppy = inferPeriodsPerYear(ibkrRealSnapshots)
    return computeVolatility({ returns, periodsPerYear: ppy })
  }, [ibkrRealSnapshots, assetTransactions, convert])

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
        // Los movimientos que el motor SÍ contó, para que el modal pueda
        // mostrarlos uno por uno. Sin esto, un veredicto de "falta un retiro"
        // es imposible de contrastar contra el propio historial del usuario:
        // hay que deducir de dos números cuál de sus filas no entró.
        contributions,
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

  // Cuentas de saldo cuya CANTIDAD quedó en cero, así que valen 0 para toda la
  // app mientras su precio guarda el saldo real (el cupón de XOCHI que el
  // usuario vio archivado y con la Hoja en 0.00). Ver lib/zeroQuantityHeal.js:
  // ahí está por qué el alcance `isBankLike` es lo que lo hace seguro. Esto sana
  // lo YA escrito; que no vuelva a escribirse lo cierra creditDestinationBalance.
  //
  // El ref lleva los ids YA sanados y no un booleano de sesión a propósito: si
  // un camino de escritura deja una cuenta en ese estado a mitad de la sesión
  // (agregar dinero a una cuenta vacía escribe el precio y no la cantidad), esto
  // lo corrige en el acto en vez de esperar a la próxima recarga. Un id sanado
  // no se vuelve a escribir, así que no hay lazo posible.
  const zeroQtyHealedRef = useRef(new Set())
  useEffect(() => {
    if (dataLoading || bulkWriting || !updateItem) return
    // Las dos caras del mismo hueco: una cuenta con saldo que la app lee como
    // cero (cantidad 0), y una cuenta vaciada cuyo saldo RESUCITA por un
    // residuo en price/cost. La cantidad que se escribe es la contraria en cada
    // caso, así que se resuelven por separado y jamás pueden solaparse (una
    // pide cantidad 0 y la otra cantidad > 0).
    const fixes = [
      ...zeroQuantityBalanceFixes(portfolioItems).map((id) => ({ id, quantity: 1 })),
      ...resurrectedBalanceFixes(portfolioItems).map((id) => ({ id, quantity: 0 })),
    ].filter((f) => !zeroQtyHealedRef.current.has(f.id))
    if (fixes.length === 0) return
    fixes.forEach((f) => zeroQtyHealedRef.current.add(f.id))
    let cancelled = false
    ;(async () => {
      for (const f of fixes) {
        if (cancelled) return
        try { await updateItem(f.id, { quantity: f.quantity }) } catch (e) { console.error('[zero-qty-heal]', e.message) }
      }
    })()
    return () => { cancelled = true }
  }, [portfolioItems, dataLoading, bulkWriting, updateItem])

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

  // Self-heal: trades de IBKR guardados con la fecha CRUDA del Flex
  // ("20260115"). El parser ya normaliza (lib/parsers/ibkrFlex.js), pero el id
  // del documento se deriva de la fecha, así que sin esto el primer sync con el
  // parser arreglado escribiría el doc corregido AL LADO del viejo y el usuario
  // vería cada operación dos veces. Se re-sella: alta del corregido primero
  // (bulkImport le deriva el id nuevo con el esquema de siempre) y recién
  // después el borrado del viejo, para que un alta fallida no deje el dato
  // huérfano. Una sola pasada por sesión: al corregirse, la próxima no
  // encuentra nada.
  const tradeDateFixRef = useRef(false)
  useEffect(() => {
    if (dataLoading || bulkWriting || ibkrAutoSyncing) return
    if (!bulkImport || !deleteTransaction) return
    if (tradeDateFixRef.current) return
    const fixes = staleTradeDateFixes(transactions)
    if (fixes.length === 0) return
    tradeDateFixRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        await bulkImport({ transactions: fixes.map((f) => f.tx) })
        for (const { oldId } of fixes) {
          if (cancelled) return
          await deleteTransaction(oldId)
        }
      } catch (e) {
        console.error('[ibkr-trade-date-fix]', e?.message)
        tradeDateFixRef.current = false
      }
    })()
    return () => { cancelled = true }
  }, [dataLoading, bulkWriting, ibkrAutoSyncing, transactions, bulkImport, deleteTransaction])

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
    const isBankDest = isBankLike(dest)
    const { newPrice, newQuantity } = creditDestinationBalance({}, dest, delta, currency, convert)
    await updateItem(dest.id, {
      ...(isBankDest ? { currentPrice: newPrice, purchasePrice: newPrice } : { currentPrice: newPrice }),
      ...(newQuantity != null ? { quantity: newQuantity } : {}),
    })
  }, [updateItem, convert])

  // Fechas ya marcadas como "ese mes no pagó" durante esta sesión, por activo.
  const excludedPayRef = useRef(new Map())
  // `opts.skipBalanceReversal`: borrar un movimiento ANTERIOR a la fecha del
  // saldo tecleado no puede mover ese saldo, porque el saldo ya refleja lo que
  // de verdad pasó (invariante 1 de lib/assetLogic/liquidFundYield.js). Lo pasa
  // el desglose del rendimiento; el resto de las pantallas no lo usa y conserva
  // la reversión de siempre. Se lee defensivo porque esta función viaja como
  // prop `onDeleteTransaction` y algún caller podría pasar un segundo argumento
  // que no sea un objeto de opciones.
  const deleteTransactionWithReversal = useCallback(async (txId, opts) => {
    const skipBalanceReversal = !!(opts && typeof opts === 'object' && opts.skipBalanceReversal)
    const tx = transactions.find((t) => t.id === txId)

    // Una TRANSFERENCIA movió los saldos de DOS cuentas al escribirse, así que
    // borrarla sin devolverlos las deja permanentemente mal, y en silencio: ese
    // era el bug. Va por su propio camino ATÓMICO (los dos ítems y el borrado
    // de la fila en un solo batch) en vez del `applyDestinationDelta` de abajo,
    // que hace un update suelto y para dos lados podría dejar la mitad hecha.
    // Quién recibe qué lo decide `transferReversalPlan`, puro y con tests.
    const reversal = tx && !skipBalanceReversal ? transferReversalPlan(tx, enrichedItems) : null
    if (reversal) {
      if (!reversalWritesSomething(reversal)) {
        // Las dos cuentas se borraron: no hay saldo que devolver y la fila ya
        // no explica nada. Se borra a secas, que es el comportamiento correcto
        // y no el defecto (no queda ningún saldo mal).
        await deleteTransaction(txId)
        return
      }
      // Un lado que existe pero no se puede expresar (ítem sin ningún precio
      // utilizable) NO se escribe como `{}`: eso es un no-op que Firestore
      // acepta, o sea el saldo quedaría mal reportando éxito. Se rehúsa entero
      // y se dice, que es el contrato de lib/transferFields.js.
      if (reversal.refused.length) {
        const err = new Error('reversal-refused')
        err.code = 'reversal-refused'
        err.sides = reversal.refused
        throw err
      }
      await reverseTransfer({
        fromId: reversal.from?.id || null, fromFields: reversal.from?.fields || null,
        toId: reversal.to?.id || null, toFields: reversal.to?.fields || null,
        txId,
      })
      return
    }

    const credit = tx && !skipBalanceReversal && dividendCreditTarget(tx, enrichedItems)
    if (credit) {
      const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
      await applyDestinationDelta(credit.dest, -amt, credit.currency)
    }
    // FASE HV10. Borrar un pago que el motor automático puede volver a escribir
    // no basta: lo reescribe en la siguiente carga, y como el id del documento
    // se calcula de fecha+símbolo+tipo+monto, vuelve IDÉNTICO. Desde afuera se
    // ve como un borrado que no se guardó, que es literalmente cómo lo reportó
    // el usuario tres veces seguidas.
    //
    // Va acá, en la función COMPARTIDA, y no en la pantalla que la llama: las
    // tres superficies que borran movimientos (el historial de la cuenta, la
    // tarjeta de movimientos recientes y el Spreadsheet) pasan por esta misma
    // función, y arreglarlo en una sola dejaría a las otras dos con el bug.
    // La versión anterior solo cubría el desglose del rendimiento, que resultó
    // ser justamente la pantalla que el usuario NO estaba usando.
    if (tx && (tx.type || '').toUpperCase() === 'DIVIDEND' && tx.date && tx._linkedItemId && updateItem) {
      const src = enrichedItems.find((it) => it.id === tx._linkedItemId)
      // Solo si ese activo tiene calendario: es la misma condición con la que
      // processDividends decide a quién le genera pagos.
      const canRegenerate = src && (src.incomeAmount > 0 || src.incomeRate > 0
        || (src.rateType === 'variable' && src.rateMin > 0) || src.rateType === 'continuous')
      if (canRegenerate) {
        // El acumulador evita que dos borrados seguidos del MISMO activo se
        // pisen: `enrichedItems` viaja capturado en este callback, así que el
        // segundo podría escribir su fecha sobre una lista que todavía no trae
        // la primera y perderla (la forma del bug de FASE EL).
        const already = excludedPayRef.current.get(src.id) || []
        const prevList = [...new Set([...(Array.isArray(src.excludedPayDates) ? src.excludedPayDates : []), ...already])]
        if (!isPayDateExcluded(prevList, tx.date)) {
          const next = [...prevList, tx.date]
          excludedPayRef.current.set(src.id, next)
          try { await updateItem(src.id, { excludedPayDates: next }) }
          catch (e) { console.error('[delete-tx-exclude]', e.message) }
        }
      }
    }
    await deleteTransaction(txId)
  }, [transactions, enrichedItems, applyDestinationDelta, deleteTransaction, updateItem, reverseTransfer])

  // No hay rama TRANSFER acá, y es a propósito: el botón de editar está
  // suprimido para las filas de transferencia (`EditAccountModal`, la condición
  // `!incoming && !outgoing`), porque un movimiento que toca DOS cuentas no se
  // puede corregir desde el editor de UNA. O sea no existe camino que llegue,
  // y escribir una rama inalcanzable sería código que nadie puede probar. Si
  // algún día se habilita editar una transferencia, el ajuste de los dos lados
  // se arma con `transferReversalPlan` igual que el borrado.
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
    dataLoading, loadError,

    // Firestore actions
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    migrateMisplacedNav,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    deleteTransactionWithReversal, updateTransactionWithReversal,
    addAlert, deleteAlert, updateAlert,
    addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, updateFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    deleteFinanceTransactionsByIds,
    bulkImport,
    // FASE LH: la señal con la que el confirm de un import rehúsa escribir
    // encima de un sync en vuelo. `ibkrAutoSyncing` cubre descarga+escritura
    // de A/B; `bulkWriting` cubre además el colchón de 1500ms del eco del
    // listener tras CUALQUIER escritura masiva.
    bulkWriting,
    saveGoals, saveSettings, saveProfile,
    // El plan de ingresos que se arma en Flujo: la proyección del tablero lo
    // LEE (y guarda ahí mismo su tasa de ahorro y de rendimiento). Sin
    // re-exportarlo, el tablero recibía `undefined` y mostraba "todavía no hay
    // ingresos planeados" sobre un plan que sí existía.
    incomePlan, saveIncomePlan,
    saveItemSnapshots, loadItemSnapshots,

    // Market data
    enrichedItems, portfolioItems, marketPrices,
    pricesLoading, pricesError, pricesUpdate,
    rates, convert, convertItemValue,
    // `ratesStale` lo publicaba useExchangeRates y este hook no lo
    // desestructuraba, asi que nunca llegaba al tablero. No se notaba porque
    // ninguna superficie mostraba tasas; la tarjeta de tipo de cambio lo usa
    // para no presentar una tasa de ayer como si fuera de ahora.
    ratesLoading, ratesError, ratesUpdate, ratesStale,
    handleRefresh,

    // Computed values
    baseCurrency, netWorth, totalAssets, dailyChange, yearlyChange,
    returnYTD, returnYTDRaw, ytdChange, returnSinceStart, sinceStartDate, returnMTD, returnMTDRaw, ytdCalibrated, ytdBreakdown, ytdBreakdownReason, ytdBreakdownDetail, ytdBreakdownTerms, ytdDegradedAccounts, ytdResolved, assetTransactions,
    // El valor con el que arrancó el año, o sea contra QUÉ se midió returnYTD.
    // Adición pura: ya se calculaba acá dentro (alimenta el desglose por
    // cuenta) y solo faltaba exponerlo. Lo consume la card de invertido por
    // año, donde un % sin su base se lee contra la columna equivocada.
    ytdStartValue,
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
    ibkrUpstreamError: settings?._ibkrLastUpstreamError || null,
    ibkrSkipReason,
    ibkrLastSync: settings?._ibkrLastAutoSync || settings?._ibkrLastSync || null,
  }
}
