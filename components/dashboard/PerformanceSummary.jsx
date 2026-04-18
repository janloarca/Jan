'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'

export default function PerformanceSummary({ snapshots, lang }) {
  const periods = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return []

    const latest = snapshots[snapshots.length - 1]
    const latestVal = latest.netWorthUSD ?? latest.totalActivosUSD ?? 0
    const now = new Date()

    const findSnapshotBefore = (daysAgo) => {
      const target = new Date(now)
      target.setDate(target.getDate() - daysAgo)
      let closest = null
      let minDiff = Infinity
      for (const s of snapshots) {
        const d = new Date(s.date)
        const diff = Math.abs(d - target)
        if (d <= target && diff < minDiff) {
          minDiff = diff
          closest = s
        }
      }
      return closest
    }

    const findYearStart = () => {
      const year = now.getFullYear()
      return snapshots.find((s) => s.date && new Date(s.date).getFullYear() >= year) || snapshots[0]
    }

    const calcReturn = (ref) => {
      if (!ref) return null
      const refVal = ref.netWorthUSD ?? ref.totalActivosUSD ?? 0
      if (refVal === 0) return null
      return {
        pct: ((latestVal - refVal) / refVal) * 100,
        abs: latestVal - refVal,
      }
    }

    const defs = [
      { key: '1W', label: '1W', ref: findSnapshotBefore(7) },
      { key: '1M', label: '1M', ref: findSnapshotBefore(30) },
      { key: 'YTD', label: 'YTD', ref: findYearStart() },
      { key: '1Y', label: '1Y', ref: findSnapshotBefore(365) },
      { key: 'ALL', label: 'ALL', ref: snapshots[0] },
    ]

    return defs.map((d) => ({ ...d, ...calcReturn(d.ref) }))
  }, [snapshots])

  if (periods.length === 0) return null

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-purple-400" />
        {lang === 'es' ? 'RENDIMIENTO' : 'PERFORMANCE SUMMARY'}
      </h3>
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
    </div>
  )
}
