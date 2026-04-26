'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getItemValue } from './utils'

const SECTOR_COLORS = [
  '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#eab308',
]

const INSTITUTION_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#06b6d4',
  '#ef4444', '#ec4899', '#84cc16',
]

export default function ValueBreakdown({ items, lang }) {
  const [view, setView] = useState('type')

  const data = useMemo(() => {
    const groups = {}
    let total = 0
    items.forEach((it) => {
      const val = getItemValue(it)
      let key
      if (view === 'type') {
        key = it.type || 'Other'
      } else {
        key = it.institution || (lang === 'es' ? 'Sin institución' : 'No institution')
      }
      groups[key] = (groups[key] || 0) + val
      total += val
    })
    const colors = view === 'type' ? SECTOR_COLORS : INSTITUTION_COLORS
    return Object.entries(groups)
      .map(([name, value], i) => ({
        name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: colors[i % colors.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [items, view, lang])

  if (items.length === 0) return null

  const size = 180
  const strokeWidth = 32
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          {lang === 'es' ? 'DESGLOSE DE VALOR' : 'VALUE BREAKDOWN'}
        </h3>
        <div className="flex gap-0.5 bg-[#0f172a] rounded-lg p-0.5">
          {[
            { key: 'type', label: lang === 'es' ? 'Tipo' : 'Type' },
            { key: 'institution', label: lang === 'es' ? 'Institución' : 'Institution' },
          ].map((opt) => (
            <button key={opt.key} onClick={() => setView(opt.key)}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all ${
                view === opt.key ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#334155" strokeWidth={strokeWidth} />
            {data.map((seg) => {
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
        </div>

        {/* Legend table */}
        <div className="flex-1 w-full">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1 font-medium">%</th>
                <th className="text-left py-1 font-medium">{view === 'type' ? (lang === 'es' ? 'TIPO' : 'TYPE') : (lang === 'es' ? 'INSTITUCIÓN' : 'INSTITUTION')}</th>
                <th className="text-right py-1 font-medium">{lang === 'es' ? 'VALOR' : 'VALUE'}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.name} className="border-t border-[#334155]/30">
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="text-slate-400">{row.pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-white font-medium">{row.name}</td>
                  <td className="py-1.5 text-right text-white">{formatCurrency(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
