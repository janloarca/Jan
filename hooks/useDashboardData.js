import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useFirestoreItems } from './useFirestoreItems'
import { useMarketPrices } from './useMarketPrices'
import { useExchangeRates } from './useExchangeRates'
import { useBenchmark } from './useBenchmark'
import { useTabCoordination } from './useTabCoordination'
import { authFetch } from '@/lib/authFetch'
import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, getTypeCategory, getInvestmentClass } from '@/components/dashboard/utils'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights, computeAssetAttribution } from '@/components/dashboard/analytics'
import { checkPriceAlerts } from '@/lib/notifications'

export function useDashboardData({ user, lang, activePortfolio, activeEntity = '__all__' }) {
  const firestoreData = useFirestoreItems()
  const {
    items, snapshots, transactions, goals, settings,
    loading: dataLoading, addItem, updateItem, deleteItem,
    deleteAllItems, saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    alerts, addAlert, deleteAlert, updateAlert,
    lots, addLot, closeLotsFIFO,
    portfolios, addPortfolio, deletePortfolio,
    financeTransactions, addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    saveGoals, saveSettings,
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
        purchasePrice: purchaseConverted || it.purchasePrice,
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
    const todayStr = new Date().toISOString().split('T')[0]
    if (snapshotSavedRef.current === todayStr) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return
    const alreadyExists = snapshots.some((s) => s.date === todayStr || s.id === todayStr)
    if (alreadyExists) { snapshotSavedRef.current = todayStr; return }
    let totalAssetsUSD = 0
    let totalDebtUSD = 0
    enrichedItems.forEach((it) => {
      const origPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
      const origCurrency = it._originalCurrency ?? baseCurrency ?? 'USD'
      let value = (it.quantity || 0) * origPrice
      value = convert ? convert(value, origCurrency, 'USD') : value
      if (it.isDebt) totalDebtUSD += Math.abs(value)
      else totalAssetsUSD += value
    })
    const netWorthUSD = totalAssetsUSD - totalDebtUSD
    if (totalAssetsUSD > 0 || totalDebtUSD > 0) {
      saveSnapshot({ date: todayStr, totalActivosUSD: totalAssetsUSD, totalDebtUSD, netWorthUSD, rates: rates || {}, baseCurrency })
      snapshotSavedRef.current = todayStr
    }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency])

  // Dividend processing
  const dividendsProcessedRef = useRef(null)
  useEffect(() => {
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    if (dividendsProcessedRef.current === todayKey) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return
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
      const destCur = dest._originalCurrency || dest.currency || 'USD'
      const converted = convert ? convert(amount, sourceCurrency, destCur) : amount
      const newQty = (dest.quantity || 0) + 1
      const oldPrice = dest._originalPrice || dest.currentPrice || dest.purchasePrice || 0
      const newPrice = oldPrice + converted / Math.max(newQty, 1)
      await updateItem(dest.id, { currentPrice: newPrice, purchasePrice: newPrice })
    }

    async function processDividends() {
      for (const it of scheduled) {
        if (cancelled) return
        const payMonths = Array.isArray(it.incomeMonths) ? it.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
        if (!payMonths.includes(currentMonth)) continue
        const effectivePayDay = getEffectivePayDay(it.incomePayDay || 1, it.businessDayRule)
        if (todayDay < effectivePayDay) continue

        const txKey = `DIV-${it.symbol || it.name}-${todayKey}`
        const alreadyProcessed = transactions.some((tx) => tx.id === txKey || (tx.symbol === (it.symbol || it.name) && tx.date === todayKey && (tx.type || '').toUpperCase() === 'DIVIDEND'))
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

          if (amount <= 0) continue

          await addTransaction({
            date: todayKey,
            type: 'DIVIDEND',
            symbol: it.symbol || it.name,
            description: `Dividend from ${it.name || it.symbol}`,
            totalAmount: amount,
            currency: incomeCurrency,
            _source: 'auto',
          })

          if (it.dividendAction === 'reinvest') {
            const priceForReinvest = originalPrice > 0 ? originalPrice : 1
            const newShares = amount / priceForReinvest
            await updateItem(it.id, { quantity: qty + newShares })
          } else if (it.incomeDestination) {
            const dest = enrichedItems.find((d) => (d.id || d.symbol) === it.incomeDestination)
            if (dest) {
              await addToDestination(dest, amount, incomeCurrency)
            }
          }

          if (it.capitalReturn > 0) {
            const newPrice = Math.max(0, (it._originalPrice || it.currentPrice || it.purchasePrice || 0) - it.capitalReturn)
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
      dividendsProcessedRef.current = todayKey
    }

    processDividends()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, transactions, addTransaction, updateItem, convert])

  const handleRefresh = useCallback(() => {
    refreshPrices()
    refreshRates()
  }, [refreshPrices, refreshRates])

  // IBKR auto-sync
  const { acquireLock, releaseLock } = useTabCoordination()
  const ibkrAutoSyncRef = useRef(false)

  const handleIBKRSync = useCallback(async (data, mode = 'merge') => {
    if (mode === 'replace') {
      const ibkrItems = items.filter(it =>
        it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      )
      for (const it of ibkrItems) {
        await deleteItem(it.id)
      }
    }
    for (const item of data.items) {
      let existing = null
      if (mode === 'merge') {
        existing = items.find(it =>
          (it.conid && it.conid === item.conid) ||
          (
            (it.symbol || '').toUpperCase() === item.symbol &&
            ((it.institution || '').toLowerCase().includes('interactive brokers') || it._source === 'ibkr')
          )
        )
      }
      if (existing) {
        await updateItem(existing.id, {
          currentPrice: item.currentPrice,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
          conid: item.conid,
          _ibkrAccountId: item._ibkrAccountId,
          _ibkrMarketValue: item._ibkrMarketValue,
          _ibkrUnrealizedPL: item._ibkrUnrealizedPL,
          _source: 'ibkr',
        })
      } else {
        await addItem(item)
        if (item.quantity > 0 && item.purchasePrice > 0 && item.type !== 'Bank') {
          await addLot({
            symbol: item.symbol,
            quantity: item.quantity,
            costBasis: item.purchasePrice,
            currency: item.currency || 'USD',
            acquisitionDate: new Date().toISOString().split('T')[0],
          })
        }
      }
    }
    for (const tx of (data.transactions || [])) {
      await addTransaction(tx)
    }
    if (data.equityHistory && data.equityHistory.length > 0) {
      const existingDates = new Set(snapshots.map(s => s.date))
      for (const entry of data.equityHistory) {
        if (!existingDates.has(entry.date)) {
          await saveSnapshot({
            date: entry.date,
            totalActivosUSD: entry.totalNav,
            netWorthUSD: entry.totalNav,
            _source: 'ibkr',
          })
        }
      }
    }
  }, [items, addItem, updateItem, deleteItem, addTransaction, addLot, saveSnapshot, snapshots])

  useEffect(() => {
    if (dataLoading || ibkrAutoSyncRef.current) return
    if (!settings?.ibkrToken || !settings?.ibkrQueryId) return
    ibkrAutoSyncRef.current = true
    const SYNC_INTERVAL = 60 * 60 * 1000
    const lastSync = settings._ibkrLastAutoSync ? new Date(settings._ibkrLastAutoSync).getTime() : 0
    const shouldSync = Date.now() - lastSync > SYNC_INTERVAL

    const doAutoSync = async () => {
      if (!acquireLock('ibkr-sync')) return
      try {
        const { syncIBKR } = await import('@/lib/ibkrSync')
        const { decryptToken } = await import('@/lib/crypto')
        const plain = await decryptToken(settings.ibkrToken, user?.uid)
        const data = await syncIBKR(plain, settings.ibkrQueryId)
        await handleIBKRSync(data, 'merge')
        saveSettings({ _ibkrLastAutoSync: new Date().toISOString() })
        console.log(`[ibkr] Auto-sync OK: ${data.items.length} positions`)
      } catch (err) {
        console.log(`[ibkr] Auto-sync failed: ${err.message}`)
      } finally {
        releaseLock('ibkr-sync')
      }
    }

    if (shouldSync) doAutoSync()
    const interval = setInterval(doAutoSync, SYNC_INTERVAL)
    return () => clearInterval(interval)
  }, [dataLoading, settings, user, handleIBKRSync, saveSettings])

  // Derived values
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const totalFromItems = useMemo(() =>
    portfolioItems.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0),
    [portfolioItems]
  )

  const convertSnapshot = useCallback((val) => convert(val, 'USD', baseCurrency), [convert, baseCurrency])

  const totalAssets = useMemo(() =>
    totalFromItems > 0 ? totalFromItems : (latestSnapshot ? convertSnapshot(latestSnapshot.totalActivosUSD ?? 0) : 0),
    [totalFromItems, latestSnapshot, convertSnapshot]
  )
  const netWorth = totalAssets

  const dailyChange = useMemo(() => {
    if (!prevSnapshot || netWorth <= 0) return null
    const prevValue = convertSnapshot(prevSnapshot.netWorthUSD ?? prevSnapshot.totalActivosUSD ?? 0)
    if (prevValue <= 0) return null
    const abs = netWorth - prevValue
    const pct = (abs / prevValue) * 100
    return { abs, pct }
  }, [prevSnapshot, netWorth, convertSnapshot])

  const yearlyChange = useMemo(() => {
    if (snapshots.length < 2) return null
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    let yearAgoSnapshot = null
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].date && new Date(snapshots[i].date) <= oneYearAgo) { yearAgoSnapshot = snapshots[i]; break }
    }
    if (!yearAgoSnapshot) return null
    const prev = convertSnapshot(yearAgoSnapshot.netWorthUSD ?? yearAgoSnapshot.totalActivosUSD ?? 0)
    if (prev === 0) return null
    return ((netWorth - prev) / prev) * 100
  }, [snapshots, netWorth, convertSnapshot])

  const [jan1Value, setJan1Value] = useState(null)
  useEffect(() => {
    if (!enrichedItems || enrichedItems.length === 0) return
    let cancelled = false
    async function fetchJan1() {
      try {
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: enrichedItems.map((it) => ({
              symbol: it.symbol, type: it.type, quantity: it.quantity,
              currentPrice: it.currentPrice, purchasePrice: it.purchasePrice,
              acquisitionDate: it.acquisitionDate,
            })),
            period: 'YTD',
          }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        const pts = data.dataPoints || []
        if (pts.length > 0) {
          const firstReal = pts.find(p => p.total > 0)
          if (!cancelled && firstReal) setJan1Value(firstReal.total)
        }
      } catch {}
    }
    fetchJan1()
    return () => { cancelled = true }
  }, [enrichedItems])

  const { returnYTD, ytdChange, returnSinceStart, sinceStartDate } = useMemo(() => {
    const yearStartTs = new Date(new Date().getFullYear(), 0, 1).getTime()
    let startVal = null
    if (snapshots.length >= 2) {
      let minDiff = Infinity
      let bestSnap = null
      const MAX_SNAP_DISTANCE = 30 * 86400000
      for (const s of snapshots) {
        if (!s.date) continue
        const snapTs = new Date(s.date).getTime()
        if (snapTs > Date.now()) continue
        const diff = Math.abs(snapTs - yearStartTs)
        if (diff < minDiff) { minDiff = diff; bestSnap = s }
      }
      if (bestSnap && minDiff <= MAX_SNAP_DISTANCE) {
        startVal = convertSnapshot(bestSnap.netWorthUSD ?? bestSnap.totalActivosUSD ?? 0)
      }
    }
    if (startVal == null || startVal <= 0) startVal = jan1Value

    let returnSinceStart = null
    let sinceStartDate = null
    if ((startVal == null || startVal <= 0) && snapshots.length >= 2) {
      const sorted = [...snapshots]
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
  }, [jan1Value, netWorth, transactions, convert, baseCurrency, snapshots, convertSnapshot])

  const annualDividends = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, convert, baseCurrency])

  const estimatedAnnualIncome = useMemo(() => {
    let total = 0
    portfolioItems.forEach((it) => {
      const qty = it.quantity || 1
      const price = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      let annual = 0
      if (it.incomeAmount > 0 && it.incomeMonths) {
        const payCount = Array.isArray(it.incomeMonths) ? it.incomeMonths.length : 12
        annual = it.incomeAmount * payCount
      } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
        annual = balance * (it.incomeRate / 100)
      } else if (it.dividendYield > 0) {
        annual = balance * (it.dividendYield / 100)
      }
      if (annual > 0) {
        const cur = it.currency || it._originalCurrency || 'USD'
        total += convert(annual, cur, baseCurrency)
      }
    })
    return total
  }, [portfolioItems, convert, baseCurrency])

  const benchmarkSymbol = settings?.benchmarkSymbol || '%5EGSPC'
  const { benchmarkData, benchmarkReturn, benchmarkName, loading: benchmarkLoading, error: benchmarkError } = useBenchmark('YTD', benchmarkSymbol)

  const netContributions = useMemo(() => {
    return computeNetContributions(transactions, convert, baseCurrency).netContributions
  }, [transactions, convert, baseCurrency])

  const cashTotal = useMemo(() => {
    return portfolioItems
      .filter((it) => /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(it.type || ''))
      .reduce((s, it) => s + (it.currentPrice || it.purchasePrice || 0), 0)
  }, [portfolioItems])

  const riskMetrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const sharpeResult = computeSharpeRatio({ returns })
    const vol = computeVolatility({ returns })
    const valueSeries = (snapshots || [])
      .map((s) => ({ ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
      .filter((p) => !isNaN(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(valueSeries)
    return { sharpe: sharpeResult.sharpe, volatility: vol, maxDrawdown: drawdown.maxDrawdownPct }
  }, [snapshots, transactions, convert, baseCurrency])

  const insights = useMemo(() => {
    const hhiResult = computeHHI(portfolioItems.map((it) => ({ value: getItemValue(it) })))
    const incomeYield = netWorth > 0 && annualDividends > 0 ? (annualDividends / netWorth) * 100 : 0
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
    return generateInsights({
      netWorth, benchmarkReturn,
      portfolioReturn: returnYTD,
      sharpe: riskMetrics.sharpe, volatility: riskMetrics.volatility, maxDrawdown: riskMetrics.maxDrawdown,
      hhi: hhiResult.hhi, incomeYield, goals,
      topContributor, topDrag, maturingSoon, debtRatio, investmentClassPcts,
    })
  }, [netWorth, benchmarkReturn, returnYTD, riskMetrics, portfolioItems, annualDividends, goals])

  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

  return {
    // Raw Firestore data
    items, snapshots, transactions, goals, settings, alerts, lots, portfolios, financeTransactions,
    entityTransactions, entityFinanceTransactions,
    dataLoading,

    // Firestore actions
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    addAlert, deleteAlert, updateAlert,
    addLot, closeLotsFIFO,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    saveGoals, saveSettings,

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
    netContributions, cashTotal, riskMetrics, insights, dataAge,

    // Benchmark
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName, benchmarkLoading,

    // IBKR
    handleIBKRSync,
  }
}
