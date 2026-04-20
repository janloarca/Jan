'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import { useMarketPrices } from '@/hooks/useMarketPrices'
import { useExchangeRates } from '@/hooks/useExchangeRates'

import FileImportModal from '@/components/FileImportModal'
import AddAccountModal from '@/components/AddAccountModal'
import AddTransactionModal from '@/components/AddTransactionModal'
import SettingsModal from '@/components/SettingsModal'
import { setBaseCurrency } from '@/components/dashboard/utils'
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
import ValueBreakdown from '@/components/dashboard/ValueBreakdown'
import ConcentrationRisk from '@/components/dashboard/ConcentrationRisk'
import GoalTracker from '@/components/dashboard/GoalTracker'
import ProjectionSimulator from '@/components/dashboard/ProjectionSimulator'
import EditAccountModal from '@/components/EditAccountModal'
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
  const { convert, convertItemValue, loading: ratesLoading, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

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
      saveSnapshot({ date: todayStr, totalActivosUSD: totalUSD, netWorthUSD: totalUSD })
      snapshotSavedRef.current = true
    }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency])

  const dividendsProcessedRef = useRef(false)

  useEffect(() => {
    if (dividendsProcessedRef.current) return
    if (!user || dataLoading) return
    if (items.length === 0) return

    const scheduled = items.filter((it) => it.incomeAmount > 0 && it.incomeMonths)
    if (scheduled.length === 0) return

    const today = new Date()
    const todayDay = today.getDate()
    const currentMonth = today.getMonth()
    const todayKey = today.toISOString().split('T')[0]

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

      addTransaction({
        type: 'DIVIDEND',
        symbol: sym,
        description: `${it.name || it.symbol} - ${it.incomeAmount} ${it.currency || 'USD'}`,
        date: todayKey,
        totalAmount: it.incomeAmount,
        currency: it.currency || 'USD',
        _auto: true,
      })

      if (it.incomeDestination) {
        const dest = items.find((d) => (d.id || d.symbol) === it.incomeDestination)
        if (dest) {
          const destPrice = (dest.currentPrice || dest.purchasePrice || 0) + it.incomeAmount
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

    dividendsProcessedRef.current = true
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

  const totalAssets = totalFromItems > 0 ? totalFromItems : (latestSnapshot ? convertSnapshot(latestSnapshot.totalActivosUSD ?? 0) : 0)
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
    const yearAgoSnapshot = [...snapshots].reverse().find((s) => s.date && new Date(s.date) <= oneYearAgo)
    if (!yearAgoSnapshot) return null
    const prev = convertSnapshot(yearAgoSnapshot.netWorthUSD ?? yearAgoSnapshot.totalActivosUSD ?? 0)
    if (prev === 0) return null
    return ((netWorth - prev) / prev) * 100
  }, [snapshots, netWorth, convertSnapshot])

  const yearStart = useMemo(() => {
    return snapshots.find((s) => {
      if (!s.date) return false
      return new Date(s.date).getFullYear() === new Date().getFullYear()
    })
  }, [snapshots])

  const startVal = yearStart ? convertSnapshot(yearStart.netWorthUSD ?? yearStart.totalActivosUSD ?? 0) : netWorth
  const returnYTD = startVal > 0 ? ((netWorth - startVal) / startVal) * 100 : 0
  const ytdChange = netWorth - startVal

  const annualDividends = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, convert, baseCurrency])

  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b1120]">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="text-emerald-400 text-2xl">⚡</span>
            <span className="text-lg font-bold text-emerald-400">Chispudo</span>
          </div>
          <div className="block">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          </div>
          <p className="mt-4 text-slate-500 text-sm">{lang === 'es' ? 'Cargando tu portfolio...' : 'Loading your portfolio...'}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#0b1120]">
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
          <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
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

        {/* Row 1: Net Worth + Portfolio Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <NetWorthCard
              netWorth={netWorth}
              returnYTD={returnYTD}
              ytdChange={ytdChange}
              yearlyChange={yearlyChange}
              convert={convert}
              lang={lang}
            />
            <TopMovers items={enrichedItems} lang={lang} />
            <GoalTracker
              netWorth={netWorth}
              annualDividends={annualDividends}
              goals={goals}
              onSaveGoals={saveGoals}
              lang={lang}
            />
            <FinancialHealth items={enrichedItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} />
          </div>

          <div className="lg:col-span-3 flex flex-col gap-4">
            <PortfolioGrowthChart snapshots={snapshots} transactions={transactions} lang={lang} />
            <AssetAllocation items={enrichedItems} lang={lang} />
          </div>
        </div>

        {/* Performance Summary */}
        <PerformanceSummary snapshots={snapshots} lang={lang} />

        {/* Action Buttons */}
        <ActionButtons
          onImport={() => setModal('import')}
          onAddAccount={() => setModal('account')}
          onAddTransaction={() => setModal('transaction')}
          onExport={handleExport}
          itemCount={enrichedItems.length}
          lang={lang}
        />

        {/* Monthly Performance */}
        <MonthlyPerformance snapshots={snapshots} lang={lang} />

        {/* Row 2: Dividend Income + Concentration Risk */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <DividendIncome transactions={transactions} convert={convert} baseCurrency={baseCurrency} lang={lang} />
          <ConcentrationRisk items={enrichedItems} lang={lang} />
        </div>

        {/* Accounts & Instruments */}
        <AccountsTable items={enrichedItems} lang={lang} onDeleteItem={deleteItem}
          onEditItem={(item) => setEditItem(item)} onViewItem={(item) => setDetailItem(item)} />

        {/* Value Breakdown */}
        <ValueBreakdown items={enrichedItems} lang={lang} />

        {/* Projection Simulator */}
        <ProjectionSimulator netWorth={netWorth} lang={lang} />

        {/* Recent Transactions */}
        <RecentTransactions transactions={transactions} lang={lang} />

        {/* Generate Report */}
        <div className="text-center py-6">
          <button onClick={handleReport}
            className="px-6 py-3 text-sm font-medium text-slate-300 bg-[#131c2e] border border-[#1e2d45] rounded-xl hover:bg-[#1a2540] hover:text-white transition-colors inline-flex items-center gap-2">
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
          existingItems={items}
          lang={lang}
        />
      )}

      {modal === 'transaction' && (
        <AddTransactionModal
          onClose={() => setModal(null)}
          onAdd={addTransaction}
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
