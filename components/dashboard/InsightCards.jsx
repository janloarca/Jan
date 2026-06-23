'use client'

import { useMemo } from 'react'
import { generateInsights } from '@/lib/insights'

// Semantic alert cards — soft tinted background + hairline border + icon chip.
// Color carries one meaning: green = good money, red = problem, amber =
// attention, blue = action/info. Tokens are theme-aware (see globals.css).
const TYPE_ACCENT = {
  success: { bg: 'var(--alert-success-bg)', border: 'var(--alert-success-border)', icon: 'var(--alert-success-icon)' },
  warning: { bg: 'var(--alert-warn-bg)',    border: 'var(--alert-warn-border)',    icon: 'var(--alert-warn-icon)' },
  danger:  { bg: 'var(--alert-error-bg)',   border: 'var(--alert-error-border)',   icon: 'var(--alert-error-icon)' },
  info:    { bg: 'var(--alert-info-bg)',     border: 'var(--alert-info-border)',     icon: 'var(--alert-info-icon)' },
  cta:     { bg: 'var(--alert-info-bg)',     border: 'var(--alert-info-border)',     icon: 'var(--accent-blue)' },
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
            className={`px-5 py-4 rounded-xl border transition-colors ${card.action ? 'cursor-pointer hover:brightness-[0.98]' : ''}`}
            style={{ background: accent.bg, borderColor: accent.border }}
            onClick={card.action === 'profile' && onOpenSettings ? onOpenSettings : undefined}
            role={card.action ? 'button' : undefined}
            tabIndex={card.action ? 0 : undefined}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
                style={{ color: accent.icon, backgroundColor: `color-mix(in srgb, ${accent.icon} 15%, transparent)` }}>
                {TYPE_ICONS[card.type] || TYPE_ICONS.info}
              </span>
              <span className="text-[13px] font-semibold" style={{ color: accent.icon }}>{lang === 'es' ? card.titleEs : card.titleEn}</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? card.descEs : card.descEn}</p>
          </div>
        )
      })}
    </div>
  )
}
