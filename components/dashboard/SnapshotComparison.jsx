'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate, getTypeCategory } from './utils'

export default function SnapshotComparison({ snapshots, items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [selectedPeriod, setSelectedPeriod] = useState('1M')

  const sorted = useMemo(() =>
    [...(snapshots || [])].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [snapshots]
  )

  const comparison = useMemo(() => {
    if (sorted.length < 2) return null

    const now = new Date()
    const periods = {
      '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'YTD': null, 'ALL': null,
    }

    let cutoffDate
    if (selectedPeriod === 'YTD') {
      cutoffDate = new Date(now.getFullYear(), 0, 1)
    } else if (selectedPeriod === 'ALL') {
      cutoffDate = new Date(sorted[0].date)
    } else {
      cutoffDate = new Date(now.getTime() - (periods[selectedPeriod] || 30) * 86400000)
    }

    let startSnap = null
    let minDiff = Infinity
    for (const s of sorted) {
      const diff = Math.abs(new Date(s.date).getTime() - cutoffDate.getTime())
      if (diff < minDiff) { minDiff = diff; startSnap = s }
    }

    const endSnap = sorted[sorted.length - 1]
    if (!startSnap || !endSnap || startSnap === endSnap) return null

    const startVal = startSnap.netWorthUSD ?? startSnap.totalActivosUSD ?? 0
    const endVal = endSnap.netWorthUSD ?? endSnap.totalActivosUSD ?? 0
    if (startVal <= 0) return null

    const change = endVal - startVal
    const changePct = (change / startVal) * 100
    const daysBetween = Math.ceil((new Date(endSnap.date) - new Date(startSnap.date)) / 86400000)
    const rawAnnualized = daysBetween > 30 && endVal > 0 ? (Math.pow(endVal / startVal, 365 / daysBetween) - 1) * 100 : null
    const annualized = rawAnnualized != null && isFinite(rawAnnualized) ? rawAnnualized : null

    return {
      startDate: startSnap.date,
      endDate: endSnap.date,
      startVal,
      endVal,
      change,
      changePct,
      daysBetween,
      annualized,
    }
  }, [sorted, selectedPeriod])

  const allocation = useMemo(() => {
    if (!items || items.length === 0) return []
    const cats = {}
    items.forEach((it) => {
      if (it.isDebt) return
      const cat = getTypeCategory(it)
      const val = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
      if (val > 0) cats[cat] = (cats[cat] || 0) + val
    })
    const total = Object.values(cats).reduce((s, v) => s + v, 0)
    return Object.entries(cats)
      .map(([cat, val]) => ({ cat, val, pct: total > 0 ? (val / total) * 100 : 0 }))
      .sort((a, b) => b.val - a.val)
  }, [items])

  if (sorted.length < 2) return null

  const sparkline = useMemo(() => {
    const values = sorted.map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0).filter((v) => v > 0)
    if (values.length < 3) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 200
    const h = 40
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x},${y}`
    }).join(' ')
    return { points, w, h }
  }, [sorted])

  return (
    <div className="bg-[#1C1C1E]/80 rounded-xl border border-[#38383A]/50 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          📸 {t('Comparación de Snapshots', 'Snapshot Comparison')}
        </h3>
        <div className="flex gap-0.5 bg-[#000000] rounded p-0.5">
          {['1W', '1M', '3M', '6M', '1Y', 'YTD', 'ALL'].map((p) => (
            <button key={p} onClick={() => setSelectedPeriod(p)}
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-all ${
                selectedPeriod === p ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-400'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {comparison ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#000000] rounded-lg p-3 border border-[#38383A]/50 text-center">
              <div className="text-[10px] text-slate-500 mb-1">{formatDate(comparison.startDate)}</div>
              <div className="text-sm font-bold text-slate-400">{formatCurrency(comparison.startVal)}</div>
            </div>
            <div className="bg-[#000000] rounded-lg p-3 border border-[#38383A]/50 text-center">
              <div className="text-[10px] text-slate-500 mb-1">{t('Cambio', 'Change')}</div>
              <div className={`text-sm font-bold ${comparison.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {comparison.change >= 0 ? '+' : ''}{comparison.changePct.toFixed(2)}%
              </div>
              <div className={`text-[10px] ${comparison.change >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                {comparison.change >= 0 ? '+' : ''}{formatCurrency(comparison.change)}
              </div>
            </div>
            <div className="bg-[#000000] rounded-lg p-3 border border-[#38383A]/50 text-center">
              <div className="text-[10px] text-slate-500 mb-1">{formatDate(comparison.endDate)}</div>
              <div className="text-sm font-bold text-white">{formatCurrency(comparison.endVal)}</div>
            </div>
          </div>

          {comparison.annualized != null && (
            <div className="flex items-center justify-between text-xs mb-3 px-1">
              <span className="text-slate-500">{comparison.daysBetween}d · {t('Anualizado', 'Annualized')}</span>
              <span className={`font-medium ${comparison.annualized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {comparison.annualized >= 0 ? '+' : ''}{comparison.annualized.toFixed(2)}%
              </span>
            </div>
          )}

          {sparkline && (
            <div className="mb-3">
              <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-12" preserveAspectRatio="none">
                <polyline points={sparkline.points} fill="none"
                  stroke={comparison.change >= 0 ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
              </svg>
            </div>
          )}

          <div className="text-[10px] text-slate-600 text-right">
            {sorted.length} {t('snapshots registrados', 'snapshots recorded')}
          </div>
        </>
      ) : (
        <div className="text-center py-4 text-xs text-slate-500">
          {t('No hay suficientes datos para este periodo', 'Not enough data for this period')}
        </div>
      )}
    </div>
  )
}
