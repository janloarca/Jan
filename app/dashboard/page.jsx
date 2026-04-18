'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'

import FileImportModal from '@/components/FileImportModal'
import AddAccountModal from '@/components/AddAccountModal'
import AddTransactionModal from '@/components/AddTransactionModal'
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

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [lang, setLang] = useState('es')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
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
    loading: dataLoading,
    addItem,
    deleteItem,
    deleteAllItems,
    saveSnapshot,
    deleteAllSnapshots,
    addTransaction,
    deleteAllTransactions,
  } = useFirestoreItems()

  const handleSignOut = async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    if (auth) await signOut(auth)
    router.push('/login')
  }

  const handleExport = useCallback(async () => {
    if (items.length === 0) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(items.map((it) => ({
      Symbol: it.symbol, Name: it.name, Type: it.type,
      Quantity: it.quantity, Price: it.purchasePrice, Institution: it.institution,
      Value: (it.quantity || 0) * (it.purchasePrice || 0),
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio')
    if (transactions.length > 0) {
      const wsTx = XLSX.utils.json_to_sheet(transactions.map((tx) => ({
        Date: tx.date, Type: tx.type, Symbol: tx.symbol,
        Quantity: tx.quantity, Price: tx.pricePerUnit, Total: tx.totalAmount,
        Description: tx.description,
      })))
      XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions')
    }
    XLSX.writeFile(wb, `chispudo-portfolio-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [items, transactions])

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const totalFromItems = useMemo(() => items.reduce((s, it) => s + (it.quantity || 0) * (it.purchasePrice || 0), 0), [items])
  const totalAssets = latestSnapshot?.totalActivosUSD ?? totalFromItems
  const netWorth = latestSnapshot?.netWorthUSD ?? totalAssets

  const monthlyChange = useMemo(() => {
    if (!latestSnapshot || !prevSnapshot) return null
    const prev = prevSnapshot.netWorthUSD ?? prevSnapshot.totalActivosUSD ?? 0
    const curr = netWorth
    if (prev === 0) return null
    return ((curr - prev) / prev) * 100
  }, [latestSnapshot, prevSnapshot, netWorth])

  const yearStart = useMemo(() => {
    return snapshots.find((s) => {
      if (!s.date) return false
      return new Date(s.date).getFullYear() === new Date().getFullYear()
    })
  }, [snapshots])

  const startVal = yearStart?.netWorthUSD ?? yearStart?.totalActivosUSD ?? netWorth
  const returnYTD = startVal > 0 ? ((netWorth - startVal) / startVal) * 100 : 0
  const ytdChange = netWorth - startVal

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
        onSignOut={handleSignOut}
        onRefresh={() => window.location.reload()}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
          <span className="text-[11px] text-slate-500">
            {lang === 'es' ? 'Datos' : 'Data'}: {dataAge != null ? (dataAge === 0 ? (lang === 'es' ? 'hoy' : 'today') : `${dataAge}d`) : (lang === 'es' ? 'sin datos' : 'no data')}
          </span>
        </div>

        {/* Row 1: Net Worth + Portfolio Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4">
            <NetWorthCard
              netWorth={netWorth}
              totalAssets={totalAssets}
              returnYTD={returnYTD}
              ytdChange={ytdChange}
              monthlyChange={monthlyChange}
              lang={lang}
            />
            <TopMovers items={items} lang={lang} />
            <FinancialHealth items={items} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} />
          </div>

          <div className="lg:col-span-3 space-y-4">
            <PortfolioGrowthChart snapshots={snapshots} lang={lang} />
            <AssetAllocation items={items} lang={lang} />
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
          itemCount={items.length}
          lang={lang}
        />

        {/* Monthly Performance */}
        <MonthlyPerformance snapshots={snapshots} lang={lang} />

        {/* Row 2: Dividend Income + Value Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <DividendIncome transactions={transactions} lang={lang} />
          <ConcentrationRisk items={items} lang={lang} />
        </div>

        {/* Accounts & Instruments */}
        <AccountsTable items={items} lang={lang} onDeleteItem={deleteItem} />

        {/* Value Breakdown */}
        <ValueBreakdown items={items} lang={lang} />

        {/* Recent Transactions */}
        <RecentTransactions transactions={transactions} lang={lang} />
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={() => setModal(null)}
          onImportItems={addItem}
          onImportTransaction={addTransaction}
          lang={lang}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={() => setModal(null)}
          onAdd={addItem}
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
    </div>
  )
}
