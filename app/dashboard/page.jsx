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
import { authFetch, safeJson } from '@/lib/authFetch'

function AnalysisTabs({ lang, portfolioItems, netWorth, totalAssets, snapshots, lots, transactions, convert, baseCurrency, benchmarkData, benchmarkName, beginnerMode }) {
  const [tab, setTab] = useState('health')
  const t = (es, en) => lang === 'es' ? es : en
  const hasLots = lots && lots.length > 0
  // Beginner mode hides the most jargon-heavy tabs (Risk metrics, Attribution)
  const tabs = [
    { key: 'health', label: t('Salud', 'Health') },
    ...(beginnerMode ? [] : [{ key: 'risk', label: t('Riesgo', 'Risk') }]),
    { key: 'concentration', label: t('Concentración', 'Concentration') },
    ...(hasLots ? [{ key: 'gains', label: t('Ganancias', 'Gains') }] : []),
    ...(beginnerMode ? [] : [{ key: 'attribution', label: t('Atribución', 'Attribution') }]),
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap border"
            style={tab === tb.key ? { backgroundColor: '#2563eb', color: '#fff', borderColor: '#2563eb' } : { color: '#94a3b8', borderColor: '#38383A' }}>
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
      {tab === 'risk' && !beginnerMode && (
        <CardBoundary id="AN-05"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></CardBoundary>
      )}
      {tab === 'concentration' && (
        <CardBoundary id="AN-02b"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {tab === 'gains' && hasLots && (
        <CardBoundary id="AN-03"><GainsReport lots={lots} items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {tab === 'attribution' && !beginnerMode && (
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
  const [beginnerMode, setBeginnerMode] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePortfolio, setActivePortfolio] = useState('__all__')
  const [activeEntity, setActiveEntity] = useState('__all__')
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [staleCode, setStaleCode] = useState(false)
  const { entities, addEntity, updateEntity: updateEntityData, deleteEntity } = useEntities()

  // Theme + lang init
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
      const savedTheme = localStorage.getItem('chispudo-theme')
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') setTheme(savedTheme)
      setBeginnerMode(localStorage.getItem('chispudo-beginner') === '1')
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

  const handleToggleBeginner = useCallback((val) => {
    const next = typeof val === 'boolean' ? val : !beginnerMode
    setBeginnerMode(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-beginner', next ? '1' : '0')
  }, [beginnerMode])

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

  useEffect(() => {
    const clientBuild = process.env.NEXT_BUILD_ID || '__dev__'
    if (clientBuild === '__dev__') return
    fetch('/api/version').then(r => r.json()).then(data => {
      if (data.buildId && data.buildId !== '__dev__' && data.buildId !== clientBuild) {
        setStaleCode(true)
      }
    }).catch(() => {})
  }, [])

  // Data layer
  const {
    items, snapshots, transactions, goals, settings, profile, alerts, lots, portfolios, financeTransactions,
    dataLoading,
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    addAlert, deleteAlert,
    addLot, closeLotsFIFO, transferFunds, executeSaleAtomic,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    bulkImport,
    saveGoals, saveSettings, saveProfile,
    enrichedItems, portfolioItems: rawPortfolioItems, entityTransactions, entityFinanceTransactions,
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
    ibkrConnected, ibkrAutoSyncing,
    ibkrSyncStatus, ibkrSyncErrorCode, ibkrLastSync,
  } = useDashboardData({ user, lang, activePortfolio, activeEntity })

  const handleOpenImport = useCallback((bh) => {
    setImportBrokerHint(bh || null)
    setModal('import')
  }, [])
  const handleOpenAccount = useCallback(() => setModal('account'), [])
  const handleOpenSettings = useCallback(() => setModal('settings'), [])
  const handleOpenTransfer = useCallback(() => setModal('transfer'), [])
  const handleOpenCashflow = useCallback(() => setModal('cashflow'), [])
  const handleOpenIBKR = useCallback(() => setModal('ibkr'), [])
  const handleOpenBlockchain = useCallback(() => setModal('blockchain'), [])
  const handleOpenPrint = useCallback(() => setModal('print'), [])
  const handleOpenReview = useCallback(() => setShowReview(true), [])
  const handleOpenCmdPalette = useCallback(() => setCmdPaletteOpen(true), [])
  const handleCloseCmdPalette = useCallback(() => setCmdPaletteOpen(false), [])
  const handleCloseModal = useCallback(() => { setModal(null); setImportBrokerHint(null) }, [])
  const handleCloseEdit = useCallback(() => setEditItem(null), [])
  const handleCloseSell = useCallback(() => setSellItem(null), [])
  const handleCloseDetail = useCallback(() => setDetailItem(null), [])
  const handleCloseReview = useCallback(() => setShowReview(false), [])
  const handleDismissToast = useCallback(() => setToast(null), [])

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
      }).then(r => r.ok ? safeJson(r) : r.json().catch(() => ({})).then(d => { throw new Error(d.error || 'OAuth failed') }))
        .then(() => showToast(lang === 'es' ? 'Broker vinculado via OAuth' : 'Broker linked via OAuth'))
        .catch(e => showToast(e.message, 'error', 5000))
    }
  }, [])

  const enrichCacheRef = useRef({})
  const [enrichData, setEnrichData] = useState({})
  useEffect(() => {
    if (!rawPortfolioItems || rawPortfolioItems.length === 0) return
    const needEnrich = rawPortfolioItems
      .filter(it => it.symbol && !it.sector && !it.assetCountry && !enrichCacheRef.current[it.symbol])
      .map(it => it.symbol)
    const unique = [...new Set(needEnrich)].slice(0, 30)
    if (unique.length === 0) return

    unique.forEach(s => { enrichCacheRef.current[s] = 'pending' })
    authFetch('/api/prices/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: unique }),
    }).then(r => r.ok ? safeJson(r) : null).then(data => {
      if (!data?.results) return
      const newData = {}
      for (const [sym, info] of Object.entries(data.results)) {
        enrichCacheRef.current[sym] = info
        if (info && typeof info === 'object') newData[sym] = info
      }
      if (Object.keys(newData).length > 0) {
        setEnrichData(prev => ({ ...prev, ...newData }))
      }
    }).catch(() => {})
  }, [rawPortfolioItems])

  const portfolioItems = useMemo(() => {
    if (Object.keys(enrichData).length === 0) return rawPortfolioItems
    return rawPortfolioItems.map(item => {
      const info = enrichData[item.symbol]
      if (!info) return item
      const patches = {}
      if (info.sector && !item.sector) patches.sector = info.sector
      if (info.country && !item.assetCountry) patches.assetCountry = info.country
      if (info.industry && !item.industry) patches.industry = info.industry
      return Object.keys(patches).length > 0 ? { ...item, ...patches } : item
    })
  }, [rawPortfolioItems, enrichData])

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
      case 'add': handleOpenAccount(); break
      case 'import': handleOpenImport(); break
      case 'export': handleExport(); break
      case 'report': handleReport(); break
      case 'print': handleOpenPrint(); break
      case 'share': handleShare(); break
      case 'transfer': handleOpenTransfer(); break
      case 'cashflow': case 'deposit': case 'withdrawal': handleOpenCashflow(); break
      case 'settings': handleOpenSettings(); break
      case 'refresh': handleRefresh(); break
      case 'theme': handleSetTheme(theme === 'dark' ? 'light' : 'dark'); break
      case 'lang': handleSetLang('toggle'); break
      case 'ibkr': handleOpenIBKR(); break
      case 'blockchain': handleOpenBlockchain(); break
      case 'ledger': setModal('ledger'); break
      case 'viewItem': setDetailItem(data); break
    }
  }, [handleExport, handleReport, handleRefresh, handleSetTheme, handleSetLang, theme, handleOpenAccount, handleOpenImport, handleOpenPrint, handleOpenTransfer, handleOpenCashflow, handleOpenSettings, handleOpenIBKR, handleOpenBlockchain])

  useEffect(() => {
    if (!dataLoading && enrichedItems.length === 0 && !showOnboarding && typeof window !== 'undefined' && !localStorage.getItem('chispudo-onboarding-done')) {
      setShowOnboarding(true)
    }
  }, [dataLoading, enrichedItems.length])

  const topBanner = useMemo(() => {
    if (staleCode) return 'stale'
    if (ibkrSyncErrorCode === 'TOKEN_EXPIRED') return 'ibkr-expired'
    if (ibkrSyncErrorCode === 'INVALID_QUERY') return 'ibkr-query'
    if (pricesError || ratesError) return 'prices'
    if (contributionWarning) return 'contribution'
    return null
  }, [staleCode, ibkrSyncErrorCode, pricesError, ratesError, contributionWarning])

  // Loading state
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#09090b]">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="text-2xl" style={{ color: '#60a5fa' }}>⚡</span>
            <span className="text-lg font-bold" style={{ color: '#60a5fa' }}>Chispudo</span>
          </div>
          <div className="block">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#3b82f6', borderTopColor: 'transparent' }} />
          </div>
          <p className="mt-4 text-slate-500 text-sm">{lang === 'es' ? 'Cargando tu portfolio...' : 'Loading your portfolio...'}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#09090b]">
      <a href="#main-content" className="skip-link">{lang === 'es' ? 'Ir al contenido' : 'Skip to content'}</a>
      <Header
        user={user} lang={lang}
        setLang={() => handleSetLang('toggle')}
        onImport={handleOpenImport}
        onSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        onRefresh={handleRefresh}
        pricesLoading={pricesLoading || ratesLoading}
        onAddAccount={handleOpenAccount}
        onCommandPalette={handleOpenCmdPalette}
        ibkrConnected={ibkrConnected}
        ibkrAutoSyncing={ibkrAutoSyncing}
        ibkrSyncStatus={ibkrSyncStatus}
        onIBKR={handleOpenIBKR}
      />

      {topBanner && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
          {topBanner === 'stale' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#60a5fa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#60a5fa' }}>
                  {lang === 'es' ? 'Hay una nueva versión disponible' : 'A new version is available'}
                </p>
              </div>
              <button onClick={() => { if (typeof caches !== 'undefined') caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))); window.location.reload() }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#2563eb', color: '#fff' }}>
                {lang === 'es' ? 'Actualizar' : 'Update'}
              </button>
            </div>
          )}
          {topBanner === 'ibkr-expired' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {lang === 'es' ? 'Tu token de IBKR expiró — genera uno nuevo para mantener tu portafolio actualizado' : 'Your IBKR token has expired — generate a new one to keep your portfolio updated'}
                </p>
              </div>
              <button onClick={() => setModal('ibkr')}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#d97706', color: '#fff' }}>
                {lang === 'es' ? 'Actualizar' : 'Update'}
              </button>
            </div>
          )}
          {topBanner === 'ibkr-query' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {lang === 'es' ? 'Query ID de IBKR inválido — verifica tu Flex Query en IBKR' : 'Invalid IBKR Query ID — verify your Flex Query in IBKR'}
                </p>
              </div>
              <button onClick={() => setModal('ibkr')}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#d97706', color: '#fff' }}>
                {lang === 'es' ? 'Configurar' : 'Configure'}
              </button>
            </div>
          )}
          {topBanner === 'prices' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {pricesError && ratesError
                    ? (lang === 'es' ? 'Precios y tasas desactualizados — error de conexión' : 'Prices and rates outdated — connection error')
                    : pricesError
                      ? (lang === 'es' ? 'Precios desactualizados — no se pudo conectar' : 'Prices outdated — could not connect')
                      : (lang === 'es' ? 'Tasas de cambio desactualizadas' : 'Exchange rates outdated')}
                </p>
              </div>
              <button onClick={handleRefresh}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#d97706', color: '#fff' }}>
                {lang === 'es' ? 'Reintentar' : 'Retry'}
              </button>
            </div>
          )}
          {topBanner === 'contribution' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {lang === 'es'
                    ? 'Tus retornos pueden no ser precisos — registra tus depósitos y retiros'
                    : 'Your returns may not be accurate — log your deposits and withdrawals'}
                </p>
              </div>
              <button onClick={() => setModal('cashflow')}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#2563eb', color: '#fff' }}>
                {lang === 'es' ? 'Registrar' : 'Log now'}
              </button>
            </div>
          )}
        </div>
      )}

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          {dataAge === 0 ? (
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#60a5fa' }} />
          ) : dataAge != null && dataAge >= 7 ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f87171' }} />
          ) : dataAge != null && dataAge >= 1 ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-500" />
          )}
          <span className="text-xs" style={{ color: dataAge >= 7 ? '#f87171' : dataAge >= 1 ? '#fbbf24' : '#7c8a9c' }}>
            {dataAge === 0
              ? (lang === 'es' ? 'Datos al día' : 'Data up to date')
              : dataAge != null
                ? (lang === 'es' ? `Actualizado hace ${dataAge}d` : `Updated ${dataAge}d ago`)
                : (lang === 'es' ? 'Sin datos aún' : 'No data yet')}
          </span>
          {dataAge != null && dataAge >= 7 && (
            <button onClick={handleRefresh} className="text-micro underline transition-colors" style={{ color: '#60a5fa' }}>
              {lang === 'es' ? 'Actualizar' : 'Refresh'}
            </button>
          )}
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


        {portfolioItems.length === 0 && !dataLoading && (
          <EmptyState
            onAdd={handleOpenAccount}
            onImport={handleOpenImport}
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
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex flex-col gap-4">
            <CardBoundary id="OR-01"><PortfolioGrowthChart items={portfolioItems} lots={lots} snapshots={snapshots} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} benchmarkSymbol={benchmarkSymbol} benchmarkName={benchmarkName} onSaveSnapshot={saveSnapshot} /></CardBoundary>
          </div>
        </div>
        </ErrorBoundary>

        <CardBoundary id="INS-01"><InsightCards items={portfolioItems} profile={profile} netWorth={netWorth} estimatedAnnualIncome={estimatedAnnualIncome} lang={lang} onOpenSettings={handleOpenSettings} /></CardBoundary>

        {/* ═══ COMPOSICIÓN: Allocation + Rendimiento por institución ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          <CardBoundary id="OR-02"><AssetAllocation items={portfolioItems} lang={lang} /></CardBoundary>
          <CardBoundary id="INST-01"><InstitutionPerformance items={portfolioItems} lots={lots} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
        </div>

        <ActionButtons
          onImport={handleOpenImport} onAddAccount={handleOpenAccount}
          onTransfer={handleOpenTransfer} onCashFlow={handleOpenCashflow} onExport={handleExport}
          onShare={handleShare} onIntegrations={handleOpenSettings}
          onReview={handleOpenReview} itemCount={enrichedItems.length} lang={lang}
          ibkrSyncStatus={ibkrSyncStatus} ibkrLastSync={ibkrLastSync}
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
        <SectionCollapse title={lang === 'es' ? 'Análisis' : 'Analysis'} id="analysis" defaultOpen={!beginnerMode && !!(lots && lots.length > 0)}>
          <ErrorBoundary lang={lang}>
            <AnalysisTabs lang={lang} portfolioItems={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lots={lots} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkData={benchmarkData} benchmarkName={benchmarkName} beginnerMode={beginnerMode} />
          </ErrorBoundary>
        </SectionCollapse>

        <NotificationCenter items={portfolioItems} transactions={transactions} lang={lang} />
        <InstallPrompt lang={lang} />

        <div className="flex items-center justify-center gap-3 pt-4 pb-8">
          <button onClick={handleReport}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-[#141416] border border-[#27272a]/60 rounded-xl hover:bg-[#2C2C2E] hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Descargar PDF' : 'Download PDF'}
          </button>
          <button onClick={handleOpenPrint}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-[#141416] border border-[#27272a]/60 rounded-xl hover:bg-[#2C2C2E] hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Imprimir Resumen' : 'Print Summary'}
          </button>
        </div>
        </>}
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={handleCloseModal} onImportItems={addItem}
          onImportTransaction={addTransaction} onImportSnapshot={saveSnapshot}
          onAddLot={addLot} onAddFinanceTransaction={addFinanceTransaction}
          onUpdateItem={updateItem} onDeleteItem={deleteItem} onBulkImport={bulkImport}
          existingItems={items} existingLots={lots}
          activePortfolio={activePortfolio} activeEntity={activeEntity !== '__all__' ? activeEntity : 'default'}
          lang={lang} brokerHint={importBrokerHint}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={handleCloseModal}
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
          onClose={handleCloseModal}
          onTransfer={transferFunds}
          onAddTransaction={() => showToast(lang === 'es' ? 'Transferencia registrada' : 'Transfer recorded')}
          existingItems={items} lang={lang}
        />
      )}

      {sellItem && (
        <SellModal
          item={sellItem} onClose={handleCloseSell}
          onExecuteSale={executeSaleAtomic}
          onSold={() => showToast(lang === 'es' ? `${sellItem.symbol} vendido` : `${sellItem.symbol} sold`)}
          existingItems={items} lang={lang}
        />
      )}

      {modal === 'ibkr' && (
        <IBKRSyncModal
          onClose={handleCloseModal}
          onSyncComplete={async (data, mode, onProgress) => {
            await handleIBKRSync(data, mode, onProgress)
            showToast(lang === 'es' ? `IBKR: ${data.items?.length || 0} posiciones sincronizadas` : `IBKR: ${data.items?.length || 0} positions synced`)
          }}
          savedToken={settings?.ibkrToken || ''} savedQueryId={settings?.ibkrQueryId || ''}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          onDisconnect={() => {
            saveSettings({ ibkrToken: null, ibkrQueryId: null, _ibkrLastSync: null, _ibkrLastAutoSync: null, _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null })
            showToast(lang === 'es' ? 'IBKR desconectado' : 'IBKR disconnected')
          }}
          uid={user?.uid} lang={lang}
          lastSyncTime={ibkrLastSync}
          existingItems={enrichedItems} existingTransactions={transactions} existingSnapshots={snapshots}
        />
      )}

      {modal === 'blockchain' && (
        <BlockchainSyncModal
          onClose={handleCloseModal}
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
          onClose={handleCloseModal}
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
          onClose={handleCloseModal}
          onAddTransaction={async (tx) => {
            await addTransaction(tx)
            showToast(lang === 'es' ? 'Flujo de caja registrado' : 'Cash flow recorded')
          }}
          lang={lang}
          baseCurrency={baseCurrency}
        />
      )}

      {modal === 'optimize' && (
        <OptimizeModal items={items} onClose={handleCloseModal}
          onSave={addItem} onDelete={deleteItem} lang={lang} />
      )}

      {modal === 'settings' && (
        <SettingsModal
          onClose={handleCloseModal} settings={settings}
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
          onOpenIBKR={handleOpenIBKR}
          onImport={handleOpenImport}
          onAddAccount={handleOpenAccount}
          onOpenBlockchain={handleOpenBlockchain}
          theme={theme} onToggleTheme={handleSetTheme} lang={lang}
          beginnerMode={beginnerMode} onToggleBeginner={handleToggleBeginner}
          profile={profile} onSaveProfile={saveProfile}
        />
      )}

      {modal === 'print' && (
        <PrintSummary items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
          snapshots={snapshots} transactions={transactions} lang={lang} onClose={handleCloseModal} />
      )}

      {editItem && (
        <EditAccountModal key={editItem.id} item={editItem} onClose={handleCloseEdit}
          onSave={async (updated) => {
            const { id, ...fields } = updated
            await updateItem(editItem.id, fields)
            showToast(lang === 'es' ? 'Cambios guardados' : 'Changes saved')
          }}
          onDelete={async (id) => {
            await deleteItem(id)
            showToast(lang === 'es' ? 'Activo eliminado' : 'Asset deleted')
          }}
          onAddTransaction={addTransaction}
          onAddLot={addLot}
          onCloseLotsFIFO={closeLotsFIFO}
          transactions={transactions}
          baseCurrency={baseCurrency}
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
        <AssetDetailModal item={detailItem} onClose={handleCloseDetail} lang={lang} uid={user?.uid} />
      )}

      {showReview && !editItem && (
        <AccountReviewModal
          items={portfolioItems}
          transactions={transactions}
          onClose={handleCloseReview}
          onEditItem={setEditItem}
          lang={lang}
        />
      )}

      <CommandPalette open={cmdPaletteOpen} onClose={handleCloseCmdPalette}
        items={portfolioItems} lang={lang} onAction={handleCmdAction} />

      <MobileNav
        onAdd={handleOpenAccount} onImport={handleOpenImport}
        onExport={handleExport} onShare={handleShare}
        onSettings={handleOpenSettings} onSearch={handleOpenCmdPalette} lang={lang}
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
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium animate-fade-in border"
          role="status"
          aria-live="polite"
          style={toast.type === 'error'
            ? { backgroundColor: 'rgba(127,29,29,0.95)', borderColor: 'rgba(185,28,28,0.5)', color: '#fecaca' }
            : toast.type === 'info'
            ? { backgroundColor: 'rgba(30,58,138,0.95)', borderColor: 'rgba(29,78,216,0.5)', color: '#dbeafe' }
            : { backgroundColor: 'rgba(6,78,59,0.95)', borderColor: 'rgba(5,150,105,0.5)', color: '#d1fae5' }
          }>
          <span>{toast.type === 'error' ? '✕' : toast.type === 'info' ? 'ℹ' : '✓'}</span>
          {toast.msg}
          <button onClick={handleDismissToast} className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}

      <ChatWidget user={user} items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
        returnYTD={returnYTD} annualDividends={annualDividends} riskMetrics={riskMetrics}
        baseCurrency={baseCurrency} lang={lang} onUpdateItem={updateItem} />
    </div>
  )
}
