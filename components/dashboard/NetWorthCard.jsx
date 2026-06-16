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
  const color = trending ? '#34d399' : '#ef4444'

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
    <div className="bg-gradient-to-br from-[#141416] to-[#141416] rounded-2xl border border-[#27272a]/60 p-6 card-hero">
      {/* Greeting + currency picker */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{greeting}</span>
        <div className="flex items-center gap-2">
          {milestone.text && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
              style={milestone.positive
                ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399' }
                : { backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24' }
              }>{milestone.text}</span>
          )}
          <div className="relative" ref={pickerRef}>
            <button onClick={() => setShowPicker(!showPicker)}
              className="text-xs px-2 py-0.5 rounded text-slate-500 hover:bg-slate-700 hover:text-slate-300 transition-colors cursor-pointer border border-transparent hover:border-[#27272a]">
              {displayCur}
            </button>
            {showPicker && (
              <div className="absolute right-0 top-full mt-1 bg-[#1C1C1E] border border-[#27272a] rounded-lg shadow-xl z-10 p-1 min-w-[80px]">
                {QUICK_CURRENCIES.map((c) => (
                  <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                    className="block w-full text-left px-3 py-1.5 text-xs rounded transition-colors"
                    style={displayCur === c ? { color: '#60a5fa', backgroundColor: 'rgba(59,130,246,0.1)' } : { color: '#94a3b8' }}>
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
        <p className="text-[2rem] sm:text-[2.5rem] leading-none text-white tracking-tight font-semibold font-mono tabular-nums">{formatCurrency(displayValue, displayCur)}</p>
        <Sparkline snapshots={snapshots} />
      </div>

      {/* Sub-KPI: Daily change — Level 2 typography */}
      {dailyChange && isFinite(dailyChange.pct) && (
        <p className="text-sm font-medium mt-1" style={{ color: isDayPositive ? '#34d399' : '#f87171' }}>
          <span className="font-mono tabular-nums">{isDayPositive ? '+' : ''}{formatCurrency(cv(dailyChange.abs), displayCur)} ({isDayPositive ? '+' : ''}{dailyChange.pct.toFixed(2)}%)</span>
          <span className="text-slate-600 font-normal ml-1.5 text-xs">{lang === 'es' ? 'hoy' : 'today'}</span>
        </p>
      )}

      {/* Metadata: YTD + yearly — Level 3 typography */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={!hasReturn
            ? { backgroundColor: 'rgba(100,116,139,0.12)', color: '#94a3b8' }
            : isYTDPositive
              ? { backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }
              : { backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171' }
          }>
          {hasYTD ? 'YTD' : sinceStartDate ? (lang === 'es' ? 'Desde ' : 'Since ') + new Date(sinceStartDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' }) : 'YTD'}
          {' '}<span className="font-mono">{hasReturn ? `${isYTDPositive ? '+' : ''}${displayReturn.toFixed(2)}%` : 'N/A'}</span>
          {hasReturn && <span className="opacity-50 ml-0.5" style={{ fontSize: '9px' }}>TWR</span>}
          {hasYTD && <InfoTip text={lang === 'es' ? 'Year-to-Date: retorno total desde el 1 de enero del año en curso.' : 'Year-to-Date: total return since January 1st of the current year.'} />}
        </span>
        {yearlyChange != null && isFinite(yearlyChange) && (
          <span className="text-xs" style={{ color: isYearlyPositive ? 'rgba(74,222,128,0.6)' : 'rgba(248,113,113,0.6)' }}>
            {isYearlyPositive ? '▲' : '▼'} <span className="font-mono">{Math.abs(yearlyChange).toFixed(1)}%</span> {lang === 'es' ? 'vs año ant.' : 'vs prior yr'}
          </span>
        )}
      </div>

      {/* Contributions vs Gains */}
      {netContributions != null && netContributions > 0 && (
        <div className="mt-4 pt-3 border-t border-[#27272a]/50">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-500">{lang === 'es' ? 'Invertido' : 'Invested'}: <span className="text-slate-300 font-medium font-mono tabular-nums">{formatCurrency(cv(netContributions), displayCur)}</span></span>
            <span className="text-slate-500">{lang === 'es' ? 'Ganancia' : 'Gains'}: <span className="font-medium font-mono tabular-nums" style={{ color: displayValue - cv(netContributions) >= 0 ? '#34d399' : '#f87171' }}>{formatCurrency(displayValue - cv(netContributions), displayCur)}</span></span>
          </div>
          <div className="w-full h-1.5 bg-[#27272a]/50 rounded-full overflow-hidden flex">
            {(() => {
              const displayContrib = cv(netContributions)
              const contribPct = displayContrib > 0 && displayValue > 0
                ? Math.min((displayContrib / displayValue) * 100, 100)
                : 100
              return (
                <>
                  <div className="h-full rounded-l-full" style={{ width: `${contribPct}%`, backgroundColor: 'rgba(59,130,246,0.5)' }} />
                  <div className="h-full rounded-r-full" style={{ width: `${Math.max(0, 100 - contribPct)}%`, backgroundColor: 'rgba(52,211,153,0.5)' }} />
                </>
              )
            })()}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(59,130,246,0.5)' }} />{lang === 'es' ? 'Invertido' : 'Invested'}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(52,211,153,0.5)' }} />{lang === 'es' ? 'Ganancias' : 'Gains'}</span>
          </div>
        </div>
      )}

      {/* Cash available */}
      {cashTotal != null && cashTotal > 0 && (
        <div className={`${netContributions > 0 ? 'mt-2' : 'mt-4 pt-3 border-t border-[#27272a]/50'} flex items-center justify-between`}>
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(6,182,212,0.6)' }} />
            {lang === 'es' ? 'Disponible' : 'Cash available'}
          </span>
          <span className="text-xs font-medium font-mono tabular-nums" style={{ color: '#22d3ee' }}>{formatCurrency(cv(cashTotal), displayCur)}</span>
        </div>
      )}
    </div>
  )
}
