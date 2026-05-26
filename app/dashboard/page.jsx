'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import { useMarketPrices } from '@/hooks/useMarketPrices'
import { useExchangeRates } from '@/hooks/useExchangeRates'
import { authFetch } from '@/lib/authFetch'

import { setBaseCurrency, setLang as setUtilsLang, computeModifiedDietz, getItemValue, formatCurrency, getTypeCategory, getInvestmentClass } from '@/components/dashboard/utils'
import { computeNetContributions, computePeriodicReturns, computeSharpeRatio, computeVolatility, computeMaxDrawdown, computeHHI, generateInsights, computeAssetAttribution } from '@/components/dashboard/analytics'
import { useBenchmark } from '@/hooks/useBenchmark'
import Header from '@/components/dashboard/Header'
import NetWorthCard from '@/components/dashboard/NetWorthCard'
import TopMovers from '@/components/dashboard/TopMovers'
import ActionButtons from '@/components/dashboard/ActionButtons'
import SectionCollapse from '@/components/dashboard/SectionCollapse'
import MobileNav from '@/components/dashboard/MobileNav'
import ErrorBanner from '@/components/dashboard/ErrorBanner'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SkeletonCard, SkeletonChart, SkeletonTable } from '@/components/dashboard/Skeleton'
import { checkPriceAlerts } from '@/lib/notifications'

const FileImportModal = dynamic(() => import('@/components/FileImportModal'))
const AddAccountModal = dynamic(() => import('@/components/AddAccountModal'))
const SellModal = dynamic(() => import('@/components/SellModal'))
const TransferModal = dynamic(() => import('@/components/TransferModal'))
const IBKRSyncModal = dynamic(() => import('@/components/IBKRSyncModal'))
const SettingsModal = dynamic(() => import('@/components/SettingsModal'))
const EditAccountModal = dynamic(() => import('@/components/EditAccountModal'))
const OptimizeModal = dynamic(() => import('@/components/OptimizeModal'))
const AssetDetailModal = dynamic(() => import('@/components/dashboard/AssetDetailModal'))
const PrintSummary = dynamic(() => import('@/components/dashboard/PrintSummary'))
const OnboardingTour = dynamic(() => import('@/components/dashboard/OnboardingTour'))
const CommandPalette = dynamic(() => import('@/components/dashboard/CommandPalette'))

const PortfolioGrowthChart = dynamic(() => import('@/components/dashboard/PortfolioGrowthChart'), { loading: () => <SkeletonChart /> })
const AccountsTable = dynamic(() => import('@/components/dashboard/AccountsTable'), { loading: () => <SkeletonTable /> })
const PerformanceSummary = dynamic(() => import('@/components/dashboard/PerformanceSummary'), { loading: () => <SkeletonCard /> })
const DividendIncome = dynamic(() => import('@/components/dashboard/DividendIncome'), { loading: () => <SkeletonCard /> })
const ProjectionSimulator = dynamic(() => import('@/components/dashboard/ProjectionSimulator'), { loading: () => <SkeletonChart /> })
const RiskMetrics = dynamic(() => import('@/components/dashboard/RiskMetrics'), { loading: () => <SkeletonCard /> })
const MonthlyPerformance = dynamic(() => import('@/components/dashboard/MonthlyPerformance'), { loading: () => <SkeletonChart /> })
const RebalanceSuggestions = dynamic(() => import('@/components/dashboard/RebalanceSuggestions'), { loading: () => <SkeletonCard /> })
const GainsReport = dynamic(() => import('@/components/dashboard/GainsReport'), { loading: () => <SkeletonCard /> })

import FinancialHealth from '@/components/dashboard/FinancialHealth'
import RecentTransactions from '@/components/dashboard/RecentTransactions'
import AssetAllocation from '@/components/dashboard/AssetAllocation'
import InvestmentClassBreakdown from '@/components/dashboard/InvestmentClassBreakdown'
import ConcentrationRisk from '@/components/dashboard/ConcentrationRisk'
import GoalTracker from '@/components/dashboard/GoalTracker'
import BenchmarkComparison from '@/components/dashboard/BenchmarkComparison'
import InsightsBanner from '@/components/dashboard/InsightsBanner'
import CurrencyImpact from '@/components/dashboard/CurrencyImpact'
import UpcomingDividends from '@/components/dashboard/UpcomingDividends'
import ContinuousYieldDisplay from '@/components/dashboard/ContinuousYieldDisplay'
import VariableRateDashboard from '@/components/dashboard/VariableRateDashboard'
import MaturityCalendar from '@/components/dashboard/MaturityCalendar'
import IncomeCalendar from '@/components/dashboard/IncomeCalendar'
import Watchlist from '@/components/dashboard/Watchlist'
import NotificationCenter from '@/components/dashboard/NotificationCenter'
import RecurringTransactions from '@/components/dashboard/RecurringTransactions'
import FeeAnalysis from '@/components/dashboard/FeeAnalysis'
import DataQuality from '@/components/dashboard/DataQuality'
import InstallPrompt from '@/components/dashboard/InstallPrompt'
import EmptyState from '@/components/dashboard/EmptyState'
import SnapshotComparison from '@/components/dashboard/SnapshotComparison'
import SavingsRate from '@/components/dashboard/SavingsRate'
import PerformanceAttribution from '@/components/dashboard/PerformanceAttribution'
import ValueBreakdown from '@/components/dashboard/ValueBreakdown'
import PriceAlerts from '@/components/dashboard/PriceAlerts'
import PortfolioSelector from '@/components/dashboard/PortfolioSelector'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [sellItem, setSellItem] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [theme, setTheme] = useState('system')
  const [lang, setLang] = useState('es')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePortfolio, setActivePortfolio] = useState('__all__')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
      const savedTheme = localStorage.getItem('chispudo-theme')
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setTheme(savedTheme)
      }
      function applyTheme(t) {
        if (t === 'system') {
          const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          document.documentElement.setAttribute('data-theme', sys)
        } else {
          document.documentElement.setAttribute('data-theme', t)
        }
      }
      applyTheme(savedTheme || 'system')

      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        const current = localStorage.getItem('chispudo-theme')
        if (!current || current === 'system') {
          document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
        }
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

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)

  useEffect(() => {
    let unsubscribe = () => {}
    let refreshInterval = null
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
    function setCookie(token) {
      document.cookie = `__session=${token}; path=/; max-age=3600; SameSite=Lax${secure}`
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
                const freshToken = await currentUser.getIdToken(true)
                setCookie(freshToken)
              } catch {}
            }, 50 * 60 * 1000)
          }
        }
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => { unsubscribe(); if (refreshInterval) clearInterval(refreshInterval) }
  }, [router])

  const {
    items,
    snapshots,
    transactions,
    goals,
    settings,
    loading: dataLoading,
    addItem,
    updateItem,
    deleteItem,
    deleteAllItems,
    saveSnapshot,
    deleteAllSnapshots,
    addTransaction,
    deleteAllTransactions,
    alerts,
    addAlert,
    deleteAlert,
    updateAlert,
    lots,
    addLot,
    closeLotsFIFO,
    portfolios,
    addPortfolio,
    deletePortfolio,
    financeTransactions,
    addFinanceTransaction,
    deleteFinanceTransaction,
    deleteAllFinanceTransactions,
    saveGoals,
    saveSettings,
  } = useFirestoreItems()

  const baseCurrency = settings?.baseCurrency || 'USD'

  useEffect(() => {
    setBaseCurrency(baseCurrency)
  }, [baseCurrency])

  useEffect(() => {
    setUtilsLang(lang)
  }, [lang])

  const { enrichedItems: rawEnriched, prices: marketPrices, loading: pricesLoading, error: pricesError, lastUpdate: pricesUpdate, refresh: refreshPrices } = useMarketPrices(items)
  const { rates, convert, convertItemValue, loading: ratesLoading, error: ratesError, lastUpdate: ratesUpdate, refresh: refreshRates } = useExchangeRates(baseCurrency)

  const alertsCheckedRef = useRef(null)
  useEffect(() => {
    if (!marketPrices || Object.keys(marketPrices).length === 0 || !alerts || alerts.length === 0) return
    const key = pricesUpdate || Date.now()
    if (alertsCheckedRef.current === key) return
    alertsCheckedRef.current = key
    checkPriceAlerts(alerts, marketPrices, (alertId) => {
      updateAlert(alertId, { triggered: true, triggeredAt: new Date().toISOString() })
    })
  }, [marketPrices, alerts, pricesUpdate, updateAlert])

  const enrichedItems = useMemo(() => {
    if (!rates) return rawEnriched
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
        _originalPurchasePrice: it.purchasePrice || 0,
        _originalCurrency: itemCurrency,
        _displayCurrency: baseCurrency,
      }
    })
  }, [rawEnriched, rates, convert, baseCurrency])

  const portfolioItems = useMemo(() => {
    if (activePortfolio === '__all__') return enrichedItems
    return enrichedItems.filter((it) => (it.portfolioId || '__default__') === activePortfolio)
  }, [enrichedItems, activePortfolio])

  const snapshotSavedRef = useRef(null)

  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    if (snapshotSavedRef.current === todayStr) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return

    const alreadyExists = snapshots.some((s) => s.date === todayStr || s.id === todayStr)
    if (alreadyExists) { snapshotSavedRef.current = todayStr; return }

    let totalAssetsUSD = 0
    let totalDebtUSD = 0
    enrichedItems.forEach((it) => {
      const origPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
      const origCurrency = it._originalCurrency ?? baseCurrency ?? 'USD'
      let value = (it.quantity || 0) * origPrice
      value = convert ? convert(value, origCurrency, 'USD') : value
      if (it.isDebt) totalDebtUSD += Math.abs(value)
      else totalAssetsUSD += value
    })
    const netWorthUSD = totalAssetsUSD - totalDebtUSD

    if (totalAssetsUSD > 0 || totalDebtUSD > 0) {
      saveSnapshot({ date: todayStr, totalActivosUSD: totalAssetsUSD, totalDebtUSD, netWorthUSD, rates: rates || {}, baseCurrency })
      snapshotSavedRef.current = todayStr
    }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, snapshots, saveSnapshot, convert, baseCurrency])

  const dividendsProcessedRef = useRef(null)

  useEffect(() => {
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    if (dividendsProcessedRef.current === todayKey) return
    if (!user || dataLoading || pricesLoading || ratesLoading) return
    if (enrichedItems.length === 0) return

    let cancelled = false

    const scheduled = enrichedItems.filter((it) =>
      (it.incomeAmount > 0 || it.incomeRate > 0 || (it.rateType === 'variable' && it.rateMin > 0) || it.rateType === 'continuous')
    )
    if (scheduled.length === 0) { dividendsProcessedRef.current = todayKey; return }

    const todayDay = now.getUTCDate()
    const currentMonth = now.getUTCMonth()

    function getEffectivePayDay(payDay, businessDayRule) {
      if (businessDayRule !== 'next_business_day') return payDay
      const testDate = new Date(Date.UTC(now.getUTCFullYear(), currentMonth, payDay))
      const dow = testDate.getUTCDay()
      if (dow === 0) return payDay + 1
      if (dow === 6) return payDay + 2
      return payDay
    }

    function addToDestination(dest, amount, sourceCurrency) {
      const destCur = dest._originalCurrency || dest.currency || 'USD'
      const converted = destCur !== sourceCurrency && convert
        ? convert(amount, sourceCurrency, destCur)
        : amount
      const isBank = /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(dest.type || '')
      if (isBank) {
        const qty = dest.quantity || 1
        const currentBal = (dest._originalPrice || dest.currentPrice || dest.purchasePrice || 0)
        const newBal = currentBal + (converted / qty)
        return updateItem(dest.id, { currentPrice: newBal, purchasePrice: newBal })
      }
      const destPrice = (dest.currentPrice || dest.purchasePrice || 0) + converted
      return updateItem(dest.id, { currentPrice: destPrice, purchasePrice: destPrice })
    }

    async function processDividends() {
      for (const it of scheduled) {
        if (cancelled) return
        try {
          const payDay = getEffectivePayDay(it.incomePayDay || 1, it.businessDayRule)
          const isContinuous = it.rateType === 'continuous'

          if (!isContinuous && todayDay !== payDay) continue

          const months = Array.isArray(it.incomeMonths) && it.incomeMonths.length > 0
            ? it.incomeMonths
            : [0,1,2,3,4,5,6,7,8,9,10,11]
          if (!months.includes(currentMonth)) continue

          if (it.maturityDate) {
            const matDate = new Date(it.maturityDate)
            if (matDate <= now) continue
          }

          const sym = (it.symbol || '').toUpperCase()
          const alreadyPaid = transactions.some((tx) =>
            tx.date === todayKey &&
            (tx.type || '').toUpperCase() === 'DIVIDEND' &&
            (tx.symbol || '').toUpperCase() === sym &&
            tx._auto === true
          )
          if (alreadyPaid) continue

          let paymentAmount = it.incomeAmount || 0
          const balance = (it.quantity || 1) * (it._originalPrice || it.currentPrice || it.purchasePrice || 0)
          const incomeCurrency = it._originalCurrency || it.currency || 'USD'

          if (it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) {
            const midRate = (it.rateMin + it.rateMax) / 2
            const payMonths = months.length || 12
            paymentAmount = (balance * (midRate / 100)) / payMonths
          } else if (isContinuous && it.incomeRate > 0) {
            paymentAmount = (balance * (it.incomeRate / 100)) / 365
          } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
            const payMonths = months.length || 12
            paymentAmount = (balance * (it.incomeRate / 100)) / payMonths
          }
          if (paymentAmount <= 0) continue

          await addTransaction({
            type: 'DIVIDEND',
            symbol: sym,
            description: `${it.name || it.symbol} - ${paymentAmount.toFixed(2)} ${incomeCurrency}`,
            date: todayKey,
            totalAmount: Math.round(paymentAmount * 100) / 100,
            currency: incomeCurrency,
            _auto: true,
          })

          if (it.dividendAction === 'reinvest') {
            const sharePrice = it.currentPrice || it.purchasePrice || 0
            if (sharePrice > 0) {
              const newShares = paymentAmount / sharePrice
              await updateItem(it.id, { quantity: (it.quantity || 0) + newShares })
            }
          } else if (it.incomeDestination) {
            const dest = enrichedItems.find((d) => (d.id || d.symbol) === it.incomeDestination)
            if (dest) {
              await addToDestination(dest, paymentAmount, incomeCurrency)
            }
          }

          if (it.capitalReturn > 0) {
            const newPrice = Math.max(0, (it._originalPrice || it.currentPrice || it.purchasePrice || 0) - it.capitalReturn)
            await updateItem(it.id, { currentPrice: newPrice, purchasePrice: newPrice })

            if (it.capitalDestination) {
              const dest = enrichedItems.find((d) => (d.id || d.symbol) === it.capitalDestination)
              if (dest) {
                await addToDestination(dest, it.capitalReturn, incomeCurrency)
              }
            }
          }
        } catch (err) {
          console.error(`[dividends] Failed for ${it.symbol}:`, err.message)
        }
      }
      dividendsProcessedRef.current = todayKey
    }

    processDividends()
    return () => { cancelled = true }
  }, [user, dataLoading, pricesLoading, ratesLoading, enrichedItems, transactions, addTransaction, updateItem, convert])

  const handleRefresh = useCallback(() => {
    refreshPrices()
    refreshRates()
  }, [refreshPrices, refreshRates])

  const handleSignOut = async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const totalFromItems = useMemo(() =>
    portfolioItems.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0),
    [portfolioItems]
  )

  const convertSnapshot = useCallback((val) => convert(val, 'USD', baseCurrency), [convert, baseCurrency])

  const totalAssets = useMemo(() =>
    totalFromItems > 0 ? totalFromItems : (latestSnapshot ? convertSnapshot(latestSnapshot.totalActivosUSD ?? 0) : 0),
    [totalFromItems, latestSnapshot, convertSnapshot]
  )
  const netWorth = totalAssets

  const dailyChange = useMemo(() => {
    if (!prevSnapshot || netWorth <= 0) return null
    const prevValue = convertSnapshot(prevSnapshot.netWorthUSD ?? prevSnapshot.totalActivosUSD ?? 0)
    if (prevValue <= 0) return null
    const abs = netWorth - prevValue
    const pct = (abs / prevValue) * 100
    return { abs, pct }
  }, [prevSnapshot, netWorth, convertSnapshot])

  const handleExport = useCallback(async () => {
    if (items.length === 0) return
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
          Date: s.date, 'Net Worth (USD)': s.netWorthUSD ?? s.totalActivosUSD ?? 0,
          Notes: s.notes || '',
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
  }, [enrichedItems, snapshots, transactions, baseCurrency])

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


  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdPaletteOpen(true) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setModal('account') }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); setModal('import') }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); handleExport() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'r' && !e.shiftKey) { e.preventDefault(); handleRefresh() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleExport, handleRefresh])


  const handleIBKRSync = useCallback(async (data, mode = 'merge') => {
    if (mode === 'replace') {
      const ibkrItems = items.filter(it =>
        it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers')
      )
      for (const it of ibkrItems) {
        await deleteItem(it.id)
      }
    }

    for (const item of data.items) {
      let existing = null
      if (mode === 'merge') {
        existing = items.find(it =>
          (it.conid && it.conid === item.conid) ||
          (
            (it.symbol || '').toUpperCase() === item.symbol &&
            ((it.institution || '').toLowerCase().includes('interactive brokers') || it._source === 'ibkr')
          )
        )
      }
      if (existing) {
        await updateItem(existing.id, {
          currentPrice: item.currentPrice,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
          conid: item.conid,
          _ibkrAccountId: item._ibkrAccountId,
          _ibkrMarketValue: item._ibkrMarketValue,
          _ibkrUnrealizedPL: item._ibkrUnrealizedPL,
          _source: 'ibkr',
        })
      } else {
        await addItem(item)
        if (item.quantity > 0 && item.purchasePrice > 0 && item.type !== 'Bank') {
          await addLot({
            symbol: item.symbol,
            quantity: item.quantity,
            costBasis: item.purchasePrice,
            currency: item.currency || 'USD',
            acquisitionDate: new Date().toISOString().split('T')[0],
          })
        }
      }
    }
    if (data.equityHistory && data.equityHistory.length > 0) {
      const existingDates = new Set(snapshots.map(s => s.date || s.id))
      for (const entry of data.equityHistory) {
        if (!existingDates.has(entry.date)) {
          await saveSnapshot(entry)
        }
      }
    }

    for (const tx of data.transactions) {
      const alreadyExists = transactions.some(t =>
        t.date === tx.date &&
        (t.symbol || '').toUpperCase() === tx.symbol &&
        t.type === tx.type &&
        Math.abs((t.quantity || 0) - tx.quantity) < 0.001
      )
      if (!alreadyExists) {
        await addTransaction(tx)
      }
    }
  }, [items, transactions, addItem, updateItem, deleteItem, addTransaction, addLot])

  const ibkrAutoSyncRef = useRef(false)
  useEffect(() => {
    if (dataLoading || ibkrAutoSyncRef.current) return
    if (!settings?.ibkrToken || !settings?.ibkrQueryId) return
    ibkrAutoSyncRef.current = true

    const SYNC_INTERVAL = 60 * 60 * 1000
    const lastSync = settings._ibkrLastAutoSync ? new Date(settings._ibkrLastAutoSync).getTime() : 0
    const shouldSync = Date.now() - lastSync > SYNC_INTERVAL

    const doAutoSync = async () => {
      try {
        const { syncIBKR } = await import('@/lib/ibkrSync')
        const { decryptToken } = await import('@/lib/crypto')
        const plain = await decryptToken(settings.ibkrToken, user?.uid)
        const data = await syncIBKR(plain, settings.ibkrQueryId)
        await handleIBKRSync(data, 'merge')
        saveSettings({ _ibkrLastAutoSync: new Date().toISOString() })
        console.log(`[ibkr] Auto-sync OK: ${data.items.length} positions`)
      } catch (err) {
        console.log(`[ibkr] Auto-sync failed: ${err.message}`)
      }
    }

    if (shouldSync) doAutoSync()
    const interval = setInterval(doAutoSync, SYNC_INTERVAL)
    return () => clearInterval(interval)
  }, [dataLoading, settings, user, handleIBKRSync, saveSettings])

  const yearlyChange = useMemo(() => {
    if (snapshots.length < 2) return null
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    let yearAgoSnapshot = null
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].date && new Date(snapshots[i].date) <= oneYearAgo) { yearAgoSnapshot = snapshots[i]; break }
    }
    if (!yearAgoSnapshot) return null
    const prev = convertSnapshot(yearAgoSnapshot.netWorthUSD ?? yearAgoSnapshot.totalActivosUSD ?? 0)
    if (prev === 0) return null
    return ((netWorth - prev) / prev) * 100
  }, [snapshots, netWorth, convertSnapshot])

  const [jan1Value, setJan1Value] = useState(null)

  useEffect(() => {
    if (!enrichedItems || enrichedItems.length === 0) return
    let cancelled = false
    async function fetchJan1() {
      try {
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: enrichedItems.map((it) => ({
              symbol: it.symbol, type: it.type, quantity: it.quantity,
              currentPrice: it.currentPrice, purchasePrice: it.purchasePrice,
              acquisitionDate: it.acquisitionDate,
            })),
            period: 'YTD',
          }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        const pts = data.dataPoints || []
        if (pts.length > 0) {
          const firstReal = pts.find(p => p.total > 0)
          if (!cancelled && firstReal) setJan1Value(firstReal.total)
        }
      } catch {}
    }
    fetchJan1()
    return () => { cancelled = true }
  }, [enrichedItems])

  const { returnYTD, ytdChange } = useMemo(() => {
    const yearStartTs = new Date(new Date().getFullYear(), 0, 1).getTime()

    let startVal = null

    if (snapshots.length >= 2) {
      let minDiff = Infinity
      let bestSnap = null
      const MAX_SNAP_DISTANCE = 30 * 86400000
      for (const s of snapshots) {
        if (!s.date) continue
        const snapTs = new Date(s.date).getTime()
        if (snapTs > Date.now()) continue
        const diff = Math.abs(snapTs - yearStartTs)
        if (diff < minDiff) { minDiff = diff; bestSnap = s }
      }
      if (bestSnap && minDiff <= MAX_SNAP_DISTANCE) {
        startVal = convertSnapshot(bestSnap.netWorthUSD ?? bestSnap.totalActivosUSD ?? 0)
      }
    }

    if (startVal == null || startVal <= 0) startVal = jan1Value
    if (startVal == null || startVal <= 0) return { returnYTD: null, ytdChange: null }

    const { pct, abs } = computeModifiedDietz({
      startValue: startVal,
      endValue: netWorth,
      startTs: yearStartTs,
      endTs: Date.now(),
      transactions,
      convert,
      baseCurrency,
    })
    const clampedPct = Math.max(-200, Math.min(200, pct))
    return { returnYTD: clampedPct, ytdChange: abs }
  }, [jan1Value, netWorth, transactions, convert, baseCurrency, snapshots, convertSnapshot])

  const annualDividends = useMemo(() => {
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
    return divs.reduce((s, tx) => {
      const amt = tx.totalAmount ?? 0
      return s + convert(amt, tx.currency || 'USD', baseCurrency)
    }, 0)
  }, [transactions, convert, baseCurrency])

  const handleReport = useCallback(async () => {
    const { generateReport } = await import('@/lib/generateReport')
    await generateReport({
      items: enrichedItems, snapshots, transactions,
      netWorth, totalAssets, lang, returnYTD, annualDividends,
    })
  }, [enrichedItems, snapshots, transactions, lang, netWorth, totalAssets, returnYTD, annualDividends])

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
      try {
        await navigator.share({ title: 'Chispudo Portfolio', text })
      } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      alert(t('Resumen copiado al portapapeles', 'Summary copied to clipboard'))
    }
  }, [enrichedItems, netWorth, totalAssets, returnYTD, lang])

  const handleCmdAction = useCallback((action, data) => {
    switch (action) {
      case 'add': setModal('account'); break
      case 'import': setModal('import'); break
      case 'export': handleExport(); break
      case 'report': handleReport(); break
      case 'print': setModal('print'); break
      case 'share': handleShare(); break
      case 'transfer': setModal('transfer'); break
      case 'settings': setModal('settings'); break
      case 'refresh': handleRefresh(); break
      case 'theme': handleSetTheme(theme === 'dark' ? 'light' : 'dark'); break
      case 'lang': handleSetLang('toggle'); break
      case 'ibkr': setModal('ibkr'); break
      case 'viewItem': setDetailItem(data); break
    }
  }, [handleExport, handleReport, handleRefresh, handleSetTheme, handleSetLang, theme])

  const estimatedAnnualIncome = useMemo(() => {
    let total = 0
    portfolioItems.forEach((it) => {
      const qty = it.quantity || 1
      const price = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      let annual = 0
      if (it.incomeAmount > 0 && it.incomeMonths) {
        const payCount = Array.isArray(it.incomeMonths) ? it.incomeMonths.length : 12
        annual = it.incomeAmount * payCount
      } else if (it.incomeMode === 'percent' && it.incomeRate > 0) {
        annual = balance * (it.incomeRate / 100)
      } else if (it.dividendYield > 0) {
        annual = balance * (it.dividendYield / 100)
      }
      if (annual > 0) {
        const cur = it.currency || it._originalCurrency || 'USD'
        total += convert(annual, cur, baseCurrency)
      }
    })
    return total
  }, [portfolioItems, convert, baseCurrency])

  const benchmarkSymbol = settings?.benchmarkSymbol || '%5EGSPC'
  const { benchmarkData, benchmarkReturn, benchmarkName, loading: benchmarkLoading, error: benchmarkError } = useBenchmark('YTD', benchmarkSymbol)

  const netContributions = useMemo(() => {
    return computeNetContributions(transactions, convert, baseCurrency).netContributions
  }, [transactions, convert, baseCurrency])

  const cashTotal = useMemo(() => {
    return portfolioItems
      .filter((it) => /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(it.type || ''))
      .reduce((s, it) => s + (it.currentPrice || it.purchasePrice || 0), 0)
  }, [portfolioItems])

  const riskMetrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const sharpeResult = computeSharpeRatio({ returns })
    const vol = computeVolatility({ returns })
    const valueSeries = (snapshots || [])
      .map((s) => ({ ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
      .filter((p) => !isNaN(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(valueSeries)
    return { sharpe: sharpeResult.sharpe, volatility: vol, maxDrawdown: drawdown.maxDrawdownPct }
  }, [snapshots, transactions, convert, baseCurrency])

  const insights = useMemo(() => {
    const hhiResult = computeHHI(portfolioItems.map((it) => ({ value: getItemValue(it) })))
    const incomeYield = netWorth > 0 && annualDividends > 0 ? (annualDividends / netWorth) * 100 : 0
    const attribution = computeAssetAttribution(portfolioItems)
    const topContributor = attribution.length > 0 ? attribution[0] : null
    const topDrag = attribution.length > 0 ? attribution[attribution.length - 1] : null
    const now = new Date()
    const in90 = new Date(now.getTime() + 90 * 86400000)
    const maturingSoon = portfolioItems.filter((it) => {
      if (!it.maturityDate) return false
      const md = new Date(it.maturityDate)
      return md > now && md <= in90
    }).length
    const debtTotal = portfolioItems.filter((it) => it.isDebt).reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const debtRatio = totalAssets > 0 ? (debtTotal / totalAssets) * 100 : 0
    const classTotals = {}
    let classTotal = 0
    portfolioItems.filter(it => !it.isDebt).forEach(it => {
      const cls = getInvestmentClass(it)
      const val = Math.abs(getItemValue(it))
      classTotals[cls] = (classTotals[cls] || 0) + val
      classTotal += val
    })
    const investmentClassPcts = {}
    Object.entries(classTotals).forEach(([k, v]) => { investmentClassPcts[k] = classTotal > 0 ? (v / classTotal) * 100 : 0 })
    return generateInsights({
      netWorth,
      benchmarkReturn,
      portfolioReturn: returnYTD,
      sharpe: riskMetrics.sharpe,
      volatility: riskMetrics.volatility,
      maxDrawdown: riskMetrics.maxDrawdown,
      hhi: hhiResult.hhi,
      incomeYield,
      goals,
      topContributor,
      topDrag,
      maturingSoon,
      debtRatio,
      investmentClassPcts,
    })
  }, [netWorth, benchmarkReturn, returnYTD, riskMetrics, portfolioItems, annualDividends, goals])

  const dataAge = latestSnapshot ? Math.round((Date.now() - new Date(latestSnapshot.date).getTime()) / 86400000) : null

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
          <p className="mt-4 text-slate-500 text-sm">{lang === 'es' ? 'Cargando tu portfolio...' : 'Loading your portfolio...'}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  if (!showOnboarding && typeof window !== 'undefined' && !localStorage.getItem('chispudo-onboarding-done') && !dataLoading && enrichedItems.length === 0) {
    setTimeout(() => setShowOnboarding(true), 500)
  }

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <a href="#main-content" className="skip-link">{lang === 'es' ? 'Ir al contenido' : 'Skip to content'}</a>
      <Header
        user={user}
        lang={lang}
        setLang={() => handleSetLang('toggle')}
        onImport={() => setModal('import')}
        onSettings={() => setModal('settings')}
        onSignOut={handleSignOut}
        onRefresh={handleRefresh}
        pricesLoading={pricesLoading || ratesLoading}
        onAddAccount={() => setModal('account')}
        onCommandPalette={() => setCmdPaletteOpen(true)}
      />

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          {dataAge === 0 ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-500" />
          )}
          <span className="text-xs text-slate-500">
            {dataAge === 0
              ? (lang === 'es' ? 'Datos al día' : 'Data up to date')
              : dataAge != null
                ? (lang === 'es' ? `Actualizado hace ${dataAge}d` : `Updated ${dataAge}d ago`)
                : (lang === 'es' ? 'Sin datos aún' : 'No data yet')}
          </span>
          {pricesUpdate && (
            <span className="text-xs text-slate-600">
              {new Date(pricesUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {baseCurrency !== 'USD' && (
            <span className="text-xs text-cyan-500/70">{baseCurrency}</span>
          )}
          {(pricesLoading || ratesLoading) && <span className="text-xs text-blue-400 animate-pulse">{lang === 'es' ? 'Actualizando...' : 'Updating...'}</span>}
          {portfolios && portfolios.length > 0 && (
            <PortfolioSelector
              portfolios={portfolios}
              activePortfolio={activePortfolio}
              onSelect={setActivePortfolio}
              onAdd={addPortfolio}
              onDelete={deletePortfolio}
              lang={lang}
            />
          )}
        </div>

        <h1 className="sr-only">{lang === 'es' ? 'Patrimonio — Dashboard' : 'Net Worth — Dashboard'}</h1>

        {/* Error Banner */}
        <ErrorBanner pricesError={pricesError} ratesError={ratesError} lang={lang} />

        {/* Notifications */}
        <NotificationCenter items={portfolioItems} transactions={transactions} lang={lang} />

        {/* Data Quality */}
        <InstallPrompt lang={lang} />
        <DataQuality items={portfolioItems} lang={lang} />

        {/* Empty State */}
        {portfolioItems.length === 0 && !dataLoading && (
          <EmptyState
            onAdd={() => setModal('account')}
            onImport={() => setModal('import')}
            onTemplate={async () => {
              const { generateTemplate } = await import('@/lib/generateTemplate')
              await generateTemplate()
            }}
            lang={lang}
          />
        )}

        {/* Insights Banner */}
        {portfolioItems.length > 0 && <InsightsBanner insights={insights} lang={lang} />}

        {/* ═══ OVERVIEW ═══ */}
        {portfolioItems.length > 0 && <>
        <ErrorBoundary lang={lang}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div data-card-id="OL-01">
            <NetWorthCard
              netWorth={netWorth}
              returnYTD={returnYTD}
              ytdChange={ytdChange}
              yearlyChange={yearlyChange}
              dailyChange={dailyChange}
              convert={convert}
              lang={lang}
              netContributions={netContributions}
              cashTotal={cashTotal}
              snapshots={snapshots}
            />
            </div>
            <div data-card-id="OL-02"><BenchmarkComparison benchmarkReturn={benchmarkReturn} portfolioReturn={returnYTD} benchmarkName={benchmarkName} lang={lang} /></div>
            <div data-card-id="OL-03"><PriceAlerts alerts={alerts} items={portfolioItems} onAddAlert={addAlert} onDeleteAlert={deleteAlert} lang={lang} /></div>
            <div data-card-id="OL-04"><UpcomingDividends items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OL-05"><ContinuousYieldDisplay items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OL-06"><VariableRateDashboard items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OL-07"><MaturityCalendar items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OL-08"><Watchlist lang={lang} /></div>
            <div data-card-id="OL-09"><TopMovers items={portfolioItems} transactions={transactions} lang={lang} /></div>
          </div>

          <div className="lg:col-span-3 flex flex-col gap-4">
            <div data-card-id="OR-01"><PortfolioGrowthChart items={portfolioItems} snapshots={snapshots} transactions={transactions} lang={lang} convert={convert} baseCurrency={baseCurrency} benchmarkSymbol={benchmarkSymbol} benchmarkName={benchmarkName} /></div>
            <div data-card-id="OR-02"><AssetAllocation items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OR-03"><InvestmentClassBreakdown items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OR-04"><ValueBreakdown items={portfolioItems} lang={lang} /></div>
            <div data-card-id="OR-05"><SnapshotComparison snapshots={snapshots} items={portfolioItems} lang={lang} /></div>
          </div>
        </div>
        </ErrorBoundary>

        {/* ═══ PERFORMANCE & RISK ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Rendimiento y Riesgo' : 'Performance & Risk'} id="perf-risk">
          <ErrorBoundary lang={lang}>
            <div data-card-id="PR-01"><PerformanceSummary items={portfolioItems} transactions={transactions} convert={convert} baseCurrency={baseCurrency} netWorth={netWorth} lang={lang} /></div>
            <div data-card-id="PR-02"><PerformanceAttribution items={portfolioItems} lang={lang} /></div>
            <div data-card-id="PR-03"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></div>
            <div data-card-id="PR-04"><CurrencyImpact items={portfolioItems} convert={convert} baseCurrency={baseCurrency} rates={rates} lang={lang} /></div>
            <div data-card-id="PR-05"><MonthlyPerformance snapshots={snapshots} transactions={transactions} convert={convert} baseCurrency={baseCurrency} lang={lang} /></div>
          </ErrorBoundary>
        </SectionCollapse>

        {/* Action Buttons */}
        <ActionButtons
          onImport={() => setModal('import')}
          onAddAccount={() => setModal('account')}
          onTransfer={() => setModal('transfer')}
          onExport={handleExport}
          onShare={handleShare}
          onIBKR={() => setModal('ibkr')}
          itemCount={enrichedItems.length}
          lang={lang}
        />

        {/* ═══ INCOME & GOALS ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Ingresos y Metas' : 'Income & Goals'} id="income-goals">
          <ErrorBoundary lang={lang}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <div data-card-id="IG-01"><DividendIncome transactions={transactions} items={portfolioItems} convert={convert} baseCurrency={baseCurrency} lang={lang} netWorth={netWorth} /></div>
              {lots && lots.length > 0 && <div data-card-id="IG-02"><GainsReport lots={lots} items={portfolioItems} lang={lang} /></div>}
              <div data-card-id="IG-03"><ConcentrationRisk items={portfolioItems} lang={lang} /></div>
            </div>

            <div data-card-id="IG-04"><IncomeCalendar items={portfolioItems} lang={lang} /></div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <div data-card-id="IG-05"><GoalTracker
                netWorth={netWorth}
                annualDividends={annualDividends}
                estimatedAnnualIncome={estimatedAnnualIncome}
                goals={goals}
                onSaveGoals={saveGoals}
                volatility={riskMetrics.volatility}
                lang={lang}
              /></div>
              <div data-card-id="IG-06"><FinancialHealth items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} /></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              <div data-card-id="IG-07"><RecurringTransactions goals={goals} onSaveGoals={saveGoals} lang={lang} /></div>
              <div data-card-id="IG-08"><SavingsRate goals={goals} transactions={transactions} netWorth={netWorth} snapshots={snapshots} lang={lang} /></div>
              <div data-card-id="IG-09"><FeeAnalysis items={portfolioItems} netWorth={netWorth} lang={lang} /></div>
            </div>

            <div data-card-id="IG-10"><RebalanceSuggestions items={portfolioItems} netWorth={netWorth} goals={goals} onSaveGoals={saveGoals} lang={lang} /></div>

            <div data-card-id="IG-11"><ProjectionSimulator netWorth={netWorth} lang={lang} volatility={riskMetrics.volatility} goalValue={goals?.portfolioGoal} /></div>
          </ErrorBoundary>
        </SectionCollapse>

        {/* ═══ HOLDINGS ═══ */}
        <SectionCollapse title={lang === 'es' ? 'Posiciones' : 'Holdings'} id="holdings">
          <ErrorBoundary lang={lang}>
            <div data-card-id="HO-01"><AccountsTable items={portfolioItems} lang={lang} onDeleteItem={deleteItem}
              onEditItem={(item) => setEditItem(item)} onViewItem={(item) => setDetailItem(item)}
              onSellItem={(item) => setSellItem(item)}
              onQuickBuy={() => setModal('account')} /></div>

            <div data-card-id="HO-02"><RecentTransactions transactions={transactions} lang={lang} onExportCSV={handleExportTransactionsCSV} /></div>
          </ErrorBoundary>
        </SectionCollapse>

        {/* Generate Report */}
        <div className="text-center py-6 flex items-center justify-center gap-3">
          <button onClick={handleReport}
            className="px-6 py-3 text-sm font-medium text-slate-300 bg-[#1e293b] border border-[#334155] rounded-xl hover:bg-[#283548] hover:text-white transition-colors inline-flex items-center gap-2">
            {lang === 'es' ? 'Generar Reporte PDF' : 'Generate PDF Report'}
          </button>
          <button onClick={() => setModal('print')}
            className="px-6 py-3 text-sm font-medium text-slate-300 bg-[#1e293b] border border-[#334155] rounded-xl hover:bg-[#283548] hover:text-white transition-colors inline-flex items-center gap-2">
            {lang === 'es' ? 'Resumen para Imprimir' : 'Print Summary'}
          </button>
        </div>
        </>}
      </main>

      {modal === 'import' && (
        <FileImportModal
          onClose={() => setModal(null)}
          onImportItems={addItem}
          onImportTransaction={addTransaction}
          onImportSnapshot={saveSnapshot}
          onAddLot={addLot}
          onAddFinanceTransaction={addFinanceTransaction}
          onUpdateItem={updateItem}
          existingItems={items}
          activePortfolio={activePortfolio}
          lang={lang}
        />
      )}

      {modal === 'account' && (
        <AddAccountModal
          onClose={() => setModal(null)}
          onAdd={addItem}
          onAddTransaction={addTransaction}
          onAddLot={addLot}
          existingItems={items}
          activePortfolio={activePortfolio}
          lang={lang}
        />
      )}

      {modal === 'transfer' && (
        <TransferModal
          onClose={() => setModal(null)}
          onSave={addItem}
          onAddTransaction={addTransaction}
          existingItems={items}
          lang={lang}
        />
      )}

      {sellItem && (
        <SellModal
          item={sellItem}
          onClose={() => setSellItem(null)}
          onSell={addItem}
          onUpdate={updateItem}
          onAddTransaction={addTransaction}
          onCloseLots={closeLotsFIFO}
          existingItems={items}
          lang={lang}
        />
      )}

      {modal === 'ibkr' && (
        <IBKRSyncModal
          onClose={() => setModal(null)}
          onSyncComplete={handleIBKRSync}
          savedToken={settings?.ibkrToken || ''}
          savedQueryId={settings?.ibkrQueryId || ''}
          onSaveCredentials={saveSettings}
          uid={user?.uid}
          lang={lang}
        />
      )}

      {modal === 'optimize' && (
        <OptimizeModal
          items={items}
          onClose={() => setModal(null)}
          onSave={addItem}
          onDelete={deleteItem}
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
          onDeleteAllFinanceTransactions={deleteAllFinanceTransactions}
          onSyncBroker={async (positions) => {
            const mapped = (positions || []).filter(p => p.quantity !== 0).map(p => ({
              symbol: (p.symbol || '').toUpperCase(),
              name: p.name || p.symbol,
              type: p.type || 'Stock',
              quantity: Math.abs(p.quantity || 0),
              purchasePrice: p.purchasePrice || 0,
              currentPrice: p.currentPrice || 0,
              institution: p.institution || 'Interactive Brokers',
              currency: p.currency || 'USD',
              acquisitionDate: p.acquisitionDate,
              conid: p._ibkrConId || '',
              _ibkrAccountId: p._ibkrAccountId || '',
              _source: 'ibkr',
            }))
            await handleIBKRSync({ items: mapped, transactions: [], accounts: [] }, 'merge')
          }}
          onExportBackup={() => {
            const data = {
              exportDate: new Date().toISOString(),
              version: '1.0',
              items,
              transactions,
              lots,
              snapshots,
              alerts,
              portfolios,
              goals,
              settings,
              financeTransactions,
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `chispudo-backup-${new Date().toISOString().split('T')[0]}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          theme={theme}
          onToggleTheme={handleSetTheme}
          lang={lang}
        />
      )}

      {modal === 'print' && (
        <PrintSummary
          items={portfolioItems}
          netWorth={netWorth}
          totalAssets={totalAssets}
          snapshots={snapshots}
          transactions={transactions}
          lang={lang}
          onClose={() => setModal(null)}
        />
      )}

      {editItem && (
        <EditAccountModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={addItem}
          onDelete={deleteItem}
          existingItems={items}
          lang={lang}
        />
      )}

      {detailItem && (
        <AssetDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          lang={lang}
          uid={user?.uid}
        />
      )}

      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        items={portfolioItems}
        lang={lang}
        onAction={handleCmdAction}
      />

      <MobileNav
        onAdd={() => setModal('account')}
        onImport={() => setModal('import')}
        onExport={handleExport}
        onShare={handleShare}
        onSettings={() => setModal('settings')}
        onSearch={() => setCmdPaletteOpen(true)}
        lang={lang}
      />

      {showOnboarding && (
        <OnboardingTour
          lang={lang}
          onAction={(action) => {
            if (action === 'add') setModal('account')
            else if (action === 'settings') setModal('settings')
          }}
          onComplete={() => setShowOnboarding(false)}
        />
      )}
    </div>
  )
}
