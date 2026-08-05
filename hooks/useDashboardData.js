import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useFirestoreItems } from './useFirestoreItems'
import { useMarketPrices } from './useMarketPrices'
import { useExchangeRates } from './useExchangeRates'
import { useBenchmark } from './useBenchmark'
import { useTabCoordination } from './useTabCoordination'
import { authFetch, safeJson } from '@/lib/authFetch'
import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, getTypeCategory, getInvestmentClass, isExcludedFromNetWorth, augmentSnapshots, projectItemAnnualIncome, findYearStartAnchor, findMonthStartAnchor, computeScopedReturns, shouldHoldFlat, combineAccountCalibrations, dedupeCalibrations } from '@/components/dashboard/utils'
import { buildTxEvents, buildCashFlows } from '@/lib/portfolioRewind'
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

export function useDashboardData({ user, lang, activePortfolio, activeEntity = '__all__' }) {
  const firestoreData = useFirestoreItems()
  const {
    items, snapshots: rawSnapshots, transactions, goals, settings, profile,
    loading: dataLoading, addItem, updateItem, deleteItem,
    deleteAllItems, deleteItemGroup, saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, deleteTransaction, deleteAllTransactions,
    alerts, addAlert, deleteAlert, updateAlert,
    lots, addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution, bulkImport,
    portfolios, addPortfolio, deletePortfolio,
    financeTransactions, addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    saveGoals, saveSettings, saveProfile,
    saveItemSnapshots, loadItemSnapshots,
  } = firestoreData

  // Calibration anchors (global AND per-account) hold a SOLVED start value,
  // not an observed NAV: they must never enter the NAV series (chart, dedup,
  // backfill, scoped returns, risk metrics) or they read as real data — a
  // global calibration used to sit in the series and the chart drew a flat
  // straight line from the anchor to the first real datapoint. Every consumer
  // below uses the filtered `snapshots` (real observations only); calibrations
  // feed the returns math and the chart's estimated-prefix fit instead.
  const calibrations = useMemo(
    () => dedupeCalibrations((rawSnapshots || []).filter((s) => s && s._calibrated && s.date)),
    [rawSnapshots]
  )
  const accountCalibrations = useMemo(
    () => calibrations.filter((s) => s._account),
    [calibrations]
  )
  const snapshots = useMemo(
    () => (rawSnapshots || []).filter((s) => s && !s._account && !s._calibrated),
    [rawSnapshots]
  )

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => { setBaseCurrency(baseCurrency) }, [baseCurrency])
  useEffect(() => { setUtilsLang(lang) }, [lang])

  const { enrichedItems: rawEnriched, prices: marketPrices, loading: pricesLoading, error: pricesError, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, error: ratesError, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

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
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return
    const alreadyExists = snapshots.some((s) => s.date === todayStr || s.id === todayStr)
    if (alreadyExists) { snapshotSavedRef.current = todayStr; return }
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
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency, transactions])

  // Backfill missing snapshots for the last 30 days
  const backfillRef = useRef(false)
  useEffect(() => {
    if (backfillRef.current) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0 || !snapshots) return
    const existingDates = new Set(snapshots.map(s => s.date || s.id))
    const today = new Date()
    const gaps = []
    for (let d = 1; d <= 30; d++) {
      const dt = new Date(today)
      dt.setDate(dt.getDate() - d)
      const dateStr = dt.toISOString().split('T')[0]
      if (!existingDates.has(dateStr)) gaps.push(dateStr)
    }
    if (gaps.length === 0) { backfillRef.current = true; return }
    backfillRef.current = true

    let cancelled = false
    async function doBackfill() {
      try {
        if (cancelled) return
        const allLots = (lots || []).filter(l => l.quantity > 0)
        // Only ASSETS go to portfolio-history (it has no isDebt notion, so a debt
        // would be summed as a positive asset). Debt is held flat and subtracted below.
        const assetItems = enrichedItems.filter(it => !it.isDebt && !isExcludedFromNetWorth(it))
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
            items: assetItems.map((it) => {
              const cur = it._originalCurrency || it.currency || 'USD'
              const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
              return {
                symbol: it.symbol, type: it.type, quantity: it.quantity,
                currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
                purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
                currency: 'USD', acquisitionDate: it.acquisitionDate,
                _holdFlat: shouldHoldFlat(it, transactions, lots),
              }
            }),
            lots: allLots.length > 0 ? allLots.map(l => ({
              symbol: l.symbol, quantity: l.quantity,
              acquisitionDate: l.acquisitionDate, closedDate: l.closedDate || null,
            })) : undefined,
            period: '1M',
          }),
        })
        if (!res.ok) return
        const data = await safeJson(res)
        const pts = data.dataPoints || []
        if (pts.length === 0) return
        const gapSet = new Set(gaps)
        for (const pt of pts) {
          const dateStr = new Date(pt.ts).toISOString().split('T')[0]
          if (!gapSet.has(dateStr) || pt.total <= 0) continue
          gapSet.delete(dateStr)
          await saveSnapshot({
            date: dateStr,
            netWorthUSD: pt.total - currentDebtUSD,
            totalActivosUSD: pt.total,
            totalDebtUSD: currentDebtUSD,
            _source: 'backfill',
          })
        }
      } catch (err) {
        console.error('[backfill] Failed:', err.message)
      }
    }
    doBackfill()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, lots, transactions, saveSnapshot, convert])

  // Dividend processing
  const dividendsProcessedRef = useRef(null)
  useEffect(() => {
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    if (dividendsProcessedRef.current === todayKey) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
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

    async function addToDestination(dest, amount, sourceCurrency) {
      const destCur = dest.currency || dest._originalCurrency || 'USD'
      const converted = convert ? convert(amount, sourceCurrency, destCur) : amount
      const cat = getTypeCategory(dest)
      if (cat === 'stocks' || cat === 'crypto' || cat === 'funds') return
      const oldBalance = (dest.quantity || 1) * (dest._originalPrice ?? dest.purchasePrice ?? 0)
      const newBalance = oldBalance + converted
      const qty = dest.quantity || 1
      const newPrice = newBalance / qty
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
        const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
        if (!(amt > 0)) return
        const key = it.incomeDestination
        if (!destReversal[key]) destReversal[key] = { amount: 0, currency: tx.currency || it._originalCurrency || 'USD' }
        destReversal[key].amount += amt
      }
      for (const it of scheduled) {
        if (cancelled) return
        const sym = it.symbol || it.name
        const autoDivs = transactions.filter(tx =>
          tx._source === 'auto' &&
          (tx.type || '').toUpperCase() === 'DIVIDEND' &&
          (tx._linkedItemId === it.id || (!tx._linkedItemId && tx.symbol === sym))
        )
        if (it.incomeMonthsExplicit) {
          // Explicit schedule: drop any auto-dividend whose month is no longer
          // configured to pay, and de-duplicate within a configured month.
          const payMonths = Array.isArray(it.incomeMonths) ? it.incomeMonths : []
          const seen = new Set()
          for (const tx of [...autoDivs].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
            if (!tx.date || !tx.id || !deleteTransaction) continue
            const d = new Date(tx.date)
            const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
            const inSchedule = payMonths.includes(d.getUTCMonth())
            if (!inSchedule || seen.has(key)) {
              queueReversal(it, tx)
              await deleteTransaction(tx.id)
            } else {
              seen.add(key)
            }
          }
        } else if (autoDivs.length > 1) {
          // No explicit schedule: keep only the most recent auto-dividend.
          const sorted = [...autoDivs].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].id && deleteTransaction) {
              queueReversal(it, sorted[i])
              await deleteTransaction(sorted[i].id)
            }
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
            if (offset === 0 && todayDay < payDay) continue
            const dateStr = `${checkYear}-${String(checkMonth + 1).padStart(2, '0')}-${String(payDay).padStart(2, '0')}`
            monthsToCheck.push({ dateStr, month: checkMonth, year: checkYear })
          }
        } else {
          // Without explicit months, only process current month
          if (payMonths.includes(currentMonth)) {
            const payDay = it.incomePayDay || 1
            if (todayDay >= payDay) {
              const dateStr = `${now.getUTCFullYear()}-${String(currentMonth + 1).padStart(2, '0')}-${String(payDay).padStart(2, '0')}`
              monthsToCheck.push({ dateStr, month: currentMonth, year: now.getUTCFullYear() })
            }
          }
        }

        for (const { dateStr } of monthsToCheck) {
          if (cancelled) return
          // Dates the user explicitly said did NOT happen (asked at account
          // creation, when the schedule implied a payment already due) —
          // never fabricate history for those, however the schedule reads.
          if (Array.isArray(it.excludedPayDates) && it.excludedPayDates.includes(dateStr)) continue
          const alreadyProcessed = transactions.some((tx) =>
            (tx.type || '').toUpperCase() === 'DIVIDEND' && tx.date === dateStr &&
            (tx._linkedItemId === it.id || (!tx._linkedItemId && tx.symbol === (it.symbol || it.name)))
          )
          if (alreadyProcessed) continue

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
          } else if (it.incomeDestination) {
            const dest = enrichedItems.find((d) => (d.id || d.symbol) === it.incomeDestination)
            if (dest) {
              await addToDestination(dest, amount, incomeCurrency)
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
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, transactions, addTransaction, deleteTransaction, updateItem, convert])

  const handleRefresh = useCallback(() => {
    refreshPrices()
    refreshRates()
  }, [refreshPrices, refreshRates])

  // IBKR auto-sync
  const { acquireLock, releaseLock } = useTabCoordination()
  const ibkrAutoSyncRef = useRef(false)
  const [ibkrAutoSyncing, setIbkrAutoSyncing] = useState(false)

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

    // Let a fresh IBKR equity entry overwrite a stale snapshot for the same date
    // (a wrong value written once must be correctable by a later sync). But NEVER
    // downgrade a FULL-portfolio snapshot (daily writer, sums all assets) to
    // broker-only NAV — that same-date tug-of-war alternated the chart between
    // ~broker-NAV and ~full-NAV days (the twin-spike artifact).
    const byDate = new Map(snapshots.map(s => [s.date, s]))
    const newSnaps = (data.equityHistory || [])
      .filter(entry => {
        const prev = byDate.get(entry.date)
        if (!prev) return true
        const nav = entry.netWorthUSD || 0
        const prevVal = prev.netWorthUSD ?? 0
        if (prev._source === 'ibkr') return prevVal !== nav
        // A 'backfill' doc is a RECONSTRUCTION (today's holdings priced at past
        // dates), not an observation, and for a portfolio grown by deposits it
        // reads far too high: one real account had January estimated at 7,153
        // against a true 5,424. Real broker NAV must be allowed to correct it in
        // EITHER direction. The old rule only accepted a higher value, so
        // importing the true, lower history silently changed nothing and the
        // year kept measuring from an invented starting point.
        if (prev._source === 'backfill') return prevVal !== nav
        // A daily/manual snapshot is a FULL-portfolio observation while broker
        // NAV covers one account, so downgrading it would lose the rest of the
        // holdings. Only take the broker figure when it is higher.
        return nav > prevVal
      })
      .map(entry => {
        // IBKR equity is in the account's base currency. Convert to USD when it
        // isn't already (uses the current FX rate — no historical FX available — so
        // it's an approximation, but far better than treating EUR/etc. as USD). No-op
        // for USD-base accounts (the common case).
        const cur = entry._equityCurrency || 'USD'
        const toUSD = (v) => (cur !== 'USD' && convert ? convert(v || 0, cur, 'USD') : (v || 0))
        return {
          date: entry.date,
          totalActivosUSD: toUSD(entry.totalActivosUSD || entry.netWorthUSD || 0),
          totalDebtUSD: toUSD(entry.totalDebtUSD || 0),
          netWorthUSD: toUSD(entry.netWorthUSD || 0),
          _source: 'ibkr',
        }
      })

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
        if (!cancelled) setIbkrAutoSyncing(false)
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
      setIbkrAutoSyncing(false)
      releaseLock('ibkr-sync')
    }
  }, [settings, user, authFetch, saveSettings, handleIBKRSync, acquireLock, releaseLock])

  // Derived values
  // IBKR-only snapshots omit manually-added assets; augment them with the held-flat
  // value of non-IBKR items so returns/changes below reflect the FULL portfolio.
  // (The growth chart and spreadsheet get the raw snapshots and do their own thing.)
  const augmentedSnapshots = useMemo(
    () => augmentSnapshots(snapshots, portfolioItems, convert),
    [snapshots, portfolioItems, convert]
  )
  const latestSnapshot = augmentedSnapshots.length > 0 ? augmentedSnapshots[augmentedSnapshots.length - 1] : null
  const prevSnapshot = augmentedSnapshots.length > 1 ? augmentedSnapshots[augmentedSnapshots.length - 2] : null

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

  const dailyChange = useMemo(() => {
    if (!prevSnapshot || netWorth <= 0) return null
    const prevValue = convertSnapshot(prevSnapshot.netWorthUSD ?? prevSnapshot.totalActivosUSD ?? 0)
    if (prevValue <= 0) return null
    // Net out real money movements since the previous snapshot, same treatment
    // as YTD/yearly Dietz: a deposit (e.g. a fresh statement import) landing
    // today is new capital, not market gain. String-prefix date compare per
    // house rule (new Date('YYYY-MM-DD') runs the day in UTC-6).
    const prevDate = prevSnapshot.date || ''
    let netFlow = 0
    ;(transactions || []).forEach((tx) => {
      if (!tx.date || tx.date <= prevDate) return
      const type = (tx.type || '').toUpperCase()
      if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') return
      const amt = Number(tx.totalAmount ?? tx.amount ?? 0)
      const converted = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt
      netFlow += type === 'DEPOSIT' ? converted : -converted
    })
    const abs = netWorth - prevValue - netFlow
    const pct = (abs / prevValue) * 100
    return { abs, pct }
  }, [prevSnapshot, netWorth, convertSnapshot, transactions, convert, baseCurrency])

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
  // True when jan1Value came from a TRANSACTIONAL reconstruction (rewound through
  // imported deposits/buys/sells): that baseline reflects real flow timing, so the
  // YTD Dietz must net the flows like it would against a real snapshot anchor.
  const [jan1Transactional, setJan1Transactional] = useState(false)
  useEffect(() => {
    if (!enrichedItems || enrichedItems.length === 0) return
    let cancelled = false
    async function fetchJan1() {
      try {
        const allLots = (lots || []).filter(l => l.quantity > 0)
        const txEventsBySym = buildTxEvents(transactions)
        const accountCashFlows = buildCashFlows(transactions,
          (amt, cur2) => convert ? convert(amt, cur2, 'USD') : amt)
        // Reconstruct the SAME portfolio that netWorth (endValue) measures — same
        // predicate as the chart (PortfolioGrowthChart) and the netWorth loop. Sending
        // raw enrichedItems here included excluded/debt items (e.g. an IBKR bank line)
        // that received the whole BUY/SELL ledger and got rewound strongly negative,
        // collapsing jan1Value while netWorth excluded it → the YTD Dietz exploded
        // (start and end measuring different portfolios).
        const jan1Items = enrichedItems.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
        // Only rewind the cash line when there is a REAL external flow
        // (deposit/withdrawal). With hold-flat stocks, rewinding cash by BUY/SELL
        // double-counts (the flat holding already implies the shares were owned), which
        // collapses the January baseline and blows up the YTD Dietz. Without deposits,
        // leave cash flat.
        const hasExternalFlow = (transactions || []).some((t) => /^(DEPOSIT|WITHDRAWAL)$/i.test(t.type || ''))
        // Prefer the CASH-{ccy} holding; fall back to any single IBKR bank-type item
        // so the ledger still rebuilds cash when the symbol isn't exactly CASH-*.
        const cashItem = (accountCashFlows.length > 0 && hasExternalFlow)
          ? (jan1Items.find((it) => it._source === 'ibkr' && /^CASH-/i.test(it.symbol || ''))
             || jan1Items.find((it) => it._source === 'ibkr' && /bank|cash/i.test(it.type || '')))
          : null
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: jan1Items.map((it) => {
              const cur = it._originalCurrency || it.currency || 'USD'
              const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
              return {
                symbol: it.symbol, type: it.type, quantity: it.quantity,
                currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
                purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
                currency: 'USD',
                acquisitionDate: it.acquisitionDate,
                _holdFlat: shouldHoldFlat(it, transactions, lots),
                txEvents: txEventsBySym[(it.symbol || '').toUpperCase()] || undefined,
                ...(cashItem && it.id === cashItem.id ? { cashFlows: accountCashFlows } : {}),
              }
            }),
            lots: allLots.length > 0 ? allLots.map(l => ({
              symbol: l.symbol, quantity: l.quantity,
              acquisitionDate: l.acquisitionDate,
              closedDate: l.closedDate || null,
            })) : undefined,
            period: 'YTD',
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
            setJan1Transactional(!!data.transactional)
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
    () => (transactions || []).filter((tx) => tx._source !== 'ibkr'),
    [transactions]
  )
  const REAL_SNAPSHOT_SOURCES = ['ibkr', 'daily', 'manual']

  const { returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdCalibrated } = useMemo(() => {
    const year = new Date().getUTCFullYear()
    const yearStartTs = Date.UTC(year, 0, 1)
    const todayStr = new Date().toISOString().split('T')[0]
    // Only THIS year's ytd calibrations: a calibration captured last year keeps
    // its Jan-1-of-last-year anchor and must not leak into the current year.
    const ytdCals = accountCalibrations.filter((c) => c._calibrationKind === 'ytd' && c.date <= todayStr && c.date.slice(0, 4) === String(year))
    const allCals = accountCalibrations.filter((c) => c._calibrationKind === 'all' && c.date <= todayStr)
    // Global (whole-portfolio) calibrated anchors now live in `calibrations`,
    // not in the NAV series. They outrank a reconstruction (jan1Value) but
    // never a REAL observation of the year start.
    const globalYtdCal = calibrations.filter((c) => !c._account && c._calibrationKind === 'ytd' && c.date <= todayStr && c.date.slice(0, 4) === String(year))
      .sort((a, b) => String(b.capturedAt || b.createdAt || '').localeCompare(String(a.capturedAt || a.createdAt || '')))[0]
    const toUSD = (v) => convert(v, baseCurrency, 'USD')
    let startVal = null
    let flowAware = false
    let anchorUSD = null
    let anchorCalibrated = false
    if (augmentedSnapshots.length >= 2) {
      // Shared anchor (also used by the chart's YTD starting point) so the
      // Dietz badge and the chart never start the year from different values.
      const bestSnap = findYearStartAnchor(augmentedSnapshots, year)
      if (bestSnap) {
        anchorUSD = bestSnap.netWorthUSD ?? bestSnap.totalActivosUSD ?? 0
        startVal = convertSnapshot(anchorUSD)
        flowAware = REAL_SNAPSHOT_SOURCES.includes(bestSnap._source)
        anchorCalibrated = !!bestSnap._calibrated
      }
    }
    if ((startVal == null || startVal <= 0) && globalYtdCal && isFinite(globalYtdCal.netWorthUSD) && globalYtdCal.netWorthUSD > 0) {
      // Calibrated global anchor: the start value was solved against the FULL
      // flow set, so the roll-forward Dietz must net the same flows (flowAware)
      // for the displayed % to keep matching the broker's number day to day.
      anchorUSD = globalYtdCal.netWorthUSD
      startVal = convertSnapshot(anchorUSD)
      flowAware = true
      anchorCalibrated = true
    }
    if (startVal == null || startVal <= 0) { startVal = jan1Value; flowAware = jan1Transactional }

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
    // Since-inception anchor candidates: the first REAL observation, and the
    // global 'all' calibration pinned at the account opening date. The earlier
    // of the two wins: a calibration reaches back past the first real datapoint
    // (that is exactly what it is for), but never overrides real data at or
    // before its own date.
    const globalAllCal = calibrations.filter((c) => !c._account && c._calibrationKind === 'all' && c.date <= todayStr)
      .sort((a, b) => String(b.capturedAt || b.createdAt || '').localeCompare(String(a.capturedAt || a.createdAt || '')))[0]
    if ((startVal == null || startVal <= 0) && (augmentedSnapshots.length >= 2 || globalAllCal)) {
      const sorted = [...augmentedSnapshots]
        .filter(s => s.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
      const first = sorted.find(s => (s.netWorthUSD ?? s.totalActivosUSD ?? 0) > 0)
      let anchor = first
        ? { date: first.date, usd: first.netWorthUSD ?? first.totalActivosUSD ?? 0, flowAware: REAL_SNAPSHOT_SOURCES.includes(first._source) }
        : null
      if (globalAllCal && isFinite(globalAllCal.netWorthUSD) && globalAllCal.netWorthUSD > 0
        && (!anchor || globalAllCal.date < anchor.date)) {
        // Same flow rule as the ytd calibrated anchor: solved against the full
        // flow set, so roll-forward nets the full flow set too.
        anchor = { date: globalAllCal.date, usd: globalAllCal.netWorthUSD, flowAware: true }
      }
      if (anchor) {
        const firstUSD = anchor.usd
        let firstVal = convertSnapshot(firstUSD)
        let firstFlowAware = anchor.flowAware
        // Same per-account swap for the since-inception anchor.
        const cals = allCals.filter((c) => c.date <= anchor.date)
        if (cals.length > 0) {
          const combined = combineAccountCalibrations({
            baseValueUSD: firstUSD > 0 ? firstUSD : null,
            anchorTs: new Date(anchor.date).getTime(),
            calibrations: cals, items: portfolioItems, convert,
          })
          if (combined && isFinite(combined.startValueUSD) && combined.startValueUSD > 0) {
            firstVal = convertSnapshot(combined.startValueUSD)
            firstFlowAware = true
          }
        }
        if (firstVal > 0 && netWorth > 0) {
          const firstTs = new Date(anchor.date).getTime()
          const { pct, abs } = computeModifiedDietz({
            startValue: firstVal, endValue: netWorth,
            startTs: firstTs, endTs: Date.now(),
            transactions: firstFlowAware ? transactions : dietzTransactions,
            convert, baseCurrency,
          })
          returnSinceStart = Math.max(-200, Math.min(200, pct))
          sinceStartDate = anchor.date
          if (startVal == null || startVal <= 0) {
            startVal = firstVal
            flowAware = firstFlowAware
          }
        }
      }
    }

    const calibrated = ytdCalApplied || anchorCalibrated
    if (startVal == null || startVal <= 0) return { returnYTD: null, ytdChange: null, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated }
    const { pct, abs } = computeModifiedDietz({
      startValue: startVal, endValue: netWorth,
      startTs: yearStartTs, endTs: Date.now(),
      transactions: flowAware ? transactions : dietzTransactions, convert, baseCurrency,
    })
    const clampedPct = Math.max(-200, Math.min(200, pct))
    return { returnYTD: clampedPct, ytdChange: abs, returnSinceStart, sinceStartDate, ytdCalibrated: calibrated }
  }, [jan1Value, jan1Transactional, netWorth, transactions, dietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot, calibrations, accountCalibrations, portfolioItems])

  // Month-to-date return (Modified Dietz) — the "how are we doing THIS month"
  // number for the Friends monthly leaderboard. Same shape as YTD, anchored to
  // the prior month-end snapshot; null when there's no reliable month anchor.
  const returnMTD = useMemo(() => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()
    if (netWorth <= 0) return null
    const todayStr = now.toISOString().split('T')[0]
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
    const anchor = findMonthStartAnchor(augmentedSnapshots, year, month)
    let startVal = anchor ? convertSnapshot(anchor.netWorthUSD ?? anchor.totalActivosUSD ?? 0) : null
    let flowAware = anchor ? REAL_SNAPSHOT_SOURCES.includes(anchor._source) : false
    // Global 'mtd' calibration anchors this month when no real observation
    // does (same rule as YTD: calibrated beats reconstructed, never real).
    if (startVal == null || startVal <= 0) {
      const mtdCal = calibrations.filter((c) => !c._account && c._calibrationKind === 'mtd'
        && c.date <= todayStr && c.date.slice(0, 7) === monthKey)
        .sort((a, b) => String(b.capturedAt || b.createdAt || '').localeCompare(String(a.capturedAt || a.createdAt || '')))[0]
      if (mtdCal && isFinite(mtdCal.netWorthUSD) && mtdCal.netWorthUSD > 0) {
        startVal = convertSnapshot(mtdCal.netWorthUSD)
        flowAware = true
      }
    }
    // Per-account mtd calibrations: same swap as the YTD path.
    const mtdCals = calibrations.filter((c) => c._account && c._calibrationKind === 'mtd'
      && c.date <= todayStr && c.date.slice(0, 7) === monthKey)
    if (mtdCals.length > 0) {
      const baseUSD = startVal != null && startVal > 0 ? convert(startVal, baseCurrency, 'USD') : null
      const combined = combineAccountCalibrations({
        baseValueUSD: baseUSD, anchorTs: Date.UTC(year, month, 1),
        calibrations: mtdCals, items: portfolioItems, convert,
      })
      if (combined && isFinite(combined.startValueUSD) && combined.startValueUSD > 0) {
        startVal = convertSnapshot(combined.startValueUSD)
        flowAware = true
      }
    }
    if (startVal == null || startVal <= 0) return null
    const { pct } = computeModifiedDietz({
      startValue: startVal, endValue: netWorth,
      startTs: Date.UTC(year, month, 1), endTs: Date.now(),
      transactions: flowAware ? transactions : dietzTransactions,
      convert, baseCurrency,
    })
    return Math.max(-200, Math.min(200, pct))
  }, [netWorth, transactions, dietzTransactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot, calibrations, portfolioItems])

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
  const { benchmarkData, benchmarkReturn, benchmarkName, loading: benchmarkLoading, error: benchmarkError } = useBenchmark('YTD', benchmarkSymbol)

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

  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

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
    items, snapshots, augmentedSnapshots, calibrations, accountCalibrations, transactions, goals, settings, profile, effectiveProfile, alerts, lots, portfolios, financeTransactions,
    entityTransactions, entityFinanceTransactions,
    dataLoading,

    // Firestore actions
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, deleteTransaction, deleteAllTransactions,
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
    returnYTD, ytdChange, returnSinceStart, sinceStartDate, returnMTD, ytdCalibrated,
    ibkrReturnYTD: ibkrReturns.ytd, ibkrReturnMTD: ibkrReturns.mtd, ibkrDayChange: ibkrReturns.day,
    annualDividends, estimatedAnnualIncome,
    netContributions, contributionsSummary, cashTotal, riskMetrics, insights, dataAge, contributionWarning,

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
