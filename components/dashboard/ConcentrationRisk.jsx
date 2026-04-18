'use client'

import { useMemo } from 'react'
import { getTypeCategory, TYPE_COLORS } from './utils'

export default function ConcentrationRisk({ items, lang }) {
  const data = useMemo(() => {
    const groups = {}
    let total = 0
    items.forEach((it) => {
      const val = (it.quantity || 0) * (it.purchasePrice || 0)
      const cat = getTypeCategory(it.type)
      groups[cat] = (groups[cat] || 0) + val
      total += val
    })
    return Object.entries(groups)
      .map(([type, value]) => ({
        type,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: TYPE_COLORS[type]?.bg || '#6b7280',
      }))
      .sort((a, b) => b.pct - a.pct)
  }, [items])

  if (items.length === 0) return null

  const maxPct = data.length > 0 ? data[0].pct : 0
  const level = maxPct > 50 ? 'high' : maxPct > 30 ? 'medium' : 'low'
  const levelLabel = {
    high: { es: 'Alta Concentración', en: 'High Concentration', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
    medium: { es: 'Media Concentración', en: 'Medium Concentration', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    low: { es: 'Baja Concentración', en: 'Low Concentration', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  }

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          {t('RIESGO DE CONCENTRACIÓN', 'CONCENTRATION RISK')}
        </h3>
        <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${levelLabel[level].color}`}>
          {lang === 'es' ? levelLabel[level].es : levelLabel[level].en}
        </span>
      </div>
      <div className="space-y-2.5">
        {data.map((row) => (
          <div key={row.type} className="flex items-center gap-3">
            <span className="text-xs text-white font-medium w-24 capitalize truncate">{row.type}</span>
            <div className="flex-1 h-2 bg-slate-700/30 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
            </div>
            <span className="text-xs text-slate-400 w-12 text-right">{row.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
