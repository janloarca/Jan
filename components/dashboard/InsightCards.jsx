'use client'

import { useMemo } from 'react'
import { generateInsights } from '@/lib/insights'

// Neutral card with a single colored accent (left border + icon).
// Reduces the "everything is colored" noise — color carries one meaning:
// green = good money, red = problem, amber = attention, blue = action/info.
const TYPE_ACCENT = {
  success: { border: 'border-l-emerald-500', icon: 'text-emerald-400' },
  warning: { border: 'border-l-amber-500', icon: 'text-amber-400' },
  danger: { border: 'border-l-red-500', icon: 'text-red-400' },
  info: { border: 'border-l-slate-500', icon: 'text-slate-400' },
  cta: { border: 'border-l-blue-500', icon: 'text-blue-400' },
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
      {cards.map((card, i) => {
        const accent = TYPE_ACCENT[card.type] || TYPE_ACCENT.info
        return (
          <div key={i}
            className={`p-3 rounded-lg bg-[#1C1C1E]/80 border border-[#38383A]/50 border-l-2 ${accent.border} ${card.action ? 'cursor-pointer hover:bg-[#2C2C2E]/60 transition-colors' : ''}`}
            onClick={card.action === 'profile' && onOpenSettings ? onOpenSettings : undefined}
            role={card.action ? 'button' : undefined}
            tabIndex={card.action ? 0 : undefined}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-sm ${accent.icon}`}>{TYPE_ICONS[card.type] || TYPE_ICONS.info}</span>
              <span className="text-xs font-semibold text-slate-200">{lang === 'es' ? card.titleEs : card.titleEn}</span>
            </div>
            <p className="text-xs text-slate-400">{lang === 'es' ? card.descEs : card.descEn}</p>
          </div>
        )
      })}
    </div>
  )
}
