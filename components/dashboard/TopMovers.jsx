'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS } from './utils'

export default function TopMovers({ items, transactions, lang }) {
  if (!items || items.length === 0) return null

  const dividendsBySymbol = useMemo(() => {
    const map = {}
    if (!transactions) return map
    transactions.forEach((tx) => {
      if ((tx.type || '').toUpperCase() !== 'DIVIDEND') return
      const sym = (tx.symbol || '').toUpperCase()
      if (!sym) return
      if (!map[sym]) map[sym] = { total: 0, entries: [] }
      map[sym].total += tx.totalAmount ?? 0
      map[sym].entries.push(tx)
    })
    return map
  }, [transactions])

  const withValue = useMemo(() => {
    return items
      .filter((it) => it.purchasePrice > 0 && it.quantity > 0)
      .map((it) => {
        const value = (it.currentPrice || it.purchasePrice) * it.quantity
        const cost = it.purchasePrice * it.quantity
        const sym = (it.symbol || '').toUpperCase()
        const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0

        let receivedDividends = 0
        const divData = dividendsBySymbol[sym]
        if (divData) {
          divData.entries.forEach((tx) => {
            const txDate = tx.date ? new Date(tx.date).getTime() : 0
            if (!acqDate || txDate >= acqDate) {
              receivedDividends += tx.totalAmount ?? 0
            }
          })
        }

        const totalReturn = cost > 0 ? ((value - cost) + receivedDividends) / cost * 100 : 0
        return { ...it, value, cost, retPct: totalReturn }
      })
      .sort((a, b) => b.value - a.value)
  }, [items, dividendsBySymbol])

  if (withValue.length === 0) return null

  const totalVal = useMemo(() => withValue.reduce((s, x) => s + x.value, 0), [withValue])
  const top = withValue.slice(0, 3)

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        {lang === 'es' ? 'TOP POSICIONES' : 'TOP HOLDINGS'}
      </h3>
      <div className="space-y-3">
        {top.map((it, i) => {
          const pct = totalVal > 0 ? (it.value / totalVal) * 100 : 0
          const cat = getTypeCategory(it.type)
          const colors = TYPE_COLORS[cat] || TYPE_COLORS.other
          const isPos = it.retPct >= 0
          return (
            <div key={it.id || it.symbol} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: colors.bg + '22', color: colors.bg }}>
                {(it.symbol || '??').slice(0, 3).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-medium truncate">{it.name || it.symbol}</span>
                  <span className="text-sm text-emerald-400 font-medium ml-2">{formatCurrency(it.value)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <span className={`text-xs font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isPos ? '+' : ''}{it.retPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
