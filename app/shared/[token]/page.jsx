'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { formatCurrency, getItemPrice, getItemValue, getTypeCategory, TYPE_COLORS, TYPE_ICONS } from '@/components/dashboard/utils'

export default function SharedPortfolioPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/share?token=${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error)))
      .then(setData)
      .catch((e) => setError(typeof e === 'string' ? e : 'Invalid or expired link'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-theme-base flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading portfolio...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-theme-base flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-white mb-2">Portfolio Not Found</h1>
          <p className="text-slate-400">{error || 'This link is invalid or has expired.'}</p>
        </div>
      </div>
    )
  }

  return <SharedDashboard items={data.items} snapshots={data.snapshots} baseCurrency={data.baseCurrency} />
}

function SharedDashboard({ items, snapshots, baseCurrency }) {
  const [theme, setTheme] = useState('dark')

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
  }, [theme])
  const totalAssets = useMemo(() =>
    items.reduce((s, it) => {
      const val = getItemValue(it)
      return val > 0 ? s + val : s
    }, 0),
    [items]
  )

  const totalDebts = useMemo(() =>
    items.reduce((s, it) => {
      const val = getItemValue(it)
      return val < 0 ? s + Math.abs(val) : s
    }, 0),
    [items]
  )

  const netWorth = totalAssets - totalDebts

  const byCategory = useMemo(() => {
    const cats = {}
    items.forEach((it) => {
      if (it.isDebt) return
      const cat = getTypeCategory(it)
      const val = getItemValue(it)
      if (val > 0) cats[cat] = (cats[cat] || 0) + val
    })
    return Object.entries(cats).sort((a, b) => b[1] - a[1])
  }, [items])

  const growthPct = useMemo(() => {
    if (snapshots.length < 2) return null
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date))
    const first = sorted[0].netWorthUSD ?? sorted[0].totalActivosUSD ?? 0
    const last = sorted[sorted.length - 1].netWorthUSD ?? sorted[sorted.length - 1].totalActivosUSD ?? 0
    if (first <= 0) return null
    return ((last - first) / first) * 100
  }, [snapshots])

  const topHoldings = useMemo(() =>
    [...items]
      .filter((it) => !it.isDebt)
      .map((it) => ({ ...it, value: getItemValue(it) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    [items]
  )

  const catColors = {
    stocks: '#3b82f6', crypto: '#f59e0b', funds: '#34d399', bonds: '#8b5cf6',
    banks: '#06b6d4', realestate: '#ec4899', alternatives: '#f97316', debts: '#ef4444', other: '#64748b',
  }

  return (
    <div className="min-h-screen bg-theme-base">
      <header className="border-b border-glass-border bg-theme-card/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg" style={{ color: 'var(--accent-green)' }}>Chispudo</span>
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Read-only</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const rows = [['Name', 'Symbol', 'Type', 'Qty', 'Price', 'Value', 'Allocation'].join(',')]
              items.filter((it) => !it.isDebt).forEach((it) => {
                const val = (it.quantity || 0) * getItemPrice(it)
                const pct = totalAssets > 0 ? (val / totalAssets * 100).toFixed(2) : '0'
                rows.push([it.name || '', it.symbol || '', it.type || '', it.quantity || 0, getItemPrice(it).toFixed(2), val.toFixed(2), pct + '%'].join(','))
              })
              const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `portfolio-${new Date().toISOString().split('T')[0]}.csv`
              a.click()
            }}
              className="px-2 py-1 text-xs text-slate-500 border border-glass-border rounded hover:bg-theme-elevated transition-colors">
              CSV
            </button>
            <button onClick={toggleTheme}
              className="px-2 py-1 text-xs text-slate-500 border border-glass-border rounded hover:bg-theme-elevated transition-colors">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <span className="text-xs text-slate-500">Advisor View</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Net Worth */}
        <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-6">
          <span className="text-xs text-slate-500 block mb-1">Net Worth</span>
          <div className="text-3xl font-bold text-white">{formatCurrency(netWorth)}</div>
          <div className="flex gap-6 mt-3 text-sm">
            <div>
              <span className="text-slate-500">Assets: </span>
              <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{formatCurrency(totalAssets)}</span>
            </div>
            {totalDebts > 0 && (
              <div>
                <span className="text-slate-500">Debts: </span>
                <span className="font-medium" style={{ color: 'var(--text-negative)' }}>-{formatCurrency(totalDebts)}</span>
              </div>
            )}
            {growthPct != null && (
              <div>
                <span className="text-slate-500">All-time: </span>
                <span className="font-medium" style={{ color: growthPct >= 0 ? '#34d399' : '#f87171' }}>
                  {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Asset Allocation */}
          <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Asset Allocation</h3>
            <div className="space-y-2">
              {byCategory.map(([cat, val]) => {
                const pct = totalAssets > 0 ? (val / totalAssets) * 100 : 0
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 capitalize flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: catColors[cat] || catColors.other }} />
                        {cat}
                      </span>
                      <span className="text-slate-400">{pct.toFixed(1)}% · {formatCurrency(val)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: catColors[cat] || catColors.other }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-glass-border/30 text-xs text-slate-500">
              {items.filter((it) => !it.isDebt).length} positions · {baseCurrency}
            </div>
          </div>

          {/* Top Holdings */}
          <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Top Holdings</h3>
            <div className="space-y-2">
              {topHoldings.map((it) => {
                const pct = totalAssets > 0 ? (it.value / totalAssets) * 100 : 0
                const cat = getTypeCategory(it)
                return (
                  <div key={it.id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColors[cat] || catColors.other }} />
                      <span className="text-sm text-white truncate">{it.name || it.symbol}</span>
                      {it.symbol && <span className="text-xs text-slate-500">{it.symbol}</span>}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className="text-sm text-white font-medium">{formatCurrency(it.value)}</span>
                      <span className="text-xs text-slate-500 ml-2">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Portfolio Growth */}
        {snapshots.length >= 2 && (
          <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Portfolio Growth</h3>
            <GrowthChart snapshots={snapshots} />
          </div>
        )}

        {/* Risk Overview */}
        <RiskOverview items={items} totalAssets={totalAssets} byCategory={byCategory} />

        {/* Income & Maturity Summary */}
        <IncomeMaturitySummary items={items} />

        <div className="text-center text-xs text-slate-600 pt-4">
          Shared via <span style={{ color: 'rgba(52,211,153,0.6)' }}>Chispudo</span> · chispu.xyz
        </div>
      </main>
    </div>
  )
}

function GrowthChart({ snapshots }) {
  const sorted = useMemo(() =>
    [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [snapshots]
  )
  const values = sorted.map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0).filter((v) => v > 0)

  if (values.length < 2) return <div className="text-sm text-slate-500">Not enough data</div>

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const w = 100
  const h = 30
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  })

  const areaPoints = [...points, `${w},${h}`, `0,${h}`].join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        <polygon points={areaPoints} fill="url(#grad)" />
        <polyline points={points.join(' ')} fill="none" stroke="#3b82f6" strokeWidth="0.5" />
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <span>{sorted[0].date?.slice(0, 10)}</span>
        <span>{formatCurrency(values[values.length - 1])}</span>
        <span>{sorted[sorted.length - 1].date?.slice(0, 10)}</span>
      </div>
    </div>
  )
}

function IncomeMaturitySummary({ items }) {
  const incomeItems = useMemo(() =>
    items.filter((it) => !it.isDebt && (it.incomeRate > 0 || it.dividendYield > 0 || (it.rateType === 'variable' && it.rateMin > 0))),
    [items]
  )

  const maturingItems = useMemo(() => {
    const now = new Date()
    return items.filter((it) => it.maturityDate && new Date(it.maturityDate) > now)
      .sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate))
  }, [items])

  const totalEstIncome = useMemo(() =>
    incomeItems.reduce((s, it) => {
      const balance = (it.quantity || 1) * getItemPrice(it)
      const rate = it.rateType === 'variable' && it.rateMin > 0
        ? (it.rateMin + it.rateMax) / 2
        : it.incomeRate || it.dividendYield || 0
      return s + balance * (rate / 100)
    }, 0),
    [incomeItems]
  )

  if (incomeItems.length === 0 && maturingItems.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {incomeItems.length > 0 && (
        <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Estimated Annual Income</h3>
          <div className="text-2xl font-bold mb-3" style={{ color: 'var(--accent-green)' }}>{formatCurrency(totalEstIncome)}</div>
          <div className="space-y-1.5">
            {incomeItems.slice(0, 6).map((it) => {
              const rate = it.rateType === 'variable' ? `${it.rateMin}-${it.rateMax}%` : `${it.incomeRate || it.dividendYield}%`
              return (
                <div key={it.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{it.name || it.symbol}</span>
                  <span style={{ color: 'var(--accent-green)' }}>{rate}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {maturingItems.length > 0 && (
        <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Upcoming Maturities</h3>
          <div className="space-y-2">
            {maturingItems.slice(0, 6).map((it) => {
              const days = Math.ceil((new Date(it.maturityDate) - new Date()) / 86400000)
              const val = (it.quantity || 1) * getItemPrice(it)
              const color = days <= 90 ? '#f87171' : days <= 365 ? '#fbbf24' : '#34d399'
              return (
                <div key={it.id} className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-300">{it.name || it.symbol}</span>
                    <span className="ml-2" style={{ color }}>
                      {days <= 30 ? `${days}d` : days <= 365 ? `${Math.round(days / 30)}mo` : `${(days / 365).toFixed(1)}yr`}
                    </span>
                  </div>
                  <span className="text-white font-medium">{formatCurrency(val)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function RiskOverview({ items, totalAssets, byCategory }) {
  const metrics = useMemo(() => {
    const nonDebt = items.filter((it) => !it.isDebt)
    const values = nonDebt.map((it) => {
      const v = (it.quantity || 0) * getItemPrice(it)
      return v > 0 ? v : 0
    }).filter((v) => v > 0)

    if (values.length === 0 || totalAssets <= 0) return null

    const weights = values.map((v) => v / totalAssets)
    const hhi = weights.reduce((s, w) => s + w * w, 0) * 10000
    const maxConcentration = Math.max(...weights) * 100

    const catCount = byCategory.length
    let diversificationScore = 100
    if (hhi > 5000) diversificationScore -= 30
    else if (hhi > 2500) diversificationScore -= 15
    if (maxConcentration > 50) diversificationScore -= 25
    else if (maxConcentration > 30) diversificationScore -= 10
    if (catCount < 3) diversificationScore -= 20
    else if (catCount < 5) diversificationScore -= 5
    diversificationScore = Math.max(0, Math.min(100, diversificationScore))

    const top3Weight = weights.sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0) * 100

    return { hhi: Math.round(hhi), maxConcentration, diversificationScore, catCount, positionCount: values.length, top3Weight }
  }, [items, totalAssets, byCategory])

  if (!metrics) return null

  const scoreColor = metrics.diversificationScore >= 70 ? '#34d399' : metrics.diversificationScore >= 40 ? '#fbbf24' : '#f87171'
  const scoreLabel = metrics.diversificationScore >= 70 ? 'Good' : metrics.diversificationScore >= 40 ? 'Moderate' : 'Concentrated'

  return (
    <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-5">
      <h3 className="text-sm font-medium text-slate-400 mb-4">Risk Overview</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold" style={{ color: scoreColor }}>{metrics.diversificationScore}</div>
          <div className="text-xs text-slate-500">Diversification</div>
          <div className="text-xs" style={{ color: scoreColor }}>{scoreLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{metrics.positionCount}</div>
          <div className="text-xs text-slate-500">Positions</div>
          <div className="text-xs text-slate-600">{metrics.catCount} categories</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{metrics.maxConcentration.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">Largest Position</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{metrics.top3Weight.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">Top 3 Weight</div>
        </div>
      </div>
    </div>
  )
}
