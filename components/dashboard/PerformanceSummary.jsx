'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, computeModifiedDietz } from './utils'

const DAY_MS = 86400000

export default function PerformanceSummary({ items, transactions, convert, baseCurrency, netWorth, lang }) {
  const [historyPoints, setHistoryPoints] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!items || items.length === 0) return
    let cancelled = false
    async function fetchHistory() {
      setLoading(true)
      try {
        const res = await fetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((it) => ({
              symbol: it.symbol, type: it.type, quantity: it.quantity,
              currentPrice: it.currentPrice, purchasePrice: it.purchasePrice,
              acquisitionDate: it.acquisitionDate,
            })),
            period: 'ALL',
          }),
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setHistoryPoints(data.dataPoints || [])
        }
      } catch {}
      if (!cancelled) setLoading(false)
    }
    fetchHistory()
    return () => { cancelled = true }
  }, [items])

  const periods = useMemo(() => {
    if (historyPoints.length === 0 || !netWorth) return []

    const now = Date.now()
    const endVal = netWorth

    function findStartValue(targetTs) {
      let closest = null
      let minDiff = Infinity
      for (const pt of historyPoints) {
        const diff = Math.abs(pt.ts - targetTs)
        if (pt.ts <= targetTs + DAY_MS && diff < minDiff) {
          minDiff = diff
          closest = pt
        }
      }
      return closest
    }

    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime()

    const defs = [
      { key: '1W', label: '1W', targetTs: now - 7 * DAY_MS },
      { key: '1M', label: '1M', targetTs: now - 30 * DAY_MS },
      { key: 'YTD', label: 'YTD', targetTs: jan1 },
      { key: '1Y', label: '1Y', targetTs: now - 365 * DAY_MS },
      { key: 'ALL', label: 'ALL', targetTs: historyPoints[0]?.ts || now },
    ]

    return defs.map((d) => {
      const startPt = d.key === 'ALL' ? historyPoints[0] : findStartValue(d.targetTs)
      if (!startPt || startPt.total <= 0) return { ...d, pct: null, abs: null }

      const { pct, abs } = computeModifiedDietz({
        startValue: startPt.total,
        endValue: endVal,
        startTs: startPt.ts,
        endTs: now,
        transactions,
        convert,
        baseCurrency,
      })

      return { ...d, pct, abs }
    })
  }, [historyPoints, netWorth, transactions, convert, baseCurrency])

  if (periods.length === 0 && !loading) return null

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-purple-400" />
        {t('RENDIMIENTO', 'PERFORMANCE SUMMARY')}
      </h3>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          {periods.map((p) => {
            const isPos = (p.pct ?? 0) >= 0
            return (
              <div key={p.key} className="text-center p-3 bg-[#0b1120] rounded-lg border border-[#1e2d45]/50">
                <span className="text-[10px] text-slate-500 font-medium">{p.label}</span>
                {p.pct != null ? (
                  <>
                    <div className={`text-base font-bold mt-1 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPos ? '+' : ''}{p.pct.toFixed(2)}%
                    </div>
                    <div className={`text-[10px] mt-0.5 ${isPos ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                      {isPos ? '+' : ''}{formatCurrency(p.abs)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-600 mt-1">—</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
