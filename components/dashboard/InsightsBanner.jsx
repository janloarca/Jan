'use client'

import { useState } from 'react'

export default function InsightsBanner({ insights, lang }) {
  const [dismissed, setDismissed] = useState(new Set())

  if (!insights || insights.length === 0) return null

  const visible = insights.filter((_, i) => !dismissed.has(i))
  if (visible.length === 0) return null

  const dismiss = (idx) => setDismissed((prev) => new Set([...prev, idx]))

  const iconMap = { positive: '✓', warning: '⚠', info: 'ℹ' }
  const colorMap = {
    positive: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    info: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {insights.map((ins, i) => {
        if (dismissed.has(i)) return null
        const text = lang === 'es' ? ins.textEs : ins.textEn
        return (
          <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] whitespace-nowrap shrink-0 ${colorMap[ins.type] || colorMap.info}`}>
            <span className="text-xs">{iconMap[ins.type] || 'ℹ'}</span>
            <span>{text}</span>
            <button onClick={() => dismiss(i)} className="opacity-50 hover:opacity-100 ml-1 text-xs">×</button>
          </div>
        )
      })}
    </div>
  )
}
