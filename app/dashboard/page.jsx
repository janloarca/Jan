'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'

import Header from '@/components/dashboard/Header'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import PortfolioGrowthChart from '@/components/dashboard/PortfolioGrowthChart'
import TopMovers from '@/components/dashboard/TopMovers'
import FinancialHealth from '@/components/dashboard/FinancialHealth'
import ActionButtons from '@/components/dashboard/ActionButtons'
import MonthlyPerformance from '@/components/dashboard/MonthlyPerformance'
import AccountsTable from '@/components/dashboard/AccountsTable'
import RecentTransactions from '@/components/dashboard/RecentTransactions'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)
  const [lang, setLang] = useState('es')

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

  // Computed values
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null
  const totalAssets = latestSnapshot?.totalActivosUSD ?? 0
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

  // Data status
  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

  // Loading
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b1120]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <p className="mt-4 text-slate-500">{lang === 'es' ? 'Cargando...' : 'Loading...'}</p>
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
        setLang={setLang}
        onImport={() => setShowImportModal(true)}
        onSignOut={handleSignOut}
        onRefresh={() => window.location.reload()}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Data freshness indicator */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
          <span className="text-[11px] text-slate-500">
            Data: {dataAge != null ? (dataAge === 0 ? 'today' : `${dataAge}d ago`) : 'no data'}
          </span>
        </div>

        {/* Top row: Net Worth + Portfolio Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Left column: Net Worth + Top Movers + Dividends + Health */}
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
            <FinancialHealth items={items} netWorth={netWorth} totalAssets={totalAssets} lang={lang} />
          </div>

          {/* Right column: Portfolio Growth */}
          <div className="lg:col-span-3">
            <PortfolioGrowthChart snapshots={snapshots} lang={lang} />
          </div>
        </div>

        {/* Action Buttons */}
        <ActionButtons onImport={() => setShowImportModal(true)} itemCount={items.length} lang={lang} />

        {/* Monthly Performance */}
        <MonthlyPerformance snapshots={snapshots} lang={lang} />

        {/* Accounts & Instruments */}
        <AccountsTable items={items} lang={lang} />

        {/* Recent Transactions */}
        <RecentTransactions transactions={transactions} lang={lang} />

        {/* Generate Report */}
        <div className="text-center py-6">
          <button className="px-6 py-3 text-sm font-medium text-slate-300 bg-[#131c2e] border border-[#1e2d45] rounded-xl hover:bg-[#1a2540] transition-colors inline-flex items-center gap-2">
            📄 {lang === 'es' ? 'Generar Reporte' : 'Generate Report'}
          </button>
        </div>
      </main>

      {/* Import Modal Placeholder */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowImportModal(false)}>
          <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-3">
              {lang === 'es' ? 'Importar Datos' : 'Import Data'}
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              {lang === 'es'
                ? 'El modulo de importacion esta en desarrollo.'
                : 'Import module is under development.'}
            </p>
            <button onClick={() => setShowImportModal(false)}
              className="w-full py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">
              {lang === 'es' ? 'Cerrar' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
