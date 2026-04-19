'use client'

import { useState } from 'react'
import { formatCurrency, getBaseCurrency } from './utils'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, yearlyChange, convert, lang }) {
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
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
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
            <div className="absolute right-0 top-full mt-1 bg-[#131c2e] border border-[#1e2d45] rounded-lg shadow-xl z-10 p-1 min-w-[80px]">
              {QUICK_CURRENCIES.map((c) => (
                <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] rounded transition-colors ${
                    displayCur === c ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-white hover:bg-[#1a2540]'
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
    </div>
  )
}
