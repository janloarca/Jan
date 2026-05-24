'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'

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

  const monthTransactions = useMemo(() => {
    return financeTransactions.filter(tx => {
      if (!tx.date) return false
      const d = new Date(tx.date)
      return d.getMonth() === month && d.getFullYear() === year
    })
  }, [financeTransactions, month, year])

  const income = useMemo(() =>
    monthTransactions.filter(tx => tx.type === 'INCOME').reduce((s, tx) => s + (tx.amount || 0), 0),
    [monthTransactions]
  )

  const expenses = useMemo(() =>
    monthTransactions.filter(tx => tx.type === 'EXPENSE').reduce((s, tx) => s + (tx.amount || 0), 0),
    [monthTransactions]
  )

  const t = (es, en) => lang === 'es' ? es : en

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
    <div className="min-h-screen bg-[#0f172a]">
      <a href="#main-content" className="skip-link">{t('Ir al contenido', 'Skip to content')}</a>
      <Header
        user={user}
        lang={lang}
        setLang={handleSetLang}
        onImport={() => setModal('import')}
        onSettings={() => {}}
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
              className="px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors">
              {t('Importar BI', 'Import BI')}
            </button>
          </div>
        </div>

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

        {financeTransactions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-white font-semibold mb-2">{t('Sin transacciones aún', 'No transactions yet')}</p>
            <p className="text-slate-500 text-sm mb-4">
              {t('Importa tu estado de cuenta de Banco Industrial o agrega transacciones manualmente.',
                 'Import your Banco Industrial statement or add transactions manually.')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setModal('import')}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Importar Estado de Cuenta', 'Import Bank Statement')}
              </button>
              <button onClick={() => setModal('add')}
                className="px-4 py-2 border border-[#334155] text-slate-300 rounded-lg hover:bg-[#283548] transition-colors text-sm">
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
        onExport={() => {}}
        onShare={() => {}}
        onSettings={() => {}}
        onSearch={() => {}}
        lang={lang}
      />
    </div>
  )
}
