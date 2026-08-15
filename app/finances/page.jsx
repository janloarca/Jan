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
import FinanceInsights from '@/components/finance/FinanceInsights'
import FinancialProfileCard from '@/components/finance/FinancialProfileCard'
import AddFinanceTransactionModal from '@/components/finance/AddFinanceTransactionModal'
import AutoCaptureModal from '@/components/finance/AutoCaptureModal'
import FileImportModal from '@/components/FileImportModal'
import { SkeletonCard, SkeletonTable } from '@/components/dashboard/Skeleton'
import { computeMonthlyAnalysis, buildFinanceInsights, investmentIncomeOfMonth } from '@/lib/financeMonth'
import PageTour from '@/components/dashboard/PageTour'
import { Wallet, Zap } from 'lucide-react'
import { INCOME_GROUPS } from '@/lib/financeCategories'
import { authFetch } from '@/lib/authFetch'

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
    updateFinanceTransaction,
    deleteFinanceTransaction,
    settings,
    saveSettings,
    profile,
    saveProfile,
    transactions: portfolioTransactions,
  } = useFirestoreItems()

  const { convert, loading: ratesLoading, refresh: refreshRates } = useExchangeRates()

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
        const conv = convert ? convert(tx.amount || 0, cur, FINANCE_CURRENCY) : NaN
        const amount = isFinite(conv) ? conv : (tx.amount || 0)
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

  // ── Motor mensual: análisis, insights, ingreso de inversión (solo lectura) ──
  const investmentIncome = useMemo(
    () => investmentIncomeOfMonth(portfolioTransactions, { month, year }, convert),
    [portfolioTransactions, month, year, convert]
  )
  const analysis = useMemo(() => {
    // The read-only investment income counts as income in every compared month,
    // so savings/savings-rate insights agree with the summary cards.
    const prevMY = month === 0 ? { month: 11, year: year - 1 } : { month: month - 1, year }
    return computeMonthlyAnalysis(financeTransactions, { month, year }, convert, {
      extraIncome: investmentIncome.total,
      prevExtraIncome: investmentIncomeOfMonth(portfolioTransactions, prevMY, convert).total,
      yoyExtraIncome: investmentIncomeOfMonth(portfolioTransactions, { month, year: year - 1 }, convert).total,
    })
  }, [financeTransactions, portfolioTransactions, investmentIncome, month, year, convert])
  const monthInsights = useMemo(() => buildFinanceInsights(analysis, lang), [analysis, lang])
  const incomeByGroup = useMemo(() => {
    const byCat = {}
    for (const tx of monthTransactions) {
      if (tx.type !== 'INCOME') continue
      byCat[tx.category] = (byCat[tx.category] || 0) + (tx.amount || 0)
    }
    const out = {}
    for (const g of INCOME_GROUPS) {
      if (g.autoOnly) continue
      out[g.key] = g.categories.reduce((s, c) => s + (byCat[c] || 0), 0)
    }
    return out
  }, [monthTransactions])

  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear()
  const daysLeft = isCurrentMonth
    ? new Date(year, month + 1, 0).getDate() - now.getDate()
    : 0

  const reminderEnabled = !!settings?.financeReminder
  const handleToggleReminder = useCallback(async () => {
    const next = !reminderEnabled
    // Email captured at opt-in time from Firebase Auth — the month-end cron reads it
    // server-side without ever listing auth users.
    await saveSettings({
      financeReminder: next,
      // Sin `financeReminderLang`: todo correo saliente va en inglés (FASE
      // HX2), así que guardar un idioma que nadie lee solo haría creer que la
      // preferencia hace algo.
      ...(next ? { financeReminderEmail: user?.email || '' } : {}),
    })
  }, [reminderEnabled, saveSettings, user, lang])

  // Fixing the category of a transaction also TEACHES the auto-capture
  // classifier: the rule is stored per merchant, so the next charge from that
  // place lands already classified. Only auto-captured rows teach, so correcting
  // a hand-typed entry never writes a rule from a description the user typed.
  const handleRecategorize = useCallback(async (tx, category) => {
    if (!tx?.id || !category || category === tx.category) return
    await updateFinanceTransaction(tx.id, { category, _needsReview: false })
    const merchant = tx.merchant || tx.description
    if (!merchant || !String(tx._source || '').startsWith('auto_')) return
    await authFetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learn', merchant, category }),
    }).catch(() => {})
  }, [updateFinanceTransaction])

  const t = (es, en) => lang === 'es' ? es : en

  // Shared by the desktop header button and MobileNav — the export used to live
  // only in MobileNav, so desktop had no way to download the CSV.
  const handleExportCsv = () => {
    if (monthTransactions.length === 0) return
    // Amounts here are already GTQ-normalized (monthTransactions), so the
    // Currency column is always GTQ; converted rows keep their original next to it.
    const header = 'Date,Type,Category,Description,Amount,Currency,OriginalAmount,OriginalCurrency'
    const rows = monthTransactions.map(tx => {
      const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`
      return [
        esc(tx.date || ''), esc(tx.type || ''), esc(tx.category || ''), esc(tx.description || ''),
        tx.amount || 0, esc(FINANCE_CURRENCY),
        tx._originalCurrency ? (tx._originalAmount || 0) : '', esc(tx._originalCurrency || ''),
      ].join(',')
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
    // Structural skeleton instead of a bare spinner — same treatment the
    // dashboard and spreadsheet already get.
    return (
      <div className="min-h-screen bg-theme-base">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <SkeletonTable />
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
      {/* FASE EM. onRefresh was a no-op and no load-stage signal was passed, so
          the ring could never show real progress — same gap as the spreadsheet
          page. Finanzas has no market prices to refresh (its numbers are
          Firestore-live + GTQ conversion), so its two real stages are the data
          listener and the exchange rate fetch. */}
      <Header
        user={user}
        lang={lang}
        setLang={handleSetLang}
        onImport={() => setModal('import')}
        onSettings={() => router.push('/dashboard')}
        onSignOut={handleSignOut}
        onRefresh={refreshRates}
        pricesLoading={ratesLoading}
        loadStagesDone={[!dataLoading, !ratesLoading].filter(Boolean).length}
        loadStagesTotal={2}
        friendsEnabled={settings?.friendsEnabled !== false}
      />
      <PageTour pageKey="finances" nextRoute="/spreadsheet" nextFlag="spreadsheet" lang={lang} steps={[
        {
          tab: t('Flujo', 'Flow'),
          title: t('Tu mes en orden', 'Your month in order'),
          body: t('Esta pestaña es para tu vida financiera personal: los ingresos y gastos de cada mes, separados de tus inversiones. Las tarjetas de arriba resumen cuánto entró, cuánto salió y cuánto ahorraste, con la comparación contra el mes anterior.',
                  'This tab is for your personal financial life: each month\'s income and spending, separate from your investments. The cards up top summarize what came in, what went out and what you saved, compared against last month.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          title: t('Registra o importa movimientos', 'Log or import movements'),
          body: t('Puedes anotar cada gasto a mano con el botón de agregar, o importar el estado de cuenta de tu banco (PDF o Excel). Chispudo detecta duplicados para que re-importar el mismo mes no duplique nada, y te deja categorizar cada movimiento.',
                  'You can log each expense by hand with the add button, or import your bank statement (PDF or Excel). Chispudo detects duplicates so re-importing the same month never double-counts, and lets you categorize every movement.'),
          tip: t('Los movimientos se agrupan en 6 categorías principales para que los reportes sean claros.', 'Movements group into 6 main categories so reports stay clear.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          title: t('Insights de tu gasto', 'Spending insights'),
          body: t('Chispudo analiza tu mes: detecta gastos hormiga (esos pequeños que suman), calcula tu tasa de ahorro y te muestra cómo cambió cada categoría contra el mes pasado y contra el mismo mes del año anterior.',
                  'Chispudo analyzes your month: it flags small recurring spends that add up, computes your savings rate, and shows how each category moved versus last month and the same month last year.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          title: t('Conectado con tu portafolio', 'Connected to your portfolio'),
          body: t('Los dividendos e intereses que genera tu portafolio aparecen aquí automáticamente como ingreso de inversión. Así tu tasa de ahorro cuenta la historia completa. También puedes activar un recordatorio mensual por correo para no olvidar registrar tu mes.',
                  'Dividends and interest from your portfolio show up here automatically as investment income, so your savings rate tells the full story. You can also enable a monthly email reminder so you never forget to log your month.'),
        },
      ]} />

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-white flex items-center gap-2">
              <Wallet size={18} style={{ color: 'var(--accent-blue)' }} /> {t('Flujo', 'Flow')}
            </h1>
            <p className="text-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('Ingresos y gastos', 'Income & expenses')}</p>
          </div>
          <div className="flex items-center gap-3">
            <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y) }} lang={lang} />
            <button onClick={() => setModal('add')}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors" style={{ color: '#ffffff' }}>
              + {t('Agregar', 'Add')}
            </button>
            <button onClick={() => setModal('import')}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-theme-elevated transition-colors">
              {t('Importar', 'Import')}
            </button>
            <button onClick={() => setModal('auto')}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-theme-elevated transition-colors">
              <Zap size={12} style={{ color: 'var(--accent-blue)' }} /> {t('Automático', 'Automatic')}
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
        <FinanceSummaryCards income={income} expenses={expenses}
          investmentIncome={investmentIncome.total}
          momIncomePct={analysis.momIncomePct} momExpensesPct={analysis.momExpensesPct}
          lang={lang} />

        <FinanceInsights
          analysis={analysis}
          insights={monthInsights}
          investmentIncome={investmentIncome}
          incomeByGroup={incomeByGroup}
          lang={lang}
          isCurrentMonth={isCurrentMonth}
          daysLeft={daysLeft}
          reminderEnabled={reminderEnabled}
          onToggleReminder={handleToggleReminder}
          reminderEmail={settings?.financeReminderEmail || user?.email || ''}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CategoryBreakdown transactions={monthTransactions} type="EXPENSE" lang={lang} />
          <CategoryBreakdown transactions={monthTransactions} type="INCOME" lang={lang} />
        </div>

        <FinanceTransactionList
          transactions={monthTransactions}
          onDelete={deleteFinanceTransaction}
          onRecategorize={handleRecategorize}
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
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button onClick={() => setModal('import')}
                className="px-4 py-2 rounded-lg hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                {t('Importar Estado de Cuenta', 'Import Bank Statement')}
              </button>
              <button onClick={() => setModal('add')}
                className="px-4 py-2 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                {t('Agregar Manual', 'Add Manually')}
              </button>
              <button onClick={() => setModal('auto')}
                className="flex items-center gap-1.5 px-4 py-2 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                <Zap size={14} style={{ color: 'var(--accent-blue)' }} /> {t('Configurar Automático', 'Set Up Automatic')}
              </button>
            </div>
          </div>
        )}

        {/* Moved here from Settings: nobody found it there, and this data is
            time-sensitive — it belongs next to the money it describes. */}
        <FinancialProfileCard profile={profile} onSaveProfile={saveProfile} analysis={analysis} lang={lang} />
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
          existingFinanceTransactions={financeTransactions}
          onUpdateItem={updateItem}
          existingItems={items}
          lang={lang}
        />
      )}

      {modal === 'auto' && (
        <AutoCaptureModal onClose={() => setModal(null)} lang={lang} />
      )}

      <MobileNav
        onAdd={() => setModal('add')}
        onImport={() => setModal('import')}
        onExport={handleExportCsv}
        onAuto={() => setModal('auto')}
        onSettings={() => router.push('/dashboard')}
        lang={lang}
        friendsEnabled={settings?.friendsEnabled !== false}
      />
    </div>
  )
}
