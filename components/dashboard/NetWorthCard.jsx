'use client'

import { useState } from 'react'
import { formatCurrency, getBaseCurrency } from './utils'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, yearlyChange, convert, lang, netContributions }) {
  const isYTDPositive = returnYTD >= 0
  const isYearlyPositive = (yearlyChange ?? 0) >= 0
  const baseCur = getBaseCurrency()
  const [tempCurrency, setTempCurrency] = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  const displayCur = tempCurrency || baseCur
  const displayValue = tempCurrency && convert
    ? convert(netWorth, baseCur, tempCurrency)
    : netWorth

  return (
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-400">{lang === 'es' ? 'Portafolio' : 'Portfolio'}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isYTDPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            YTD {isYTDPositive ? '+' : ''}{returnYTD.toFixed(2)}% {formatCurrency(Math.abs(ytdChange))}
          </span>
        </div>
        <div className="relative">
          <button onClick={() => setShowPicker(!showPicker)}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300 transition-colors cursor-pointer">
            {displayCur}
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 bg-[#1e293b] border border-[#334155] rounded-lg shadow-xl z-10 p-1 min-w-[80px]">
              {QUICK_CURRENCIES.map((c) => (
                <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] rounded transition-colors ${
                    displayCur === c ? 'text-blue-400 bg-blue-500/10' : 'text-slate-400 hover:text-white hover:bg-[#283548]'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-3xl font-bold text-white mb-1">{formatCurrency(displayValue, displayCur)}</p>
      {yearlyChange != null && (
        <p className={`text-[10px] mt-1 ${isYearlyPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isYearlyPositive ? '▲' : '▼'} {Math.abs(yearlyChange).toFixed(1)}% {lang === 'es' ? 'vs año anterior' : 'vs last year'}
        </p>
      )}

      {netContributions != null && netContributions > 0 && (
        <div className="mt-3 pt-3 border-t border-[#334155]/50">
          <div className="flex items-center justify-between text-[10px] mb-1.5">
            <span className="text-slate-500">{lang === 'es' ? 'Aportes' : 'Contributed'}: <span className="text-slate-300 font-medium">{formatCurrency(netContributions)}</span></span>
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
          <div className="flex items-center gap-3 mt-1 text-[8px] text-slate-600">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/60" />{lang === 'es' ? 'Aportes' : 'Contributions'}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />{lang === 'es' ? 'Ganancias' : 'Gains'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
