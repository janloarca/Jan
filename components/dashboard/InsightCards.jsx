'use client'

import { useMemo } from 'react'
import { generateInsights } from '@/lib/insights'

const TYPE_STYLES = {
  success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  danger: 'bg-red-500/10 border-red-500/20 text-red-400',
  info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  cta: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
}

const TYPE_ICONS = {
  success: '✓',
  warning: '⚠',
  danger: '✖',
  info: 'ℹ',
  cta: '→',
}

export default function InsightCards({ items, profile, netWorth, estimatedAnnualIncome, lang, onOpenSettings }) {
  const t = (es, en) => lang === 'es' ? es : en

  const cards = useMemo(() => {
    const result = []

    if (!profile || !profile.monthlyIncome) {
      result.push({
        type: 'cta',
        titleEs: 'Completa tu perfil',
        titleEn: 'Complete your profile',
        descEs: 'Agrega tu ingreso y gastos en Configuración → Perfil para insights personalizados.',
        descEn: 'Add your income and expenses in Settings → Profile for personalized insights.',
        priority: 0,
        action: 'profile',
      })
    }

    if (items && items.length > 0) {
      const missing = items.filter(it => !it.acquisitionDate)
      if (missing.length > 0) {
        result.push({
          type: 'info',
          titleEs: 'Datos incompletos',
          titleEn: 'Incomplete data',
          descEs: `${missing.length} activo${missing.length > 1 ? 's' : ''} sin fecha de compra — afecta tu retorno YTD.`,
          descEn: `${missing.length} asset${missing.length > 1 ? 's' : ''} missing purchase date — affects your YTD return.`,
          priority: 1,
        })
      }
    }

    const insights = generateInsights(items, profile, netWorth, estimatedAnnualIncome)
    result.push(...insights)

    return result.sort((a, b) => a.priority - b.priority).slice(0, 6)
  }, [items, profile, netWorth, estimatedAnnualIncome])

  if (!cards || cards.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((card, i) => (
        <div key={i}
          className={`p-3 rounded-lg border ${TYPE_STYLES[card.type] || TYPE_STYLES.info} ${card.action ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          onClick={card.action === 'profile' && onOpenSettings ? onOpenSettings : undefined}
          role={card.action ? 'button' : undefined}
          tabIndex={card.action ? 0 : undefined}
        >
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
