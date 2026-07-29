'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { formatCurrency, getBaseCurrency, getTypeCategory, getItemValue, isExcludedFromNetWorth, TYPE_COLORS, CHART_PALETTE } from './utils'
import { InfoTip } from '../ui/Tooltip'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos', en: 'Funds' },
  stocks: { es: 'Acciones', en: 'Stocks' },
  crypto: { es: 'Cripto', en: 'Crypto' },
  alternatives: { es: 'Alternativos', en: 'Alternatives' },
  bonds: { es: 'Bonos', en: 'Bonds' },
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  receivables: { es: 'Por Cobrar', en: 'Receivables' },
  other: { es: 'Otros', en: 'Other' },
}

function getGreeting(lang) {
  const hour = new Date().getHours()
  if (hour < 12) return lang === 'es' ? 'Buenos días' : 'Good morning'
  if (hour < 18) return lang === 'es' ? 'Buenas tardes' : 'Good afternoon'
  return lang === 'es' ? 'Buenas noches' : 'Good evening'
}

function getMilestone(netWorth, returnYTD, lang) {
  if (returnYTD == null) return { text: lang === 'es' ? 'Acumulando datos' : 'Gathering data', positive: false }
  if (returnYTD > 20) return { text: lang === 'es' ? 'Año increíble' : 'Incredible year', positive: true }
  if (returnYTD > 10) return { text: lang === 'es' ? 'Gran rendimiento' : 'Strong returns', positive: true }
  if (returnYTD > 0) return { text: lang === 'es' ? 'En positivo' : 'In the green', positive: true }
  if (returnYTD > -5) return { text: lang === 'es' ? 'Mantente firme' : 'Stay steady', positive: false }
  return { text: lang === 'es' ? 'Los mercados se recuperan' : 'Markets recover', positive: false }
}

function Sparkline({ snapshots, width = 60, height = 24 }) {
  if (!snapshots || snapshots.length < 2) return null
  const recent = snapshots.slice(-30)
  const values = recent.map(s => s.netWorthUSD ?? s.totalActivosUSD ?? 0).filter(v => v > 0)
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const trending = values[values.length - 1] >= values[0]
  const color = trending ? 'var(--accent-green)' : 'var(--text-negative)'

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  const gradientId = `spark-${trending ? 'up' : 'down'}`

  return (
    <svg width={width} height={height} className="inline-block ml-2 align-middle" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, yearlyChange, dailyChange, convert, lang, netContributions, cashTotal, snapshots, items, contributionWarning, onLogFlow }) {
  const hasYTD = returnYTD != null && isFinite(returnYTD)
  const displayReturn = hasYTD ? returnYTD : (returnSinceStart != null && isFinite(returnSinceStart) ? returnSinceStart : null)
  const hasReturn = displayReturn != null
  const isYTDPositive = (displayReturn ?? 0) >= 0
  const isYearlyPositive = (yearlyChange ?? 0) >= 0
  const isDayPositive = dailyChange ? dailyChange.abs >= 0 : true
  const baseCur = getBaseCurrency()
  const [tempCurrency, setTempCurrency] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const displayCur = tempCurrency || baseCur
  const cv = (val) => tempCurrency && convert ? convert(val, baseCur, tempCurrency) : val
  const displayValue = cv(netWorth)

  const greeting = getGreeting(lang)
  const milestone = getMilestone(netWorth, displayReturn, lang)

  // Asset-class composition of net worth — fills the card and explains where
  // the money sits. Percentages are currency-agnostic; values use cv() so they
  // follow the temporary currency picker like the rest of the card.
  const allocation = useMemo(() => {
    if (!items || items.length === 0) return []
    const byGroup = {}
    let total = 0
    items.forEach((it) => {
      if (it.isDebt || isExcludedFromNetWorth(it)) return
      const val = getItemValue(it)
      if (val <= 0) return
      const key = getTypeCategory(it)
      byGroup[key] = (byGroup[key] || 0) + val
      total += val
    })
    let segs = Object.entries(byGroup)
      .map(([name, value], i) => ({
        name, value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: TYPE_COLORS[name]?.bg || CHART_PALETTE[i % CHART_PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
    if (segs.length > 5) {
      const tail = segs.slice(4)
      segs = segs.slice(0, 4)
      segs.push({
        name: '_more', isOther: true, count: tail.length,
        value: tail.reduce((s, x) => s + x.value, 0),
        pct: tail.reduce((s, x) => s + x.pct, 0),
        color: 'var(--text-muted)',
      })
    }
    return segs
  }, [items])

  const catLabel = (seg) => seg.isOther
    ? (lang === 'es' ? `Otros (${seg.count})` : `Others (${seg.count})`)
    : (CATEGORY_LABELS[seg.name]?.[lang] || seg.name)

  // Biggest movers of the day — per-asset intraday % change, ordered by the
  // magnitude of the move (gainers and losers mixed). Deduped by item id (two
  // distinct holdings sharing a symbol must not shadow each other) and gated by
  // position weight: a $5 position's ±10% shouldn't headline the card.
  const movers = useMemo(() => {
    if (!items || items.length === 0) return []
    const eligible = items.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
    const total = eligible.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const minValue = total * 0.005 // ≥0.5% of the portfolio
    const seen = new Set()
    const list = []
    eligible.forEach((it) => {
      if (it.change1d == null || !isFinite(it.change1d)) return
      if (Math.abs(getItemValue(it)) < minValue) return
      const key = it.id || it.symbol || it.name
      const label = it.symbol || it.name
      if (!label || seen.has(key)) return
      seen.add(key)
      list.push({ label, pct: it.change1d })
    })
    return list.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5)
  }, [items])

  return (
    <div className="bg-gradient-to-br from-theme-card to-theme-surface rounded-2xl p-5 card-hero h-full flex flex-col"
      style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
      {/* Greeting + currency picker */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{greeting}</span>
        <div className="flex items-center gap-2">
          {milestone.text && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={milestone.positive
                ? { backgroundColor: 'rgba(52,211,153,0.1)', color: 'var(--accent-green)' }
                : { backgroundColor: 'var(--alert-warn-bg)', color: 'var(--accent-orange)' }
              }>{milestone.text}</span>
          )}
          <div className="relative" ref={pickerRef}>
            <button onClick={() => setShowPicker(!showPicker)}
              className="text-xs px-2 py-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              style={{ border: '1px solid transparent', ...(showPicker ? { backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: 'var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)' } : {}) }}>
              {displayCur}
            </button>
            {showPicker && (
              <div className="absolute right-0 top-full mt-1 bg-theme-card/80 rounded-lg z-10 p-1 min-w-[80px]"
                style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
                {QUICK_CURRENCIES.map((c) => (
                  <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                    className="block w-full text-left px-3 py-1.5 text-xs rounded transition-colors"
                    style={displayCur === c ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.1)' } : { color: 'var(--text-secondary)' }}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI: Main value — Level 1 typography */}
      <div className="flex items-baseline gap-2 mb-0.5">
        <p className="text-[2.25rem] sm:text-[3rem] leading-none text-white tracking-tight font-bold font-mono tabular-nums drop-shadow-sm">{formatCurrency(displayValue, displayCur)}</p>
        <Sparkline snapshots={snapshots} />
      </div>

      {/* Sub-KPI: Daily change — Level 2 typography */}
      {dailyChange && isFinite(dailyChange.pct) && (
        <p className="text-sm font-medium mt-1" style={{ color: isDayPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>
          <span className="font-mono tabular-nums">{isDayPositive ? '+' : ''}{formatCurrency(cv(dailyChange.abs), displayCur)} ({isDayPositive ? '+' : ''}{dailyChange.pct.toFixed(2)}%)</span>
          <span className="text-slate-600 font-normal ml-1.5 text-xs">{lang === 'es' ? 'hoy' : 'today'}</span>
        </p>
      )}

      {/* Metadata: YTD + yearly — Level 3 typography */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={!hasReturn
            ? { backgroundColor: 'rgba(100,116,139,0.12)', color: 'var(--text-secondary)' }
            : isYTDPositive
              ? { backgroundColor: 'rgba(52,211,153,0.12)', color: 'var(--accent-green)' }
              : { backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--text-negative)' }
          }>
          {hasYTD ? 'YTD' : sinceStartDate ? (lang === 'es' ? 'Desde ' : 'Since ') + new Date(sinceStartDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' }) : 'YTD'}
          {' '}<span className="font-mono">{hasReturn ? `${isYTDPositive ? '+' : ''}${displayReturn.toFixed(2)}%` : 'N/A'}</span>
          {hasReturn && <span className="opacity-50 ml-0.5" style={{ fontSize: '9px' }}>Dietz</span>}
          {hasYTD && <InfoTip text={lang === 'es' ? 'Year-to-Date: retorno desde el 1 de enero del año en curso. Calculado con el método Dietz Modificado, que descuenta tus depósitos y retiros para que solo cuente lo que ganaron tus inversiones (no el dinero nuevo que metiste).' : 'Year-to-Date: return since January 1st of the current year. Calculated with the Modified Dietz method, which adjusts for your deposits and withdrawals so only investment performance counts (not new money you put in).'} />}
        </span>
        {yearlyChange != null && isFinite(yearlyChange) && (
          <span className="text-xs" style={{ color: isYearlyPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {isYearlyPositive ? '▲' : '▼'} <span className="font-mono">{Math.abs(yearlyChange).toFixed(1)}%</span> {lang === 'es' ? 'vs año ant.' : 'vs prior yr'}
          </span>
        )}
      </div>

      {/* Quiet, non-alarming nudge: big growth with few logged deposits may mean
          unrecorded contributions. A muted tip, NOT an amber warning banner. */}
      {contributionWarning && (
        <div className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="shrink-0">ⓘ</span>
          <span>
            {lang === 'es'
              ? 'Para un retorno más preciso, agrega tus depósitos y retiros.'
              : 'For a more accurate return, add your deposits and withdrawals.'}
            {onLogFlow && (
              <button onClick={onLogFlow} className="ml-1 underline transition-colors" style={{ color: 'var(--accent-blue)' }}>
                {lang === 'es' ? 'Registrar' : 'Log'}
              </button>
            )}
          </span>
        </div>
      )}

      {/* Composition — fills the card, shows where the net worth sits */}
      {allocation.length > 0 && (
        <div className="mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2.5 block">{lang === 'es' ? 'Composición' : 'Composition'}</span>
          {/* Stacked bar */}
          <div className="w-full h-2.5 rounded-full overflow-hidden flex mb-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {allocation.map((seg) => (
              <div key={seg.name} className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${Math.max(seg.pct, 0.5)}%`, backgroundColor: seg.color }}
                title={`${catLabel(seg)} · ${seg.pct.toFixed(1)}%`} />
            ))}
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
            {allocation.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between gap-2 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-xs text-slate-400 truncate">{catLabel(seg)}</span>
                </span>
                <span className="text-xs font-medium font-mono tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>{seg.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Biggest movers of the day — fills the remaining height */}
      {movers.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0 mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2.5 block">{lang === 'es' ? 'Mayores movimientos hoy' : "Today's biggest movers"}</span>
          <div className="flex-1 flex flex-col justify-evenly">
            {movers.map((m) => {
              const up = m.pct >= 0
              return (
                <div key={m.label} className="flex items-center justify-between py-0.5">
                  <span className="text-sm text-slate-300 font-medium truncate pr-2">{m.label}</span>
                  <span className="text-sm font-mono tabular-nums font-medium shrink-0" style={{ color: up ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {up ? '▲' : '▼'} {up ? '+' : ''}{m.pct.toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cash available — anchored at the bottom */}
      {cashTotal != null && cashTotal > 0 && (
        <div className="mt-auto pt-3 border-t border-glass-border/50 flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)', opacity: 0.6 }} />
            {lang === 'es' ? 'Disponible' : 'Cash available'}
          </span>
          <span className="text-xs font-medium font-mono tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{formatCurrency(cv(cashTotal), displayCur)}</span>
        </div>
      )}
    </div>
  )
}
