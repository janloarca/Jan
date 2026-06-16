'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, computeModifiedDietz } from './utils'
import { computeTWRSeries } from './analytics'
import { authFetch, safeJson } from '@/lib/authFetch'

const DAY_MS = 86400000

export default function PerformanceSummary({ items, transactions, convert, baseCurrency, netWorth, lang }) {
  const [historyPoints, setHistoryPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [returnMode, setReturnMode] = useState('twr')

  useEffect(() => {
    if (!items || items.length === 0) return
    let cancelled = false
    async function fetchHistory() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await authFetch('/api/prices/portfolio-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((it) => {
              const cur = it._originalCurrency || it.currency || 'USD'
              const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
              return {
                symbol: it.symbol, type: it.type, quantity: it.quantity,
                currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
                purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
                currency: 'USD',
                acquisitionDate: it.acquisitionDate,
              }
            }),
            period: 'ALL',
          }),
        })
        if (res.ok && !cancelled) {
          const data = await safeJson(res)
          let pts = data.dataPoints || []
          if (baseCurrency !== 'USD' && convert) {
            pts = pts.map(dp => ({ ...dp, total: convert(dp.total, 'USD', baseCurrency) }))
          }
          setHistoryPoints(pts)
        }
      } catch (err) {
        console.error('Failed to fetch performance history:', err)
        if (!cancelled) setFetchError(lang === 'es' ? 'Error cargando rendimiento' : 'Failed to load performance')
      }
      if (!cancelled) setLoading(false)
    }
    fetchHistory()
    return () => { cancelled = true }
  }, [items, baseCurrency, lang])

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
      { key: '3M', label: '3M', targetTs: now - 90 * DAY_MS },
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

  if (periods.length === 0 && !loading) return (
    <div className="bg-[#1C1C1E]/40 rounded-xl border border-[#38383A]/30 p-4 text-center">
      <p className="text-sm" style={{ color: fetchError ? 'rgba(248,113,113,0.7)' : '#64748b' }}>
        {fetchError || (lang === 'es' ? 'Sin datos de rendimiento aún' : 'No performance data yet')}
      </p>
    </div>
  )

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#1C1C1E] rounded-2xl border border-[#38383A] p-5 card-primary">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          {t('RENDIMIENTO', 'PERFORMANCE SUMMARY')}
        </h3>
        <div className="flex gap-0.5 bg-[#000000] rounded p-0.5">
          <button onClick={() => setReturnMode('twr')}
            className="px-1.5 py-0.5 text-xs font-medium rounded transition-all"
            style={returnMode === 'twr' ? { backgroundColor: '#475569', color: '#ffffff' } : { color: 'var(--text-muted)' }}>TWR</button>
          <button onClick={() => setReturnMode('mwr')}
            className="px-1.5 py-0.5 text-xs font-medium rounded transition-all"
            style={returnMode === 'mwr' ? { backgroundColor: '#475569', color: '#ffffff' } : { color: 'var(--text-muted)' }}>MWR</button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
          {periods.map((p) => {
            const isPos = (p.pct ?? 0) >= 0
            return (
              <div key={p.key} className="text-center p-2 sm:p-3 bg-[#000000] rounded-lg border border-[#38383A]/50">
                <span className="text-xs text-slate-500 font-medium">{p.label}</span>
                {p.pct != null && isFinite(p.pct) ? (
                  <>
                    <div className="text-sm sm:text-base font-bold font-mono tabular-nums mt-1" style={{ color: isPos ? '#34d399' : '#f87171' }}>
                      {isPos ? '+' : ''}{p.pct.toFixed(2)}%
                    </div>
                    <div className="text-xs sm:text-xs font-mono tabular-nums mt-0.5" style={{ color: isPos ? 'rgba(52,211,153,0.7)' : 'rgba(239,68,68,0.7)' }}>
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
