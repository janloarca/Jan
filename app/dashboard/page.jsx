'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { getItemValue, formatCurrency, getTypeCategory } from '@/components/dashboard/utils'
import Header from '@/components/dashboard/Header'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import ActionButtons from '@/components/dashboard/ActionButtons'
import SectionCollapse from '@/components/dashboard/SectionCollapse'
import MobileNav from '@/components/dashboard/MobileNav'
import ErrorBanner from '@/components/dashboard/ErrorBanner'
import ErrorBoundary from '@/components/ErrorBoundary'
import CardBoundary from '@/components/dashboard/CardBoundary'
import { SkeletonCard, SkeletonChart } from '@/components/dashboard/Skeleton'

function ModalSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="h-5 w-32 bg-slate-700/50 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          <div className="h-10 bg-slate-700/30 rounded animate-pulse" />
          <div className="h-10 bg-slate-700/30 rounded animate-pulse" />
          <div className="h-10 bg-slate-700/30 rounded animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  )
}

const FileImportModal = dynamic(() => import('@/components/FileImportModal'), { loading: () => <ModalSkeleton /> })
const AddAccountModal = dynamic(() => import('@/components/AddAccountModal'), { loading: () => <ModalSkeleton /> })
const SellModal = dynamic(() => import('@/components/SellModal'), { loading: () => <ModalSkeleton /> })
const TransferModal = dynamic(() => import('@/components/TransferModal'), { loading: () => <ModalSkeleton /> })
const IBKRSyncModal = dynamic(() => import('@/components/IBKRSyncModal'), { loading: () => <ModalSkeleton /> })
const BlockchainSyncModal = dynamic(() => import('@/components/BlockchainSyncModal'), { loading: () => <ModalSkeleton /> })
const LedgerSyncModal = dynamic(() => import('@/components/LedgerSyncModal'), { loading: () => <ModalSkeleton /> })
const SettingsModal = dynamic(() => import('@/components/SettingsModal'), { loading: () => <ModalSkeleton /> })
const EditAccountModal = dynamic(() => import('@/components/EditAccountModal'), { loading: () => <ModalSkeleton /> })
const OptimizeModal = dynamic(() => import('@/components/OptimizeModal'))
const AssetDetailModal = dynamic(() => import('@/components/dashboard/AssetDetailModal'), { loading: () => <ModalSkeleton /> })
const AccountReviewModal = dynamic(() => import('@/components/dashboard/AccountReviewModal'), { loading: () => <ModalSkeleton /> })
const CashFlowModal = dynamic(() => import('@/components/CashFlowModal'), { loading: () => <ModalSkeleton /> })
const PrintSummary = dynamic(() => import('@/components/dashboard/PrintSummary'))
const OnboardingTour = dynamic(() => import('@/components/dashboard/OnboardingTour'))
const CommandPalette = dynamic(() => import('@/components/dashboard/CommandPalette'))
const ChatWidget = dynamic(() => import('@/components/ChatWidget'), { ssr: false })

const PortfolioGrowthChart = dynamic(() => import('@/components/dashboard/PortfolioGrowthChart'), { loading: () => <SkeletonChart /> })
const DividendIncome = dynamic(() => import('@/components/dashboard/DividendIncome'), { loading: () => <SkeletonCard /> })
const GoalTracker = dynamic(() => import('@/components/dashboard/GoalTracker'), { loading: () => <SkeletonCard /> })
const FinancialHealth = dynamic(() => import('@/components/dashboard/FinancialHealth'), { loading: () => <SkeletonCard /> })
const ConcentrationRisk = dynamic(() => import('@/components/dashboard/ConcentrationRisk'), { loading: () => <SkeletonCard /> })
const GainsReport = dynamic(() => import('@/components/dashboard/GainsReport'), { loading: () => <SkeletonCard /> })
const PerformanceAttribution = dynamic(() => import('@/components/dashboard/PerformanceAttribution'), { loading: () => <SkeletonCard /> })
const RiskMetrics = dynamic(() => import('@/components/dashboard/RiskMetrics'), { loading: () => <SkeletonCard /> })
const InsightCards = dynamic(() => import('@/components/dashboard/InsightCards'), { loading: () => <SkeletonCard /> })
const InstitutionPerformance = dynamic(() => import('@/components/dashboard/InstitutionPerformance'), { loading: () => <SkeletonCard /> })
const RebalanceSuggestions = dynamic(() => import('@/components/dashboard/RebalanceSuggestions'), { loading: () => <SkeletonCard /> })

import RecentTransactions from '@/components/dashboard/RecentTransactions'
import AssetAllocation from '@/components/dashboard/AssetAllocation'
import NotificationCenter from '@/components/dashboard/NotificationCenter'
import InstallPrompt from '@/components/dashboard/InstallPrompt'
import EmptyState from '@/components/dashboard/EmptyState'
// MonthlyBreakdown removed — replaced by /spreadsheet page
import PortfolioSelector from '@/components/dashboard/PortfolioSelector'
import EntitySwitcher from '@/components/dashboard/EntitySwitcher'
import { useEntities } from '@/hooks/useEntities'
import { authFetch } from '@/lib/authFetch'

function AnalysisTabs({ lang, portfolioItems, netWorth, totalAssets, snapshots, lots, transactions, convert, baseCurrency, benchmarkData, benchmarkName }) {
  const [tab, setTab] = useState('health')
  const t = (es, en) => lang === 'es' ? es : en
  const hasLots = lots && lots.length > 0
  const tabs = [
    { key: 'health', label: t('Salud', 'Health') },
    { key: 'risk', label: t('Riesgo', 'Risk') },
    { key: 'concentration', label: t('Concentración', 'Concentration') },
    ...(hasLots ? [{ key: 'gains', label: t('Ganancias', 'Gains') }] : []),
    { key: 'attribution', label: t('Atribución', 'Attribution') },
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${tab === tb.key ? 'bg-blue-600 text-white' : 'text-slate-400 border border-[#38383A] hover:text-white hover:bg-[#2C2C2E]'}`}>
            {tb.label}
          </button>
        ))}
      </div>
      {tab === 'health' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CardBoundary id="AN-01"><FinancialHealth items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} /></CardBoundary>
          <CardBoundary id="AN-02"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
        </div>
      )}
      {tab === 'risk' && (
        <CardBoundary id="AN-05"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></CardBoundary>
      )}
      {tab === 'concentration' && (
        <CardBoundary id="AN-02b"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {tab === 'gains' && hasLots && (
        <CardBoundary id="AN-03"><GainsReport lots={lots} items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {tab === 'attribution' && (
        <CardBoundary id="AN-04"><PerformanceAttribution items={portfolioItems} lang={lang} /></CardBoundary>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [importBrokerHint, setImportBrokerHint] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [sellItem, setSellItem] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [lang, setLang] = useState('es')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePortfolio, setActivePortfolio] = useState('__all__')
  const [activeEntity, setActiveEntity] = useState('__all__')
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const { entities, addEntity, updateEntity: updateEntityData, deleteEntity } = useEntities()

  // Theme + lang init
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
      const savedTheme = localStorage.getItem('chispudo-theme')
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') setTheme(savedTheme)
      function applyTheme(t) {
        if (t === 'system') {
          const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          document.documentElement.setAttribute('data-theme', sys)
        } else {
          document.documentElement.setAttribute('data-theme', t)
        }
      }
      applyTheme(savedTheme || 'dark')
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        const current = localStorage.getItem('chispudo-theme')
        if (current === 'system') document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [])

  const handleSetTheme = useCallback((newTheme) => {
    setTheme(newTheme)
    if (typeof window !== 'undefined') {
      if (newTheme === 'system') {
        const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', sys)
        localStorage.setItem('chispudo-theme', 'system')
      } else {
        document.documentElement.setAttribute('data-theme', newTheme)
        localStorage.setItem('chispudo-theme', newTheme)
      }
    }
  }, [])

  const handleSetLang = useCallback((newLang) => {
    const next = newLang === 'toggle' ? (lang === 'en' ? 'es' : 'en') : newLang
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  // Auth
  useEffect(() => {
    let unsubscribe = () => {}
    let refreshInterval = null
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
    function setCookie(token) {
      document.cookie = `__session=${token}; path=/; max-age=604800; SameSite=Lax${secure}`
    }
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onIdTokenChanged(auth, async (currentUser) => {
        if (!currentUser) {
          document.cookie = '__session=; path=/; max-age=0'
          router.push('/login')
        } else {
          const token = await currentUser.getIdToken()
          setCookie(token)
          setUser(currentUser)
          if (!refreshInterval) {
            refreshInterval = setInterval(async () => {
              try {
                if (auth.currentUser) {
                  const t = await auth.currentUser.getIdToken(true)
                  setCookie(t)
                }
              } catch {}
            }, 50 * 60 * 1000)
          }
          setAuthLoading(false)
        }
      })
    }
    initAuth()
    return () => { unsubscribe(); if (refreshInterval) clearInterval(refreshInterval) }
  }, [router])

  // Data layer
  const {
    items, snapshots, transactions, goals, settings, profile, alerts, lots, portfolios, financeTransactions,
    dataLoading,
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    addAlert, deleteAlert,
    addLot, closeLotsFIFO,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    bulkImport,
    saveGoals, saveSettings, saveProfile,
    enrichedItems, portfolioItems, entityTransactions, entityFinanceTransactions,
    pricesLoading, pricesError, pricesUpdate,
    rates, convert,
    ratesLoading, ratesError,
    handleRefresh,
    baseCurrency, netWorth, totalAssets, dailyChange, yearlyChange,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate,
    annualDividends, estimatedAnnualIncome,
    netContributions, cashTotal, riskMetrics, insights, dataAge, contributionWarning,
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName,
    handleIBKRSync,
    ibkrSyncStatus, ibkrSyncErrorCode,
  } = useDashboardData({ user, lang, activePortfolio, activeEntity })

  const showToast = useCallback((msg, type = 'success', duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), duration)
  }, [])

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauthCode = params.get('oauth_code')
    const oauthBroker = params.get('oauth_broker')
    const oauthError = params.get('oauth_error')
    if (oauthError) {
      showToast(`OAuth error: ${oauthError}`, 'error', 5000)
      window.history.replaceState({}, '', '/dashboard')
      return
    }
    if (oauthCode && oauthBroker) {
      window.history.replaceState({}, '', '/dashboard')
      authFetch(`/api/brokers/${oauthBroker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exchange-code', code: oauthCode }),
      }).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error || 'OAuth failed') }))
        .then(() => showToast(lang === 'es' ? 'Broker vinculado via OAuth' : 'Broker linked via OAuth'))
        .catch(e => showToast(e.message, 'error', 5000))
    }
  }, [])

  const enrichCacheRef = useRef({})
  useEffect(() => {
    if (!portfolioItems || portfolioItems.length === 0) return
    const needEnrich = portfolioItems
      .filter(it => it.symbol && !it.sector && !it.assetCountry && !enrichCacheRef.current[it.symbol])
      .map(it => it.symbol)
    const unique = [...new Set(needEnrich)].slice(0, 30)
    if (unique.length === 0) return

    unique.forEach(s => { enrichCacheRef.current[s] = 'pending' })
    authFetch('/api/prices/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: unique }),
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (!data?.results) return
      for (const [sym, info] of Object.entries(data.results)) {
        enrichCacheRef.current[sym] = info
      }
      for (const item of portfolioItems) {
        const info = enrichCacheRef.current[item.symbol]
        if (info && typeof info === 'object') {
          if (info.sector && !item.sector) item.sector = info.sector
          if (info.country && !item.assetCountry) item.assetCountry = info.country
          if (info.industry && !item.industry) item.industry = info.industry
        }
      }
    }).catch(() => {})
  }, [portfolioItems])

  // Export XLSX
  const handleExport = useCallback(async () => {
    if (items.length === 0) return
    showToast(lang === 'es' ? 'Generando Excel...' : 'Generating Excel...', 'info')
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(enrichedItems.map((it) => {
      const value = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
      const row = {
        Symbol: it.symbol, Name: it.name, Type: it.type,
        Subtype: it.subtype || '',
        Quantity: it.quantity, 'Purchase Price': it.purchasePrice,
        'Current Price': it.currentPrice || '', Institution: it.institution,
        Currency: it._displayCurrency || baseCurrency,
        Value: it.isDebt ? -Math.abs(value) : value,
      }
      if (it.maturityDate) row['Maturity Date'] = it.maturityDate
      if (it.rateType) row['Rate Type'] = it.rateType
      if (it.incomeRate) row['Income Rate (%)'] = it.incomeRate
      if (it.rateMin) row['Rate Min (%)'] = it.rateMin
      if (it.rateMax) row['Rate Max (%)'] = it.rateMax
      if (it.taxJurisdiction) row['Tax Jurisdiction'] = it.taxJurisdiction
      if (it.isIlliquid) row['Illiquid'] = 'Yes'
      if (it.custodyType) row['Custody'] = it.custodyType
      if (it.isDebt) row['Debt'] = 'Yes'
      if (it.notes) row['Notes'] = it.notes
      if (it.tags?.length) row['Tags'] = it.tags.join(', ')
      return row
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio')
    if (snapshots.length > 0) {
      const wsSnap = XLSX.utils.json_to_sheet(
        [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date)).map((s) => ({
          Date: s.date, 'Net Worth (USD)': s.netWorthUSD ?? s.totalActivosUSD ?? 0, Notes: s.notes || '',
        }))
      )
      XLSX.utils.book_append_sheet(wb, wsSnap, 'History')
    }
    if (transactions.length > 0) {
      const wsTx = XLSX.utils.json_to_sheet(transactions.map((tx) => ({
        Date: tx.date, Type: tx.type, Symbol: tx.symbol,
        Quantity: tx.quantity, Price: tx.pricePerUnit, Total: tx.totalAmount,
        Currency: tx.currency || 'USD', Description: tx.description,
      })))
      XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions')
    }
    XLSX.writeFile(wb, `chispudo-portfolio-${new Date().toISOString().split('T')[0]}.xlsx`)
    showToast(lang === 'es' ? 'Excel exportado ✓' : 'Excel exported ✓')
  }, [enrichedItems, snapshots, transactions, baseCurrency, showToast, lang])

  const handleExportTransactionsCSV = useCallback(() => {
    if (!transactions || transactions.length === 0) return
    const header = 'Date,Type,Symbol,Description,Quantity,Price,Total,Currency,Cost Basis,Realized Gain'
    const rows = [...transactions].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((tx) => {
      const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`
      let costBasis = ''
      let realizedGain = ''
      if ((tx.type || '').toUpperCase() === 'SELL' && tx.symbol && lots) {
        const matched = lots.filter((l) =>
          l.status === 'closed' &&
          (l.symbol || '').toUpperCase() === (tx.symbol || '').toUpperCase() &&
          l.closedDate === tx.date
        )
        if (matched.length > 0) {
          costBasis = matched.reduce((s, l) => s + (l.costBasis || 0) * (l.quantity || 0), 0).toFixed(2)
          realizedGain = matched.reduce((s, l) => s + (l.realizedGain || 0), 0).toFixed(2)
        }
      }
      return [
        tx.date || '', tx.type || '', tx.symbol || '', esc(tx.description || ''),
        tx.quantity || '', tx.pricePerUnit || '', tx.totalAmount || '', tx.currency || 'USD',
        costBasis, realizedGain,
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chispudo-transactions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [transactions, lots])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdPaletteOpen(true) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setModal('account') }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); setModal('import') }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); handleExport() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); setModal('cashflow') }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'r' && !e.shiftKey) { e.preventDefault(); handleRefresh() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleExport, handleRefresh])

  const handleReport = useCallback(async () => {
    const { generateReport } = await import('@/lib/generateReport')
    await generateReport({
      items: enrichedItems, snapshots, transactions,
      netWorth, totalAssets, lang, returnYTD, annualDividends,
      profileName: profile?.name || user?.displayName || '',
    })
    showToast(lang === 'es' ? 'PDF descargado' : 'PDF downloaded')
  }, [enrichedItems, snapshots, transactions, lang, netWorth, totalAssets, returnYTD, annualDividends, profile, user, showToast])

  const handleShare = useCallback(async () => {
    const t = (es, en) => lang === 'es' ? es : en
    const assets = enrichedItems.filter((it) => !it.isDebt)
    const debts = enrichedItems.filter((it) => it.isDebt)
    const debtTotal = debts.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const byCat = {}
    assets.forEach((it) => {
      const cat = getTypeCategory(it)
      byCat[cat] = (byCat[cat] || 0) + getItemValue(it)
    })
    const catLines = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, val]) => `  ${cat}: ${formatCurrency(val)} (${totalAssets > 0 ? ((val / totalAssets) * 100).toFixed(1) : 0}%)`)
      .join('\n')
    const top5 = [...assets]
      .map((it) => ({ name: it.name || it.symbol, value: getItemValue(it) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((it) => `  ${it.name}: ${formatCurrency(it.value)}`)
      .join('\n')
    const text = [
      `⚡ ${t('Mi Portafolio', 'My Portfolio')} — Chispudo`,
      '',
      `${t('Patrimonio Neto', 'Net Worth')}: ${formatCurrency(netWorth)}`,
      `${t('Activos', 'Assets')}: ${formatCurrency(totalAssets)}`,
      debtTotal > 0 ? `${t('Deuda', 'Debt')}: ${formatCurrency(debtTotal)}` : null,
      returnYTD != null ? `${t('Retorno YTD', 'YTD Return')}: ${returnYTD >= 0 ? '+' : ''}${returnYTD.toFixed(2)}%` : null,
      '',
      `${t('Distribución', 'Allocation')}:`,
      catLines,
      '',
      `Top 5:`,
      top5,
      '',
      `${t('Posiciones', 'Positions')}: ${enrichedItems.length}`,
      '',
      `chispu.xyz`,
    ].filter(Boolean).join('\n')
    if (navigator.share) {
      try { await navigator.share({ title: 'Chispudo Portfolio', text }) } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(text)
        showToast(t('Resumen copiado al portapapeles', 'Summary copied to clipboard'), 'success')
      } catch {
        showToast(t('No se pudo copiar', 'Could not copy to clipboard'), 'error')
      }
    }
  }, [enrichedItems, netWorth, totalAssets, returnYTD, lang])

  const handleSignOut = async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }

  const handleCmdAction = useCallback((action, data) => {
    switch (action) {
      case 'add': setModal('account'); break
      case 'import': setModal('import'); break
      case 'export': handleExport(); break
      case 'report': handleReport(); break
      case 'print': setModal('print'); break
      case 'share': handleShare(); break
      case 'transfer': setModal('transfer'); break
      case 'cashflow': setModal('cashflow'); break
      case 'deposit': setModal('cashflow'); break
      case 'withdrawal': setModal('cashflow'); break
      case 'settings': setModal('settings'); break
      case 'refresh': handleRefresh(); break
      case 'theme': handleSetTheme(theme === 'dark' ? 'light' : 'dark'); break
      case 'lang': handleSetLang('toggle'); break
      case 'ibkr': setModal('ibkr'); break
      case 'blockchain': setModal('blockchain'); break
      case 'ledger': setModal('ledger'); break
      case 'viewItem': setDetailItem(data); break
    }
  }, [handleExport, handleReport, handleRefresh, handleSetTheme, handleSetLang, theme])

  useEffect(() => {
    if (!dataLoading && enrichedItems.length === 0 && !showOnboarding && typeof window !== 'undefined' && !localStorage.getItem('chispudo-onboarding-done')) {
      setShowOnboarding(true)
    }
  }, [dataLoading, enrichedItems.length])

  // Loading state
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#000000]">
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
    <div className="min-h-screen bg-[#000000]">
      <a href="#main-content" className="skip-link">{lang === 'es' ? 'Ir al contenido' : 'Skip to content'}</a>
      <Header
        user={user} lang={lang}
        setLang={() => handleSetLang('toggle')}
        onImport={(bh) => { setImportBrokerHint(bh || null); setModal('import') }}
        onSettings={() => setModal('settings')}
        onSignOut={handleSignOut}
        onRefresh={handleRefresh}
        pricesLoading={pricesLoading || ratesLoading}
        onAddAccount={() => setModal('account')}
        onCommandPalette={() => setCmdPaletteOpen(true)}
      />

      {ibkrSyncErrorCode === 'TOKEN_EXPIRED' && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm text-amber-300 font-medium">{lang === 'es' ? 'Tu token de IBKR expiró' : 'Your IBKR token has expired'}</p>
              <p className="text-xs text-amber-400/60 mt-0.5">{lang === 'es' ? 'Genera uno nuevo para mantener tu portafolio actualizado.' : 'Generate a new one to keep your portfolio updated.'}</p>
            </div>
            <button onClick={() => setModal('ibkr')} className="text-xs text-amber-400 hover:text-amber-300 font-medium px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors shrink-0">
              {lang === 'es' ? 'Actualizar' : 'Update'} →
            </button>
          </div>
        </div>
      )}
      {ibkrSyncErrorCode === 'INVALID_QUERY' && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm text-amber-300 font-medium">{lang === 'es' ? 'Query ID de IBKR inválido' : 'Invalid IBKR Query ID'}</p>
              <p className="text-xs text-amber-400/60 mt-0.5">{lang === 'es' ? 'Verifica tu Flex Query en IBKR.' : 'Verify your Flex Query in IBKR.'}</p>
            </div>
            <button onClick={() => setModal('ibkr')} className="text-xs text-amber-400 hover:text-amber-300 font-medium px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors shrink-0">
              {lang === 'es' ? 'Configurar' : 'Configure'} →
            </button>
          </div>
        </div>
      )}

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          {dataAge === 0 ? (
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          ) : dataAge != null && dataAge >= 7 ? (
            <span className="w-2 h-2 rounded-full bg-red-400" />
          ) : dataAge != null && dataAge >= 1 ? (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-500" />
          )}
          <span className={`text-xs ${dataAge >= 7 ? 'text-red-400' : dataAge >= 1 ? 'text-amber-400' : 'text-slate-500'}`}>
            {dataAge === 0
              ? (lang === 'es' ? 'Datos al día' : 'Data up to date')
              : dataAge != null
                ? (lang === 'es' ? `Actualizado hace ${dataAge}d` : `Updated ${dataAge}d ago`)
                : (lang === 'es' ? 'Sin datos aún' : 'No data yet')}
          </span>
          {dataAge != null && dataAge >= 7 && (
            <button onClick={handleRefresh} className="text-micro text-blue-400 hover:text-blue-300 underline transition-colors">
              {lang === 'es' ? 'Actualizar' : 'Refresh'}
            </button>
          )}
          {pricesUpdate && (
            <span className="text-xs text-slate-600">
              {new Date(pricesUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {baseCurrency !== 'USD' && <span className="text-xs text-cyan-500/70">{baseCurrency}</span>}
          <span className="text-[8px] text-slate-700 font-mono select-all" title="Build ID">b5jun-v3</span>
          {(pricesLoading || ratesLoading) && <span className="text-xs text-blue-400 animate-pulse">{lang === 'es' ? 'Actualizando...' : 'Updating...'}</span>}
          {entities && entities.length > 1 && (
            <EntitySwitcher
              entities={entities} activeEntity={activeEntity}
              onSelect={setActiveEntity} onAdd={() => setModal('settings')} lang={lang}
            />
          )}
          {portfolios && portfolios.length > 0 && (
            <PortfolioSelector
              portfolios={portfolios} activePortfolio={activePortfolio}
              onSelect={setActivePortfolio} onAdd={addPortfolio} onDelete={deletePortfolio} lang={lang}
            />
          )}
        </div>

        <h1 className="sr-only">{lang === 'es' ? 'Patrimonio — Dashboard' : 'Net Worth — Dashboard'}</h1>

        <CardBoundary id="ErrorBanner"><ErrorBanner pricesError={pricesError} ratesError={ratesError} lang={lang} /></CardBoundary>
        <CardBoundary id="NotificationCenter"><NotificationCenter items={portfolioItems} transactions={transactions} lang={lang} /></CardBoundary>
        <CardBoundary id="InstallPrompt"><InstallPrompt lang={lang} /></CardBoundary>

        {contributionWarning && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm">
            <span className="text-amber-400 text-lg">!</span>
            <p className="text-amber-300 flex-1">
              {lang === 'es'
                ? 'Tus retornos pueden no ser precisos. Registra tus depósitos y retiros para cálculos correctos.'
                : 'Your returns may not be accurate. Log your deposits and withdrawals for correct calculations.'}
            </p>
            <button onClick={() => setModal('cashflow')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              style={{ backgroundColor: '#2563eb', color: '#fff' }}>
              {lang === 'es' ? 'Registrar ahora' : 'Log now'}
            </button>
          </div>
        )}

        {portfolioItems.length === 0 && !dataLoading && (
          <EmptyState
            onAdd={() => setModal('account')}
            onImport={(bh) => { setImportBrokerHint(bh || null); setModal('import') }}
            onTemplate={async () => {
              const { generateTemplate } = await import('@/lib/generateTemplate')
              await generateTemplate()
            }}
            lang={lang}
          />
        )}

        {/* ═══ RESUMEN ═══ */}
        {portfolioItems.length > 0 && <>
        <ErrorBoundary lang={lang}>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6 items-start">
          <div className="md:col-span-1 lg:col-span-2 flex flex-col gap-4">
            <CardBoundary id="OL-01">
            <NetWorthCard
              netWorth={netWorth} returnYTD={returnYTD} ytdChange={ytdChange}
              returnSinceStart={returnSinceStart} sinceStartDate={sinceStartDate}
              yearlyChange={yearlyChange} dailyChange={dailyChange} convert={convert}
              lang={lang} netContributions={netContributions} cashTotal={cashTotal} snapshots={snapshots}
            />
            </CardBoundary>
            <CardBoundary id="OR-02"><AssetAllocation items={portfolioItems} lang={lang} /></CardBoundary>
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex flex-col gap-4">
            <CardBoundary id="OR-01"><PortfolioGrowthChart items={portfolioItems} lots={lots} snapshots={snapshots} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} benchmarkSymbol={benchmarkSymbol} benchmarkName={benchmarkName} onSaveSnapshot={saveSnapshot} /></CardBoundary>
          </div>
        </div>
        </ErrorBoundary>

        <CardBoundary id="INS-01"><InsightCards items={portfolioItems} profile={profile} netWorth={netWorth} estimatedAnnualIncome={estimatedAnnualIncome} lang={lang} onOpenSettings={() => setModal('settings')} /></CardBoundary>

        {/* ═══ RENDIMIENTO POR INSTITUCIÓN ═══ */}
        <CardBoundary id="INST-01"><InstitutionPerformance items={portfolioItems} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>

        <ActionButtons
          onImport={(bh) => { setImportBrokerHint(bh || null); setModal('import') }} onAddAccount={() => setModal('account')}
          onTransfer={() => setModal('transfer')} onCashFlow={() => setModal('cashflow')} onExport={handleExport}
          onShare={handleShare} onIntegrations={() => setModal('settings')}
          onReview={() => setShowReview(true)} itemCount={enrichedItems.length} lang={lang}
          ibkrSyncStatus={ibkrSyncStatus} ibkrLastSync={settings?._ibkrLastAutoSync || settings?._ibkrLastSync}
        />

        {/* ═══ INGRESOS ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Ingresos' : 'Income'} id="income">
          <ErrorBoundary lang={lang}>
            <CardBoundary id="IG-01"><DividendIncome transactions={transactions} items={portfolioItems} convert={convert} baseCurrency={baseCurrency} lang={lang} netWorth={netWorth} /></CardBoundary>
          </ErrorBoundary>
        </SectionCollapse>

        {/* ═══ ACTIVIDAD RECIENTE ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Actividad Reciente' : 'Recent Activity'} id="activity" defaultOpen={false}>
          <ErrorBoundary lang={lang}>
            <CardBoundary id="HO-02"><RecentTransactions transactions={transactions} lang={lang} onExportCSV={handleExportTransactionsCSV} /></CardBoundary>
          </ErrorBoundary>
        </SectionCollapse>

        {/* ═══ METAS ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Metas' : 'Goals'} id="goals" defaultOpen={!!(goals?.incomeGoal || goals?.portfolioGoal)}>
          <ErrorBoundary lang={lang}>
            <CardBoundary id="GO-01"><GoalTracker netWorth={netWorth} annualDividends={annualDividends} estimatedAnnualIncome={estimatedAnnualIncome} goals={goals} onSaveGoals={saveGoals} volatility={riskMetrics?.volatility} lang={lang} /></CardBoundary>
            {!settings?.hideRebalanceSuggestions && (
              <CardBoundary id="IG-10"><RebalanceSuggestions items={portfolioItems} netWorth={netWorth} goals={goals} onSaveGoals={saveGoals} lang={lang} onDismiss={() => saveSettings({ ...settings, hideRebalanceSuggestions: true })} /></CardBoundary>
            )}
          </ErrorBoundary>
        </SectionCollapse>

        {/* ═══ ANALISIS ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Análisis' : 'Analysis'} id="analysis" defaultOpen={!!(lots && lots.length > 0)}>
          <ErrorBoundary lang={lang}>
            <AnalysisTabs lang={lang} portfolioItems={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lots={lots} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkData={benchmarkData} benchmarkName={benchmarkName} />
          </ErrorBoundary>
        </SectionCollapse>

        <div className="flex items-center justify-center gap-3 pt-4 pb-8">
          <button onClick={handleReport}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-[#1C1C1E] border border-[#38383A]/60 rounded-xl hover:bg-[#2C2C2E] hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Descargar PDF' : 'Download PDF'}
          </button>
          <button onClick={() => setModal('print')}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-[#1C1C1E] border border-[#38383A]/60 rounded-xl hover:bg-[#2C2C2E] hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Imprimir Resumen' : 'Print Summary'}
          </button>
        </div>
        </>}
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={() => { setModal(null); setImportBrokerHint(null) }} onImportItems={addItem}
          onImportTransaction={addTransaction} onImportSnapshot={saveSnapshot}
          onAddLot={addLot} onAddFinanceTransaction={addFinanceTransaction}
          onUpdateItem={updateItem} onDeleteItem={deleteItem} onBulkImport={bulkImport}
          existingItems={items}
          activePortfolio={activePortfolio} activeEntity={activeEntity !== '__all__' ? activeEntity : 'default'}
          lang={lang} brokerHint={importBrokerHint}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={() => setModal(null)}
          onAdd={async (item) => {
            await addItem(item)
            showToast(lang === 'es' ? `${item.symbol || item.name} agregado` : `${item.symbol || item.name} added`)
          }}
          onAddTransaction={addTransaction} onAddLot={addLot}
          existingItems={items} activePortfolio={activePortfolio}
          activeEntity={activeEntity !== '__all__' ? activeEntity : 'default'}
          lang={lang}
        />
      )}

      {modal === 'transfer' && (
        <TransferModal
          onClose={() => setModal(null)}
          onSave={async (item) => {
            await addItem(item)
          }}
          onAddTransaction={async (tx) => {
            await addTransaction(tx)
            showToast(lang === 'es' ? 'Transferencia registrada' : 'Transfer recorded')
          }}
          existingItems={items} lang={lang}
        />
      )}

      {sellItem && (
        <SellModal
          item={sellItem} onClose={() => {
            setSellItem(null)
          }}
          onSell={async (item) => {
            await addItem(item)
            showToast(lang === 'es' ? `${sellItem.symbol} vendido` : `${sellItem.symbol} sold`)
          }}
          onUpdate={updateItem}
          onAddTransaction={addTransaction} onCloseLots={closeLotsFIFO}
          existingItems={items} lang={lang}
        />
      )}

      {modal === 'ibkr' && (
        <IBKRSyncModal
          onClose={() => setModal(null)}
          onSyncComplete={async (data, mode, onProgress) => {
            await handleIBKRSync(data, mode, onProgress)
            showToast(lang === 'es' ? `IBKR: ${data.items?.length || 0} posiciones sincronizadas` : `IBKR: ${data.items?.length || 0} positions synced`)
          }}
          savedToken={settings?.ibkrToken || ''} savedQueryId={settings?.ibkrQueryId || ''}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          uid={user?.uid} lang={lang}
          lastSyncTime={settings?._ibkrLastSync || settings?._ibkrLastAutoSync || null}
          existingItems={enrichedItems} existingTransactions={transactions} existingSnapshots={snapshots}
        />
      )}

      {modal === 'blockchain' && (
        <BlockchainSyncModal
          onClose={() => setModal(null)}
          onSyncComplete={async ({ items: syncItems, transactions: syncTxs, mode }) => {
            if (mode === 'replace') {
              const bcItems = items.filter(it => it._source === 'blockchain' || (it.institution || '').toLowerCase().includes('blockchain'))
              for (const it of bcItems) await deleteItem(it.id)
            }
            for (const item of syncItems) {
              const existing = mode === 'merge' ? items.find(it =>
                (it.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() &&
                (it._source === 'blockchain' || (it.institution || '').toLowerCase().includes('blockchain'))
              ) : null
              if (existing) {
                await updateItem(existing.id, { currentPrice: item.currentPrice, quantity: item.quantity, _source: 'blockchain' })
              } else {
                await addItem(item)
              }
            }
            for (const tx of (syncTxs || [])) await addTransaction(tx)
            setModal(null)
            showToast(lang === 'es' ? `Blockchain.com: ${syncItems.length} posiciones importadas` : `Blockchain.com: ${syncItems.length} positions imported`)
          }}
          onSaveCredentials={saveSettings} uid={user?.uid} lang={lang}
        />
      )}

      {modal === 'ledger' && (
        <LedgerSyncModal
          onClose={() => setModal(null)}
          onSyncComplete={async ({ items: syncItems, mode }) => {
            for (const item of syncItems) {
              const existing = items.find(it =>
                it._walletAddress === item._walletAddress ||
                ((it.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() &&
                 (it._source === 'ledger' || (it.institution || '').toLowerCase() === 'ledger'))
              )
              if (existing) {
                await updateItem(existing.id, { quantity: item.quantity, _source: 'ledger', _walletAddress: item._walletAddress })
              } else {
                await addItem(item)
              }
            }
            setModal(null)
            showToast(lang === 'es' ? `Ledger: ${syncItems.length} balances importados` : `Ledger: ${syncItems.length} balances imported`)
          }}
          lang={lang}
        />
      )}

      {modal === 'cashflow' && (
        <CashFlowModal
          onClose={() => setModal(null)}
          onAddTransaction={async (tx) => {
            await addTransaction(tx)
            showToast(lang === 'es' ? 'Flujo de caja registrado' : 'Cash flow recorded')
          }}
          lang={lang}
          baseCurrency={baseCurrency}
        />
      )}

      {modal === 'optimize' && (
        <OptimizeModal items={items} onClose={() => setModal(null)}
          onSave={addItem} onDelete={deleteItem} lang={lang} />
      )}

      {modal === 'settings' && (
        <SettingsModal
          onClose={() => setModal(null)} settings={settings}
          onSaveSettings={saveSettings}
          onDeleteAllItems={deleteAllItems} onDeleteAllSnapshots={deleteAllSnapshots}
          onDeleteAllTransactions={deleteAllTransactions}
          onDeleteAllFinanceTransactions={deleteAllFinanceTransactions}
          entities={entities}
          onAddEntity={addEntity}
          onUpdateEntity={updateEntityData}
          onDeleteEntity={deleteEntity}
          lastSyncTime={settings?._ibkrLastSync || settings?._ibkrLastAutoSync || null}
          portfolioItems={portfolioItems}
          onSyncBroker={async (brokerId, data) => {
            const positions = data?.positions || data || []
            const posArray = Array.isArray(positions) ? positions : []
            const mapped = posArray.filter(p => p.quantity !== 0).map(p => ({
              symbol: (p.symbol || '').toUpperCase(), name: p.name || p.symbol,
              type: p.type || 'Stock', quantity: Math.abs(p.quantity || 0),
              purchasePrice: p.purchasePrice || 0, currentPrice: p.currentPrice || 0,
              institution: p.institution || brokerId || 'Unknown', currency: p.currency || 'USD',
              acquisitionDate: p.acquisitionDate,
              _source: brokerId || 'broker',
            }))
            if (mapped.length > 0) {
              await bulkImport({ items: mapped }, (done, total) => {
                showToast(`Sync ${brokerId}: ${done}/${total}`, 'info', 2000)
              })
              showToast(`${brokerId}: ${mapped.length} positions synced`, 'success')
            }
          }}
          onExportBackup={() => {
            const data = {
              exportDate: new Date().toISOString(), version: '1.0',
              items, transactions, lots, snapshots, alerts, portfolios, goals, settings, financeTransactions,
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `chispudo-backup-${new Date().toISOString().split('T')[0]}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          onOpenIBKR={() => setModal('ibkr')}
          onImport={(bh) => { setImportBrokerHint(bh || null); setModal('import') }}
          onAddAccount={() => setModal('account')}
          onOpenBlockchain={() => setModal('blockchain')}
          theme={theme} onToggleTheme={handleSetTheme} lang={lang}
          profile={profile} onSaveProfile={saveProfile}
        />
      )}

      {modal === 'print' && (
        <PrintSummary items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
          snapshots={snapshots} transactions={transactions} lang={lang} onClose={() => setModal(null)} />
      )}

      {editItem && (
        <EditAccountModal key={editItem.id} item={editItem} onClose={() => setEditItem(null)}
          onSave={async (updated) => {
            const { id, ...fields } = updated
            await updateItem(editItem.id, fields)
            showToast(lang === 'es' ? 'Cambios guardados' : 'Changes saved')
          }}
          onDelete={async (id) => {
            await deleteItem(id)
            showToast(lang === 'es' ? 'Activo eliminado' : 'Asset deleted')
          }}
          existingItems={items} lang={lang}
          allItems={portfolioItems}
          onNavigate={showReview ? null : (dir) => {
            if (dir === 'next') {
              const sorted = [...portfolioItems].sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a)))
              const currentId = editItem.id
              const idx = sorted.findIndex(it => it.id === currentId)
              if (idx >= 0 && idx < sorted.length - 1) setEditItem(sorted[idx + 1])
              else setEditItem(null)
            }
          }} />
      )}

      {detailItem && (
        <AssetDetailModal item={detailItem} onClose={() => setDetailItem(null)} lang={lang} uid={user?.uid} />
      )}

      {showReview && !editItem && (
        <AccountReviewModal
          items={portfolioItems}
          transactions={transactions}
          onClose={() => setShowReview(false)}
          onEditItem={(item) => { setEditItem(item) }}
          lang={lang}
        />
      )}

      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)}
        items={portfolioItems} lang={lang} onAction={handleCmdAction} />

      <MobileNav
        onAdd={() => setModal('account')} onImport={(bh) => { setImportBrokerHint(bh || null); setModal('import') }}
        onExport={handleExport} onShare={handleShare}
        onSettings={() => setModal('settings')} onSearch={() => setCmdPaletteOpen(true)} lang={lang}
      />

      {showOnboarding && (
        <OnboardingTour lang={lang}
          onAction={(action) => {
            if (action === 'add') setModal('account')
            else if (action === 'settings') setModal('settings')
          }}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {toast && (
        <div className={`fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium animate-fade-in ${
          toast.type === 'error' ? 'bg-red-900/90 border border-red-700/50 text-red-100' :
          toast.type === 'info' ? 'bg-blue-900/90 border border-blue-700/50 text-blue-100' :
          'bg-emerald-900/90 border border-emerald-700/50 text-emerald-100'
        }`}>
          <span>{toast.type === 'error' ? '✕' : toast.type === 'info' ? 'ℹ' : '✓'}</span>
          {toast.msg}
        </div>
      )}

      <ChatWidget user={user} items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
        returnYTD={returnYTD} annualDividends={annualDividends} riskMetrics={riskMetrics}
        baseCurrency={baseCurrency} lang={lang} onUpdateItem={updateItem} />
    </div>
  )
}
