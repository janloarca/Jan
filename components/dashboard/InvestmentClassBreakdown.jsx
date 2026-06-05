'use client'

import { useMemo } from 'react'
import { getInvestmentClass, INVESTMENT_CLASS_META, getItemValue, formatCurrency, getEffectiveYield } from './utils'
import Icon from '@/components/ui/Icon'

const CLASS_ORDER = ['renta_variable', 'renta_fija', 'patrimonio_vc']

export default function InvestmentClassBreakdown({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const classes = useMemo(() => {
    const grouped = {}
    let total = 0

    items.forEach((it) => {
      if (it.isDebt) return
      const cls = getInvestmentClass(it)
      if (!grouped[cls]) grouped[cls] = { value: 0, count: 0, gainAbs: 0, topItems: [] }
      const val = Math.abs(getItemValue(it))
      const cost = (it.quantity || 0) * (it.purchasePrice || it.currentPrice || 0)
      grouped[cls].value += val
      grouped[cls].count += 1
      grouped[cls].gainAbs += val - cost
      grouped[cls].topItems.push({ name: it.name || it.symbol, value: val, yield: getEffectiveYield(it) })
      total += val
    })

    return CLASS_ORDER.map((key) => {
      const meta = INVESTMENT_CLASS_META[key]
      const data = grouped[key] || { value: 0, count: 0, gainAbs: 0, topItems: [] }
      const pct = total > 0 ? (data.value / total) * 100 : 0
      const costBasis = data.value - data.gainAbs
      const gainPct = costBasis > 0 ? (data.gainAbs / costBasis) * 100 : 0
      data.topItems.sort((a, b) => b.value - a.value)
      return { key, meta, ...data, pct, gainPct, total }
    })
  }, [items])

  const totalValue = useMemo(() => items.filter(it => !it.isDebt).reduce((s, it) => s + Math.abs(getItemValue(it)), 0), [items])

  if (items.length === 0 || totalValue === 0) return null

  return (
    <div className="bg-[#1C1C1E] rounded-2xl border border-[#38383A] p-5 card-primary">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
          {t('TIPO DE RETORNO', 'RETURN TYPE')}
        </h3>
        <span className="text-xs text-slate-500">{formatCurrency(totalValue)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {classes.map(({ key, meta, value, count, pct, gainPct, gainAbs, topItems }) => (
          <div key={key}
            className="rounded-xl p-4 border transition-colors"
            style={{
              backgroundColor: `${meta.color}08`,
              borderColor: `${meta.color}20`,
            }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${meta.color}20` }}>
                <Icon name={meta.icon} size={14} style={{ color: meta.color }} />
              </div>
              <div>
                <p className="text-xs font-semibold text-white leading-tight">{meta.label[lang]}</p>
                <p className="text-[10px] leading-tight" style={{ color: `${meta.color}cc` }}>{meta.returnType[lang]}</p>
              </div>
            </div>

            <p className="text-lg font-bold text-white mb-0.5">{formatCurrency(value)}</p>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
              <span className={`text-xs font-medium ${gainAbs >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {gainAbs >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500">{count} {count === 1 ? t('activo', 'asset') : t('activos', 'assets')}</span>
            </div>

            {/* Bar */}
            <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: `${meta.color}15` }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
            </div>

            {/* Top 3 */}
            {topItems.slice(0, 3).map((item, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-0.5">
                <span className="text-slate-400 truncate max-w-[100px]">{item.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-300">{formatCurrency(item.value)}</span>
                  {item.yield != null && (
                    <span className="text-emerald-400/70">{item.yield.toFixed(1)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Insight line */}
      {classes.length > 0 && (() => {
        const dominant = classes.reduce((a, b) => a.pct > b.pct ? a : b)
        if (dominant.pct < 10) return null
        return (
          <p className="text-xs text-slate-500 mt-3 text-center">
            {dominant.pct.toFixed(0)}% {t('del portafolio está en', 'of portfolio is in')} <span className="text-slate-300 font-medium">{dominant.meta.returnType[lang]}</span>
          </p>
        )
      })()}
    </div>
  )
}
