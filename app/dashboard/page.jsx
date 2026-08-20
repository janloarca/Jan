'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { getItemValue, formatCurrency, getTypeCategory, ibkrAttentionNeeded } from '@/components/dashboard/utils'
import { computeLoadStages } from '@/lib/loadStages'
import { ibkrJourneyProgress } from '@/lib/ibkrJourney'
import Header from '@/components/dashboard/Header'
import PullToRefresh from '@/components/ui/PullToRefresh'
import ChispudoLoader from '@/components/ui/ChispudoLoader'
import { InfoTip } from '@/components/ui/Tooltip'
import { useEdgeFade } from '@/hooks/useEdgeFade'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import PageBanner from '@/components/ui/PageBanner'
import AdBanner from '@/components/AdBanner'
import MonthEndCheckin, { hasLiveSync } from '@/components/dashboard/MonthEndCheckin'
import DashboardLoading from './loading'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import CalibrateReturnModal from '@/components/dashboard/CalibrateReturnModal'
import IBKRJourneyBar from '@/components/dashboard/IBKRJourneyBar'
import QuickActionsCard from '@/components/dashboard/QuickActionsCard'
import SectionCollapse from '@/components/dashboard/SectionCollapse'
import MobileNav from '@/components/dashboard/MobileNav'
import ErrorBoundary from '@/components/ErrorBoundary'
import CardBoundary from '@/components/dashboard/CardBoundary'
import { SkeletonCard, SkeletonChart, Shimmer } from '@/components/dashboard/Skeleton'

// The most-seen loading moment in the app in practice — the next/dynamic()
// fallback for 17 different modals below, so it flashes for a beat every
// time any of them opens. Used to be its own third hardcoded-hex placeholder
// system (bg-slate-700/*), unrelated to both Skeleton.jsx's Shimmer and to
// this same file's own DashboardLoading skeleton. Same Shimmer atom as both
// of those now — this shape (title bar + rows) has no real layout to match,
// unlike DashboardLoading, so there's no constraint against reusing it as-is.
function ModalSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status" aria-live="polite" aria-label="Loading">
      <div className="bg-theme-card border border-glass-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <Shimmer className="h-5 w-32 mb-4" />
        <div className="space-y-3">
          <Shimmer className="h-10" />
          <Shimmer className="h-10" />
          <Shimmer className="h-10 w-2/3" />
        </div>
      </div>
    </div>
  )
}

const FileImportModal = dynamic(() => import('@/components/FileImportModal'), { loading: () => <ModalSkeleton /> })
const AddAccountModal = dynamic(() => import('@/components/AddAccountModal'), { loading: () => <ModalSkeleton /> })
const SellModal = dynamic(() => import('@/components/SellModal'), { loading: () => <ModalSkeleton /> })
const SellPickerModal = dynamic(() => import('@/components/dashboard/SellPickerModal'), { loading: () => <ModalSkeleton /> })
const PriceAlertsModal = dynamic(() => import('@/components/dashboard/PriceAlertsModal'), { loading: () => <ModalSkeleton /> })
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
const LiquidYieldModal = dynamic(() => import('@/components/dashboard/LiquidYieldModal'), { loading: () => <ModalSkeleton /> })
const CashFlowModal = dynamic(() => import('@/components/CashFlowModal'), { loading: () => <ModalSkeleton /> })
const PrintSummary = dynamic(() => import('@/components/dashboard/PrintSummary'))
const OnboardingTour = dynamic(() => import('@/components/dashboard/OnboardingTour'))
const GuidedSetup = dynamic(() => import('@/components/dashboard/GuidedSetup'))
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
// These three were already built and registered in cardRegistry.js but had
// never been mounted anywhere in the app. They are Analysis tabs now.
const BenchmarkComparison = dynamic(() => import('@/components/dashboard/BenchmarkComparison'), { loading: () => <SkeletonCard /> })
const CurrencyImpact = dynamic(() => import('@/components/dashboard/CurrencyImpact'), { loading: () => <SkeletonCard /> })
const FeeAnalysis = dynamic(() => import('@/components/dashboard/FeeAnalysis'), { loading: () => <SkeletonCard /> })
const PortfolioMap = dynamic(() => import('@/components/dashboard/PortfolioMap'), { loading: () => <SkeletonCard /> })
const ProjectionSimulator = dynamic(() => import('@/components/dashboard/ProjectionSimulator'), { loading: () => <SkeletonCard /> })
// InstitutionPerformance sigue EN DISCO y sin un solo cambio: sus seis filas
// duplicaban número por número la vista "Inst." de Asignación de Activos, así
// que el tablero dejó de renderizarla (ver la grilla de composición más abajo).
// El `dynamic()` que estaba acá sí se quitó: un import dinámico sin punto de
// montaje igual emite su chunk, o sea todo el mundo pagaba la descarga de una
// card que nadie pide. Remontarla sigue siendo una línea, ahora dos.
const InvestedByYearCard = dynamic(() => import('@/components/dashboard/InvestedByYearCard'), { loading: () => <SkeletonCard /> })
const RebalanceSuggestions = dynamic(() => import('@/components/dashboard/RebalanceSuggestions'), { loading: () => <SkeletonCard /> })
const WealthProjectionCard = dynamic(() => import('@/components/dashboard/WealthProjectionCard'), { loading: () => <SkeletonCard /> })
const InvestmentComparator = dynamic(() => import('@/components/dashboard/InvestmentComparator'), { loading: () => <SkeletonCard /> })

// How long a finished IBKR-journey step stays on screen before it carries the
// user to the next one (FASE GQ4). Long enough to read the one-line "Listo:
// N trimestres guardados" confirmation, short enough to still feel automatic.
const IBKR_AUTO_ADVANCE_MS = 1600

import RecentTransactions from '@/components/dashboard/RecentTransactions'
import DataQualityCard from '@/components/dashboard/DataQualityCard'
import ChispuSuggestions from '@/components/dashboard/ChispuSuggestions'
import CostsCard from '@/components/dashboard/CostsCard'
import { reconcileBrokerPositions } from '@/lib/brokerReconcile'
import { analyzeDataCompleteness } from '@/lib/dataCompleteness'
import { detectPhantomFlows } from '@/lib/phantomFlows'
import { detectFakeAggregateTrades, detectImportStampedAcquisitions, detectFakeCashReportItems, detectDuplicateCashDividends, detectCrossSourceDuplicateFlows } from '@/lib/badDataCleanup'
import { IBKR_DISCONNECTED_FIELDS } from '@/lib/brokerRegistry'
import { ibkrFailureFeedback, ibkrCooldownRemainingMs, formatCooldown } from '@/lib/ibkrSyncFeedback'
import { toastStyleFor, toastIconFor } from '@/lib/toastStyle'

import { DEMO_ITEMS, DEMO_LOTS, DEMO_TRANSACTIONS, isDemoItem } from '@/lib/demoData'
import AssetAllocation from '@/components/dashboard/AssetAllocation'
import NotificationCenter from '@/components/dashboard/NotificationCenter'
import InstallPrompt from '@/components/dashboard/InstallPrompt'
import EmptyState from '@/components/dashboard/EmptyState'
// MonthlyBreakdown removed — replaced by /spreadsheet page
import PortfolioSelector from '@/components/dashboard/PortfolioSelector'
import EntitySwitcher from '@/components/dashboard/EntitySwitcher'
import { useEntities } from '@/hooks/useEntities'
import { authFetch, safeJson } from '@/lib/authFetch'

// Sits in the dashboard's composition grid as Asset Allocation's sibling, so it
// wears the same card: same shell, same header shape, same segmented control.
// It used to be a bare tab strip in a collapsed section at the very bottom of
// the page. Its five original tabs are unchanged; Benchmark, Currency and Fees
// were already built as components and had simply never been mounted anywhere,
// and Data quality moved up from "Recent activity".
function AnalysisTabs({ lang, portfolioItems, netWorth, totalAssets, snapshots, lots, transactions, convert, baseCurrency, rates, benchmarkData, benchmarkName, benchmarkReturn, portfolioReturn, volatility, goalValue, beginnerMode, onConnect, onImportBroker }) {
  const t = (es, en) => lang === 'es' ? es : en
  const hasLots = lots && lots.length > 0

  // Once vistas en UNA fila plana no son pestañas, son una lista que se sale de
  // la pantalla: en el iPad del usuario la última quedaba cortada, y la guía de
  // NN/g es explícita en que las pestañas sirven para "unas pocas secciones".
  //
  // Se agrupan en cuatro familias, y ninguna vista desaparece. El criterio es la
  // PREGUNTA que contesta cada una, no de dónde salió el componente:
  //   Rendimiento  -> cómo me fue y qué lo movió
  //   Riesgo       -> qué tan expuesto estoy a que salga mal
  //   Exposición   -> a qué estoy expuesto, y qué me cuesta
  //   Proyección   -> lo que viene, y qué tan confiable es lo que estoy viendo
  //
  // Cuatro chips entran completos hasta en un teléfono, y dentro de cada familia
  // quedan dos o tres vistas: los dos niveles son cortos.
  const families = [
    {
      key: 'performance', label: t('Rendimiento', 'Performance'),
      views: [
        { key: 'benchmark', label: t('Benchmark', 'Benchmark') },
        ...(beginnerMode ? [] : [{ key: 'attribution', label: t('Atribución', 'Attribution') }]),
        ...(hasLots ? [{ key: 'gains', label: t('Ganancias', 'Gains') }] : []),
      ],
    },
    {
      key: 'risk', label: t('Riesgo', 'Risk'),
      views: [
        { key: 'health', label: t('Salud', 'Health') },
        ...(beginnerMode ? [] : [{ key: 'risk', label: t('Métricas', 'Metrics') }]),
        { key: 'concentration', label: t('Concentración', 'Concentration') },
      ],
    },
    {
      key: 'exposure', label: t('Exposición', 'Exposure'),
      views: [
        { key: 'map', label: t('Mapa', 'Map') },
        { key: 'currency', label: t('Moneda', 'Currency') },
        { key: 'fees', label: t('Comisiones', 'Fees') },
      ],
    },
    {
      key: 'outlook', label: t('Proyección', 'Outlook'),
      views: [
        { key: 'projection', label: t('Proyección', 'Projection') },
        { key: 'quality', label: t('Calidad de datos', 'Data quality') },
      ],
    },
  ].filter((f) => f.views.length > 0)

  const [family, setFamily] = useState('risk')
  const activeFamily = families.find((f) => f.key === family) || families[0]
  // La vista arranca en la primera de su familia y se re-ancla al cambiar de
  // familia, así que nunca queda una vista activa que no esté en la fila de
  // abajo (por ejemplo al entrar o salir de modo principiante).
  const [tab, setTab] = useState(activeFamily.views[0].key)
  const activeTab = activeFamily.views.some((v) => v.key === tab) ? tab : activeFamily.views[0].key

  return (
    <div className="card p-4 sm:p-5">
      {/* Header — mirrors AssetAllocation's so the two read as one pair */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-purple)' }} />
          {t('ANÁLISIS', 'ANALYSIS')}
          <InfoTip text={t(
            'Distintas lecturas del mismo portafolio, agrupadas por la pregunta que contestan. Ninguna pestaña cambia tus datos.',
            'Different readings of the same portfolio, grouped by the question each one answers. No tab changes your data.'
          )} />
        </h3>
      </div>

      <SegmentedTabs
        tabs={families.map((f) => ({ key: f.key, label: f.label }))}
        value={activeFamily.key}
        onChange={(k) => {
          setFamily(k)
          const next = families.find((f) => f.key === k)
          if (next) setTab(next.views[0].key)
        }}
        deps={[lang, beginnerMode, hasLots]}
        ariaLabel={t('Familias de análisis', 'Analysis families')}
        className="mb-2"
      />
      {/* El segundo nivel solo aparece cuando de verdad hay algo que elegir. */}
      {activeFamily.views.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 mb-4">
          {activeFamily.views.map((v) => {
            const on = v.key === activeTab
            return (
              <button key={v.key} onClick={() => setTab(v.key)}
                aria-pressed={on}
                className="px-2.5 min-h-[28px] text-caption rounded-md transition-colors"
                style={on
                  ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', fontWeight: 600 }
                  : { color: 'var(--text-muted)' }}>
                {v.label}
              </button>
            )
          })}
        </div>
      )}
      {activeTab === 'health' && (
        // Concentration lives in its own dedicated tab; don't duplicate it here.
        <CardBoundary id="AN-01"><FinancialHealth items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'risk' && !beginnerMode && (
        <CardBoundary id="AN-05"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></CardBoundary>
      )}
      {activeTab === 'concentration' && (
        <CardBoundary id="AN-02b"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'gains' && hasLots && (
        <CardBoundary id="AN-03"><GainsReport lots={lots} items={portfolioItems} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
      )}
      {activeTab === 'attribution' && !beginnerMode && (
        <CardBoundary id="AN-04"><PerformanceAttribution items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'benchmark' && (
        <CardBoundary id="OL-02"><BenchmarkComparison benchmarkReturn={benchmarkReturn} portfolioReturn={portfolioReturn} benchmarkName={benchmarkName} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'currency' && (
        <CardBoundary id="PR-04"><CurrencyImpact items={portfolioItems} convert={convert} baseCurrency={baseCurrency} rates={rates} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'fees' && (
        <CardBoundary id="IG-09"><FeeAnalysis items={portfolioItems} netWorth={netWorth} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'quality' && (
        <CardBoundary id="HO-03"><DataQualityCard items={portfolioItems} transactions={transactions} snapshots={snapshots} convert={convert} baseCurrency={baseCurrency} lang={lang} onConnect={onConnect} onImportBroker={onImportBroker} /></CardBoundary>
      )}
      {activeTab === 'map' && (
        <CardBoundary id="OR-06"><PortfolioMap items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'projection' && (
        <CardBoundary id="IG-11"><ProjectionSimulator netWorth={netWorth} lang={lang} volatility={volatility} goalValue={goalValue} /></CardBoundary>
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
  // Primeros pasos guiados: le preguntamos al usuario qué tiene y lo
  // acompañamos activo por activo. Es lo que ve un usuario nuevo en vez de
  // caer directo en el formulario largo.
  const [showGuided, setShowGuided] = useState(false)
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
  // Hasta cuándo el pill de IBKR no debe mandar otra petición. Vive en el
  // componente y no en settings a propósito: es una pausa de esta sesión para
  // no alimentar el bloqueo de IBKR a toques, no un estado que valga la pena
  // persistir (recargar la página ya pasa por la cadencia del auto-sync).
  const [ibkrCooldownUntil, setIbkrCooldownUntil] = useState(0)
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
    migrateMisplacedNav,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    deleteTransactionWithReversal, updateTransactionWithReversal,
    addAlert, deleteAlert,
    addLot, closeLotsFIFO, transferFunds, executeSaleAtomic, executeContribution,
    addPortfolio, deletePortfolio,
    addFinanceTransaction, updateFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    deleteFinanceTransactionsByIds,
    bulkImport,
    saveGoals, saveSettings, saveProfile, incomePlan, saveIncomePlan,
    enrichedItems, portfolioItems: rawPortfolioItems, entityTransactions, entityFinanceTransactions,
    marketPrices,
    pricesLoading, pricesError, pricesUpdate,
    rates, convert,
    ratesLoading, ratesError,
    handleRefresh,
    baseCurrency, netWorth, totalAssets, dailyChange, yearlyChange,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdCalibrated, ytdBreakdown, ytdBreakdownReason, ytdBreakdownDetail, ytdBreakdownTerms,
    annualDividends, estimatedAnnualIncome,
    netContributions, contributionsSummary, cashTotal, riskMetrics, insights, dataAge, contributionWarning, ytdDegradedAccounts,
    brokerCompletionState, ibkrDataComplete, inferredFlowCandidates, inferredFlowReconciliation, ibkrReconciliation, acceptInferredFlow, dismissInferredFlow,
    liquidYieldCandidates, acceptLiquidYield, dismissLiquidYield,
    benchmarkSymbol, benchmarkData, benchmarkReturn, benchmarkName, benchmarkLoading,
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
  const handleOpenGuided = useCallback(() => { setModal(null); setShowGuided(true) }, [])
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
    // Dentro del enfriamiento no se manda NADA: repetir el intento es lo que
    // alimenta el bloqueo de IBKR. Pero tampoco puede parecer que el botón está
    // muerto, así que se repite la explicación con cuánto falta.
    const remaining = ibkrCooldownRemainingMs(ibkrCooldownUntil)
    if (remaining > 0) {
      showToast(lang === 'es'
        ? `IBKR nos pidió esperar. Lo reintentamos ${formatCooldown(remaining, lang)}.`
        : `IBKR asked us to wait. We will retry ${formatCooldown(remaining, lang)}.`, 'warn', 4000)
      return
    }
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
          : `IBKR: ${res.count} positions but NO value history. Add "Equity Summary" to your Flex Query.`, 'warn', 6000)
      } else if (shortHistory) {
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · solo ${res.equityDays} días de historial (desde ${res.equityOldest}). El período del Flex Query sigue corto: ponlo en "Year to Date".`
          : `IBKR: ${res.count} positions · only ${res.equityDays} days of history (since ${res.equityOldest}). Your Flex Query period is still short: set it to "Year to Date".`, 'warn', 8000)
      } else if ((res.trades || 0) + (res.flows || 0) === 0) {
        // History arrived but zero trades/deposits: the query is missing the
        // Trades / Cash Transactions sections, so the rewound value curve and
        // deposit-aware returns cannot be built.
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · ${res.equityDays} días de historial, pero 0 trades y 0 depósitos. Agrega "Trades" y "Cash Transactions" a tu Flex Query.`
          : `IBKR: ${res.count} positions · ${res.equityDays} days of history but 0 trades and 0 deposits. Add "Trades" and "Cash Transactions" to your Flex Query.`, 'warn', 8000)
      } else {
        showToast(lang === 'es'
          ? `IBKR: ${res.count} posiciones · ${res.equityDays} días de historial · ${res.trades || 0} trades · ${res.flows || 0} depósitos/retiros · ${res.dividends || 0} dividendos`
          : `IBKR: ${res.count} positions · ${res.equityDays} days of history · ${res.trades || 0} trades · ${res.flows || 0} deposits/withdrawals · ${res.dividends || 0} dividends`, 'success', 7000)
      }
    } else if (res?.error === 'BUSY') {
      // a sync is already running; the spinning pill already communicates this
    } else if (res?.error !== 'NOT_CONNECTED') {
      // IBKR bloquea por intentos FALLIDOS, no por volumen, y este botón es el
      // único camino que se salta toda espera. Un token vencido produce el lazo
      // exacto que provoca el bloqueo: error, toque, error, toque. Así que un
      // fallo arma un enfriamiento, y si es algo que el usuario puede arreglar,
      // le abrimos la pantalla donde se arregla en vez de gastar otro intento.
      const fb = ibkrFailureFeedback(res?.errorCode, lang)
      setIbkrCooldownUntil(fb.cooldownMs > 0 ? Date.now() + fb.cooldownMs : 0)
      showToast(fb.message, fb.tone, 6000)
      if (fb.action === 'open-connection') setModal('ibkr')
    }
    // ⚠ showToast NO va en estas dependencias: está declarado con `const` MÁS
    // ABAJO en este mismo componente (línea ~505), y una deps array se evalúa
    // en CADA render, así que referenciarlo desde aquí arriba lanza un
    // ReferenceError de temporal dead zone ("Cannot access 'X' before
    // initialization") que tumba el dashboard entero antes de pintar nada.
    // Ya pasó en FASE HC con refetchBenchmark; esta es la segunda vez.
    // Omitirlo es seguro y es lo que este archivo hacía antes: showToast es un
    // useCallback con deps [], o sea su identidad nunca cambia.
  }, [ibkrConnected, ibkrAutoSyncing, triggerIBKRSync, lang, ibkrCooldownUntil])
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
  // FASE GM. El viaje continuo de IBKR: un orquestador que SECUENCIA los
  // modales existentes (conectar → archivo → foto → % → resumen) bajo una
  // barra de progreso fija, para que cerrar un paso AVANCE al siguiente en
  // vez de soltar al usuario en el dashboard sin saber si faltaban pasos
  // (el bug reportado). Ningún paso es obligatorio: "Saltar" avanza sin
  // hacerlo, "Salir" abandona el viaje. Reglas del usuario: secuencia
  // seguida, cero pop-ups inesperados, nunca de vuelta a la pantalla
  // principal a mitad del viaje.
  const [ibkrJourney, setIbkrJourney] = useState(null) // null | 1..5
  const ibkrJourneyRef = useRef(null)
  useEffect(() => { ibkrJourneyRef.current = ibkrJourney }, [ibkrJourney])
  // El avance real de IBKR (cuántos de los 4 requisitos están cumplidos y
  // cuál sigue), derivado del MISMO brokerCompletionState que alimenta al
  // checklist. Lo consumen la barra del viaje (checks en los círculos), el
  // panel de ConnectionsModal y el resumen final.
  const ibkrProgress = useMemo(() => ibkrJourneyProgress(brokerCompletionState), [brokerCompletionState])
  // Abrir un paso concreto del viaje, sin pasar por la secuencia. Es lo que
  // alimenta los círculos tocables de la barra y las filas del panel de
  // avance: el viaje es una secuencia SUGERIDA, y el usuario pidió poder
  // "tocar el que quiere editar". Una sola definición de qué modal abre cada
  // paso, para que saltar y avanzar no puedan discrepar.
  const openIbkrJourneyStep = useCallback((n) => {
    const step = Math.max(1, Math.min(5, Number(n) || 1))
    setIbkrJourney(step)
    setBrokerCompletionId(null)
    if (step !== 2) setImportBrokerHint(null)
    if (step === 1) setModal('ibkr')
    else if (step === 2) { setImportBrokerHint('ibkr'); setModal('import') }
    else if (step === 3) setModal('quarterly')
    else if (step === 4) setModal('calibrate')
    else { setModal(null); setTimeout(() => setBrokerCompletionId('ibkr'), 50) }
  }, [])
  const advanceIbkrJourney = useCallback((fromStep = null) => {
    const cur = ibkrJourneyRef.current
    if (cur == null) return
    // FASE GQ4: a step that auto-advances on its own success passes the step it
    // was scheduled FROM, so a late timer can never double-advance (skipping a
    // step) if the user already moved on by hand, skipped, or exited — it just
    // no-ops. Checked with typeof: this same function is wired straight to the
    // journey bar's "Skip" button (onClick={onSkip}), which calls it with a
    // MouseEvent, and a naive `!= null` test would swallow every skip click.
    if (typeof fromStep === 'number' && cur !== fromStep) return
    const next = cur + 1
    if (next > 5) { setIbkrJourney(null); setBrokerCompletionId(null); return }
    setIbkrJourney(next)
    if (next !== 2) setImportBrokerHint(null)
    if (next === 2) { setImportBrokerHint('ibkr'); setModal('import') }
    else if (next === 3) setModal('quarterly')
    else if (next === 4) setModal('calibrate')
    else if (next === 5) { setModal(null); setTimeout(() => setBrokerCompletionId('ibkr'), 50) }
  }, [])
  // FASE GQ4: finishing a step's actual work should carry the user forward on
  // its own — that is the whole point of the journey (FASE GM), and without it
  // a saved step just sits there with its primary button still reading "Save",
  // which is exactly what the user hit at step 3 ("se queda ahí y no pasa
  // automáticamente al siguiente paso"). The short pause is deliberate: it
  // leaves the confirmation line ("Listo: 14 trimestres guardados...") on
  // screen long enough to actually read before the next step replaces it.
  // Only data-entry steps use this. The upload step is NOT auto-advanced on
  // purpose: its done screen is a real report (how many positions, NAV days,
  // and the amber "no deposits arrived" warning of FASE GG) that the user
  // needs to read, and it fires its callback even on a failed import.
  const autoAdvanceIbkrJourney = useCallback((fromStep) => {
    if (ibkrJourneyRef.current !== fromStep) return
    setTimeout(() => advanceIbkrJourney(fromStep), IBKR_AUTO_ADVANCE_MS)
  }, [advanceIbkrJourney])
  // El argumento es opcional y se valida con typeof: este callback está
  // cableado directo a onClick en ConnectionsModal, así que recibe un
  // MouseEvent cuando nadie le pasa un paso (misma trampa que documenta
  // FASE GQ4 para advanceIbkrJourney).
  const startIbkrJourney = useCallback((n) => {
    openIbkrJourneyStep(typeof n === 'number' ? n : 1)
  }, [openIbkrJourneyStep])
  const exitIbkrJourney = useCallback(() => {
    setIbkrJourney(null)
    setModal(null)
    setImportBrokerHint(null)
    setBrokerCompletionId(null)
  }, [])

  // Con el viaje activo, cerrar el modal de un paso AVANZA al siguiente en
  // vez de terminar: la única salida explícita es el botón "Salir" de la
  // barra (exitIbkrJourney, que no pasa por aquí).
  const handleCloseModal = useCallback(() => {
    setModal(null); setImportBrokerHint(null)
    if (ibkrJourneyRef.current != null) advanceIbkrJourney()
  }, [advanceIbkrJourney])
  const handleCloseEdit = useCallback(() => setEditItem(null), [])
  const handleCloseSell = useCallback(() => setSellItem(null), [])
  // Vender era INALCANZABLE: SellModal solo se monta con un sellItem, y nada
  // en la app llamaba a setSellItem (el único caller previsto era el botón por
  // fila de AccountsTable, un componente que hoy no se renderiza en ningún
  // lado). Por eso "no sabía dónde registrar una venta" no era un problema de
  // descubrimiento sino de que el camino no existía. El picker elige la
  // posición y recién ahí abre el SellModal de siempre, sin tocar su lógica.
  const handleOpenSellPicker = useCallback(() => setModal('sellPicker'), [])
  const handlePickSellItem = useCallback((it) => { setModal(null); setSellItem(it) }, [])
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

  // FASE GO. El usuario pidió "desconexión completa": borrar la cuenta de
  // IBKR desde la ruedita debe dejarla exactamente como si nunca se hubiera
  // conectado, no solo sin historial (FASE GL) sino sin credenciales — sin
  // esto, reabrir el viaje mostraba "IBKR Conectado" con un resumen de
  // sync fantasma (262 días NAV, 317 trades) de una cuenta que ya no existe,
  // porque `deleteItemGroup` deliberadamente conservaba token/queryId. Esta
  // envoltura decide ANTES de borrar (con los items de HOY, mismo criterio
  // last-item que `ibkrGone` en accountCleanup) si el grupo se lleva el
  // último item de IBKR, y si es así corre la MISMA desconexión completa que
  // el botón "Desconectar IBKR" ya usa — un solo camino para "IBKR ya no
  // está", sin importar por cuál botón se llegó.
  const handleDeleteItemGroup = useCallback(async (ids) => {
    const idSet = new Set(ids)
    const groupHasIbkr = (items || []).some((it) => it && idSet.has(it.id) && it._source === 'ibkr')
    const survivesIbkr = (items || []).some((it) => it && !idSet.has(it.id) && it._source === 'ibkr')
    const ibkrGone = groupHasIbkr && !survivesIbkr
    const result = await deleteItemGroup(ids)
    if (ibkrGone) await handleIbkrDisconnect()
    return result
  }, [items, deleteItemGroup, handleIbkrDisconnect])

  // "Eliminar todo" se lleva TODAS las cuentas, IBKR incluida sin excepción:
  // misma desconexión completa, sin necesidad de calcular last-item.
  const handleDeleteAllItems = useCallback(async (opts) => {
    const hadIbkr = (items || []).some((it) => it && it._source === 'ibkr')
    const result = await deleteAllItems(opts)
    if (hadIbkr) await handleIbkrDisconnect()
    return result
  }, [items, deleteAllItems, handleIbkrDisconnect])

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
      showToast(`OAuth error: ${oauthError}`, 'warn', 5000)
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
        .catch(e => showToast(e.message, 'warn', 5000))
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
  // their own currency; the engine converts per-tx via `convert`). marketPrices
  // is passed so the price-completeness checks (no-market-price, no-cost-basis)
  // can tell "genuinely no price resolves for this symbol" apart from "this
  // market item's real price is resolved live and was never the right field to
  // read on the raw item" — without it, every working stock/crypto position
  // flagged as if its price were missing (it never IS the raw item's own field).
  // FASE HV11. El precio que la app YA muestra para cada ítem, por id. Es lo
  // que alimenta la gráfica y el Spreadsheet, así que preguntarle a ESTE mapa
  // "¿este activo tiene precio?" no puede contradecir lo que el usuario ve.
  // Antes solo se pasaba el mapa de precios por SÍMBOLO, y dos posiciones del
  // mismo activo con símbolos distintos daban respuestas distintas.
  const resolvedPrices = useMemo(() => {
    const out = {}
    for (const it of portfolioItems || []) {
      if (!it?.id) continue
      const p = Number(it._originalPrice ?? it.currentPrice) || 0
      if (p > 0) out[it.id] = p
    }
    return out
  }, [portfolioItems])

  const dataCompleteness = useMemo(
    () => analyzeDataCompleteness({
      items, transactions, lots, convert, baseCurrency, marketPrices, resolvedPrices,
      // Mientras la vuelta de precios está en curso o falló, "sin precio actual"
      // describe a la app, no a los datos del usuario. Ver el comentario en
      // lib/dataCompleteness.js.
      pricesReady: !pricesLoading && !pricesError,
    }),
    [items, transactions, lots, convert, baseCurrency, marketPrices, resolvedPrices, pricesLoading, pricesError]
  )

  // FASE HV. El rendimiento deducido de una cuenta líquida entra a la MISMA
  // lista de sugerencias que todo lo demás, en vez de estrenar una superficie
  // propia: es una pregunta sobre los datos, igual que las otras. Se arma acá y
  // no en `lib/dataCompleteness.js` porque ese módulo no conoce el motor de
  // rendimiento, y duplicarlo ahí sería tener dos respuestas distintas a la
  // misma pregunta.
  const suggestionFindings = useMemo(() => {
    const extra = (liquidYieldCandidates || []).map((c) => ({
      id: `liquid-yield:${c.itemId}`,
      code: 'liquid-yield',
      severity: c.status === 'negative-residual' ? 'medium' : 'low',
      itemId: c.itemId,
      textEs: c.status === 'negative-residual'
        ? `${c.name}: entró más de lo que hay en la cuenta. Puede faltar un retiro.`
        : `${c.name}: ${formatCurrency(c.interest, c.currency)} de tu saldo no vino de ningún movimiento. Parece rendimiento de la cuenta.`,
      textEn: c.status === 'negative-residual'
        ? `${c.name}: more went in than the account holds. A withdrawal may be missing.`
        : `${c.name}: ${formatCurrency(c.interest, c.currency)} of your balance came from no movement. It looks like the account's own yield.`,
      action: { kind: 'liquid-yield' },
      suggestion: null,
    }))
    return extra.length > 0 ? [...extra, ...dataCompleteness.findings] : dataCompleteness.findings
  }, [liquidYieldCandidates, dataCompleteness])

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
        items: enrichedItems, snapshots: augmentedSnapshots, transactions,
        netWorth, totalAssets, lang,
        returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdBreakdown, ytdBreakdownReason,
        annualDividends, estimatedAnnualIncome,
        benchmarkName, benchmarkReturn, volatilityPct: riskMetrics?.volatility,
        sharpe: riskMetrics?.sharpe, beta: riskMetrics?.beta,
        profileName: profile?.name || user?.displayName || '',
        baseCurrency, convert, period: 'ytd',
      })
      showToast(lang === 'es' ? 'PDF descargado' : 'PDF downloaded')
    } catch (err) {
      console.error('[report] generation failed:', err)
      showToast(lang === 'es' ? 'Error generando el PDF' : 'Error generating PDF')
    }
  }, [enrichedItems, augmentedSnapshots, transactions, lang, netWorth, totalAssets, returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdBreakdown, ytdBreakdownReason, annualDividends, estimatedAnnualIncome, benchmarkName, benchmarkReturn, riskMetrics, profile, user, showToast, baseCurrency, convert])

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
  // banner, the header pill and the actions card dot. They each used to decide on
  // their own (`ibkrSyncStatus === 'error'`), so a single transient failure lit up
  // a warning triangle over data synced hours ago.
  // FASE HX: la regla completa (5 días hábiles sin señal de conexión, para TODO
  // código de error, midiendo desde la marca MÁS RECIENTE) vive en
  // ibkrAttentionNeeded (components/dashboard/utils.js, puro y con tests), no
  // aquí: este memo solo la cablea a settings.
  const everIbkrSynced = !!(settings?._ibkrLastSync || settings?._ibkrLastAutoSync)
  const ibkrNeedsAttention = useMemo(() => ibkrAttentionNeeded({
    errorCode: ibkrSyncErrorCode,
    lastSync: settings?._ibkrLastSync,
    lastAutoSync: settings?._ibkrLastAutoSync,
    connectedAt: settings?._ibkrConnectedAt,
  }), [ibkrSyncErrorCode, settings?._ibkrLastSync, settings?._ibkrLastAutoSync, settings?._ibkrConnectedAt])

  const topBanner = useMemo(() => {
    // Nothing to be stale ABOUT on an empty account: a brand-new user opening the app
    // was greeted by an amber "exchange rates outdated" warning above the welcome
    // screen, which reads as "this is broken" before they've added anything.
    if (portfolioItems.length === 0) return null
    if (staleCode) return 'stale'
    // FASE HX: TODA rama de IBKR pasa por ibkrNeedsAttention (la regla de los
    // 5 días hábiles). TOKEN_EXPIRED/INVALID_QUERY salían aquí SIN esa
    // compuerta, así que un solo intento fallido con esos códigos encendía el
    // banner aunque la conexión hubiera funcionado ayer; ahora solo deciden el
    // COPY una vez que la barra se cruzó, no el momento en que aparece.
    if (ibkrNeedsAttention && ibkrSyncErrorCode === 'TOKEN_EXPIRED') return 'ibkr-expired'
    if (ibkrNeedsAttention && ibkrSyncErrorCode === 'INVALID_QUERY') return 'ibkr-query'
    // FASE GQ: a first connection that crossed the grace period without ever
    // landing a sync gets its OWN copy — "your credentials might be wrong"
    // instead of "the last sync failed" (that phrasing assumes at least one
    // sync happened). Checked before the general ibkrNeedsAttention branch
    // below so it takes priority over the generic wording for exactly this
    // case, never for an established connection that started failing.
    if (ibkrNeedsAttention && !everIbkrSynced && settings?._ibkrConnectedAt) return 'ibkr-never-connected'
    // LOCKED (and everything else) self-heals; ibkrNeedsAttention holds the
    // shared 5-business-day staleness rule so this banner can never disagree
    // with the header pill. LOCKED still gets its own more useful copy
    // ("generate a new token") once it actually crosses that bar, instead of
    // falling through to the generic "sync failed" wording.
    if (ibkrNeedsAttention) return ibkrSyncErrorCode === 'LOCKED' ? 'ibkr-locked' : 'ibkr-failed'
    if (pricesError || ratesError) return 'prices'
    // The contribution hint is not an alarm anywhere: it is one line inside the
    // "Completar información" flow (Nuevo menu), reachable when the user goes
    // looking. It used to sit under the YTD figure, where it read as a
    // complaint about the number itself.
    return null
  }, [staleCode, ibkrSyncErrorCode, ibkrNeedsAttention, everIbkrSynced, settings?._ibkrConnectedAt, pricesError, ratesError, portfolioItems.length])

  // Loading state — show the structural skeleton (same layout as the loaded page)
  // instead of a lone spinner, so first paint already looks like the dashboard.
  if (authLoading || (user && dataLoading)) {
    return <DashboardLoading />
  }

  if (!user) return null

  const loadStages = computeLoadStages({ dataLoading, ratesLoading, pricesLoading, benchmarkLoading })

  return (
    <div className="min-h-screen bg-theme-base">
      <a href="#main-content" className="skip-link">{lang === 'es' ? 'Ir al contenido' : 'Skip to content'}</a>
      {/* Jalar hacia abajo para actualizar. Solo acá: el gesto reemplaza al
          refresco NATIVO de Safari (la app no es PWA), y en el resto de las
          pantallas conviene conservarlo como salida de emergencia.
          Recibe EXACTAMENTE los mismos valores que el anillo del header de
          abajo, así los dos nunca pueden contar historias distintas. */}
      <PullToRefresh
        onRefresh={handleRefresh}
        loading={pricesLoading || ratesLoading || benchmarkLoading}
        error={!!(pricesError || ratesError)}
        stagesDone={loadStages.done}
        stagesTotal={loadStages.total}
        lang={lang}
      />
      <Header
        user={user} lang={lang}
        setLang={() => handleSetLang('toggle')}
        onImport={handleOpenImport}
        onSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        onRefresh={handleRefresh}
        // Same flags computeLoadStages counts as real stages below, so the
        // ring never sits at "idle" while one of them is still genuinely in
        // flight (e.g. rates/prices already landed but the benchmark hasn't).
        pricesLoading={pricesLoading || ratesLoading || benchmarkLoading}
        // Real stages, not a timer: your data, the exchange rates, the market
        // prices, the benchmark. The ring fills as each one actually lands.
        // dataLoading only ever goes true→false once (the very first load —
        // see lib/loadStages.js), so computeLoadStages stops counting it as a
        // stage the moment it resolves instead of leaving every later
        // refresh stuck with a permanent, meaningless floor.
        loadStagesDone={loadStages.done}
        loadStagesTotal={loadStages.total}
        // Reflects the SAME error signal the "prices" banner already uses
        // (see staleCode above) — the button's error state and the banner
        // can never disagree about whether the last refresh actually failed.
        // Both hooks clear their own error on the next fetch attempt, so a
        // retry click clears this automatically once the retry lands.
        refreshError={!!(pricesError || ratesError)}
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

      {/* Eran SIETE bloques de ~20 líneas escritos a mano, seis de ellos copias
          casi exactas que solo diferían en el texto, el rótulo del botón y si
          llevaban o no el link de "Desconectar". Ahora son datos: `PageBanner`
          pone la forma y esta tabla dice qué cambia en cada caso. El aviso de
          versión nueva además tenía su azul como rgba fijo en vez del token. */}
      {topBanner && (() => {
        const es = lang === 'es'
        const ibkrFix = { secondaryLabel: es ? 'Desconectar' : 'Disconnect', onSecondary: handleIbkrDisconnect, onAction: () => setModal('ibkr') }
        const BANNERS = {
          stale: {
            tone: 'brand', icon: 'refresh',
            message: es ? 'Hay una nueva versión disponible' : 'A new version is available',
            actionLabel: es ? 'Actualizar' : 'Update',
            onAction: () => {
              if (typeof caches !== 'undefined') caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
              window.location.reload()
            },
          },
          'ibkr-expired': {
            ...ibkrFix,
            message: es ? 'Tu token de IBKR expiró: genera uno nuevo para mantener tu portafolio actualizado' : 'Your IBKR token has expired: generate a new one to keep your portfolio updated',
            actionLabel: es ? 'Actualizar' : 'Update',
          },
          'ibkr-query': {
            ...ibkrFix,
            message: es ? 'Query ID de IBKR inválido: verifica tu Flex Query en IBKR' : 'Invalid IBKR Query ID: verify your Flex Query in IBKR',
            actionLabel: es ? 'Configurar' : 'Configure',
          },
          // FASE GQ: una primera conexión que nunca llegó a sincronizar ni una
          // vez. "La última sincronización falló" (ibkr-failed) da por hecho que
          // hubo AL MENOS una, así que esta copia apunta a las credenciales.
          // FASE HX: era rojo con botón rojo sólido, el tratamiento de una falla
          // mortal, para algo que el auto-sync sigue reintentando solo.
          'ibkr-never-connected': {
            ...ibkrFix,
            message: es ? 'No pudimos conectar con IBKR en los últimos días: revisa tu Token y Query ID' : "We couldn't connect to IBKR in the last few days: check your Token and Query ID",
            actionLabel: es ? 'Revisar credenciales' : 'Check credentials',
          },
          // FASE HX: mismo suavizado. LOCKED se levanta solo (EZ3: reintento
          // cada 12h), así que rojo-mortal era el tono equivocado incluso
          // cruzada la barra de 5 días.
          'ibkr-locked': {
            ...ibkrFix,
            message: es ? 'IBKR bloqueó tu token: genera uno NUEVO en IBKR o importa un CSV mientras tanto' : 'IBKR locked your token: generate a NEW one in IBKR or import a CSV in the meantime',
            actionLabel: es ? 'Resolver' : 'Resolve',
          },
          'ibkr-failed': {
            message: es ? 'La última sincronización con IBKR falló: tus datos pueden estar desactualizados' : 'The last IBKR sync failed: your data may be outdated',
            actionLabel: es ? 'Reintentar' : 'Retry',
            onAction: () => setModal('ibkr'),
          },
          prices: {
            message: pricesError && ratesError
              ? (es ? 'Precios y tasas desactualizados: error de conexión' : 'Prices and rates outdated: connection error')
              : pricesError
                ? (es ? 'Precios desactualizados: no se pudo conectar' : 'Prices outdated: could not connect')
                : (es ? 'Tasas de cambio desactualizadas' : 'Exchange rates outdated'),
            actionLabel: es ? 'Reintentar' : 'Retry',
            onAction: handleRefresh,
          },
        }
        const b = BANNERS[topBanner]
        if (!b) return null
        const { message, ...rest } = b
        return (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
            <PageBanner {...rest}>{message}</PageBanner>
          </div>
        )
      })()}

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
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
        <NotificationCenter items={portfolioItems} transactions={transactions} lang={lang} settings={settings} convert={convert} baseCurrency={baseCurrency} />
        <div className="flex items-center gap-3 flex-wrap">
          {/* A refresh in flight gets its OWN small confirmation right next to
              the freshness text — the header button already shows full
              progress, this is a second, lightweight "yes, it's really
              happening" cue for whoever's looking at the body instead of the
              header. Inline, tiny, never blocks the row it sits in. */}
          {(pricesLoading || ratesLoading) && (
            <ChispudoLoader mode="inline" size="small" state="refreshing" delay={250} lang={lang} />
          )}
          {/* Freshness dot: 1-day-old data is normal (snapshots are daily), so
              1-13d stays neutral/muted — amber only kicks in at ≥14d. */}
          {dataAge === 0 ? (
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          ) : dataAge != null && dataAge >= 14 ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--alert-warn-icon)' }} />
          ) : (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--text-muted)' }} />
          )}
          <span className="text-xs" style={{ color: dataAge != null && dataAge >= 14 ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
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
            // Con cero activos, "agregar" significa el recorrido guiado: el
            // formulario largo sigue disponible desde el botón "Nuevo".
            onAdd={handleOpenGuided}
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
        <div className="stagger-1 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6 items-stretch">
          <div className="md:col-span-1 lg:col-span-2 flex flex-col gap-4">
            <CardBoundary id="OL-01" className="h-full">
            <NetWorthCard
              netWorth={netWorth} returnYTD={returnYTD} ytdChange={ytdChange}
              returnSinceStart={returnSinceStart} sinceStartDate={sinceStartDate}
              dailyChange={dailyChange} convert={convert}
              lang={lang} netContributions={netContributions} cashTotal={cashTotal} snapshots={augmentedSnapshots} items={portfolioItems}
              ytdCalibrated={ytdCalibrated} ytdBreakdown={ytdBreakdown} ytdBreakdownReason={ytdBreakdownReason} ytdBreakdownDetail={ytdBreakdownDetail} ytdBreakdownTerms={ytdBreakdownTerms}
              ytdDegradedAccounts={ytdDegradedAccounts}
            />
            </CardBoundary>
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex flex-col gap-4">
            <CardBoundary id="OR-01"><PortfolioGrowthChart items={portfolioItems} lots={lots} snapshots={chartSnapshots} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} onSaveSnapshot={saveSnapshot} ibkrSyncSummary={ibkrSyncSummary} onImportBroker={handleOpenImport} repairItems={enrichedItems} repairSnapshots={snapshots} onMigrateNav={migrateMisplacedNav} /></CardBoundary>
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
                findings={suggestionFindings}
                globalScore={dataCompleteness.globalScore}
                items={items}
                lang={lang}
                onEditItem={setEditItem}
                onOpenCashflow={handleOpenCashflowPrefilled}
                onOpenReview={handleOpenReview}
                onOpenLiquidYield={() => setModal('liquidYield')}
                onConfirmDistinct={(f) => {
                  (f.action?.itemIds || []).forEach((id) => updateItem(id, { _dupConfirmedDistinct: true }))
                }}
                onApplySuggestion={updateItem}
              />
            </CardBoundary>
          )
          return (
            <>
              {hasHigh && suggestionsCard}

              {/* ═══ COMPOSICIÓN: Allocation + Rendimiento por institución ═══
                  Dos COLUMNAS independientes, no una grilla por filas: en una
                  grilla, la fila 2 arranca donde termina la card más alta de la
                  fila 1, y una card corta (Price Alerts vacía) quedaba flotando
                  con un hueco blanco enorme debajo. Cada columna empaqueta sus
                  cards una tras otra, sin huecos; en móvil colapsa a una sola
                  columna en el orden natural de lectura. */}
              {/* Sin items-start: las dos columnas estiran al mismo alto y la
                  última card de cada una toma el sobrante (flex-1 + h-full
                  adentro), así el bloque cierra en una línea pareja en vez de
                  un borde inferior disparejo. */}
              <div className="stagger-3 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                <div className="flex flex-col gap-4 sm:gap-6 min-w-0">
                  <CardBoundary id="OR-02"><AssetAllocation items={portfolioItems} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} ibkrDataComplete={ibkrDataComplete} /></CardBoundary>
                  <CardBoundary id="INV-01" className="flex-1"><InvestedByYearCard transactions={transactions} items={items} snapshots={augmentedSnapshots} netWorth={netWorth} returnYTD={returnYTD} ytdChange={ytdChange} convert={convert} baseCurrency={baseCurrency} lang={lang} /></CardBoundary>
                </div>
                <div className="flex flex-col gap-4 sm:gap-6 min-w-0">
                  {/* Aquí vivía InstitutionPerformance (INST-01). Se dejó de
                      montar porque sus seis filas repetían, número por número,
                      lo que ya muestra la vista "Inst." de Asignación de
                      Activos; el conteo de posiciones y el badge de historial
                      de IBKR, que solo estaban ahí, se movieron a esa vista.
                      El componente y su fórmula no se tocaron y siguen en
                      disco: volver a montarlo es una línea. */}
                  <CardBoundary id="AN-00">
                    <AnalysisTabs
                      lang={lang} portfolioItems={portfolioItems} netWorth={netWorth} totalAssets={totalAssets}
                      snapshots={augmentedSnapshots} lots={lots} transactions={transactions}
                      convert={convert} baseCurrency={baseCurrency} rates={rates}
                      benchmarkData={benchmarkData} benchmarkName={benchmarkName}
                      benchmarkReturn={benchmarkReturn} portfolioReturn={returnYTD}
                      volatility={riskMetrics?.volatility} goalValue={goals?.portfolioGoal}
                      beginnerMode={beginnerMode}
                      onConnect={handleOpenConnections} onImportBroker={handleOpenImport}
                    />
                  </CardBoundary>
                  {/* Las acciones viven DENTRO del marco, a la altura de
                      "Invertido por año", en vez de una barra de botones
                      sueltos debajo de las tarjetas. Las alertas de precio
                      son una acción más (abren su modal) en vez de una card
                      casi siempre vacía ocupando media columna. */}
                  <CardBoundary id="ACT-01" className="flex-1">
                    <QuickActionsCard
                      onImport={handleOpenImport} onAddAccount={handleOpenAccount}
                      onTransfer={handleOpenTransfer} onCashFlow={handleOpenCashflow}
                      onSell={handleOpenSellPicker} onPriceAlerts={() => setModal('priceAlerts')}
                      onExport={handleExport} onShare={handleShare}
                      onIntegrations={handleOpenConnections} onReview={handleOpenReview}
                      itemCount={enrichedItems.length} alertCount={(alerts || []).length} lang={lang}
                      ibkrSyncStatus={ibkrSyncStatus} ibkrLastSync={ibkrLastSync} ibkrNeedsAttention={ibkrNeedsAttention}
                    />
                  </CardBoundary>
                </div>
              </div>

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
              <div className="card px-4 py-2.5 mb-3 grid grid-cols-3 gap-3">
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
            <CardBoundary id="HO-02"><RecentTransactions transactions={transactions} items={items} lang={lang} convert={convert} baseCurrency={baseCurrency} onExportCSV={handleExportTransactionsCSV} onDeleteTransaction={deleteTransactionWithReversal} /></CardBoundary>
            {/* DataQualityCard (HO-03) se movió a la pestaña "Calidad" de la
                card de Análisis: mide qué tan confiable es tu historia, que es
                análisis, no actividad reciente. */}
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
        {/* La sección "Análisis" que vivía aquí abajo se movió arriba, a la
            grilla de composición, como card hermana de Asignación de Activos.
            Estaba repetida al dejarla en los dos lugares. */}
        </SectionCollapse></div>

        {/* ═══ PROYECCIONES ═══ — lo único de esta página que mira hacia
            ADELANTE. Va al final a propósito: todo lo de arriba mide lo que
            pasó, y esto es un supuesto. El comparador de inversiones se suma
            acá arriba. */}
        <div className="stagger-6"><SectionCollapse title={lang === 'es' ? 'Proyecciones' : 'Projections'} id="projections" defaultOpen={false}>
          <ErrorBoundary lang={lang}>
            <CardBoundary id="PROJ-01">
              <InvestmentComparator
                scenarios={settings?.investmentScenarios}
                onSave={(list) => saveSettings({ ...settings, investmentScenarios: list })}
                netWorth={netWorth}
                baseCurrency={baseCurrency}
                lang={lang}
              />
            </CardBoundary>
            <CardBoundary id="PROJ-02">
              <WealthProjectionCard
                netWorth={netWorth}
                plan={incomePlan}
                onSavePlan={saveIncomePlan}
                financeTransactions={entityFinanceTransactions}
                profile={profile}
                convert={convert}
                baseCurrency={baseCurrency}
                returnSinceStart={returnSinceStart}
                sinceStartDate={sinceStartDate}
                onOpenFlow={() => router.push('/finances')}
                lang={lang}
              />
            </CardBoundary>
          </ErrorBoundary>
        </SectionCollapse></div>

        <InstallPrompt lang={lang} />

        <div className="flex items-center justify-center gap-3 pt-4 pb-8">
          {/* Una sola entrada (FASE HT): el modal trae período, vista previa,
              Imprimir y Descargar PDF, todos sobre los mismos datos. */}
          <button onClick={handleOpenPrint}
            className="px-5 py-2.5 text-sm font-medium text-slate-400 bg-theme-surface border border-glass-border/60 rounded-xl hover:bg-theme-elevated hover:text-white hover:border-[var(--text-muted)] transition-all inline-flex items-center gap-2">
            {lang === 'es' ? 'Generar reporte' : 'Generate report'}
          </button>
        </div>

        </>}
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={handleCloseModal} onImportItems={addItem}
          onImportTransaction={addTransaction} onImportSnapshot={saveSnapshot}
          onAddLot={addLot} onAddFinanceTransaction={addFinanceTransaction} onUpdateFinanceTransaction={updateFinanceTransaction}
          existingFinanceTransactions={financeTransactions}
          onUpdateItem={updateItem} onDeleteItem={deleteItem} onBulkImport={bulkImport}
          existingItems={items} existingLots={lots}
          activePortfolio={activePortfolio} activeEntity={activeEntity !== '__all__' ? activeEntity : 'default'}
          lang={lang} brokerHint={importBrokerHint} journeyActive={ibkrJourney != null}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={handleCloseModal}
          onAdd={async (item) => {
            // ⛔ LÓGICA CONGELADA (G). Ver
            // lib/assetLogic/corporateBondWithEntryFee.js: PREGUNTAR antes de
            // cambiar este wrapper.
            // MUST return the new id: AddAccountModal links the opening DEPOSIT
            // to it (_linkedItemId). Swallowing it left that deposit "sin
            // vincular", which is not cosmetic — every engine that asks "what
            // explains this account's balance" keys on _linkedItemId, so the
            // account read as having no history at all (FASE EA).
            const id = await addItem(item)
            showToast(lang === 'es' ? `${item.symbol || item.name} agregado` : `${item.symbol || item.name} added`)
            return id
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

      {modal === 'sellPicker' && (
        <SellPickerModal
          items={portfolioItems} onPick={handlePickSellItem} onClose={handleCloseModal}
          lang={lang} baseCurrency={baseCurrency}
        />
      )}

      {modal === 'priceAlerts' && (
        <PriceAlertsModal
          items={portfolioItems} alerts={alerts} marketPrices={marketPrices}
          addAlert={addAlert} deleteAlert={deleteAlert} lang={lang} onClose={handleCloseModal}
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

      {/* FASE GM: la barra fija del viaje continuo de IBKR, dibujada ENCIMA
          del modal del paso activo. Lleva el hilo (Paso X de 5), permite
          saltar el paso o salir del viaje, y garantiza que ningún cierre de
          modal deje al usuario en el dashboard preguntándose si faltaban
          pasos. */}
      {ibkrJourney != null && (
        <IBKRJourneyBar
          step={ibkrJourney}
          total={5}
          title={[
            lang === 'es' ? 'Conectar por API' : 'Connect via API',
            lang === 'es' ? 'Subir tu Flex XML' : 'Upload your Flex XML',
            lang === 'es' ? 'Transcribir tu foto de PortfolioAnalyst' : 'Transcribe your PortfolioAnalyst screenshot',
            lang === 'es' ? 'Copiar tus retornos (%)' : 'Copy your returns (%)',
            lang === 'es' ? 'Resumen y conciliación' : 'Summary and reconciliation',
          ][ibkrJourney - 1]}
          onSkip={advanceIbkrJourney}
          onExit={exitIbkrJourney}
          onJump={openIbkrJourneyStep}
          doneSteps={ibkrProgress.steps.filter((s) => s.done).map((s) => s.step)}
          lang={lang}
        />
      )}

      {modal === 'ibkr' && (
        <IBKRSyncModal
          onClose={() => {
            const justConnected = !ibkrWasConnectedRef.current && ibkrConnected
            handleCloseModal()
            // Greet a brand-new connection with the checklist, once — a routine
            // re-sync (already connected before opening) never triggers it.
            // Inside the FASE GM journey the checklist IS the final step, so
            // the auto-open would collide with the sequence: skip it there.
            if (justConnected && ibkrJourneyRef.current == null) setTimeout(() => setBrokerCompletionId('ibkr'), 50)
          }}
          onSyncComplete={async (data, mode, onProgress) => {
            await handleIBKRSync(data, mode, onProgress)
            showToast(lang === 'es' ? `IBKR: ${data.items?.length || 0} posiciones sincronizadas` : `IBKR: ${data.items?.length || 0} positions synced`)
          }}
          savedToken={settings?.ibkrToken || ''} savedQueryId={settings?.ibkrQueryId || ''}
          vaultMigrated={!!settings?._ibkrVaultMigrated} syncSummary={ibkrSyncSummary}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null, _ibkrAutoSyncFailCount: 0 }) }}
          // FASE GQ: fired by the non-blocking first-connect (handleQuickConnect
          // in IBKRSyncModal) BEFORE any sync has actually run — deliberately
          // does NOT stamp _ibkrLastSync (that would lie about a sync that
          // hasn't happened) and instead stamps _ibkrConnectedAt, one of the
          // clocks ibkrNeedsAttention's 5-business-day rule reads above. Once
          // saved, the existing auto-sync effect (useDashboardData) picks up
          // the new credentials on its own next render — no separate trigger
          // call needed here.
          // FASE HX: SIEMPRE se estampa la hora actual (antes preservaba la
          // marca vieja con `settings?._ibkrConnectedAt ||`): re-guardar
          // credenciales es un intento de conexión fresco y reinicia el
          // fusible de 5 días; con la preservación, "me reconecté ayer" no
          // apagaba una alarma cuyo reloj seguía corriendo desde el primer
          // intento. No puede spamear escrituras: handleQuickConnect corre a
          // lo sumo una vez por apertura del modal (autoStartedRef).
          onSaveCredentialsPending={(creds) => { saveSettings({ ...creds, _ibkrConnectedAt: new Date().toISOString(), _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null, _ibkrAutoSyncFailCount: 0 }) }}
          onApiSyncSuccess={() => { saveSettings({ _ibkrLastSync: new Date().toISOString(), _ibkrAutoSyncStatus: 'ok', _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null }) }}
          onDisconnect={handleIbkrDisconnect}
          uid={user?.uid} lang={lang}
          journeyActive={ibkrJourney != null}
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
          transactions={transactions}
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
          userEmail={user?.email || ''}
          onSaveSettings={saveSettings}
          onDeleteAllItems={handleDeleteAllItems} onDeleteAllSnapshots={deleteAllSnapshots}
          onDeleteAllTransactions={deleteAllTransactions}
          onDeleteAllFinanceTransactions={deleteAllFinanceTransactions}
          onDeleteFinanceTransactionsByIds={deleteFinanceTransactionsByIds}
          financeTransactions={financeTransactions}
          onDeleteItemGroup={handleDeleteItemGroup}
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
          onStartIbkrJourney={startIbkrJourney}
          ibkrProgress={ibkrProgress}
          onOpenIbkrStep={openIbkrJourneyStep}
          onBackgroundSync={handleIBKRPillClick}
          onImport={handleOpenImport}
          onAddAccount={handleOpenAccount}
          onOpenBlockchain={handleOpenBlockchain}
          onOpenLedger={() => setModal('ledger')}
          onCalibrate={() => setModal('calibrate')}
          onOpenBrokerChecklist={(brokerId) => setBrokerCompletionId(brokerId)}
          onSaveCredentials={(creds) => { saveSettings({ ...creds, _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null, _ibkrAutoSyncFailCount: 0 }) }}
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
          snapshots={augmentedSnapshots} transactions={transactions}
          returnYTD={returnYTD} ytdChange={ytdChange}
          returnSinceStart={returnSinceStart} sinceStartDate={sinceStartDate}
          ytdBreakdown={ytdBreakdown} ytdBreakdownReason={ytdBreakdownReason}
          annualDividends={annualDividends}
          estimatedAnnualIncome={estimatedAnnualIncome}
          benchmarkName={benchmarkName} benchmarkReturn={benchmarkReturn}
          volatilityPct={riskMetrics?.volatility}
          sharpe={riskMetrics?.sharpe} beta={riskMetrics?.beta}
          baseCurrency={baseCurrency} convert={convert}
          profileName={profile?.name || user?.displayName || ''}
          lang={lang} onClose={handleCloseModal} />
      )}

      {modal === 'calibrate' && (
        <CalibrateReturnModal
          netWorth={netWorth} transactions={transactions} convert={convert} baseCurrency={baseCurrency}
          snapshots={snapshots} accountSnapshots={accountCalibrations} items={portfolioItems}
          saveSnapshot={saveSnapshot} deleteSnapshot={deleteSnapshot}
          lang={lang} onClose={handleCloseModal}
          // Inside the IBKR walkthrough the account being onboarded IS IBKR.
          preferredAccount={ibkrJourney != null ? 'ibkr' : null}
          onSaved={() => autoAdvanceIbkrJourney(4)} />
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
          onDeleteTransaction={deleteTransactionWithReversal}
          onUpdateTransaction={updateTransactionWithReversal}
          onExecuteContribution={executeContribution}
          onCreateDestination={addItem}
          transactions={transactions}
          baseCurrency={baseCurrency}
          convert={convert}
          existingItems={items} lang={lang}
          allItems={portfolioItems}
          findings={dataCompleteness.findings}
          onOpenCashflow={handleOpenCashflowPrefilled}
          /* FASE HV3. Guardar cierra y devuelve al dashboard, punto.
           *
           * Antes, `onNavigate('next')` saltaba a la cuenta SIGUIENTE por
           * tamaño apenas se guardaba. Reportado por el usuario: arregló su
           * fondo líquido desde "Chispu te sugiere", guardó, y aterrizó
           * editando su Bitcoin sin haberlo pedido ("me quedé confundido").
           * No era aleatorio: el fondo vale $327.89 y Bitcoin $294.05, o sea
           * era literalmente la siguiente cuenta hacia abajo.
           *
           * El encadenado tenía sentido como barrido de "revisá todas tus
           * cuentas", pero ese barrido ya existe aparte y es AccountReviewModal,
           * que hace su propio paso a paso y por eso ya desactivaba esto
           * (`showReview ? null : ...`). O sea el encadenado solo llegaba a
           * dispararse desde el único lugar donde está mal: una corrección
           * puntual de UNA cuenta. Sin el prop, el botón además deja de decir
           * "Guardar →" y dice "Guardar", que es lo que de verdad hace.
           */ />
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
          onConfirmDistinct={(f) => {
            (f.action?.itemIds || []).forEach((id) => updateItem(id, { _dupConfirmedDistinct: true }))
          }}
          onApplySuggestion={updateItem}
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
          saveSettings={saveSettings}
          convert={convert}
          baseCurrency={baseCurrency}
          snapshots={snapshots}
          lang={lang}
          onClose={handleCloseModal}
          onSaved={(n) => {
            showToast(lang === 'es' ? `${n} trimestres guardados` : `${n} quarters saved`, 'success')
            autoAdvanceIbkrJourney(3)
          }}
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
          onClose={() => { setBrokerCompletionId(null); setIbkrJourney(null) }}
          completionState={brokerCompletionState}
          progress={brokerCompletionId === 'ibkr' ? ibkrProgress : null}
          onOpenStep={openIbkrJourneyStep}
          onConnect={() => setModal('ibkr')}
          onImportHistory={() => handleOpenImport('ibkr')}
          onQuarterlyHistory={handleOpenQuarterly}
          onCalibrate={() => setModal('calibrate')}
          inferredFlowCount={inferredFlowCandidates.length}
          onReviewInferredFlows={() => setModal('inferredFlows')}
          reconciliation={ibkrReconciliation}
        />
      )}

      {modal === 'inferredFlows' && (
        <InferredFlowsModal
          candidates={inferredFlowCandidates}
          reconciliation={inferredFlowReconciliation}
          lang={lang}
          onClose={handleCloseModal}
          onAccept={async (c) => {
            await acceptInferredFlow(c)
            showToast(lang === 'es' ? 'Movimiento registrado' : 'Movement recorded', 'success')
          }}
          onDismiss={dismissInferredFlow}
        />
      )}

      {modal === 'liquidYield' && (
        <LiquidYieldModal
          candidates={liquidYieldCandidates}
          lang={lang}
          // setModal(null) y no handleCloseModal a propósito: con un viaje de
          // IBKR activo, cerrar por ahí AVANZA el paso (FASE GM), y este modal
          // no es parte de ese viaje.
          onClose={() => setModal(null)}
          onAccept={async (c) => {
            await acceptLiquidYield(c)
            showToast(lang === 'es' ? 'Rendimiento registrado' : 'Yield recorded', 'success')
          }}
          onDismiss={dismissLiquidYield}
          // Los dos desenlaces posibles de mirar el desglose, cada uno a la
          // pantalla que ya sabe hacer ese trabajo: falta una salida (Cash Flow,
          // con el monto del descuadre ya puesto y la fecha a cargo del usuario,
          // que es el único dato que la app no puede saber), o sobra una fila
          // (el editor de la cuenta, la única superficie que revierte bien el
          // crédito que ese pago movió, vía deleteTransactionWithReversal).
          onRegisterMissing={(c) => {
            setModal(null)
            handleOpenCashflowPrefilled({
              flowType: 'WITHDRAWAL', origin: 'external', linkedId: c.itemId,
              amount: Math.abs(c.interest), currency: c.currency, date: '',
            })
          }}
          onOpenAccount={(c) => {
            setModal(null)
            const it = items.find((i) => i.id === c.itemId)
            if (it) setEditItem(it)
          }}
          // "Esto no pasó": borrar una fila del desglose, sin cerrar la pantalla.
          //
          // Lo importante no es el borrado sino lo que va ANTES: un pago que
          // escribió el motor automático se vuelve a escribir solo en la
          // siguiente corrida, porque su calendario sigue diciendo que ese mes
          // paga. Borrarlo a secas no sirve de nada: reaparece. Por eso la fecha
          // se agrega primero a `excludedPayDates` del activo que lo produce,
          // que es el mecanismo que ya existe para "esta fecha NO ocurrió"
          // (hoy solo se podía marcar al crear la cuenta, nunca después).
          //
          // El borrado va por deleteTransactionWithReversal, la única vía que
          // además revierte el crédito que ese pago pudo haber movido en la
          // cuenta destino.
          onDeleteMovement={async (m, c) => {
            if (!m?.txId) return
            try {
              // Una sola vía de borrado para todas las pantallas: marcar el mes
              // como "no pagó" vive DENTRO de deleteTransactionWithReversal, así
              // que no hay una copia acá que se pueda quedar atrás.
              //
              // Lo único propio de esta pantalla: un movimiento ANTERIOR a la
              // fecha del saldo no puede mover ese saldo. El usuario lo tecleó
              // leyendo su estado de cuenta, así que ya refleja lo que de verdad
              // pasó, haya acreditado la app ese cupón o no. Es el invariante 1
              // de lib/assetLogic/liquidFundYield.js. Uno POSTERIOR a la foto sí
              // se revierte, porque ese llegó después.
              const afterPhoto = c?.asOfTs != null && Number.isFinite(m.ts) && m.ts > c.asOfTs
              await deleteTransactionWithReversal(m.txId, { skipBalanceReversal: !afterPhoto })
            } catch (err) {
              // Un borrado que falla NO puede quedarse mudo: la fila desaparece
              // de la lista igual (se recalcula sola) y el usuario cree que
              // guardó, hasta que recarga y todo volvió.
              showToast(lang === 'es'
                ? `No se pudo borrar el movimiento: ${err.message}`
                : `Could not delete the movement: ${err.message}`, 'error')
            }
          }}
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
            // Un usuario nuevo que dice "agregar mi primer activo" no puede
            // aterrizar en el formulario largo: ese es el momento exacto en que
            // más ayuda necesita. Va al recorrido guiado.
            if (action === 'add') handleOpenGuided()
            else if (action === 'settings') setModal('settings')
          }}
          onComplete={() => setShowOnboarding(false)}
          onSeedDemo={handleSeedDemo}
          onClearDemo={handleClearDemo}
          demoActive={isDemoMode}
        />
      )}

      {showGuided && (
        <GuidedSetup
          onClose={() => setShowGuided(false)}
          onAdd={async (item) => {
            // Mismo wrapper que el alta manual: DEBE devolver el id o el
            // depósito de apertura nace huérfano (⛔ lógica congelada G).
            const id = await addItem(item)
            showToast(lang === 'es' ? `${item.symbol || item.name} agregado` : `${item.symbol || item.name} added`)
            return id
          }}
          onAddTransaction={addTransaction} onAddLot={addLot}
          onCreateDestination={addItem}
          existingItems={items} activePortfolio={activePortfolio}
          activeEntity={activeEntity !== '__all__' ? activeEntity : 'default'}
          onConnectBroker={handleOpenConnections}
          lang={lang}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium animate-fade-in border"
          role="status"
          aria-live="polite"
          style={toastStyleFor(toast.type)}>
          <span>{toastIconFor(toast.type)}</span>
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
