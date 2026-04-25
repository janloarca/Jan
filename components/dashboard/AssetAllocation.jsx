'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue, getSectorFromType, getGeographyFromSymbol } from './utils'

const DONUT_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
]

export default function AssetAllocation({ items, lang }) {
  const [view, setView] = useState('type')

  const allocation = useMemo(() => {
    const groupFns = {
      type: (it) => getTypeCategory(it.type),
      sector: (it) => getSectorFromType(it.type),
      geography: (it) => getGeographyFromSymbol(it.symbol),
      currency: (it) => it._originalCurrency || it.currency || 'USD',
      institution: (it) => it.institution || (lang === 'es' ? 'Sin institución' : 'No institution'),
    }

    const fn = groupFns[view] || groupFns.type
    const byGroup = {}
    let total = 0
    items.forEach((it) => {
      const key = fn(it)
      const val = getItemValue(it)
      byGroup[key] = (byGroup[key] || 0) + val
      total += val
    })
    return Object.entries(byGroup)
      .map(([name, value], i) => ({
        name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: view === 'type' ? (TYPE_COLORS[name]?.bg || DONUT_COLORS[i % DONUT_COLORS.length]) : DONUT_COLORS[i % DONUT_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [items, view, lang])

  const totalValue = useMemo(() => items.reduce((s, it) => s + getItemValue(it), 0), [items])

  if (items.length === 0) return null

  const size = 160
  const strokeWidth = 28
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  const t = (es, en) => lang === 'es' ? es : en

  const views = [
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'sector', label: t('Sector', 'Sector') },
    { key: 'geography', label: t('Geo', 'Geo') },
    { key: 'currency', label: t('Moneda', 'Currency') },
    { key: 'institution', label: t('Inst.', 'Inst.') },
  ]

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          ASSET ALLOCATION
        </h3>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        {views.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
              view === v.key
                ? 'bg-slate-600 text-white'
                : 'text-slate-400 border border-slate-600/50 hover:bg-[#1a2540]'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-6">
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
                  key={seg.name}
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
            <span className="text-[10px] text-slate-500">Total</span>
            <span className="text-sm font-bold text-white">{formatCurrency(totalValue)}</span>
          </div>
        </div>

        <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
          {allocation.map((seg) => (
            <div key={seg.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-xs text-slate-300 capitalize truncate max-w-[100px]">{seg.name}</span>
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
