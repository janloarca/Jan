'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { getItemValue, formatCurrency, getTypeCategory, businessDaysSince } from '@/components/dashboard/utils'
import Header from '@/components/dashboard/Header'
import AdBanner from '@/components/AdBanner'
import MonthEndCheckin, { hasLiveSync } from '@/components/dashboard/MonthEndCheckin'
import DashboardLoading from './loading'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import CalibrateReturnModal from '@/components/dashboard/CalibrateReturnModal'
import ActionButtons from '@/components/dashboard/ActionButtons'
import SectionCollapse from '@/components/dashboard/SectionCollapse'
import MobileNav from '@/components/dashboard/MobileNav'
import ErrorBoundary from '@/components/ErrorBoundary'
import CardBoundary from '@/components/dashboard/CardBoundary'
import { SkeletonCard, SkeletonChart } from '@/components/dashboard/Skeleton'

function ModalSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status" aria-live="polite" aria-label="Loading">
      <div className="bg-theme-card border border-glass-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
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
const ConnectionsModal = dynamic(() => import('@/components/ConnectionsModal'), { loading: () => <ModalSkeleton /> })
const EditAccountModal = dynamic(() => import('@/components/EditAccountModal'), { loading: () => <ModalSkeleton /> })
const OptimizeModal = dynamic(() => import('@/components/OptimizeModal'))
const AssetDetailModal = dynamic(() => import('@/components/dashboard/AssetDetailModal'), { loading: () => <ModalSkeleton /> })
const AccountReviewModal = dynamic(() => import('@/components/dashboard/AccountReviewModal'), { loading: () => <ModalSkeleton /> })
const EnrichModal = dynamic(() => import('@/components/dashboard/EnrichModal'), { loading: () => <ModalSkeleton /> })
const QuarterlyHistoryModal = dynamic(() => import('@/components/dashboard/QuarterlyHistoryModal'), { loading: () => <ModalSkeleton /> })
const BrokerCompletionModal = dynamic(() => import('@/components/dashboard/BrokerCompletionModal'), { loading: () => <ModalSkeleton /> })
const InferredFlowsModal = dynamic(() => import('@/components/dashboard/InferredFlowsModal'), { loading: () => <ModalSkeleton /> })
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
const InstitutionPerformance = dynamic(() => import('@/components/dashboard/InstitutionPerformance'), { loading: () => <SkeletonCard /> })
const RebalanceSuggestions = dynamic(() => import('@/components/dashboard/RebalanceSuggestions'), { loading: () => <SkeletonCard /> })

import RecentTransactions from '@/components/dashboard/RecentTransactions'
import DataQualityCard from '@/components/dashboard/DataQualityCard'
import ChispuSuggestions from '@/components/dashboard/ChispuSuggestions'
import CostsCard from '@/components/dashboard/CostsCard'
import { reconcileBrokerPositions } from '@/lib/brokerReconcile'
import { analyzeDataCompleteness } from '@/lib/dataCompleteness'
import { detectPhantomFlows } from '@/lib/phantomFlows'
import { detectFakeAggregateTrades, detectImportStampedAcquisitions, detectFakeCashReportItems, detectDuplicateCashDividends, detectCrossSourceDuplicateFlows } from '@/lib/badDataCleanup'
import { IBKR_DISCONNECTED_FIELDS } from '@/lib/brokerRegistry'
import { DEMO_ITEMS, DEMO_LOTS, DEMO_TRANSACTIONS, isDemoItem } from '@/lib/demoData'
import AssetAllocation from '@/components/dashboard/AssetAllocation'
import PriceAlerts from '@/components/dashboard/PriceAlerts'
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
      <div className="inline-flex items-center gap-0.5 p-1 rounded-[10px] max-w-full overflow-x-auto" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap"
            style={tab === tb.key
              ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
              : { color: 'var(--text-muted)' }}>
            {tb.label}
          </button>
        ))}
      </div>
      {tab === 'health' && (
        // Concentration lives in its own dedicated tab; don't duplicate it here.
        <CardBoundary id="AN-01"><FinancialHealth items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} /></CardBoundary>
      )}
      {tab === 'risk' && !beginnerMode && (
        <CardBoundary id="AN-05"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></CardBoundary>
      )}
      {tab === 'concentration' && (
        <CardBoundary id="AN-02b"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {tab === 'gains' && hasLots && (
        <CardBoundary id="AN-03"><GainsReport lots={lots} items={portfolioItems} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
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
  const [cashflowPrefill, setCashflowPrefill] = useState(null)
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
  // Review wizard targeting: an item id to open on, whether to walk only the
  // accounts with gaps ("let Chispu recommend"), or narrow the whole wizard to
  // one institution ("fix everything IDC holds").
  const [reviewTarget, setReviewTarget] = useState({ itemId: null, guided: false, institution: null })
  const [showEnrich, setShowEnrich] = useState(false)
  const [brokerCompletionId, setBrokerCompletionId] = useState(null)
  // Snapshot of ibkrConnected the moment the IBKR modal opens, so closing it
  // can tell "just connected for the first time" apart from "just re-synced" —
  // the checklist should greet a NEW connection, not interrupt a routine sync.
  const ibkrWasConnectedRef = useRef(false)
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
      document.documentElement.classList.add('theme-transitioning')
      const resolved = newTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : newTheme
      document.documentElement.setAttribute('data-theme', resolved)
      localStorage.setItem('chispudo-theme', newTheme)
      const tc = resolved === 'light' ? '#F0F2F8' : '#0A0A12'
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', tc))
      setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 400)
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
    items, snapshots, chartSnapshots, augmentedSnapshots, accountCalibrations, transactions, goals, settings, profile, effectiveProfile, alerts, lots, portfolios, financeTransactions,
    dataLoading,
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    addAlert, deleteAlert,
    addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    bulkImport,
    saveGoals, saveSettings, saveProfile,
    enrichedItems, portfolioItems: rawPortfolioItems, entityTransactions, entityFinanceTransactions,
    marketPrices,
    pricesLoading, pricesError, pricesUpdate,
    rates, convert,
    ratesLoading, ratesError,
    handleRefresh,
    baseCurrency, netWorth, totalAssets, dailyChange, yearlyChange,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdCalibrated, ytdBreakdown,
    annualDividends, estimatedAnnualIncome,
    netContributions, contributionsSummary, cashTotal, riskMetrics, insights, dataAge, contributionWarning,
    brokerCompletionState, ibkrDataComplete, inferredFlowCandidates, acceptInferredFlow, dismissInferredFlow,
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName,
    handleIBKRSync, triggerIBKRSync,
    ibkrConnected, ibkrAutoSyncing,
    ibkrSyncStatus, ibkrSyncErrorCode, ibkrLastSync, ibkrSyncSummary,
  } = useDashboardData({ user, lang, activePortfolio, activeEntity })

  // Only matters for the ONE transition into 'ibkr': captures whether it was
  // already connected, so closing the modal can tell "just connected for the
  // first time" apart from "just ran a routine re-sync" — the completion
  // checklist should greet a new connection, not interrupt a routine one.
  useEffect(() => {
    if (modal === 'ibkr') ibkrWasConnectedRef.current = ibkrConnected
  }, [modal]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenImport = useCallback((bh) => {
    setImportBrokerHint(bh || null)
    setModal('import')
  }, [])
  const handleOpenAccount = useCallback(() => setModal('account'), [])
  const handleOpenSettings = useCallback(() => setModal('settings'), [])
  const handleOpenConnections = useCallback(() => setModal('connections'), [])
  const handleOpenTransfer = useCallback(() => setModal('transfer'), [])
  const handleOpenCashflow = useCallback(() => { setCashflowPrefill(null); setModal('cashflow') }, [])
  const handleOpenCashflowPrefilled = useCallback((prefill) => { setCashflowPrefill(prefill || null); setModal('cashflow') }, [])
  const handleOpenIBKR = useCallback(() => setModal('ibkr'), [])

  // Header IBKR pill: when connected, sync in the BACKGROUND (no blocking modal) and
  // let the user keep working — the pill spins (ibkrAutoSyncing) and a toast reports the
  // outcome. Not connected → open the modal to enter credentials the first time.
  const handleIBKRPillClick = useCallback(async () => {
    if (!ibkrConnected) { setModal('ibkr'); return }
    if (ibkrAutoSyncing) return
    showToast(lang === 'es' ? 'Sincronizando IBKR… puedes seguir usando la app' : 'Syncing IBKR… you can keep using the app', 'info', 2500)
    const res = await triggerIBKRSync()
    if (res?.ok) {
      // Tell the user how much HISTORY arrived, not just position count: a short
      // Flex period silently truncates equity/deposits/trades, and this toast is
      // the only feedback on the background path.
      const shortHistory = res.equityDays > 1 && res.equityOldest
        && new Date(res.equityOldest).getTime() > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000
      if (res.equityDays <= 1) {
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones, pero SIN historial de valor. Agrega "Equity Summary" a tu Flex Query.`
          : `IBKR: ${res.count} positions but NO value history. Add "Equity Summary" to your Flex Query.`, 'error', 6000)
      } else if (shortHistory) {
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · solo ${res.equityDays} días de historial (desde ${res.equityOldest}). El período del Flex Query sigue corto: ponlo en "Year to Date".`
          : `IBKR: ${res.count} positions · only ${res.equityDays} days of history (since ${res.equityOldest}). Your Flex Query period is still short: set it to "Year to Date".`, 'error', 8000)
      } else if ((res.trades || 0) + (res.flows || 0) === 0) {
        // History arrived but zero trades/deposits: the query is missing the
        // Trades / Cash Transactions sections, so the rewound value curve and
        // deposit-aware returns cannot be built.
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · ${res.equityDays} días de historial, pero 0 trades y 0 depósitos. Agrega "Trades" y "Cash Transactions" a tu Flex Query.`
          : `IBKR: ${res.count} positions · ${res.equityDays} days of history but 0 trades and 0 deposits. Add "Trades" and "Cash Transactions" to your Flex Query.`, 'error', 8000)
      } else {
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · ${res.equityDays} días de historial · ${res.trades || 0} trades · ${res.flows || 0} depósitos/retiros · ${res.dividends || 0} dividendos`
          : `IBKR: ${res.count} positions · ${res.equityDays} days of history · ${res.trades || 0} trades · ${res.flows || 0} deposits/withdrawals · ${res.dividends || 0} dividends`, 'success', 7000)
      }
    } else if (res?.error === 'BUSY') {
      // a sync is already running; the spinning pill already communicates this
    } else if (res?.error !== 'NOT_CONNECTED') {
      showToast(lang === 'es' ? 'IBKR no se pudo actualizar. Revisa la conexión en Ajustes.' : 'IBKR sync failed. Check the connection in Settings.', 'error', 4000)
    }
  }, [ibkrConnected, ibkrAutoSyncing, triggerIBKRSync, lang])
  const handleOpenBlockchain = useCallback(() => setModal('blockchain'), [])
  const handleOpenPrint = useCallback(() => setModal('print'), [])
  const handleOpenReview = useCallback(() => { setReviewTarget({ itemId: null, guided: false, institution: null }); setShowReview(true) }, [])
  const handleOpenEnrich = useCallback(() => setShowEnrich(true), [])
  const handleOpenQuarterly = useCallback(() => setModal('quarterly'), [])
  const handleCloseEnrich = useCallback(() => setShowEnrich(false), [])
  const handleEnrichGuided = useCallback(() => { setReviewTarget({ itemId: null, guided: true, institution: null }); setShowReview(true) }, [])
  const handleEnrichAccount = useCallback((it) => { setReviewTarget({ itemId: it?.id || null, guided: false, institution: null }); setShowReview(true) }, [])
  const handleEnrichInstitution = useCallback((name) => { setReviewTarget({ itemId: null, guided: false, institution: name }); setShowReview(true) }, [])
  const handleOpenCmdPalette = useCallback(() => setCmdPaletteOpen(true), [])
  const handleCloseCmdPalette = useCallback(() => setCmdPaletteOpen(false), [])
  const handleCloseModal = useCallback(() => { setModal(null); setImportBrokerHint(null) }, [])
  const handleCloseEdit = useCallback(() => setEditItem(null), [])
  const handleCloseSell = useCallback(() => setSellItem(null), [])
  const handleCloseDetail = useCallback(() => setDetailItem(null), [])
  const handleCloseReview = useCallback(() => setShowReview(false), [])
  const handleDismissToast = useCallback(() => setToast(null), [])

  // Demo mode (onboarding sample data): seed via the batch import path and
  // clean up selectively by the _source:'demo' flag.
  const handleSeedDemo = useCallback(async () => {
    await bulkImport({ items: DEMO_ITEMS, lots: DEMO_LOTS, transactions: DEMO_TRANSACTIONS })
  }, [bulkImport])

  const showToast = useCallback((msg, type = 'success', duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), duration)
  }, [])

  // Shared by the sync modal's "Desconectar IBKR" button and the red top
  // banner's own dismiss action — a locked/expired token only ever offered
  // "reconnect" as a way out, with no visible way to say "I'm fine on CSV
  // imports, stop nagging me." Both call sites must clear the SAME fields
  // (client mirror + every auto-sync status field), or the banner keeps
  // showing even after the user disconnects.
  const handleIbkrDisconnect = useCallback(async () => {
    saveSettings(IBKR_DISCONNECTED_FIELDS)
    // Also wipe the SERVER vault — clearing only the client doc left the
    // encrypted token alive, so the connection resurfaced and auto-synced.
    try {
      await authFetch('/api/brokers/ibkr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials', token: '', queryId: '' }),
      })
    } catch (e) { console.error('[ibkr] vault clear on disconnect failed:', e?.message) }
    showToast(lang === 'es' ? 'IBKR desconectado' : 'IBKR disconnected')
  }, [saveSettings, showToast, lang])

  // Self-heal rows THIS APP invented. Several shipped IBKR file-parser bugs
  // (FASE BU/BV/BY, fixed 2026-07-28) wrote fake data into real imports: a
  // "Total" row read as a deposit, a lifetime trade-aggregate misread as
  // individual buys/sells, Cash Report line items misread as holdings, and a
  // dividend duplicated under symbol CASH by two parsers claiming the same
  // section. A fifth class isn't a parser bug at all: the SAME real deposit
  // imported once via file and once via the live API sync lands as two docs,
  // because the API path appends a txn-id suffix to the doc id the file path
  // never had — doubling that flow's effect on every return calculation.
  // None of these were the user's entry, so asking them to confirm removal
  // would be handing them our mistake to clean up. We know these are wrong
  // (lib/phantomFlows, lib/badDataCleanup — each detector proves a real row
  // cannot match its predicate), so we fix them and say so.
  // Order matters (lib/badDataCleanup): fake trades first, since clearing the
  // acquisitionDate side effect (1b) needs to know WHICH symbols were faked.
  const healedRef = useRef(false)
  useEffect(() => {
    if (dataLoading || healedRef.current || !deleteTransaction || !deleteItem || !updateItem) return
    const fakeTrades = detectFakeAggregateTrades(transactions || [])
    const fakeTradeSymbols = new Set(fakeTrades.map((t) => (t.symbol || '').toUpperCase()))
    const stampedAcquisitions = detectImportStampedAcquisitions(items || [], fakeTradeSymbols)
    const dupeDividends = detectDuplicateCashDividends(transactions || [])
    const dupeFlows = detectCrossSourceDuplicateFlows(transactions || [])
    const phantoms = detectPhantomFlows(transactions || [])
    const fakeCashItems = detectFakeCashReportItems(items || [])

    const txToDelete = [...fakeTrades, ...dupeDividends, ...dupeFlows, ...phantoms]
    if (txToDelete.length === 0 && stampedAcquisitions.length === 0 && fakeCashItems.length === 0) return
    healedRef.current = true
    let cancelled = false
    ;(async () => {
      let removedTx = 0, clearedItems = 0, removedItems = 0
      for (const p of txToDelete) {
        try { await deleteTransaction(p.id); removedTx++ } catch { /* leave it; next load retries */ }
      }
      for (const a of stampedAcquisitions) {
        try { await updateItem(a.id, { acquisitionDate: null, _historyIncomplete: true }); clearedItems++ } catch { /* leave it; next load retries */ }
      }
      for (const it of fakeCashItems) {
        try { await deleteItem(it.id); removedItems++ } catch { /* leave it; next load retries */ }
      }
      if (cancelled || (removedTx === 0 && clearedItems === 0 && removedItems === 0)) return
      const total = [...fakeTrades, ...phantoms, ...dupeDividends, ...dupeFlows].reduce((sum, p) => sum + Math.abs(p.amount || 0), 0)
        + fakeCashItems.reduce((sum, it) => sum + Math.abs(it.value || 0), 0)
      showToast(
        lang === 'es'
          ? `Corregimos ${removedTx + removedItems + clearedItems} error(es) nuestro(s) en tu importación (${formatCurrency(total)} en filas que en realidad no existían). Tu retorno ya estaba mal por eso.`
          : `We fixed ${removedTx + removedItems + clearedItems} error(s) on our side in your import (${formatCurrency(total)} in rows that were never really there). Your return was wrong because of it.`,
        'info', 8000
      )
    })()
    return () => { cancelled = true }
  }, [dataLoading, transactions, items, deleteTransaction, deleteItem, updateItem, lang, showToast])

  const isDemoMode = useMemo(() => items.some(isDemoItem), [items])
  const handleClearDemo = useCallback(async () => {
    await deleteDemoData()
    showToast(lang === 'es' ? 'Datos de ejemplo eliminados' : 'Sample data removed')
  }, [deleteDemoData, showToast, lang])

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    // The auth callback now delivers the single-use code in the URL FRAGMENT
    // (never sent in Referer headers or server logs). Query is kept as a
    // fallback for redirects already in flight during a deploy.
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const oauthCode = hashParams.get('oauth_code') || params.get('oauth_code')
    const oauthBroker = hashParams.get('oauth_broker') || params.get('oauth_broker')
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

  // Data-completeness engine: gap findings + score over RAW data (items carry
  // their own currency; the engine converts per-tx via `convert`).
  const dataCompleteness = useMemo(
    () => analyzeDataCompleteness({ items, transactions, lots, convert, baseCurrency }),
    [items, transactions, lots, convert, baseCurrency]
  )

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
    if (!enrichedItems || enrichedItems.length === 0) {
      showToast(lang === 'es' ? 'Agrega activos antes de generar el reporte' : 'Add assets before generating the report')
      return
    }
    try {
      const { generateReport } = await import('@/lib/generateReport')
      await generateReport({
        items: enrichedItems, snapshots, transactions,
        netWorth, totalAssets, lang, returnYTD, annualDividends,
        profileName: profile?.name || user?.displayName || '',
        baseCurrency, convert,
      })
      showToast(lang === 'es' ? 'PDF descargado' : 'PDF downloaded')
    } catch (err) {
      console.error('[report] generation failed:', err)
      showToast(lang === 'es' ? 'Error generando el PDF' : 'Error generating PDF')
    }
  }, [enrichedItems, snapshots, transactions, lang, netWorth, totalAssets, returnYTD, annualDividends, profile, user, showToast, baseCurrency, convert])

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
      `⚡ ${t('Mi Portafolio', 'My Portfolio')}: Chispudo`,
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

  // Returning from the per-page tour chain (PageTour routed back with the final
  // flag): reopen the tour so it can show its closing card. The flag itself is
  // consumed by OnboardingTour's finalStep initializer.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem('chispudo-tour-final') === '1') {
        setShowOnboarding(true)
      }
    } catch {}
  }, [])

  // ONE rule for "is the IBKR connection actually in trouble?", shared by the top
  // banner, the header pill and the ActionButtons dot. They each used to decide on
  // their own (`ibkrSyncStatus === 'error'`), so a single transient failure lit up
  // a warning triangle over data synced hours ago. Split by whether the failure
  // can heal itself:
  //   - TOKEN_EXPIRED / INVALID_QUERY / LOCKED need the USER to act, so they warn
  //     immediately (auto-sync is halted or backed off for these).
  //   - Everything else (RATE_LIMITED/TIMEOUT/UNKNOWN) retries on its own every
  //     30min, so it only becomes news once the data is genuinely stale: 5 BUSINESS
  //     days without a successful sync. Business days because the market is shut on
  //     weekends and a Friday sync has nothing to add on Sunday.
  const ibkrNeedsAttention = useMemo(() => {
    if (!ibkrSyncErrorCode) return false
    if (['TOKEN_EXPIRED', 'INVALID_QUERY', 'LOCKED'].includes(ibkrSyncErrorCode)) return true
    return businessDaysSince(settings?._ibkrLastSync || settings?._ibkrLastAutoSync) >= 5
  }, [ibkrSyncErrorCode, settings?._ibkrLastSync, settings?._ibkrLastAutoSync])

  const topBanner = useMemo(() => {
    // Nothing to be stale ABOUT on an empty account: a brand-new user opening the app
    // was greeted by an amber "exchange rates outdated" warning above the welcome
    // screen, which reads as "this is broken" before they've added anything.
    if (portfolioItems.length === 0) return null
    if (staleCode) return 'stale'
    if (ibkrSyncErrorCode === 'TOKEN_EXPIRED') return 'ibkr-expired'
    if (ibkrSyncErrorCode === 'INVALID_QUERY') return 'ibkr-query'
    if (ibkrSyncErrorCode === 'LOCKED') return 'ibkr-locked'
    // Any other auto-sync failure self-heals; ibkrNeedsAttention holds the shared
    // staleness rule so this banner can never disagree with the header pill.
    if (ibkrNeedsAttention) return 'ibkr-failed'
    if (pricesError || ratesError) return 'prices'
    // The contribution hint is not an alarm anywhere: it is one line inside the
    // "Completar información" flow (Nuevo menu), reachable when the user goes
    // looking. It used to sit under the YTD figure, where it read as a
    // complaint about the number itself.
    return null
  }, [staleCode, ibkrSyncErrorCode, ibkrNeedsAttention, pricesError, ratesError, portfolioItems.length])

  // Loading state — show the structural skeleton (same layout as the loaded page)
  // instead of a lone spinner, so first paint already looks like the dashboard.
  if (authLoading || (user && dataLoading)) {
    return <DashboardLoading />
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-theme-base">
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
        onOpenConnections={handleOpenConnections}
        ibkrConnected={ibkrConnected}
        ibkrAutoSyncing={ibkrAutoSyncing}
        ibkrSyncSummary={ibkrSyncSummary}
        ibkrSyncStatus={ibkrSyncStatus}
        ibkrNeedsAttention={ibkrNeedsAttention}
        onIBKR={handleIBKRPillClick}
        onEnrich={portfolioItems.length > 0 ? handleOpenEnrich : null}
        enrichGapCount={dataCompleteness.findings.filter((f) => f.itemId).length}
        friendsEnabled={settings?.friendsEnabled !== false}
      />

      {topBanner && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
          {topBanner === 'stale' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-blue)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <p className="text-sm font-medium" style={{ color: 'var(--accent-blue)' }}>
                  {lang === 'es' ? 'Hay una nueva versión disponible' : 'A new version is available'}
                </p>
              </div>
              <button onClick={() => { if (typeof caches !== 'undefined') caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))); window.location.reload() }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
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
                  {lang === 'es' ? 'Tu token de IBKR expiró: genera uno nuevo para mantener tu portafolio actualizado' : 'Your IBKR token has expired: generate a new one to keep your portfolio updated'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={handleIbkrDisconnect} className="text-xs transition-colors" style={{ color: '#fcd34d', opacity: 0.7 }}>
                  {lang === 'es' ? 'Desconectar' : 'Disconnect'}
                </button>
                <button onClick={() => setModal('ibkr')}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ backgroundColor: '#d97706', color: '#fff' }}>
                  {lang === 'es' ? 'Actualizar' : 'Update'}
                </button>
              </div>
            </div>
          )}
          {topBanner === 'ibkr-query' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {lang === 'es' ? 'Query ID de IBKR inválido: verifica tu Flex Query en IBKR' : 'Invalid IBKR Query ID: verify your Flex Query in IBKR'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={handleIbkrDisconnect} className="text-xs transition-colors" style={{ color: '#fcd34d', opacity: 0.7 }}>
                  {lang === 'es' ? 'Desconectar' : 'Disconnect'}
                </button>
                <button onClick={() => setModal('ibkr')}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ backgroundColor: '#d97706', color: '#fff' }}>
                  {lang === 'es' ? 'Configurar' : 'Configure'}
                </button>
              </div>
            </div>
          )}
          {topBanner === 'ibkr-locked' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#f87171' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fca5a5' }}>
                  {lang === 'es' ? 'IBKR bloqueó tu token: genera uno NUEVO en IBKR o importa un CSV mientras tanto' : 'IBKR locked your token: generate a NEW one in IBKR or import a CSV in the meantime'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={handleIbkrDisconnect} className="text-xs transition-colors" style={{ color: '#fca5a5', opacity: 0.7 }}>
                  {lang === 'es' ? 'Desconectar' : 'Disconnect'}
                </button>
                <button onClick={() => setModal('ibkr')}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ backgroundColor: '#dc2626', color: '#fff' }}>
                  {lang === 'es' ? 'Resolver' : 'Resolve'}
                </button>
              </div>
            </div>
          )}
          {topBanner === 'ibkr-failed' && (
            <div className="px-4 py-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#fcd34d' }}>
                  {lang === 'es' ? 'La última sincronización con IBKR falló: tus datos pueden estar desactualizados' : 'The last IBKR sync failed: your data may be outdated'}
                </p>
              </div>
              <button onClick={() => setModal('ibkr')}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
                style={{ backgroundColor: '#d97706', color: '#fff' }}>
                {lang === 'es' ? 'Reintentar' : 'Retry'}
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
                    ? (lang === 'es' ? 'Precios y tasas desactualizados: error de conexión' : 'Prices and rates outdated: connection error')
                    : pricesError
                      ? (lang === 'es' ? 'Precios desactualizados: no se pudo conectar' : 'Prices outdated: could not connect')
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
        </div>
      )}

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-5 space-y-3 sm:space-y-4">
        {/* Demo mode: the exit must always be obvious, even after the tour ends */}
        {isDemoMode && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-xs"
            style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {lang === 'es' ? 'Estás explorando con datos de ejemplo: nada de esto es tuyo todavía.' : 'You are exploring with sample data: none of this is yours yet.'}
            </span>
            <button onClick={handleClearDemo}
              className="shrink-0 px-2.5 py-1 rounded-lg font-medium"
              style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
              {lang === 'es' ? 'Borrar demo y empezar' : 'Delete demo and start'}
            </button>
          </div>
        )}

        {/* Time-sensitive alerts (maturities, dividends received) belong at the
            top — buried at page-bottom they were invisible on mobile. */}
        <NotificationCenter items={portfolioItems} transactions={transactions} lang={lang} settings={settings} />
        <div className="flex items-center gap-3 flex-wrap">
          {/* Freshness dot: 1-day-old data is normal (snapshots are daily), so
              1-13d stays neutral/muted — amber only kicks in at ≥14d. */}
          {dataAge === 0 ? (
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          ) : dataAge != null && dataAge >= 14 ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
          ) : (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--text-muted)' }} />
          )}
          <span className="text-xs" style={{ color: dataAge != null && dataAge >= 14 ? '#fbbf24' : 'var(--text-muted)' }}>
            {dataAge === 0
              ? (lang === 'es' ? 'Datos al día' : 'Data up to date')
              : dataAge != null
                ? (lang === 'es' ? `Actualizado hace ${dataAge}d` : `Updated ${dataAge}d ago`)
                : (lang === 'es' ? 'Sin datos aún' : 'No data yet')}
          </span>
          {dataAge != null && dataAge >= 14 && (
            <button onClick={handleRefresh} className="text-micro underline transition-colors" style={{ color: 'var(--accent-blue)' }}>
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

        <h1 className="sr-only">{lang === 'es' ? 'Patrimonio: Dashboard' : 'Net Worth: Dashboard'}</h1>


        {/* One onboarding surface at a time — don't stack this under the tour modal */}
        {portfolioItems.length === 0 && !dataLoading && !showOnboarding && (
          <EmptyState
            onAdd={handleOpenAccount}
            onImport={handleOpenImport}
            onTemplate={async () => {
              const { generateTemplate } = await import('@/lib/generateTemplate')
              await generateTemplate()
            }}
            onDemo={async () => {
              // Seed first, then open the tour: with demo items already present
              // the tour mounts straight into the anchored walkthrough.
              await handleSeedDemo()
              setShowOnboarding(true)
            }}
            onConnect={handleOpenConnections}
            lang={lang}
          />
        )}

        {/* ═══ RESUMEN ═══ */}
        {portfolioItems.length > 0 && <>
        <ErrorBoundary lang={lang}>
        <div className="stagger-1 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 items-stretch">
          <div className="md:col-span-1 lg:col-span-2 flex flex-col gap-4">
            <CardBoundary id="OL-01" className="h-full">
            <NetWorthCard
              netWorth={netWorth} returnYTD={returnYTD} ytdChange={ytdChange}
              returnSinceStart={returnSinceStart} sinceStartDate={sinceStartDate}
              dailyChange={dailyChange} convert={convert}
              lang={lang} netContributions={netContributions} cashTotal={cashTotal} snapshots={augmentedSnapshots} items={portfolioItems}
              ytdCalibrated={ytdCalibrated} ytdBreakdown={ytdBreakdown}
            />
            </CardBoundary>
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex flex-col gap-4">
            <CardBoundary id="OR-01"><PortfolioGrowthChart items={portfolioItems} lots={lots} snapshots={chartSnapshots} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} benchmarkSymbol={benchmarkSymbol} benchmarkName={benchmarkName} onSaveSnapshot={saveSnapshot} ibkrSyncSummary={ibkrSyncSummary} onImportBroker={handleOpenImport} /></CardBoundary>
          </div>
        </div>
        </ErrorBoundary>

        <MonthEndCheckin
          settings={settings} saveSettings={saveSettings}
          hasItems={portfolioItems.length > 0}
          hasLiveConnection={hasLiveSync(portfolioItems, ibkrConnected)}
          onImport={handleOpenImport}
          onAddManual={handleOpenAccount}
          lang={lang}
        />

        {/* Ad slot — first seam below the hero, visible without scrolling.
            Renders nothing until NEXT_PUBLIC_ADSENSE_SLOT_FOOTER is set. */}
        <div className="stagger-2"><AdBanner lang={lang} /></div>

        {/* Insight cards feed removed at the user's request: the metrics it
            repeated (emergency fund, FIRE, savings rate, passive income) live in
            their dedicated cards, and the row left dead whitespace on tablets. */}

        {/* Chispu te sugiere — data gaps with one-tap fixes. HIGH-severity
            findings surface above the fold (before composition/actions);
            otherwise the card sits below the action row. */}
        {(() => {
          const hasHigh = dataCompleteness.findings.some((f) => f.severity === 'high')
          const suggestionsCard = (
            <CardBoundary id="SUGG-01">
              <ChispuSuggestions
                findings={dataCompleteness.findings}
                globalScore={dataCompleteness.globalScore}
                items={items}
                lang={lang}
                onEditItem={setEditItem}
                onOpenCashflow={handleOpenCashflowPrefilled}
                onOpenReview={handleOpenReview}
              />
            </CardBoundary>
          )
          return (
            <>
              {hasHigh && suggestionsCard}

              {/* ═══ COMPOSICIÓN: Allocation + Rendimiento por institución ═══ */}
              <div className="stagger-3 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 items-start">
                <CardBoundary id="OR-02"><AssetAllocation items={portfolioItems} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
                <CardBoundary id="INST-01"><InstitutionPerformance items={portfolioItems} lang={lang} baseCurrency={baseCurrency} transactions={transactions} convert={convert} ibkrDataComplete={ibkrDataComplete} /></CardBoundary>
                <CardBoundary id="OL-03"><PriceAlerts items={portfolioItems} alerts={alerts} marketPrices={marketPrices} addAlert={addAlert} deleteAlert={deleteAlert} lang={lang} /></CardBoundary>
              </div>

              <ActionButtons
                onImport={handleOpenImport} onAddAccount={handleOpenAccount}
                onTransfer={handleOpenTransfer} onCashFlow={handleOpenCashflow} onExport={handleExport}
                onShare={handleShare} onIntegrations={handleOpenConnections}
                onReview={handleOpenReview} itemCount={enrichedItems.length} lang={lang}
                ibkrSyncStatus={ibkrSyncStatus} ibkrLastSync={ibkrLastSync} ibkrNeedsAttention={ibkrNeedsAttention}
              />

              {!hasHigh && suggestionsCard}
            </>
          )
        })()}

        {/* ═══ INGRESOS & COSTOS ═══ — both are "what your money did to you this
            year" (money it made / money it cost), so they read as one section
            instead of Costs sitting as an unrelated card right below it. */}
        <div className="stagger-4"><SectionCollapse title={lang === 'es' ? 'Ingresos & Costos' : 'Income & Costs'} id="income">
          <ErrorBoundary lang={lang}>
            <CardBoundary id="IG-01"><DividendIncome transactions={transactions} items={portfolioItems} convert={convert} baseCurrency={baseCurrency} lang={lang} totalAssets={totalAssets} /></CardBoundary>
            <CardBoundary id="COST-01"><CostsCard transactions={transactions} items={portfolioItems} convert={convert} baseCurrency={baseCurrency} lang={lang} /></CardBoundary>
          </ErrorBoundary>
        </SectionCollapse></div>

        {/* ═══ ACTIVIDAD RECIENTE ═══ */}
        <div className="stagger-5"><SectionCollapse title={lang === 'es' ? 'Actividad Reciente' : 'Recent Activity'} id="activity" defaultOpen={false}>
          <ErrorBoundary lang={lang}>
            {/* Gross money in vs out — one compact strip (three separate airy cards
                wasted a whole row of vertical space on tablets) */}
            {(contributionsSummary.totalContributed > 0 || contributionsSummary.totalWithdrawn > 0) && (
              <div className="bg-theme-surface/80 rounded-xl border border-glass-border/50 px-4 py-2.5 mb-3 grid grid-cols-3 gap-3">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-xs text-slate-500 shrink-0">{lang === 'es' ? 'Aportado' : 'Deposited'}</span>
                  <span className="text-sm font-bold font-mono tabular-nums truncate" style={{ color: 'var(--accent-green)' }}>{formatCurrency(contributionsSummary.totalContributed)}</span>
                </div>
                <div className="flex items-baseline gap-2 min-w-0 justify-center">
                  <span className="text-xs text-slate-500 shrink-0">{lang === 'es' ? 'Retirado' : 'Withdrawn'}</span>
                  <span className="text-sm font-bold font-mono tabular-nums truncate" style={{ color: 'var(--text-negative)' }}>{formatCurrency(contributionsSummary.totalWithdrawn)}</span>
                </div>
                <div className="flex items-baseline gap-2 min-w-0 justify-end">
                  <span className="text-xs text-slate-500 shrink-0">{lang === 'es' ? 'Neto' : 'Net'}</span>
                  <span className="text-sm font-bold font-mono tabular-nums truncate" style={{ color: 'var(--text-primary)' }}>{formatCurrency(contributionsSummary.netContributions)}</span>
                </div>
              </div>
            )}
            <CardBoundary id="HO-02"><RecentTransactions transactions={transactions} items={items} lang={lang} onExportCSV={handleExportTransactionsCSV} onDeleteTransaction={deleteTransaction} /></CardBoundary>
            <CardBoundary id="HO-03"><DataQualityCard items={portfolioItems} transactions={transactions} snapshots={snapshots} convert={convert} baseCurrency={baseCurrency} lang={lang} onConnect={handleOpenConnections} onImportBroker={handleOpenImport} /></CardBoundary>
          </ErrorBoundary>
        </SectionCollapse></div>

        {/* ═══ METAS ═══ */}
        <div className="stagger-6"><SectionCollapse title={lang === 'es' ? 'Metas' : 'Goals'} id="goals" defaultOpen={!!(goals?.incomeGoal || goals?.portfolioGoal)}>
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
            <AnalysisTabs lang={lang} portfolioItems={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={augmentedSnapshots} lots={lots} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkData={benchmarkData} benchmarkName={benchmarkName} beginnerMode={beginnerMode} />
          </ErrorBoundary>
        </SectionCollapse></div>

        <InstallPrompt lang={lang} />

        <div className="flex items-center justify-center gap-3 pt-4 pb-8">
          <button onClick={handleReport}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-theme-surface border border-glass-border/60 rounded-xl hover:bg-theme-elevated hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Descargar PDF' : 'Download PDF'}
          </button>
          <button onClick={handleOpenPrint}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-theme-surface border border-glass-border/60 rounded-xl hover:bg-theme-elevated hover:text-white hover:border-[#475569] transition-all inline-flex items-center gap-2">
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
          existingFinanceTransactions={financeTransactions}
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
          onCreateDestination={addItem}
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
          existingItems={items} lang={lang} convert={convert}
        />
      )}

      {modal === 'ibkr' && (
        <IBKRSyncModal
          onClose={() => {
            const justConnected = !ibkrWasConnectedRef.current && ibkrConnected
            handleCloseModal()
            // Greet a brand-new connection with the checklist, once — a routine
            // re-sync (already connected before opening) never triggers it.
            if (justConnected) setTimeout(() => setBrokerCompletionId('ibkr'), 50)
          }}
          onSyncComplete={async (data, mode, onProgress) => {
            await handleIBKRSync(data, mode, onProgress)
            showToast(lang === 'es' ? `IBKR: ${data.items?.length || 0} posiciones sincronizadas` : `IBKR: ${data.items?.length || 0} positions synced`)
          }}
          savedToken={settings?.ibkrToken || ''} savedQueryId={settings?.ibkrQueryId || ''}
          vaultMigrated={!!settings?._ibkrVaultMigrated} syncSummary={ibkrSyncSummary}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          onApiSyncSuccess={() => { saveSettings({ _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: 'ok', _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          onDisconnect={handleIbkrDisconnect}
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
          onSyncComplete={async ({ items: syncItems, transactions: syncTxs, mode }) => {
            const newKeys = new Set()
            for (const item of syncItems) {
              // Match by wallet address when both sides have one: every chain's
              // address is unique, and several chains now share a symbol (ETH
              // mainnet vs ETH on Arbitrum/Base/Optimism). The symbol fallback
              // only applies to legacy items imported before _walletAddress.
              const existing = items.find(it =>
                (item._walletAddress && it._walletAddress === item._walletAddress) ||
                (!item._walletAddress && !it._walletAddress &&
                 (it.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() &&
                 (it._source === 'ledger' || (it.institution || '').toLowerCase() === 'ledger'))
              )
              if (existing) {
                await updateItem(existing.id, { quantity: item.quantity, _source: 'ledger', _walletAddress: item._walletAddress })
              } else {
                await addItem(item)
                newKeys.add(item._walletAddress || item.symbol)
              }
            }
            // Inflows attach only to NEWLY created items: re-syncing an address
            // that already exists would duplicate its BUY history.
            let txCount = 0
            for (const tx of (syncTxs || [])) {
              if (newKeys.has(tx._walletAddress || tx.symbol)) { await addTransaction(tx); txCount++ }
            }
            setModal(null)
            showToast(lang === 'es'
              ? `Cripto: ${syncItems.length} posiciones, ${txCount} compras detectadas`
              : `Crypto: ${syncItems.length} positions, ${txCount} detected buys`)
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
          onTransfer={async (payload) => {
            await transferFunds(payload)
            showToast(lang === 'es' ? 'Transferencia registrada' : 'Transfer recorded')
          }}
          onExecuteContribution={async (payload) => {
            await executeContribution(payload)
            showToast(lang === 'es' ? 'Movimiento registrado' : 'Movement recorded')
          }}
          onConfirmNewMoney={(itemId) => updateItem(itemId, { _newMoneyConfirmed: true })}
          existingItems={items}
          lang={lang}
          baseCurrency={baseCurrency}
          prefill={cashflowPrefill}
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
          onDeleteItemGroup={deleteItemGroup}
          onSetLang={() => handleSetLang('toggle')}
          entities={entities}
          onAddEntity={addEntity}
          onUpdateEntity={updateEntityData}
          onDeleteEntity={deleteEntity}
          onOpenConnections={handleOpenConnections}
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
          theme={theme} onToggleTheme={handleSetTheme} lang={lang}
          beginnerMode={beginnerMode} onToggleBeginner={handleToggleBeginner}
          portfolioItems={portfolioItems}
        />
      )}

      {modal === 'connections' && (
        <ConnectionsModal
          onClose={handleCloseModal}
          lang={lang}
          lastSyncTime={settings?._ibkrLastSync || settings?._ibkrLastAutoSync || null}
          portfolioItems={portfolioItems}
          onOpenIBKR={handleOpenIBKR}
          onBackgroundSync={handleIBKRPillClick}
          onImport={handleOpenImport}
          onAddAccount={handleOpenAccount}
          onOpenBlockchain={handleOpenBlockchain}
          onOpenLedger={() => setModal('ledger')}
          onCalibrate={() => setModal('calibrate')}
          onOpenBrokerChecklist={(brokerId) => setBrokerCompletionId(brokerId)}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          onSyncBroker={async (brokerId, data) => {
            const positions = data?.positions || data || []
            const posArray = Array.isArray(positions) ? positions : []
            const source = brokerId || 'broker'
            const mapped = posArray.filter(p => p.quantity !== 0).map(p => ({
              symbol: (p.symbol || '').toUpperCase(), name: p.name || p.symbol,
              type: p.type || 'Stock', quantity: Math.abs(p.quantity || 0),
              purchasePrice: p.purchasePrice || 0, currentPrice: p.currentPrice || 0,
              institution: p.institution || brokerId || 'Unknown', currency: p.currency || 'USD',
              acquisitionDate: p.acquisitionDate,
              // Preserve the short/long side: the old mapper dropped isDebt and
              // Math.abs'd the quantity, so a hedged book imported as 100% long.
              isDebt: !!p.isDebt || (p.quantity || 0) < 0,
              conid: p.conid, accountId: p.accountId || p._ibkrAccountId,
              _source: source,
            }))
            if (mapped.length === 0) {
              showToast(lang === 'es'
                ? `${brokerId}: no se recibieron posiciones. Revisa la conexión.`
                : `${brokerId}: no positions received. Check the connection.`, 'error')
              return
            }
            // Reconcile instead of blind-inserting: bulkImport mints a new id per
            // item, so the old path duplicated the whole portfolio on every sync.
            const tag = {}
            if (activePortfolio && activePortfolio !== '__all__') tag.portfolioId = activePortfolio
            if (activeEntity && activeEntity !== '__all__' && activeEntity !== 'default') tag.entityId = activeEntity
            const { newItems, updateItems, deleteIds } = reconcileBrokerPositions({
              incoming: mapped, existing: items, source, tag,
            })
            await bulkImport({ items: newItems, updateItems, deleteIds }, (done, total) => {
              showToast(`Sync ${brokerId}: ${done}/${total}`, 'info', 2000)
            })
            const parts = [
              `${mapped.length} ${lang === 'es' ? 'posiciones' : 'positions'}`,
              newItems.length ? `+${newItems.length}` : null,
              deleteIds.length ? `-${deleteIds.length}` : null,
            ].filter(Boolean)
            showToast(`${brokerId}: ${parts.join(' · ')}`, 'success')
          }}
        />
      )}

      {modal === 'print' && (
        <PrintSummary items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
          snapshots={augmentedSnapshots} transactions={transactions} lang={lang} onClose={handleCloseModal} />
      )}

      {modal === 'calibrate' && (
        <CalibrateReturnModal
          netWorth={netWorth} transactions={transactions} convert={convert} baseCurrency={baseCurrency}
          snapshots={snapshots} accountSnapshots={accountCalibrations} items={portfolioItems}
          saveSnapshot={saveSnapshot} deleteSnapshot={deleteSnapshot}
          lang={lang} onClose={handleCloseModal} />
      )}

      {editItem && (
        <EditAccountModal key={editItem.id} item={editItem} onClose={handleCloseEdit} entities={entities}
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
          onDeleteTransaction={deleteTransaction}
          onUpdateTransaction={updateTransaction}
          onExecuteContribution={executeContribution}
          onCreateDestination={addItem}
          transactions={transactions}
          baseCurrency={baseCurrency}
          existingItems={items} lang={lang}
          allItems={portfolioItems}
          findings={dataCompleteness.findings}
          onOpenCashflow={handleOpenCashflowPrefilled}
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
        <AssetDetailModal item={detailItem} onClose={handleCloseDetail} lang={lang} uid={user?.uid}
          transactions={transactions} convert={convert} baseCurrency={baseCurrency} />
      )}

      {showReview && !editItem && (
        <AccountReviewModal
          items={portfolioItems}
          transactions={transactions}
          onClose={handleCloseReview}
          onEditItem={setEditItem}
          onOpenCashflow={handleOpenCashflowPrefilled}
          lang={lang}
          findings={dataCompleteness.findings}
          startItemId={reviewTarget.itemId}
          onlyWithFindings={reviewTarget.guided}
          institutionFilter={reviewTarget.institution}
        />
      )}

      {modal === 'quarterly' && (
        <QuarterlyHistoryModal
          saveSnapshot={saveSnapshot}
          convert={convert}
          baseCurrency={baseCurrency}
          snapshots={snapshots}
          lang={lang}
          onClose={handleCloseModal}
          onSaved={(n) => showToast(lang === 'es' ? `${n} trimestres guardados` : `${n} quarters saved`, 'success')}
        />
      )}

      {showEnrich && (
        <EnrichModal
          items={portfolioItems}
          findings={dataCompleteness.findings}
          contributionWarning={contributionWarning}
          lang={lang}
          onClose={handleCloseEnrich}
          onPickAccount={handleEnrichAccount}
          onPickInstitution={handleEnrichInstitution}
          onGuided={handleEnrichGuided}
          onBrokerChecklist={() => { setShowEnrich(false); setBrokerCompletionId('ibkr') }}
          hasBroker={portfolioItems.some((it) => it._source === 'ibkr')}
        />
      )}

      {brokerCompletionId && (
        <BrokerCompletionModal
          brokerId={brokerCompletionId}
          brokerName={brokerCompletionId === 'ibkr' ? 'Interactive Brokers' : brokerCompletionId}
          lang={lang}
          onClose={() => setBrokerCompletionId(null)}
          completionState={brokerCompletionState}
          onConnect={() => setModal('ibkr')}
          onImportHistory={() => handleOpenImport('ibkr')}
          onQuarterlyHistory={handleOpenQuarterly}
          onCalibrate={() => setModal('calibrate')}
          inferredFlowCount={inferredFlowCandidates.length}
          onReviewInferredFlows={() => setModal('inferredFlows')}
        />
      )}

      {modal === 'inferredFlows' && (
        <InferredFlowsModal
          candidates={inferredFlowCandidates}
          lang={lang}
          onClose={handleCloseModal}
          onAccept={async (c) => {
            await acceptInferredFlow(c)
            showToast(lang === 'es' ? 'Movimiento registrado' : 'Movement recorded', 'success')
          }}
          onDismiss={dismissInferredFlow}
        />
      )}

      <CommandPalette open={cmdPaletteOpen} onClose={handleCloseCmdPalette}
        items={portfolioItems} lang={lang} onAction={handleCmdAction} />

      <MobileNav
        onAdd={handleOpenAccount} onImport={handleOpenImport}
        onExport={handleExport} onShare={handleShare}
        onSettings={handleOpenSettings} onSearch={handleOpenCmdPalette} lang={lang}
        onEnrich={portfolioItems.length > 0 ? handleOpenEnrich : null}
        enrichGapCount={dataCompleteness.findings.filter((f) => f.itemId).length}
        friendsEnabled={settings?.friendsEnabled !== false}
      />

      {showOnboarding && (
        <OnboardingTour lang={lang}
          onAction={(action) => {
            if (action === 'add') setModal('account')
            else if (action === 'settings') setModal('settings')
          }}
          onComplete={() => setShowOnboarding(false)}
          onSeedDemo={handleSeedDemo}
          onClearDemo={handleClearDemo}
          demoActive={isDemoMode}
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
