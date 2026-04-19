'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue } from './utils'

const DONUT_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
]

export default function AssetAllocation({ items, lang }) {
  const allocation = useMemo(() => {
    const byType = {}
    let total = 0
    items.forEach((it) => {
      const cat = getTypeCategory(it.type)
      const val = getItemValue(it)
      byType[cat] = (byType[cat] || 0) + val
      total += val
    })
    return Object.entries(byType)
      .map(([type, value], i) => ({
        type,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: TYPE_COLORS[type]?.bg || DONUT_COLORS[i % DONUT_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [items])

  const totalValue = useMemo(() => items.reduce((s, it) => s + getItemValue(it), 0), [items])

  if (items.length === 0) return null

  const size = 160
  const strokeWidth = 28
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        {lang === 'es' ? 'ASSET ALLOCATION' : 'ASSET ALLOCATION'}
      </h3>

      <div className="flex items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e2d45" strokeWidth={strokeWidth} />
            {allocation.map((seg) => {
              const dash = (seg.pct / 100) * circumference
              const gap = circumference - dash
              const currentOffset = offset
              offset += dash
              return (
                <circle
                  key={seg.type}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={-currentOffset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              )
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] text-slate-500">{lang === 'es' ? 'Total' : 'Total'}</span>
            <span className="text-sm font-bold text-white">{formatCurrency(totalValue)}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5">
          {allocation.map((seg) => (
            <div key={seg.type} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-xs text-slate-300 capitalize">{seg.type}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400">{seg.pct.toFixed(1)}%</span>
                <span className="text-[11px] text-white font-medium w-16 text-right">{formatCurrency(seg.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
