'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, computeModifiedDietz } from './utils'
import { computeTWRSeries } from './analytics'

const DAY_MS = 86400000

export default function PerformanceSummary({ items, transactions, convert, baseCurrency, netWorth, lang }) {
  const [historyPoints, setHistoryPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [returnMode, setReturnMode] = useState('twr')

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
      } catch (err) {
        console.error('Failed to fetch performance history:', err)
      }
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

      const { pct: mwrPct, abs } = computeModifiedDietz({
        startValue: startPt.total,
        endValue: endVal,
        startTs: startPt.ts,
        endTs: now,
        transactions,
        convert,
        baseCurrency,
      })

      let pct = mwrPct
      if (returnMode === 'twr') {
        const slice = historyPoints.filter((pt) => pt.ts >= startPt.ts).map((pt) => ({ ts: pt.ts, value: pt.total }))
        if (slice.length >= 2) {
          if (Math.abs(slice[slice.length - 1].value - endVal) > 1) slice.push({ ts: now, value: endVal })
          const twrSeries = computeTWRSeries(slice, transactions, convert, baseCurrency)
          if (twrSeries.length > 0) pct = twrSeries[twrSeries.length - 1]
        }
      }

      return { ...d, pct, abs }
    })
  }, [historyPoints, netWorth, transactions, convert, baseCurrency, returnMode])

  if (periods.length === 0 && !loading) return null

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          {t('RENDIMIENTO', 'PERFORMANCE SUMMARY')}
        </h3>
        <div className="flex gap-0.5 bg-[#0f172a] rounded p-0.5">
          <button onClick={() => setReturnMode('twr')}
            className={`px-1.5 py-0.5 text-xs font-medium rounded transition-all ${returnMode === 'twr' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'}`}>TWR</button>
          <button onClick={() => setReturnMode('mwr')}
            className={`px-1.5 py-0.5 text-xs font-medium rounded transition-all ${returnMode === 'mwr' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'}`}>MWR</button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2">
          {periods.map((p) => {
            const isPos = (p.pct ?? 0) >= 0
            return (
              <div key={p.key} className="text-center p-2 sm:p-3 bg-[#0f172a] rounded-lg border border-[#334155]/50">
                <span className="text-xs text-slate-500 font-medium">{p.label}</span>
                {p.pct != null ? (
                  <>
                    <div className={`text-sm sm:text-base font-bold mt-1 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPos ? '+' : ''}{p.pct.toFixed(2)}%
                    </div>
                    <div className={`text-xs sm:text-xs mt-0.5 ${isPos ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
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
        <div className="text-xs text-slate-600 mt-2 text-right">
          {returnMode === 'twr' ? t('Retorno ponderado por tiempo (TWR)', 'Time-Weighted Return (TWR)') : t('Retorno ponderado por dinero (MWR)', 'Money-Weighted Return (MWR)')}
        </div>
      </>
      )}
    </div>
  )
}
