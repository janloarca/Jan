'use client'

import { formatCurrency } from './utils'

export default function TopMovers({ items, lang }) {
  if (!items || items.length === 0) return null

  const withReturn = items
    .filter((it) => it.purchasePrice > 0 && it.quantity > 0)
    .map((it) => {
      const currentVal = it.currentPrice ? it.currentPrice * it.quantity : it.purchasePrice * it.quantity
      const costBasis = it.purchasePrice * it.quantity
      const retPct = ((currentVal - costBasis) / costBasis) * 100
      return { ...it, retPct, retAbs: currentVal - costBasis }
    })
    .sort((a, b) => b.retPct - a.retPct)

  const gainers = withReturn.filter((i) => i.retPct > 0).slice(0, 4)
  const losers = withReturn.filter((i) => i.retPct < 0).slice(-3).reverse()

  if (gainers.length === 0 && losers.length === 0) return null

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        TOP MOVERS · YTD
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {gainers.map((it) => (
          <div key={it.id || it.symbol} className="flex items-center justify-between">
            <span className="text-xs text-white font-medium">{it.symbol}</span>
            <span className="text-xs text-emerald-400 font-medium">+{it.retPct.toFixed(1)}%</span>
          </div>
        ))}
        {losers.map((it) => (
          <div key={it.id || it.symbol} className="flex items-center justify-between">
            <span className="text-xs text-white font-medium">{it.symbol}</span>
            <span className="text-xs text-red-400 font-medium">{it.retPct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
