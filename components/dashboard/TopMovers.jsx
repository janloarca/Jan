'use client'

import { formatCurrency } from './utils'

export default function TopMovers({ items, lang }) {
  if (!items || items.length === 0) return null

  const withValue = items
    .filter((it) => it.purchasePrice > 0 && it.quantity > 0)
    .map((it) => {
      const value = (it.currentPrice || it.purchasePrice) * it.quantity
      const cost = it.purchasePrice * it.quantity
      const retPct = cost > 0 ? ((value - cost) / cost) * 100 : 0
      return { ...it, value, cost, retPct }
    })
    .sort((a, b) => b.value - a.value)

  if (withValue.length === 0) return null

  const top = withValue.slice(0, 5)

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        {lang === 'es' ? 'TOP POSICIONES' : 'TOP HOLDINGS'}
      </h3>
      <div className="space-y-2">
        {top.map((it, i) => {
          const totalVal = withValue.reduce((s, x) => s + x.value, 0)
          const pct = totalVal > 0 ? (it.value / totalVal) * 100 : 0
          return (
            <div key={it.id || it.symbol} className="flex items-center gap-3">
              <span className="text-[10px] text-slate-600 w-3">{i + 1}</span>
              <span className="text-xs text-white font-medium w-16 truncate">{it.symbol}</span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span className="text-[11px] text-emerald-400 font-medium w-16 text-right">{formatCurrency(it.value)}</span>
              <span className="text-[10px] text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
