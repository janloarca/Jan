'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS } from './utils'
import { computeAssetAttribution } from './analytics'

export default function PerformanceAttribution({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const attribution = useMemo(() => {
    const raw = computeAssetAttribution(items || [])
    if (raw.length === 0) return null

    const positive = raw.filter((a) => a.gain > 0).slice(0, 8)
    const negative = raw.filter((a) => a.gain < 0).sort((a, b) => a.gain - b.gain).slice(0, 8)
    const totalGain = raw.reduce((s, a) => s + a.gain, 0)
    const totalValue = raw.reduce((s, a) => s + a.value, 0)

    const byCat = {}
    raw.forEach((a) => {
      const it = (items || []).find((i) => (i.symbol || i.name) === a.symbol)
      const cat = it ? getTypeCategory(it) : 'other'
      if (!byCat[cat]) byCat[cat] = { gain: 0, value: 0 }
      byCat[cat].gain += a.gain
      byCat[cat].value += a.value
    })
    const catAttribution = Object.entries(byCat)
      .map(([cat, d]) => ({ cat, gain: d.gain, value: d.value, contribution: totalValue > 0 ? (d.gain / totalValue) * 100 : 0 }))
      .sort((a, b) => b.gain - a.gain)

    return { positive, negative, totalGain, totalValue, catAttribution }
  }, [items])

  if (!attribution || attribution.totalValue <= 0) return null

  const maxGain = Math.max(
    ...attribution.positive.map((a) => Math.abs(a.gain)),
    ...attribution.negative.map((a) => Math.abs(a.gain)),
    1
  )

  return (
    <div className="bg-[#1C1C1E]/80 rounded-xl border border-[#38383A]/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
          {t('ATRIBUCIÓN DE RENDIMIENTO', 'PERFORMANCE ATTRIBUTION')}
        </h3>
        <span className={`text-sm font-bold ${attribution.totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {attribution.totalGain >= 0 ? '+' : ''}{formatCurrency(attribution.totalGain)}
        </span>
      </div>

      {/* By category */}
      <div className="mb-4">
        <span className="text-xs text-slate-500 mb-2 block">{t('Por categoría', 'By category')}</span>
        <div className="space-y-1.5">
          {attribution.catAttribution.map(({ cat, gain, contribution }) => {
            const colors = TYPE_COLORS[cat] || TYPE_COLORS.other
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors.bg }} />
                <span className="text-xs text-slate-300 capitalize w-20 truncate">{cat}</span>
                <div className="flex-1 h-4 flex items-center">
                  {gain >= 0 ? (
                    <div className="h-full flex items-center" style={{ width: `${Math.abs(gain) / maxGain * 100}%`, minWidth: '2px' }}>
                      <div className="h-2 bg-emerald-500/50 rounded-full w-full" />
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-end ml-auto" style={{ width: `${Math.abs(gain) / maxGain * 100}%`, minWidth: '2px' }}>
                      <div className="h-2 bg-red-500/50 rounded-full w-full" />
                    </div>
                  )}
                </div>
                <span className={`text-xs font-medium w-16 text-right ${gain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gain >= 0 ? '+' : ''}{formatCurrency(gain)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top contributors */}
      {attribution.positive.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-emerald-400/70 mb-1.5 block">{t('Mayores ganadores', 'Top contributors')}</span>
          <div className="space-y-1">
            {attribution.positive.slice(0, 5).map((a) => (
              <div key={a.symbol} className="flex items-center justify-between text-xs py-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-white font-medium truncate">{a.symbol}</span>
                  <span className="text-slate-600">{a.weight.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-emerald-400/60">+{a.contribution.toFixed(2)}%</span>
                  <span className="text-emerald-400 font-medium w-16 text-right">+{formatCurrency(a.gain)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top detractors */}
      {attribution.negative.length > 0 && (
        <div>
          <span className="text-xs text-red-400/70 mb-1.5 block">{t('Mayores perdedores', 'Top detractors')}</span>
          <div className="space-y-1">
            {attribution.negative.slice(0, 5).map((a) => (
              <div key={a.symbol} className="flex items-center justify-between text-xs py-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-white font-medium truncate">{a.symbol}</span>
                  <span className="text-slate-600">{a.weight.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-red-400/60">{a.contribution.toFixed(2)}%</span>
                  <span className="text-red-400 font-medium w-16 text-right">{formatCurrency(a.gain)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
