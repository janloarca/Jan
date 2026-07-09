'use client'

import { useMemo, useState } from 'react'

// "Chispu te sugiere" — surfaces the data-completeness findings with a one-tap
// fix per finding. Renders nothing when the data is complete. Dismissals stick
// per finding id (stable code:itemId) in localStorage; a fixed finding simply
// stops being generated, so the list heals itself.

const DISMISS_KEY = 'chispudo-dismissed-suggestions'

const SEV_STYLE = {
  high: { color: 'var(--alert-error-icon)', backgroundColor: 'var(--alert-error-bg)', borderColor: 'var(--alert-error-border)' },
  medium: { color: 'var(--alert-warn-icon)', backgroundColor: 'var(--alert-warn-bg)', borderColor: 'var(--alert-warn-border)' },
  low: { color: 'var(--alert-info-icon)', backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--alert-info-border)' },
}
const SEV_ICON = { high: '⚠', medium: '◆', low: 'ℹ' }

export default function ChispuSuggestions({ findings = [], globalScore = 100, lang = 'es', onEditItem, onOpenCashflow, onOpenReview, items = [] }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
  })
  const [expanded, setExpanded] = useState(false)

  const visible = useMemo(() => findings.filter((f) => !dismissed.has(f.id)), [findings, dismissed])
  const shown = expanded ? visible : visible.slice(0, 3)

  if (visible.length === 0) return null

  const dismiss = (id) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])) } catch {}
  }

  const actionLabel = (f) => {
    if (f.action?.kind === 'cashflow') return t('Capturar historia', 'Add history')
    if (f.action?.kind === 'review') return t('Revisar', 'Review')
    return t('Completar', 'Complete')
  }

  const runAction = (f) => {
    const item = f.itemId ? items.find((it) => it.id === f.itemId) : null
    if (f.action?.kind === 'cashflow' && onOpenCashflow) {
      onOpenCashflow(f.action.prefill || (f.itemId ? { flowType: 'DEPOSIT', origin: 'external', linkedId: f.itemId, alreadyReflected: true } : {}))
    } else if (f.action?.kind === 'review' && onOpenReview) {
      onOpenReview()
    } else if (item && onEditItem) {
      onEditItem(item)
    }
  }

  const scoreColor = globalScore >= 85 ? 'var(--accent-green)' : globalScore >= 60 ? 'var(--accent-orange)' : 'var(--alert-error-icon)'

  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          💡 {t('Chispu te sugiere', 'Chispu suggests')}
        </h3>
        <span className="text-xs px-2 py-1 rounded-full font-medium"
          style={{ color: scoreColor, backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }}
          title={t('Qué tan completos están tus datos: historia, fechas, monedas, destinos de ingresos.', 'How complete your data is: history, dates, currencies, income destinations.')}>
          {t('Datos', 'Data')} {globalScore}% {t('completos', 'complete')}
        </span>
      </div>

      <div className="space-y-2">
        {shown.map((f) => (
          <div key={f.id} className="flex items-start gap-2 p-2.5 rounded-lg border" style={SEV_STYLE[f.severity]}>
            <span className="text-sm shrink-0 mt-0.5" aria-hidden="true">{SEV_ICON[f.severity]}</span>
            <p className="text-xs flex-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {lang === 'es' ? f.textEs : f.textEn}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => runAction(f)}
                className="text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap"
                style={{ color: 'var(--accent-blue)', border: '1px solid rgba(59,130,246,0.35)' }}>
                {actionLabel(f)}
              </button>
              <button onClick={() => dismiss(f.id)} aria-label={t('Descartar sugerencia', 'Dismiss suggestion')}
                className="text-xs w-6 h-6 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {visible.length > 3 && (
        <button onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs underline" style={{ color: 'var(--text-muted)' }}>
          {expanded ? t('Ver menos', 'Show less') : `${t('Ver todas', 'Show all')} (${visible.length})`}
        </button>
      )}
    </div>
  )
}
