'use client'

import { useState, useEffect, useRef } from 'react'
import { formatCurrency, getBaseCurrency } from './utils'
import { InfoTip } from '../ui/Tooltip'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

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

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, yearlyChange, dailyChange, convert, lang, netContributions, cashTotal, snapshots }) {
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

  return (
    <div className="bg-gradient-to-br from-theme-card to-theme-surface rounded-2xl p-6 card-hero"
      style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
      {/* Greeting + currency picker */}
      <div className="flex items-center justify-between mb-4">
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
                    style={displayCur === c ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(59,130,246,0.1)' } : { color: 'var(--text-secondary)' }}>
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
          {hasReturn && <span className="opacity-50 ml-0.5" style={{ fontSize: '9px' }}>TWR</span>}
          {hasYTD && <InfoTip text={lang === 'es' ? 'Year-to-Date: retorno desde el 1 de enero del año en curso. Calculado con TWR (Time-Weighted Return), que descuenta tus depósitos y retiros para medir el rendimiento real de tus inversiones.' : 'Year-to-Date: return since January 1st of the current year. Calculated using TWR (Time-Weighted Return), which excludes your deposits and withdrawals to measure true investment performance.'} />}
        </span>
        {yearlyChange != null && isFinite(yearlyChange) && (
          <span className="text-xs" style={{ color: isYearlyPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {isYearlyPositive ? '▲' : '▼'} <span className="font-mono">{Math.abs(yearlyChange).toFixed(1)}%</span> {lang === 'es' ? 'vs año ant.' : 'vs prior yr'}
          </span>
        )}
      </div>

      {/* Contributions vs Gains */}
      {netContributions != null && netContributions > 0 && (
        <div className="mt-4 pt-3 border-t border-glass-border/50">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-500">{lang === 'es' ? 'Invertido' : 'Invested'}: <span className="text-slate-300 font-medium font-mono tabular-nums">{formatCurrency(cv(netContributions), displayCur)}</span></span>
            <span className="text-slate-500">{lang === 'es' ? 'Ganancia' : 'Gains'}: <span className="font-medium font-mono tabular-nums" style={{ color: displayValue - cv(netContributions) >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>{formatCurrency(displayValue - cv(netContributions), displayCur)}</span></span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden flex" style={{ backgroundColor: 'rgba(127,127,127,0.15)' }}>
            {(() => {
              const displayContrib = cv(netContributions)
              const contribPct = displayContrib > 0 && displayValue > 0
                ? Math.min((displayContrib / displayValue) * 100, 100)
                : 100
              return (
                <>
                  <div className="h-full rounded-l-full" style={{ width: `${contribPct}%`, backgroundColor: 'var(--accent-blue)' }} />
                  <div className="h-full rounded-r-full" style={{ width: `${Math.max(0, 100 - contribPct)}%`, backgroundColor: 'var(--accent-green)' }} />
                </>
              )
            })()}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent-blue)' }} />{lang === 'es' ? 'Invertido' : 'Invested'}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent-green)' }} />{lang === 'es' ? 'Ganancias' : 'Gains'}</span>
          </div>
        </div>
      )}

      {/* Cash available */}
      {cashTotal != null && cashTotal > 0 && (
        <div className={`${netContributions > 0 ? 'mt-2' : 'mt-4 pt-3 border-t border-glass-border/50'} flex items-center justify-between`}>
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
