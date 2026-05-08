'use client'

import { useMemo } from 'react'

export default function DataQuality({ items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const quality = useMemo(() => {
    if (!items || items.length === 0) return null
    let issues = 0
    let total = 0
    const checks = []

    const noDate = items.filter((it) => !it.acquisitionDate).length
    if (noDate > 0) { issues += noDate; checks.push({ icon: '📅', text: t(`${noDate} sin fecha de compra`, `${noDate} missing purchase date`), count: noDate }) }
    total += items.length

    const noPrice = items.filter((it) => !it.currentPrice && !it.purchasePrice).length
    if (noPrice > 0) { issues += noPrice; checks.push({ icon: '💲', text: t(`${noPrice} sin precio`, `${noPrice} missing price`), count: noPrice }) }
    total += items.length

    const noInst = items.filter((it) => !it.institution).length
    if (noInst > 0) { issues += noInst; checks.push({ icon: '🏦', text: t(`${noInst} sin institución`, `${noInst} missing institution`), count: noInst }) }
    total += items.length

    const noType = items.filter((it) => !it.type || it.type === 'Stock').length
    if (noType > items.length * 0.8) {
      checks.push({ icon: '📋', text: t('Mayoría tipo genérico', 'Most have generic type'), count: noType })
      issues += Math.floor(noType / 2)
    }
    total += items.length

    const score = total > 0 ? Math.round(((total - issues) / total) * 100) : 100

    return { score, checks, total: items.length }
  }, [items, lang])

  if (!quality || quality.score >= 95 || quality.total < 3) return null

  const color = quality.score >= 80 ? 'text-emerald-400' : quality.score >= 60 ? 'text-amber-400' : 'text-red-400'
  const barColor = quality.score >= 80 ? 'bg-emerald-500' : quality.score >= 60 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="text-center shrink-0">
          <div className={`text-lg font-bold ${color}`}>{quality.score}%</div>
          <div className="text-[10px] text-slate-600">{t('Calidad', 'Quality')}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden mb-1.5">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${quality.score}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {quality.checks.slice(0, 3).map((c, i) => (
              <span key={i} className="text-[10px] text-slate-500">{c.icon} {c.text}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
