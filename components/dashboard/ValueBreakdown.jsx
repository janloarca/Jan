'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getItemValue, getTypeCategory } from './utils'

const SECTOR_COLORS = [
  '#34d399', '#f59e0b', 'var(--accent-blue)', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#eab308',
]

const INSTITUTION_COLORS = [
  'var(--accent-blue)', '#34d399', '#f59e0b', '#a855f7', '#06b6d4',
  '#ef4444', '#ec4899', '#84cc16',
]

const CURRENCY_COLORS = [
  '#34d399', 'var(--accent-blue)', '#f59e0b', '#a855f7', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16',
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
        key = getTypeCategory(it.type)
      } else if (view === 'currency') {
        key = it._originalCurrency || it.currency || 'USD'
      } else {
        key = it.institution || (lang === 'es' ? 'Sin institución' : 'No institution')
      }
      groups[key] = (groups[key] || 0) + val
      total += val
    })
    const colors = view === 'type' ? SECTOR_COLORS : view === 'currency' ? CURRENCY_COLORS : INSTITUTION_COLORS
    return Object.entries(groups)
      .filter(([, value]) => Math.abs(value) > 0.01)
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
    <div className="card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#c084fc' }} />
          {lang === 'es' ? 'DESGLOSE DE VALOR' : 'VALUE BREAKDOWN'}
        </h3>
        <div className="flex gap-0.5 bg-theme-base rounded-lg p-0.5">
          {[
            { key: 'type', label: lang === 'es' ? 'Tipo' : 'Type' },
            { key: 'currency', label: lang === 'es' ? 'Moneda' : 'Currency' },
            { key: 'institution', label: lang === 'es' ? 'Inst.' : 'Inst.' },
          ].map((opt) => (
            <button key={opt.key} onClick={() => setView(opt.key)}
              className="px-3 py-1 text-xs font-medium rounded-md transition-all"
              style={view === opt.key
                ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' }
                : { color: 'var(--text-muted)' }
              }>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* La pista de la dona: token de tema, no un gris fijo. #38383A es un gris
                de tema OSCURO, así que en tema claro dibujaba un aro oscuro y pesado
                alrededor de una card blanca. */}
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--card-border)" strokeWidth={strokeWidth} />
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
                <th className="text-left py-1 font-medium">{view === 'type' ? (lang === 'es' ? 'TIPO' : 'TYPE') : view === 'currency' ? (lang === 'es' ? 'MONEDA' : 'CURRENCY') : (lang === 'es' ? 'INSTITUCIÓN' : 'INSTITUTION')}</th>
                <th className="text-right py-1 font-medium">{lang === 'es' ? 'VALOR' : 'VALUE'}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.name} className="border-t border-glass-border/30">
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
