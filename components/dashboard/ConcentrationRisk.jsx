'use client'

import { useState, useMemo } from 'react'
import { getTypeCategory, TYPE_COLORS, getItemValue, getSectorFromType, getGeographyFromSymbol } from './utils'
import { computeHHI, computeHHIByDimension } from './analytics'

export default function ConcentrationRisk({ items, lang }) {
  const [dimension, setDimension] = useState('type')

  const data = useMemo(() => {
    const dimensionFns = {
      asset: (it) => it.symbol || it.name || 'Unknown',
      type: (it) => getTypeCategory(it.type),
      sector: (it) => getSectorFromType(it.type),
      geography: (it) => getGeographyFromSymbol(it.symbol),
    }

    const fn = dimensionFns[dimension] || dimensionFns.type
    const result = computeHHIByDimension(items, fn)

    const groups = result.groups.map((g) => ({
      ...g,
      color: dimension === 'type' ? (TYPE_COLORS[g.name]?.bg || '#6b7280') : undefined,
    }))

    return { ...result, groups }
  }, [items, dimension])

  const individualHHI = useMemo(() => {
    const positions = items.map((it) => ({ value: getItemValue(it) }))
    return computeHHI(positions)
  }, [items])

  if (items.length === 0) return null

  const t = (es, en) => lang === 'es' ? es : en

  const displayHHI = dimension === 'asset' ? individualHHI : data
  const levelLabel = {
    high: { es: 'Alta Concentración', en: 'High Concentration', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
    medium: { es: 'Media Concentración', en: 'Medium Concentration', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    low: { es: 'Baja Concentración', en: 'Low Concentration', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  }

  const topPosition = data.groups[0]
  const insight = useMemo(() => {
    if (displayHHI.hhi > 2500) {
      return t(
        `Portafolio altamente concentrado (HHI: ${displayHHI.hhi}). Equivalente a ${displayHHI.equivalentPositions} posiciones iguales.`,
        `Highly concentrated portfolio (HHI: ${displayHHI.hhi}). Equivalent to ${displayHHI.equivalentPositions} equal positions.`
      )
    }
    if (topPosition && topPosition.pct > 40) {
      return t(
        `"${topPosition.name}" representa ${topPosition.pct.toFixed(0)}% del portafolio. Considera diversificar.`,
        `"${topPosition.name}" represents ${topPosition.pct.toFixed(0)}% of portfolio. Consider diversifying.`
      )
    }
    if (displayHHI.level === 'low') {
      return t('Buena diversificación entre posiciones.', 'Well diversified across positions.')
    }
    return null
  }, [displayHHI, topPosition, lang])

  const dims = [
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'asset', label: t('Activo', 'Asset') },
    { key: 'sector', label: t('Sector', 'Sector') },
    { key: 'geography', label: t('Geografía', 'Geography') },
  ]

  const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ec4899', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1']

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          {t('RIESGO DE CONCENTRACIÓN', 'CONCENTRATION RISK')}
        </h3>
        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${levelLabel[displayHHI.level].color}`}>
          {lang === 'es' ? levelLabel[displayHHI.level].es : levelLabel[displayHHI.level].en}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mb-3">
        {dims.map((d) => (
          <button key={d.key} onClick={() => setDimension(d.key)}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              dimension === d.key
                ? 'bg-slate-600 text-white'
                : 'text-slate-400 border border-slate-600/50 hover:bg-[#283548]'
            }`}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3 px-2 py-1.5 bg-[#0f172a] rounded-lg border border-[#334155]/50">
        <span className="text-xs text-slate-500">HHI</span>
        <div className="flex-1 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{
            width: `${Math.min((displayHHI.hhi / 5000) * 100, 100)}%`,
            backgroundColor: displayHHI.level === 'low' ? '#10b981' : displayHHI.level === 'medium' ? '#f59e0b' : '#ef4444',
          }} />
        </div>
        <span className="text-xs font-bold text-slate-300">{displayHHI.hhi}</span>
      </div>

      <div className="space-y-2">
        {data.groups.slice(0, 8).map((row, i) => (
          <div key={row.name} className="flex items-center gap-3">
            <span className="text-xs text-white font-medium w-24 capitalize truncate">{row.name}</span>
            <div className="flex-1 h-2 bg-slate-700/30 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${row.pct}%`,
                backgroundColor: row.color || PALETTE[i % PALETTE.length],
              }} />
            </div>
            <span className="text-xs text-slate-400 w-12 text-right">{row.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      {insight && (
        <p className="text-xs text-slate-400 mt-3 px-1 italic">{insight}</p>
      )}
    </div>
  )
}
