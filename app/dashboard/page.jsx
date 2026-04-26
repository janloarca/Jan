'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import { useMarketPrices } from '@/hooks/useMarketPrices'
import { useExchangeRates } from '@/hooks/useExchangeRates'

import FileImportModal from '@/components/FileImportModal'
import AddAccountModal from '@/components/AddAccountModal'

import SettingsModal from '@/components/SettingsModal'
import { setBaseCurrency, computeModifiedDietz, getItemValue } from '@/components/dashboard/utils'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights } from '@/components/dashboard/analytics'
import { useBenchmark } from '@/hooks/useBenchmark'
import Header from '@/components/dashboard/Header'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import PortfolioGrowthChart from '@/components/dashboard/PortfolioGrowthChart'
import TopMovers from '@/components/dashboard/TopMovers'
import FinancialHealth from '@/components/dashboard/FinancialHealth'
import ActionButtons from '@/components/dashboard/ActionButtons'
import MonthlyPerformance from '@/components/dashboard/MonthlyPerformance'
import AccountsTable from '@/components/dashboard/AccountsTable'
import RecentTransactions from '@/components/dashboard/RecentTransactions'
import AssetAllocation from '@/components/dashboard/AssetAllocation'
import PerformanceSummary from '@/components/dashboard/PerformanceSummary'
import DividendIncome from '@/components/dashboard/DividendIncome'
import ConcentrationRisk from '@/components/dashboard/ConcentrationRisk'
import GoalTracker from '@/components/dashboard/GoalTracker'
import ProjectionSimulator from '@/components/dashboard/ProjectionSimulator'
import RiskMetrics from '@/components/dashboard/RiskMetrics'
import BenchmarkComparison from '@/components/dashboard/BenchmarkComparison'
import InsightsBanner from '@/components/dashboard/InsightsBanner'
import CurrencyImpact from '@/components/dashboard/CurrencyImpact'
import EditAccountModal from '@/components/EditAccountModal'
import OptimizeModal from '@/components/OptimizeModal'
import AssetDetailModal from '@/components/dashboard/AssetDetailModal'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [lang, setLang] = useState('es')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
      const savedTheme = localStorage.getItem('chispudo-theme')
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme)
        document.documentElement.setAttribute('data-theme', savedTheme)
      }
    }
  }, [])

  const handleSetTheme = useCallback((newTheme) => {
    setTheme(newTheme)
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-theme', newTheme)
      localStorage.setItem('chispudo-theme', newTheme)
    }
  }, [])

  const handleSetLang = useCallback((newLang) => {
    const next = newLang === 'toggle' ? (lang === 'en' ? 'es' : 'en') : newLang
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onAuthStateChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (!currentUser) {
          router.push('/login')
        } else {
          setUser(currentUser)
        }
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => unsubscribe()
  }, [router])

  const {
    items,
    snapshots,
    transactions,
    goals,
    settings,
    loading: dataLoading,
    addItem,
    deleteItem,
    deleteAllItems,
    saveSnapshot,
    deleteAllSnapshots,
    addTransaction,
    deleteAllTransactions,
    saveGoals,
    saveSettings,
  } = useFirestoreItems()

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => {
    setBaseCurrency(baseCurrency)
  }, [baseCurrency])

  const { enrichedItems: rawEnriched, loading: pricesLoading, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

  const enrichedItems = useMemo(() => {
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
        _originalCurrency: itemCurrency,
        _displayCurrency: baseCurrency,
      }
    })
  }, [rawEnriched, convert, baseCurrency])

  const snapshotSavedRef = useRef(false)

  useEffect(() => {
    if (snapshotSavedRef.current) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return

    const todayStr = new Date().toISOString().split('T')[0]
    const alreadyExists = snapshots.some((s) => s.date === todayStr || s.id === todayStr)
    if (alreadyExists) { snapshotSavedRef.current = true; return }

    const totalUSD = enrichedItems.reduce((sum, it) => {
      const value = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
      return sum + convert(value, baseCurrency, 'USD')
    }, 0)

    if (totalUSD > 0) {
      saveSnapshot({ date: todayStr, totalActivosUSD: totalUSD, netWorthUSD: totalUSD, rates: rates || {}, baseCurrency })
      snapshotSavedRef.current = true
    }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency])

  const dividendsProcessedRef = useRef(null)

  useEffect(() => {
    const todayKey = new Date().toISOString().split('T')[0]
    if (dividendsProcessedRef.current === todayKey) return
    if (!user || dataLoading) return
    if (items.length === 0) return

    const scheduled = items.filter((it) => (it.incomeAmount > 0 || it.incomeRate > 0) && it.incomeMonths)
    if (scheduled.length === 0) return

    const today = new Date()
    const todayDay = today.getDate()
    const currentMonth = today.getMonth()

    scheduled.forEach((it) => {
      const payDay = it.incomePayDay || 1
      if (todayDay !== payDay) return

      const months = it.incomeMonths || [0,1,2,3,4,5,6,7,8,9,10,11]
      if (!months.includes(currentMonth)) return

      const sym = (it.symbol || '').toUpperCase()
      const alreadyPaid = transactions.some((tx) =>
        tx.date === todayKey &&
        (tx.type || '').toUpperCase() === 'DIVIDEND' &&
        (tx.symbol || '').toUpperCase() === sym &&
        tx._auto === true
      )
      if (alreadyPaid) return

      let paymentAmount = it.incomeAmount || 0
      if (it.incomeMode === 'percent' && it.incomeRate > 0) {
        const balance = (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
        const payMonths = (it.incomeMonths || []).length || 12
        paymentAmount = (balance * (it.incomeRate / 100)) / payMonths
      }
      if (paymentAmount <= 0) return

      addTransaction({
        type: 'DIVIDEND',
        symbol: sym,
        description: `${it.name || it.symbol} - ${paymentAmount.toFixed(2)} ${it.currency || 'USD'}`,
        date: todayKey,
        totalAmount: Math.round(paymentAmount * 100) / 100,
        currency: it.currency || 'USD',
        _auto: true,
      })

      if (it.dividendAction === 'reinvest') {
        const sharePrice = it.currentPrice || it.purchasePrice || 0
        if (sharePrice > 0) {
          const newShares = paymentAmount / sharePrice
          addItem({ ...it, quantity: (it.quantity || 0) + newShares })
        }
      } else if (it.incomeDestination) {
        const dest = items.find((d) => (d.id || d.symbol) === it.incomeDestination)
        if (dest) {
          const destPrice = (dest.currentPrice || dest.purchasePrice || 0) + paymentAmount
          addItem({ ...dest, currentPrice: destPrice, purchasePrice: destPrice })
        }
      }

      if (it.capitalReturn > 0) {
        const newPrice = Math.max(0, (it.currentPrice || it.purchasePrice || 0) - it.capitalReturn)
        addItem({ ...it, currentPrice: newPrice, purchasePrice: newPrice })

        if (it.capitalDestination) {
          const dest = items.find((d) => (d.id || d.symbol) === it.capitalDestination)
          if (dest) {
            const destPrice = (dest.currentPrice || dest.purchasePrice || 0) + it.capitalReturn
            addItem({ ...dest, currentPrice: destPrice, purchasePrice: destPrice })
          }
        }
      }
    })

    dividendsProcessedRef.current = new Date().toISOString().split('T')[0]
  }, [user, dataLoading, items, transactions, addTransaction, addItem])

  const handleRefresh = useCallback(() => {
    refreshPrices()
    refreshRates()
  }, [refreshPrices, refreshRates])

  const handleSignOut = async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    if (auth) await signOut(auth)
    router.push('/login')
  }

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const totalFromItems = useMemo(() =>
    enrichedItems.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0),
    [enrichedItems]
  )

  const convertSnapshot = useCallback((val) => convert(val, 'USD', baseCurrency), [convert, baseCurrency])

  const totalAssets = useMemo(() =>
    totalFromItems > 0 ? totalFromItems : (latestSnapshot ? convertSnapshot(latestSnapshot.totalActivosUSD ?? 0) : 0),
    [totalFromItems, latestSnapshot, convertSnapshot]
  )
  const netWorth = totalAssets

  const handleExport = useCallback(async () => {
    if (items.length === 0) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(enrichedItems.map((it) => ({
      Symbol: it.symbol, Name: it.name, Type: it.type,
      Quantity: it.quantity, 'Purchase Price': it.purchasePrice,
      'Current Price': it.currentPrice || '', Institution: it.institution,
      Currency: it._displayCurrency || baseCurrency,
      Value: (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0),
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio')
    if (transactions.length > 0) {
      const wsTx = XLSX.utils.json_to_sheet(transactions.map((tx) => ({
        Date: tx.date, Type: tx.type, Symbol: tx.symbol,
        Quantity: tx.quantity, Price: tx.pricePerUnit, Total: tx.totalAmount,
        Currency: tx.currency || 'USD', Description: tx.description,
      })))
      XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions')
    }
    XLSX.writeFile(wb, `chispudo-portfolio-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [enrichedItems, transactions, baseCurrency])

  const handleReport = useCallback(async () => {
    const { generateReport } = await import('@/lib/generateReport')
    await generateReport({
      items: enrichedItems, snapshots, transactions,
      netWorth, totalAssets, lang,
    })
  }, [enrichedItems, snapshots, transactions, lang, netWorth, totalAssets])

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
        const res = await fetch('/api/prices/portfolio-history', {
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
          if (!cancelled) setJan1Value(pts[0].total)
        }
      } catch {}
    }
    fetchJan1()
    return () => { cancelled = true }
  }, [enrichedItems])

  const { returnYTD, ytdChange } = useMemo(() => {
    if (jan1Value == null) return { returnYTD: 0, ytdChange: 0 }
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
    const { pct, abs } = computeModifiedDietz({
      startValue: jan1Value,
      endValue: netWorth,
      startTs: yearStart,
      endTs: Date.now(),
      transactions,
      convert,
      baseCurrency,
    })
    return { returnYTD: pct, ytdChange: abs }
  }, [jan1Value, netWorth, transactions, convert, baseCurrency])

  const annualDividends = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, convert, baseCurrency])

  const estimatedAnnualIncome = useMemo(() => {
    let total = 0
    enrichedItems.forEach((it) => {
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
  }, [enrichedItems, convert, baseCurrency])

  const { benchmarkData, benchmarkReturn, loading: benchmarkLoading } = useBenchmark('YTD')

  const netContributions = useMemo(() => {
    return computeNetContributions(transactions, convert, baseCurrency).netContributions
  }, [transactions, convert, baseCurrency])

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
    const hhiResult = computeHHI(enrichedItems.map((it) => ({ value: getItemValue(it) })))
    const incomeYield = netWorth > 0 && annualDividends > 0 ? (annualDividends / netWorth) * 100 : 0
    return generateInsights({
      netWorth,
      benchmarkReturn,
      portfolioReturn: returnYTD,
      sharpe: riskMetrics.sharpe,
      volatility: riskMetrics.volatility,
      maxDrawdown: riskMetrics.maxDrawdown,
      hhi: hhiResult.hhi,
      incomeYield,
      goals,
    })
  }, [netWorth, benchmarkReturn, returnYTD, riskMetrics, enrichedItems, annualDividends, goals])

  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="text-blue-400 text-2xl">⚡</span>
            <span className="text-lg font-bold text-blue-400">Chispudo</span>
          </div>
          <div className="block">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
          <p className="mt-4 text-slate-500 text-sm">{lang === 'es' ? 'Cargando tu portfolio...' : 'Loading your portfolio...'}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <Header
        user={user}
        lang={lang}
        setLang={() => handleSetLang('toggle')}
        onImport={() => setModal('import')}
        onSettings={() => setModal('settings')}
        onSignOut={handleSignOut}
        onRefresh={handleRefresh}
        pricesLoading={pricesLoading || ratesLoading}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-blue-400 pulse-dot" />
          <span className="text-[11px] text-slate-500">
            {lang === 'es' ? 'Datos' : 'Data'}: {dataAge != null ? (dataAge === 0 ? (lang === 'es' ? 'hoy' : 'today') : `${dataAge}d`) : (lang === 'es' ? 'sin datos' : 'no data')}
          </span>
          {pricesUpdate && (
            <span className="text-[10px] text-slate-600">
              {lang === 'es' ? 'Precios:' : 'Prices:'} {new Date(pricesUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {baseCurrency !== 'USD' && (
            <span className="text-[10px] text-cyan-500/70">{baseCurrency}</span>
          )}
          {(pricesLoading || ratesLoading) && <span className="text-[10px] text-emerald-500 animate-pulse">{lang === 'es' ? 'Actualizando...' : 'Updating...'}</span>}
        </div>

        {/* Insights Banner */}
        <InsightsBanner insights={insights} lang={lang} />

        {/* ═══ OVERVIEW ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <NetWorthCard
              netWorth={netWorth}
              returnYTD={returnYTD}
              ytdChange={ytdChange}
              yearlyChange={yearlyChange}
              convert={convert}
              lang={lang}
              netContributions={netContributions}
            />
            <BenchmarkComparison benchmarkReturn={benchmarkReturn} portfolioReturn={returnYTD} lang={lang} />
            <TopMovers items={enrichedItems} transactions={transactions} lang={lang} />
          </div>

          <div className="lg:col-span-3 flex flex-col gap-4">
            <PortfolioGrowthChart items={enrichedItems} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} />
            <AssetAllocation items={enrichedItems} lang={lang} />
          </div>
        </div>

        {/* ═══ PERFORMANCE & RISK ═══ */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {lang === 'es' ? 'Rendimiento y Riesgo' : 'Performance & Risk'}
          </span>
          <div className="flex-1 h-px bg-[#334155]" />
        </div>

        <PerformanceSummary items={enrichedItems} transactions={transactions} convert={convert} baseCurrency={baseCurrency} netWorth={netWorth} lang={lang} />
        <RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} />
        <CurrencyImpact items={enrichedItems} convert={convert} baseCurrency={baseCurrency} rates={rates} lang={lang} />
        <MonthlyPerformance snapshots={snapshots} transactions={transactions} convert={convert} baseCurrency={baseCurrency} lang={lang} />

        {/* Action Buttons */}
        <ActionButtons
          onImport={() => setModal('import')}
          onAddAccount={() => setModal('account')}
          onOptimize={() => setModal('optimize')}
          onExport={handleExport}
          itemCount={enrichedItems.length}
          lang={lang}
        />

        {/* ═══ INCOME & GOALS ═══ */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {lang === 'es' ? 'Ingresos y Metas' : 'Income & Goals'}
          </span>
          <div className="flex-1 h-px bg-[#334155]" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <DividendIncome transactions={transactions} items={enrichedItems} convert={convert} baseCurrency={baseCurrency} lang={lang} netWorth={netWorth} />
          <ConcentrationRisk items={enrichedItems} lang={lang} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <GoalTracker
            netWorth={netWorth}
            annualDividends={annualDividends}
            estimatedAnnualIncome={estimatedAnnualIncome}
            goals={goals}
            onSaveGoals={saveGoals}
            volatility={riskMetrics.volatility}
            lang={lang}
          />
          <FinancialHealth items={enrichedItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} />
        </div>

        <ProjectionSimulator netWorth={netWorth} lang={lang} volatility={riskMetrics.volatility} goalValue={goals?.portfolioGoal} />

        {/* ═══ HOLDINGS ═══ */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {lang === 'es' ? 'Posiciones' : 'Holdings'}
          </span>
          <div className="flex-1 h-px bg-[#334155]" />
        </div>

        <AccountsTable items={enrichedItems} lang={lang} onDeleteItem={deleteItem}
          onEditItem={(item) => setEditItem(item)} onViewItem={(item) => setDetailItem(item)} />

        <RecentTransactions transactions={transactions} lang={lang} />

        {/* Generate Report */}
        <div className="text-center py-6">
          <button onClick={handleReport}
            className="px-6 py-3 text-sm font-medium text-slate-300 bg-[#1e293b] border border-[#334155] rounded-xl hover:bg-[#283548] hover:text-white transition-colors inline-flex items-center gap-2">
            {lang === 'es' ? 'Generar Reporte PDF' : 'Generate PDF Report'}
          </button>
        </div>
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={() => setModal(null)}
          onImportItems={addItem}
          onImportTransaction={addTransaction}
          onImportSnapshot={saveSnapshot}
          lang={lang}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={() => setModal(null)}
          onAdd={addItem}
          onAddTransaction={addTransaction}
          existingItems={items}
          lang={lang}
        />
      )}

      {modal === 'optimize' && (
        <OptimizeModal
          items={items}
          onClose={() => setModal(null)}
          onSave={addItem}
          onDelete={deleteItem}
          lang={lang}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal
          onClose={() => setModal(null)}
          settings={settings}
          onSaveSettings={saveSettings}
          onDeleteAllItems={deleteAllItems}
          onDeleteAllSnapshots={deleteAllSnapshots}
          onDeleteAllTransactions={deleteAllTransactions}
          theme={theme}
          onToggleTheme={handleSetTheme}
          lang={lang}
        />
      )}

      {editItem && (
        <EditAccountModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={addItem}
          onDelete={deleteItem}
          lang={lang}
        />
      )}

      {detailItem && (
        <AssetDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          lang={lang}
        />
      )}
    </div>
  )
}
