'use client'

import { useState } from 'react'
import { formatCurrency, getBaseCurrency } from './utils'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

function getGreeting(lang) {
  const hour = new Date().getHours()
  if (hour < 12) return lang === 'es' ? 'Buenos días' : 'Good morning'
  if (hour < 18) return lang === 'es' ? 'Buenas tardes' : 'Good afternoon'
  return lang === 'es' ? 'Buenas noches' : 'Good evening'
}

function getMilestone(netWorth, returnYTD, lang) {
  if (returnYTD > 20) return { text: lang === 'es' ? 'Año increíble' : 'Incredible year', color: 'text-emerald-400' }
  if (returnYTD > 10) return { text: lang === 'es' ? 'Gran rendimiento' : 'Strong returns', color: 'text-emerald-400' }
  if (returnYTD > 0) return { text: lang === 'es' ? 'En positivo' : 'In the green', color: 'text-emerald-400' }
  if (returnYTD > -5) return { text: lang === 'es' ? 'Mantente firme' : 'Stay steady', color: 'text-amber-400' }
  return { text: lang === 'es' ? 'Los mercados se recuperan' : 'Markets recover', color: 'text-amber-400' }
}

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, yearlyChange, dailyChange, convert, lang, netContributions, cashTotal }) {
  const isYTDPositive = returnYTD >= 0
  const isYearlyPositive = (yearlyChange ?? 0) >= 0
  const isDayPositive = dailyChange ? dailyChange.abs >= 0 : true
  const baseCur = getBaseCurrency()
  const [tempCurrency, setTempCurrency] = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  const displayCur = tempCurrency || baseCur
  const displayValue = tempCurrency && convert
    ? convert(netWorth, baseCur, tempCurrency)
    : netWorth

  const greeting = getGreeting(lang)
  const milestone = getMilestone(netWorth, returnYTD, lang)

  return (
    <div className="bg-gradient-to-br from-[#1e293b] to-[#1a2536] rounded-2xl border border-[#334155]/60 p-6 card-hero">
      {/* Greeting + milestone */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-400">{greeting}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${milestone.color}`}>{milestone.text}</span>
          <div className="relative">
            <button onClick={() => setShowPicker(!showPicker)}
              className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300 transition-colors cursor-pointer">
              {displayCur}
            </button>
            {showPicker && (
              <div className="absolute right-0 top-full mt-1 bg-[#1e293b] border border-[#334155] rounded-lg shadow-xl z-10 p-1 min-w-[80px]">
                {QUICK_CURRENCIES.map((c) => (
                  <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                      displayCur === c ? 'text-blue-400 bg-blue-500/10' : 'text-slate-400 hover:text-white hover:bg-[#283548]'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main value */}
      <p className="text-4xl font-black text-white mb-1 tracking-tight">{formatCurrency(displayValue, displayCur)}</p>

      {/* Daily change */}
      {dailyChange && (
        <p className={`text-sm font-medium ${isDayPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isDayPositive ? '+' : ''}{formatCurrency(dailyChange.abs, displayCur)} ({isDayPositive ? '+' : ''}{dailyChange.pct.toFixed(2)}%)
          <span className="text-slate-500 font-normal ml-1">{lang === 'es' ? 'hoy' : 'today'}</span>
        </p>
      )}

      {/* YTD + yearly in a compact row */}
      <div className="flex items-center gap-3 mt-1.5">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          isYTDPositive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
        }`}>
          YTD {isYTDPositive ? '+' : ''}{returnYTD.toFixed(2)}%
        </span>
        {yearlyChange != null && (
          <span className={`text-xs ${isYearlyPositive ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
            {isYearlyPositive ? '▲' : '▼'} {Math.abs(yearlyChange).toFixed(1)}% {lang === 'es' ? 'vs año anterior' : 'vs prior year'}
          </span>
        )}
      </div>

      {/* Contributions vs Gains */}
      {netContributions != null && netContributions > 0 && (
        <div className="mt-3 pt-3 border-t border-[#334155]/50">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-500">{lang === 'es' ? 'Invertido' : 'Invested'}: <span className="text-slate-300 font-medium">{formatCurrency(netContributions)}</span></span>
            <span className="text-slate-500">{lang === 'es' ? 'Ganancia' : 'Gains'}: <span className={`font-medium ${displayValue - netContributions >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(displayValue - netContributions)}</span></span>
          </div>
          <div className="w-full h-1.5 bg-slate-700/30 rounded-full overflow-hidden flex">
            {(() => {
              const contribPct = netContributions > 0 && displayValue > 0
                ? Math.min((netContributions / displayValue) * 100, 100)
                : 100
              return (
                <>
                  <div className="h-full bg-blue-500/60 rounded-l-full" style={{ width: `${contribPct}%` }} />
                  <div className="h-full bg-emerald-500/60 rounded-r-full" style={{ width: `${Math.max(0, 100 - contribPct)}%` }} />
                </>
              )
            })()}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/60" />{lang === 'es' ? 'Invertido' : 'Invested'}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />{lang === 'es' ? 'Ganancias' : 'Gains'}</span>
          </div>
        </div>
      )}

      {/* Cash available */}
      {cashTotal != null && cashTotal > 0 && (
        <div className={`${netContributions > 0 ? 'mt-2' : 'mt-3 pt-3 border-t border-[#334155]/50'} flex items-center justify-between`}>
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/60" />
            {lang === 'es' ? 'Disponible' : 'Cash available'}
          </span>
          <span className="text-xs font-medium text-cyan-400">{formatCurrency(cashTotal, displayCur)}</span>
        </div>
      )}
    </div>
  )
}
