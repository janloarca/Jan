'use client'

import { useMemo } from 'react'
import { generateInsights } from '@/lib/insights'

const TYPE_STYLES = {
  success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  danger: 'bg-red-500/10 border-red-500/20 text-red-400',
  info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
}

const TYPE_ICONS = {
  success: '✓',
  warning: '⚠',
  danger: '✖',
  info: 'ℹ',
}

export default function InsightCards({ items, profile, netWorth, estimatedAnnualIncome, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const cards = useMemo(() => {
    return generateInsights(items, profile, netWorth, estimatedAnnualIncome)
  }, [items, profile, netWorth, estimatedAnnualIncome])

  if (!cards || cards.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((card, i) => (
        <div key={i} className={`p-3 rounded-lg border ${TYPE_STYLES[card.type] || TYPE_STYLES.info}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{TYPE_ICONS[card.type] || TYPE_ICONS.info}</span>
            <span className="text-xs font-semibold">{lang === 'es' ? card.titleEs : card.titleEn}</span>
          </div>
          <p className="text-xs opacity-80">{lang === 'es' ? card.descEs : card.descEn}</p>
        </div>
      ))}
    </div>
  )
}
