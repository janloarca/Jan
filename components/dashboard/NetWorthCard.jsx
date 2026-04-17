'use client'

import { formatCurrency } from './utils'

export default function NetWorthCard({ netWorth, totalAssets, returnYTD, ytdChange, monthlyChange, lang }) {
  const isYTDPositive = returnYTD >= 0
  const isMonthlyPositive = monthlyChange >= 0

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-400">Net Worth</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">Base</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isYTDPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            YTD {isYTDPositive ? '+' : ''}{returnYTD.toFixed(2)}% {formatCurrency(Math.abs(ytdChange))}
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-400">USD</span>
      </div>
      <p className="text-3xl font-bold text-white mb-1">{formatCurrency(netWorth)}</p>
      <p className="text-xs text-slate-500">~ {formatCurrency(totalAssets)}</p>
      {monthlyChange != null && (
        <p className={`text-[10px] mt-2 ${isMonthlyPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isMonthlyPositive ? '▲' : '▼'} {Math.abs(monthlyChange).toFixed(1)}% {lang === 'es' ? 'vs mes anterior' : 'vs last month'}
        </p>
      )}
    </div>
  )
}
