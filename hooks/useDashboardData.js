import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useFirestoreItems } from './useFirestoreItems'
import { useMarketPrices } from './useMarketPrices'
import { useExchangeRates } from './useExchangeRates'
import { useBenchmark } from './useBenchmark'
import { useTabCoordination } from './useTabCoordination'
import { authFetch, safeJson } from '@/lib/authFetch'
import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, getTypeCategory, getInvestmentClass, isExcludedFromNetWorth, augmentSnapshots, projectItemAnnualIncome } from '@/components/dashboard/utils'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights, computeAssetAttribution, inferPeriodsPerYear, filterValueSpikes } from '@/components/dashboard/analytics'
import { checkPriceAlerts } from '@/lib/notifications'

export function useDashboardData({ user, lang, activePortfolio, activeEntity = '__all__' }) {
  const firestoreData = useFirestoreItems()
  const {
    items, snapshots, transactions, goals, settings, profile,
    loading: dataLoading, addItem, updateItem, deleteItem,
    deleteAllItems, saveSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, deleteTransaction, deleteAllTransactions,
    alerts, addAlert, deleteAlert, updateAlert,
    lots, addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution, bulkImport,
    portfolios, addPortfolio, deletePortfolio,
    financeTransactions, addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    saveGoals, saveSettings, saveProfile,
    saveItemSnapshots, loadItemSnapshots,
  } = firestoreData

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => { setBaseCurrency(baseCurrency) }, [baseCurrency])
  useEffect(() => { setUtilsLang(lang) }, [lang])

  const { enrichedItems: rawEnriched, prices: marketPrices, loading: pricesLoading, error: pricesError, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, error: ratesError, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

  const alertsCheckedRef = useRef(null)
  useEffect(() => {
    if (!marketPrices || Object.keys(marketPrices).length === 0 || !alerts || alerts.length === 0) return
    const key = pricesUpdate || Date.now()
    if (alertsCheckedRef.current === key) return
    alertsCheckedRef.current = key
    checkPriceAlerts(alerts, marketPrices, (alertId) => {
      updateAlert(alertId, { triggered: true, triggeredAt: new Date().toISOString() })
    })
  }, [marketPrices, alerts, pricesUpdate, updateAlert])

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
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, lots, saveSnapshot, convert])

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
        // Full/daily snapshot exists: only overwrite if the broker NAV is HIGHER
        // (then the stored one was the poorer value).
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
  }, [items, snapshots, bulkImport, activePortfolio, activeEntity])

  // LOCKED = IBKR temporarily blocked the token after failed attempts; retrying
  // refreshes the lock, so it must halt auto-sync like the other fatal states.
  const FATAL_ERROR_CODES = ['TOKEN_EXPIRED', 'INVALID_QUERY', 'LOCKED']

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
    const SYNC_INTERVAL = 30 * 60 * 1000
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
        saveSettings({
          _ibkrLastAutoSync: new Date().toISOString(),
          _ibkrAutoSyncStatus: 'ok',
          _ibkrAutoSyncError: null,
          _ibkrAutoSyncErrorCode: null,
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
    const abs = netWorth - prevValue
    const pct = (abs / prevValue) * 100
    return { abs, pct }
  }, [prevSnapshot, netWorth, convertSnapshot])

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
  useEffect(() => {
    if (!enrichedItems || enrichedItems.length === 0) return
    let cancelled = false
    async function fetchJan1() {
      try {
        const allLots = (lots || []).filter(l => l.quantity > 0)
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: enrichedItems.map((it) => {
              const cur = it._originalCurrency || it.currency || 'USD'
              const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
              return {
                symbol: it.symbol, type: it.type, quantity: it.quantity,
                currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
                purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
                currency: 'USD',
                acquisitionDate: it.acquisitionDate,
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
          }
        }
      } catch {}
    }
    fetchJan1()
    return () => { cancelled = true }
  }, [enrichedItems, lots, convert, baseCurrency])

  const { returnYTD, ytdChange, returnSinceStart, sinceStartDate } = useMemo(() => {
    const year = new Date().getUTCFullYear()
    const yearStartTs = Date.UTC(year, 0, 1)
    let startVal = null
    if (augmentedSnapshots.length >= 2) {
      const sorted = [...augmentedSnapshots].filter(s => s.date).sort((a, b) => new Date(a.date) - new Date(b.date))
      let bestSnap = sorted.find(s => {
        const d = new Date(s.date)
        return d.getFullYear() === year && d.getMonth() === 0
      })
      if (!bestSnap) {
        bestSnap = [...sorted].reverse().find(s => {
          const d = new Date(s.date)
          return d.getFullYear() === year - 1 && d.getMonth() === 11
        })
      }
      if (bestSnap) {
        const diff = Math.abs(new Date(bestSnap.date).getTime() - yearStartTs)
        if (diff <= 15 * 86400000) {
          startVal = convertSnapshot(bestSnap.netWorthUSD ?? bestSnap.totalActivosUSD ?? 0)
        }
      }
    }
    if (startVal == null || startVal <= 0) startVal = jan1Value

    let returnSinceStart = null
    let sinceStartDate = null
    if ((startVal == null || startVal <= 0) && augmentedSnapshots.length >= 2) {
      const sorted = [...augmentedSnapshots]
        .filter(s => s.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
      const first = sorted.find(s => (s.netWorthUSD ?? s.totalActivosUSD ?? 0) > 0)
      if (first) {
        const firstVal = convertSnapshot(first.netWorthUSD ?? first.totalActivosUSD ?? 0)
        if (firstVal > 0 && netWorth > 0) {
          const firstTs = new Date(first.date).getTime()
          const { pct, abs } = computeModifiedDietz({
            startValue: firstVal, endValue: netWorth,
            startTs: firstTs, endTs: Date.now(),
            transactions, convert, baseCurrency,
          })
          returnSinceStart = Math.max(-200, Math.min(200, pct))
          sinceStartDate = first.date
          if (startVal == null || startVal <= 0) {
            startVal = firstVal
          }
        }
      }
    }

    if (startVal == null || startVal <= 0) return { returnYTD: null, ytdChange: null, returnSinceStart, sinceStartDate }
    const { pct, abs } = computeModifiedDietz({
      startValue: startVal, endValue: netWorth,
      startTs: yearStartTs, endTs: Date.now(),
      transactions, convert, baseCurrency,
    })
    const clampedPct = Math.max(-200, Math.min(200, pct))
    return { returnYTD: clampedPct, ytdChange: abs, returnSinceStart, sinceStartDate }
  }, [jan1Value, netWorth, transactions, convert, baseCurrency, augmentedSnapshots, convertSnapshot])

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
    items, snapshots, augmentedSnapshots, transactions, goals, settings, profile, effectiveProfile, alerts, lots, portfolios, financeTransactions,
    entityTransactions, entityFinanceTransactions,
    dataLoading,

    // Firestore actions
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots, deleteDemoData,
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
    returnYTD, ytdChange, returnSinceStart, sinceStartDate,
    annualDividends, estimatedAnnualIncome,
    netContributions, contributionsSummary, cashTotal, riskMetrics, insights, dataAge, contributionWarning,

    // Benchmark
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName, benchmarkLoading,

    // IBKR
    handleIBKRSync,
    ibkrConnected: !!(settings?.ibkrToken && settings?.ibkrQueryId),
    ibkrAutoSyncing,
    ibkrSyncStatus: settings?._ibkrAutoSyncStatus || null,
    ibkrSyncError: settings?._ibkrAutoSyncError || null,
    ibkrSyncErrorCode: settings?._ibkrAutoSyncErrorCode || null,
    ibkrLastSync: settings?._ibkrLastAutoSync || settings?._ibkrLastSync || null,
  }
}
