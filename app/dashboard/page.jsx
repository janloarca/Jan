'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'

const labels = {
  en: {
    appName: 'chispu.xyz',
    importData: 'Import Data',
    signOut: 'Sign Out',
    totalAssets: 'Total Assets',
    netWorth: 'Net Worth',
    holdings: 'Holdings',
    returnYTD: 'Return YTD',
    monthlyChange: 'vs last month',
    portfolioHoldings: 'Portfolio Holdings',
    recentSnapshots: 'Recent Snapshots',
    recentTransactions: 'Recent Transactions',
    portfolioGrowth: 'Portfolio Growth',
    allocation: 'Asset Allocation',
    symbol: 'Symbol',
    name: 'Name',
    type: 'Type',
    quantity: 'Qty',
    purchasePrice: 'Cost Basis',
    totalValue: 'Total Value',
    institution: 'Institution',
    date: 'Date',
    totalActivosUSD: 'Total Assets',
    netWorthUSD: 'Net Worth',
    note: 'Note',
    noHoldings: 'No holdings yet. Import data to get started.',
    noSnapshots: 'No snapshots recorded yet.',
    noTransactions: 'No transactions recorded yet.',
    noChartData: 'Import snapshots to see your growth chart.',
    loading: 'Loading...',
    stocks: 'Stocks',
    crypto: 'Crypto',
    bonds: 'Bonds',
    funds: 'Funds',
    banks: 'Banks',
    other: 'Other',
    viewAll: 'View All',
    amount: 'Amount',
  },
  es: {
    appName: 'chispu.xyz',
    importData: 'Importar Datos',
    signOut: 'Cerrar Sesion',
    totalAssets: 'Total Activos',
    netWorth: 'Patrimonio Neto',
    holdings: 'Posiciones',
    returnYTD: 'Retorno YTD',
    monthlyChange: 'vs mes anterior',
    portfolioHoldings: 'Posiciones del Portafolio',
    recentSnapshots: 'Snapshots Recientes',
    recentTransactions: 'Transacciones Recientes',
    portfolioGrowth: 'Crecimiento del Portafolio',
    allocation: 'Distribucion de Activos',
    symbol: 'Simbolo',
    name: 'Nombre',
    type: 'Tipo',
    quantity: 'Cant.',
    purchasePrice: 'Costo',
    totalValue: 'Valor Total',
    institution: 'Institucion',
    date: 'Fecha',
    totalActivosUSD: 'Total Activos',
    netWorthUSD: 'Patrimonio Neto',
    note: 'Nota',
    noHoldings: 'Sin posiciones. Importa datos para comenzar.',
    noSnapshots: 'Sin snapshots registrados.',
    noTransactions: 'Sin transacciones registradas.',
    noChartData: 'Importa snapshots para ver tu grafica de crecimiento.',
    loading: 'Cargando...',
    stocks: 'Acciones',
    crypto: 'Crypto',
    bonds: 'Bonos/Inversiones',
    funds: 'Fondos',
    banks: 'Bancos',
    other: 'Otro',
    viewAll: 'Ver Todo',
    amount: 'Monto',
  },
}

function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

function formatCompact(value) {
  if (value == null || isNaN(value)) return '$0'
  if (value >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'k'
  }
  return '$' + value.toFixed(0)
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatShortDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
    })
  } catch {
    return dateStr
  }
}

// Categorize item type into groups
function getTypeCategory(type) {
  if (!type) return 'other'
  const t = type.toLowerCase()
  if (/stock|accion/i.test(t)) return 'stocks'
  if (/crypto|cripto/i.test(t)) return 'crypto'
  if (/bond|bono|instrumento|inversion|deuda|debt/i.test(t)) return 'bonds'
  if (/fund|fondo|etf/i.test(t)) return 'funds'
  if (/bank|banco|cash|saving/i.test(t)) return 'banks'
  return 'other'
}

const TYPE_COLORS = {
  stocks: { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  crypto: { bg: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  bonds: { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  funds: { bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  banks: { bg: 'bg-gray-500', light: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
  other: { bg: 'bg-pink-500', light: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
}

// Portfolio Growth Chart with time filters and hover tooltip
function PortfolioGrowthChart({ snapshots, lang }) {
  const [period, setPeriod] = useState('ALL')
  const [hoverIdx, setHoverIdx] = useState(null)

  const periods = [
    { key: '3M', months: 3 },
    { key: '6M', months: 6 },
    { key: '1Y', months: 12 },
    { key: 'YTD', months: null },
    { key: 'ALL', months: null },
  ]

  const filtered = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return []
    if (period === 'ALL') return snapshots
    if (period === 'YTD') {
      const year = new Date().getFullYear()
      return snapshots.filter((s) => new Date(s.date).getFullYear() >= year)
    }
    const p = periods.find((pp) => pp.key === period)
    if (!p?.months) return snapshots
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - p.months)
    return snapshots.filter((s) => new Date(s.date) >= cutoff)
  }, [snapshots, period])

  if (!filtered || filtered.length < 2) return null

  const values = filtered.map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0)
  const assetsValues = filtered.map((s) => s.totalActivosUSD ?? 0)
  const min = Math.min(...values, ...assetsValues) * 0.95
  const max = Math.max(...values, ...assetsValues) * 1.02
  const range = max - min || 1

  const firstVal = values[0]
  const lastVal = values[values.length - 1]
  const growthPct = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0
  const growthAbs = lastVal - firstVal
  const isPositive = growthPct >= 0

  const lineColor = isPositive ? '#10b981' : '#ef4444'
  const lineColorLight = isPositive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.08)'

  const height = 260
  const padding = { top: 24, right: 20, bottom: 44, left: 56 }
  const width = 700
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const toPoint = (vals) =>
    vals.map((v, i) => ({
      x: padding.left + (i / (vals.length - 1)) * chartWidth,
      y: padding.top + chartHeight - ((v - min) / range) * chartHeight,
      v,
    }))

  const netPoints = toPoint(values)
  const assetPoints = toPoint(assetsValues)

  // Smooth curve using cardinal spline
  function smoothPath(pts) {
    if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const tension = 0.3
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3
      const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3
      const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3
      const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const netLine = smoothPath(netPoints)
  const assetLine = smoothPath(assetPoints)
  const areaPath = `${netLine} L ${netPoints[netPoints.length - 1].x} ${padding.top + chartHeight} L ${netPoints[0].x} ${padding.top + chartHeight} Z`

  // Y-axis ticks
  const yTickCount = 5
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const val = min + (range * i) / (yTickCount - 1)
    const y = padding.top + chartHeight - (i / (yTickCount - 1)) * chartHeight
    return { val, y }
  })

  // X-axis labels
  const step = Math.max(1, Math.floor(filtered.length / 7))
  const xLabels = filtered
    .map((s, i) => ({ label: formatShortDate(s.date), x: netPoints[i]?.x, i }))
    .filter((_, i) => i % step === 0 || i === filtered.length - 1)

  const hoverSnap = hoverIdx != null ? filtered[hoverIdx] : null
  const hoverPoint = hoverIdx != null ? netPoints[hoverIdx] : null

  return (
    <div>
      {/* Header row: growth stats + period buttons */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{formatCurrency(lastVal)}</span>
            <span className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isPositive ? '+' : ''}{growthPct.toFixed(1)}%
            </span>
            <span className={`text-xs ${isPositive ? 'text-emerald-500' : 'text-red-400'}`}>
              ({isPositive ? '+' : ''}{formatCurrency(growthAbs)})
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatShortDate(filtered[0]?.date)} — {formatShortDate(filtered[filtered.length - 1]?.date)}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                period === p.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.key}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const svg = e.currentTarget
            const rect = svg.getBoundingClientRect()
            const mouseX = ((e.clientX - rect.left) / rect.width) * width
            let closest = 0
            let closestDist = Infinity
            netPoints.forEach((p, i) => {
              const dist = Math.abs(p.x - mouseX)
              if (dist < closestDist) {
                closestDist = dist
                closest = i
              }
            })
            setHoverIdx(closest)
          }}
        >
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={tick.y}
                x2={width - padding.right}
                y2={tick.y}
                stroke="#f3f4f6"
                strokeWidth="1"
              />
              <text x={padding.left - 10} y={tick.y + 4} textAnchor="end" fill="#9ca3af" fontSize="10" fontFamily="system-ui">
                {formatCompact(tick.val)}
              </text>
            </g>
          ))}

          {/* Area gradient */}
          <defs>
            <linearGradient id="growthAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#growthAreaGrad)" />

          {/* Total Assets line (secondary, dashed) */}
          {assetsValues.some((v, i) => Math.abs(v - values[i]) > 1) && (
            <path
              d={assetLine}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="6 4"
              opacity="0.5"
            />
          )}

          {/* Net Worth line (primary) */}
          <path d={netLine} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" />

          {/* Hover vertical line + point */}
          {hoverPoint && (
            <g>
              <line
                x1={hoverPoint.x}
                y1={padding.top}
                x2={hoverPoint.x}
                y2={padding.top + chartHeight}
                stroke="#d1d5db"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" fill={lineColor} stroke="#fff" strokeWidth="2" />
            </g>
          )}

          {/* X-axis labels */}
          {xLabels.map((xl, i) => (
            <text key={i} x={xl.x} y={height - 10} textAnchor="middle" fill="#9ca3af" fontSize="10" fontFamily="system-ui">
              {xl.label}
            </text>
          ))}

          {/* Invisible hover zones for better interaction */}
          {netPoints.map((p, i) => (
            <rect
              key={i}
              x={p.x - chartWidth / filtered.length / 2}
              y={padding.top}
              width={chartWidth / filtered.length}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}
        </svg>

        {/* Hover tooltip */}
        {hoverSnap && hoverPoint && (
          <div
            className="absolute pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
            style={{
              left: `${(hoverPoint.x / width) * 100}%`,
              top: `${(hoverPoint.y / height) * 100 - 14}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="font-semibold">{formatCurrency(hoverSnap.netWorthUSD ?? hoverSnap.totalActivosUSD)}</div>
            <div className="text-gray-300">{formatDate(hoverSnap.date)}</div>
            {hoverSnap.note && <div className="text-gray-400 text-[10px]">{hoverSnap.note}</div>}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: lineColor }} />
          <span>{lang === 'es' ? 'Patrimonio Neto' : 'Net Worth'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 rounded border-b border-dashed border-gray-400" />
          <span>{lang === 'es' ? 'Total Activos' : 'Total Assets'}</span>
        </div>
      </div>
    </div>
  )
}

// Allocation donut chart
function AllocationChart({ allocation, t }) {
  const total = allocation.reduce((acc, a) => acc + a.value, 0)
  if (total === 0) return null

  const size = 180
  const cx = size / 2
  const cy = size / 2
  const radius = 65
  const innerRadius = 42

  let cumAngle = -Math.PI / 2
  const arcs = allocation.map((a) => {
    const fraction = a.value / total
    const startAngle = cumAngle
    const endAngle = cumAngle + fraction * 2 * Math.PI
    cumAngle = endAngle

    const largeArc = fraction > 0.5 ? 1 : 0
    const x1 = cx + radius * Math.cos(startAngle)
    const y1 = cy + radius * Math.sin(startAngle)
    const x2 = cx + radius * Math.cos(endAngle - 0.001)
    const y2 = cy + radius * Math.sin(endAngle - 0.001)
    const ix1 = cx + innerRadius * Math.cos(endAngle - 0.001)
    const iy1 = cy + innerRadius * Math.sin(endAngle - 0.001)
    const ix2 = cx + innerRadius * Math.cos(startAngle)
    const iy2 = cy + innerRadius * Math.sin(startAngle)

    const path = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ')

    return { ...a, path, fraction }
  })

  const colorMap = {
    stocks: '#3b82f6',
    crypto: '#f97316',
    bonds: '#10b981',
    funds: '#a855f7',
    banks: '#6b7280',
    other: '#ec4899',
  }

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={colorMap[a.key] || '#6b7280'} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-gray-900 font-bold" fontSize="16">
          {formatCompact(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-gray-400" fontSize="10">
          total
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorMap[a.key] }} />
            <span className="text-gray-600">{t[a.key] || a.key}</span>
            <span className="font-medium text-gray-900 ml-auto">{(a.fraction * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)
  const [lang, setLang] = useState('es')
  const [showAllSnapshots, setShowAllSnapshots] = useState(false)

  const t = labels[lang]

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push('/login')
      } else {
        setUser(currentUser)
      }
      setAuthLoading(false)
    })
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
    await signOut(auth)
    router.push('/login')
  }

  // Computed values
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prevSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null
  const totalAssets = latestSnapshot?.totalActivosUSD ?? 0
  const netWorth = latestSnapshot?.netWorthUSD ?? 0

  const monthlyChange = useMemo(() => {
    if (!latestSnapshot || !prevSnapshot) return null
    const prev = prevSnapshot.netWorthUSD ?? prevSnapshot.totalActivosUSD ?? 0
    const curr = netWorth || totalAssets
    if (prev === 0) return null
    return ((curr - prev) / prev) * 100
  }, [latestSnapshot, prevSnapshot, netWorth, totalAssets])

  const yearStart = useMemo(() => {
    return snapshots.find((s) => {
      if (!s.date) return false
      const d = new Date(s.date)
      const now = new Date()
      return d.getFullYear() === now.getFullYear()
    })
  }, [snapshots])

  const startNetWorth = yearStart?.netWorthUSD ?? yearStart?.totalActivosUSD ?? netWorth
  const returnYTD = startNetWorth > 0 ? ((netWorth - startNetWorth) / startNetWorth) * 100 : 0

  // Allocation by type
  const allocation = useMemo(() => {
    const groups = {}
    items.forEach((item) => {
      const cat = getTypeCategory(item.type)
      const value = (item.quantity || 0) * (item.purchasePrice || 0)
      groups[cat] = (groups[cat] || 0) + value
    })
    return Object.entries(groups)
      .map(([key, value]) => ({ key, value }))
      .filter((a) => a.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [items])

  const recentSnapshots = useMemo(() => {
    const reversed = [...snapshots].reverse()
    return showAllSnapshots ? reversed : reversed.slice(0, 5)
  }, [snapshots, showAllSnapshots])

  const recentTransactions = useMemo(() => [...transactions].reverse().slice(0, 10), [transactions])

  // Loading state
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="mt-4 text-gray-500">{t.loading}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{t.appName}</h1>
              <span className="hidden sm:inline text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {user.email}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                {lang === 'en' ? 'ES' : 'EN'}
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 transition-colors"
              >
                {t.importData}
              </button>
              <button
                onClick={handleSignOut}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                {t.signOut}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <SummaryCard
            label={t.totalAssets}
            value={formatCurrency(totalAssets)}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            iconColor="text-blue-500 bg-blue-50"
          />
          <SummaryCard
            label={t.netWorth}
            value={formatCurrency(netWorth)}
            subtitle={monthlyChange != null ? `${monthlyChange >= 0 ? '+' : ''}${monthlyChange.toFixed(1)}% ${t.monthlyChange}` : null}
            subtitleColor={monthlyChange >= 0 ? 'text-green-600' : 'text-red-500'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            iconColor="text-emerald-500 bg-emerald-50"
          />
          <SummaryCard
            label={t.holdings}
            value={items.length.toString()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
            iconColor="text-purple-500 bg-purple-50"
          />
          <SummaryCard
            label={t.returnYTD}
            value={`${returnYTD >= 0 ? '+' : ''}${returnYTD.toFixed(2)}%`}
            valueColor={returnYTD >= 0 ? 'text-green-600' : 'text-red-500'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
            iconColor={returnYTD >= 0 ? 'text-green-500 bg-green-50' : 'text-red-500 bg-red-50'}
          />
        </div>

        {/* Chart + Allocation Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
          {/* Net Worth Chart */}
          <section className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t.portfolioGrowth}</h2>
            {snapshots.length < 2 ? (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                {t.noChartData}
              </div>
            ) : (
              <PortfolioGrowthChart snapshots={snapshots} lang={lang} />
            )}
          </section>

          {/* Allocation */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.allocation}</h2>
            {allocation.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                {t.noHoldings}
              </div>
            ) : (
              <AllocationChart allocation={allocation} t={t} />
            )}
          </section>
        </div>

        {/* Portfolio Holdings Table */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{t.portfolioHoldings}</h2>
          </div>
          {items.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400">{t.noHoldings}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 sm:px-6 py-3 font-medium">{t.symbol}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium hidden sm:table-cell">{t.name}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium">{t.type}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-right">{t.quantity}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-right">{t.purchasePrice}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-right">{t.totalValue}</th>
                    <th className="px-4 sm:px-6 py-3 font-medium hidden md:table-cell">{t.institution}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => {
                    const cat = getTypeCategory(item.type)
                    const colors = TYPE_COLORS[cat]
                    const totalVal = (item.quantity || 0) * (item.purchasePrice || 0)
                    return (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 sm:px-6 py-3">
                          <span className="font-semibold text-gray-900">{item.symbol || '-'}</span>
                          <span className="sm:hidden block text-xs text-gray-400">{item.name}</span>
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-gray-600 hidden sm:table-cell">{item.name || '-'}</td>
                        <td className="px-4 sm:px-6 py-3">
                          <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${colors.light} ${colors.text}`}>
                            {item.type || '-'}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-right text-gray-900 font-mono text-xs">
                          {item.quantity != null ? Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '-'}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-right text-gray-600 text-xs">
                          {item.purchasePrice != null ? formatCurrency(item.purchasePrice) : '-'}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-right font-medium text-gray-900 text-xs">
                          {totalVal > 0 ? formatCurrency(totalVal) : '-'}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-gray-500 text-xs hidden md:table-cell">{item.institution || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Bottom grid: Snapshots + Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Recent Snapshots */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{t.recentSnapshots}</h2>
              {snapshots.length > 5 && (
                <button
                  onClick={() => setShowAllSnapshots(!showAllSnapshots)}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  {showAllSnapshots ? `Top 5` : `${t.viewAll} (${snapshots.length})`}
                </button>
              )}
            </div>
            {recentSnapshots.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400">{t.noSnapshots}</div>
            ) : (
              <div className="overflow-y-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
                      <th className="px-4 sm:px-6 py-2 font-medium">{t.date}</th>
                      <th className="px-4 sm:px-6 py-2 font-medium text-right">{t.totalActivosUSD}</th>
                      <th className="px-4 sm:px-6 py-2 font-medium text-right">{t.netWorthUSD}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recentSnapshots.map((snap) => (
                      <tr key={snap.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 sm:px-6 py-2.5 text-gray-900 text-xs font-medium">
                          {formatDate(snap.date)}
                          {snap.note && <span className="block text-gray-400 font-normal">{snap.note}</span>}
                        </td>
                        <td className="px-4 sm:px-6 py-2.5 text-right text-gray-900 font-mono text-xs">
                          {formatCurrency(snap.totalActivosUSD)}
                        </td>
                        <td className="px-4 sm:px-6 py-2.5 text-right text-gray-900 font-mono text-xs">
                          {formatCurrency(snap.netWorthUSD)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Transactions */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t.recentTransactions}</h2>
            </div>
            {recentTransactions.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400">{t.noTransactions}</div>
            ) : (
              <div className="overflow-y-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
                      <th className="px-4 sm:px-6 py-2 font-medium">{t.date}</th>
                      <th className="px-4 sm:px-6 py-2 font-medium">{t.symbol}</th>
                      <th className="px-4 sm:px-6 py-2 font-medium">{t.type}</th>
                      <th className="px-4 sm:px-6 py-2 font-medium text-right">{t.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recentTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 sm:px-6 py-2.5 text-gray-600 text-xs">{formatDate(tx.date)}</td>
                        <td className="px-4 sm:px-6 py-2.5 text-gray-900 font-medium text-xs">
                          {tx.symbol || tx.description || '-'}
                        </td>
                        <td className="px-4 sm:px-6 py-2.5">
                          {tx.type && (
                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                              tx.type === 'BUY' || tx.type === 'DEPOSIT'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-red-50 text-red-700'
                            }`}>
                              {tx.type}
                            </span>
                          )}
                        </td>
                        <td className="px-4 sm:px-6 py-2.5 text-right font-mono text-xs text-gray-900">
                          {formatCurrency(tx.totalAmount ?? tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* File Import Modal - only render if component exists */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowImportModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{t.importData}</h2>
            <p className="text-gray-500 text-sm mb-4">
              {lang === 'es'
                ? 'El modulo de importacion completo esta en desarrollo. Por ahora, los datos se pueden agregar directamente via Firestore.'
                : 'The full import module is under development. For now, data can be added directly via Firestore.'}
            </p>
            <button
              onClick={() => setShowImportModal(false)}
              className="w-full py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              {lang === 'es' ? 'Cerrar' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, subtitle, subtitleColor = 'text-green-600', valueColor = 'text-gray-900', icon, iconColor = 'text-blue-500 bg-blue-50' }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs sm:text-sm font-medium text-gray-500">{label}</p>
        {icon && (
          <div className={`p-1.5 rounded-lg ${iconColor}`}>
            {icon}
          </div>
        )}
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${valueColor}`}>{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1 ${subtitleColor}`}>{subtitle}</p>
      )}
    </div>
  )
}
