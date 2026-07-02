'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import { useExchangeRates } from '@/hooks/useExchangeRates'

// Finanzas is GTQ-denominated; normalize every transaction to GTQ before summing
// so a USD entry isn't added 1:1 to GTQ totals (and mislabeled "Q").
const FINANCE_CURRENCY = 'GTQ'

import Header from '@/components/dashboard/Header'
import MobileNav from '@/components/dashboard/MobileNav'
import MonthSelector from '@/components/finance/MonthSelector'
import FinanceSummaryCards from '@/components/finance/FinanceSummaryCards'
import CategoryBreakdown from '@/components/finance/CategoryBreakdown'
import FinanceTransactionList from '@/components/finance/FinanceTransactionList'
import AddFinanceTransactionModal from '@/components/finance/AddFinanceTransactionModal'
import FileImportModal from '@/components/FileImportModal'

export default function FinancesPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')
  const [modal, setModal] = useState(null)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
    }
  }, [])

  const handleSetLang = useCallback(() => {
    const next = lang === 'en' ? 'es' : 'en'
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onIdTokenChanged(auth, (currentUser) => {
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
    loading: dataLoading,
    addItem,
    updateItem,
    financeTransactions,
    addFinanceTransaction,
    deleteFinanceTransaction,
    settings,
  } = useFirestoreItems()

  const { convert } = useExchangeRates()

  const monthTransactions = useMemo(() => {
    return financeTransactions
      .filter(tx => {
        if (!tx.date) return false
        // Parse YYYY-MM-DD parts directly. `new Date('2026-06-01')` is UTC midnight,
        // which shifts to the prior day/month for users west of UTC (e.g. GT, UTC-6).
        const [y, m] = String(tx.date).split('-').map(Number)
        if (!y || !m) return false
        return (m - 1) === month && y === year
      })
      .map(tx => {
        const cur = tx.currency || FINANCE_CURRENCY
        const amount = convert ? convert(tx.amount || 0, cur, FINANCE_CURRENCY) : (tx.amount || 0)
        // Keep the original for reference; display/sum use the GTQ-normalized amount
        return cur === FINANCE_CURRENCY ? tx : { ...tx, amount, _originalAmount: tx.amount, _originalCurrency: cur }
      })
  }, [financeTransactions, month, year, convert])

  const income = useMemo(() =>
    monthTransactions.filter(tx => tx.type === 'INCOME').reduce((s, tx) => s + (tx.amount || 0), 0),
    [monthTransactions]
  )

  const expenses = useMemo(() =>
    monthTransactions.filter(tx => tx.type === 'EXPENSE').reduce((s, tx) => s + (tx.amount || 0), 0),
    [monthTransactions]
  )

  const t = (es, en) => lang === 'es' ? es : en

  // Shared by the desktop header button and MobileNav — the export used to live
  // only in MobileNav, so desktop had no way to download the CSV.
  const handleExportCsv = () => {
    if (monthTransactions.length === 0) return
    const header = 'Date,Type,Category,Description,Amount,Currency'
    const rows = monthTransactions.map(tx => {
      const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`
      return [esc(tx.date || ''), esc(tx.type || ''), esc(tx.category || ''), esc(tx.description || ''), tx.amount || 0, esc(tx.currency || 'GTQ')].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chispudo-finances-${year}-${String(month + 1).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-theme-base">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="text-blue-400 text-2xl">⚡</span>
            <span className="text-lg font-bold text-blue-400">Chispudo</span>
          </div>
          <div className="block">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
          <p className="mt-4 text-slate-500 text-sm">{t('Cargando...', 'Loading...')}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const handleSignOut = async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-theme-base">
      <a href="#main-content" className="skip-link">{t('Ir al contenido', 'Skip to content')}</a>
      <Header
        user={user}
        lang={lang}
        setLang={handleSetLang}
        onImport={() => setModal('import')}
        onSettings={() => router.push('/dashboard')}
        onSignOut={handleSignOut}
        onRefresh={() => {}}
        pricesLoading={false}
      />

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">{t('Finanzas Personales', 'Personal Finances')}</h1>
            <p className="text-xs text-slate-500">{t('Ingresos y gastos', 'Income & expenses')}</p>
          </div>
          <div className="flex items-center gap-3">
            <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y) }} lang={lang} />
            <button onClick={() => setModal('add')}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors">
              + {t('Agregar', 'Add')}
            </button>
            <button onClick={() => setModal('import')}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-theme-elevated transition-colors">
              {t('Importar', 'Import')}
            </button>
            {monthTransactions.length > 0 && (
              <button onClick={handleExportCsv}
                className="hidden sm:inline-flex px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-theme-elevated transition-colors">
                {t('Exportar', 'Export')}
              </button>
            )}
          </div>
        </div>

        {/* A brand-new user sees the empty state directly, not a stack of Q0.00
            cards and blank breakdowns with the guidance buried below the fold. */}
        {financeTransactions.length > 0 && <>
        <FinanceSummaryCards income={income} expenses={expenses} lang={lang} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CategoryBreakdown transactions={monthTransactions} type="EXPENSE" lang={lang} />
          <CategoryBreakdown transactions={monthTransactions} type="INCOME" lang={lang} />
        </div>

        <FinanceTransactionList
          transactions={monthTransactions}
          onDelete={deleteFinanceTransaction}
          lang={lang}
        />
        </>}

        {financeTransactions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-white font-semibold mb-2">{t('Sin transacciones aún', 'No transactions yet')}</p>
            <p className="text-slate-500 text-sm mb-4">
              {t('Importa tu estado de cuenta bancario o agrega transacciones manualmente.',
                 'Import your bank statement or add transactions manually.')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setModal('import')}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Importar Estado de Cuenta', 'Import Bank Statement')}
              </button>
              <button onClick={() => setModal('add')}
                className="px-4 py-2 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                {t('Agregar Manual', 'Add Manually')}
              </button>
            </div>
          </div>
        )}
      </main>

      {modal === 'add' && (
        <AddFinanceTransactionModal
          onClose={() => setModal(null)}
          onAdd={addFinanceTransaction}
          lang={lang}
        />
      )}

      {modal === 'import' && (
        <FileImportModal
          onClose={() => setModal(null)}
          onImportItems={addItem}
          onAddFinanceTransaction={addFinanceTransaction}
          onUpdateItem={updateItem}
          existingItems={items}
          lang={lang}
        />
      )}

      <MobileNav
        onAdd={() => setModal('add')}
        onImport={() => setModal('import')}
        onExport={handleExportCsv}
        onSettings={() => router.push('/dashboard')}
        lang={lang}
      />
    </div>
  )
}
