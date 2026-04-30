'use client'

import { useState } from 'react'

export default function InsightsBanner({ insights, lang }) {
  const [dismissed, setDismissed] = useState(new Set())

  if (!insights || insights.length === 0) return null

  const visible = insights.filter((_, i) => !dismissed.has(i))
  if (visible.length === 0) return null

  const dismiss = (idx) => setDismissed((prev) => new Set([...prev, idx]))

  const styleMap = {
    positive: { bg: 'bg-emerald-500/8 border-emerald-500/20', text: 'text-emerald-400', icon: '▲' },
    warning: { bg: 'bg-amber-500/8 border-amber-500/20', text: 'text-amber-400', icon: '!' },
    info: { bg: 'bg-blue-500/8 border-blue-500/20', text: 'text-blue-400', icon: '→' },
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {insights.map((ins, i) => {
        if (dismissed.has(i)) return null
        const text = lang === 'es' ? ins.textEs : ins.textEn
        const style = styleMap[ins.type] || styleMap.info
        return (
          <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] whitespace-nowrap shrink-0 ${style.bg}`}>
            <span className={`text-xs font-bold ${style.text}`}>{style.icon}</span>
            <span className={style.text}>{text}</span>
            <button onClick={() => dismiss(i)} className="opacity-40 hover:opacity-100 ml-1 text-xs text-slate-500">×</button>
          </div>
        )
      })}
    </div>
  )
}
