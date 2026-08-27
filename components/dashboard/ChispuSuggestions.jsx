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
const SEV_ICON = { high: '⚠', medium: '●', low: 'ℹ' }

export default function ChispuSuggestions({ findings = [], globalScore = 100, lang = 'es', onEditItem, onOpenCashflow, onOpenReview, onCompleteAll, onOpenLiquidYield, onConfirmDistinct, onApplySuggestion, items = [] }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
  })
  const [expanded, setExpanded] = useState(false)
  const [applied, setApplied] = useState(() => new Set())

  // Findings with a resolved patch stay VISIBLE right after applying (their
  // own next recompute will drop them once items actually update) but their
  // row swaps to a small confirmation so the click reads as "done", not as
  // nothing happening.
  const applySuggestion = (f) => {
    if (!f.suggestion || !f.itemId || !onApplySuggestion) return
    onApplySuggestion(f.itemId, f.suggestion.patch)
    setApplied((p) => new Set(p).add(f.id))
  }

  const visible = useMemo(() => findings.filter((f) => !dismissed.has(f.id)), [findings, dismissed])
  const shown = expanded ? visible : visible.slice(0, 3)
  const dismissedCount = findings.length - visible.length

  // Data truly complete (no findings at all, and there IS data): confirm it in
  // one slim line instead of vanishing — the score is a game you can win.
  if (findings.length === 0) {
    if (items.length === 0) return null
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs"
        style={{ backgroundColor: 'var(--alert-success-bg)', border: '1px solid var(--alert-success-border)', color: 'var(--accent-green)' }}>
        ✓ {t('Tus datos están completos: Chispu no encontró huecos.', 'Your data is complete: Chispu found no gaps.')}
      </div>
    )
  }
  if (visible.length === 0 && dismissedCount === 0) return null

  const dismiss = (id) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])) } catch {}
  }

  const restoreDismissed = () => {
    setDismissed(new Set())
    try { localStorage.removeItem(DISMISS_KEY) } catch {}
  }

  // Everything dismissed: keep a slim way back instead of hiding real gaps forever.
  if (visible.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-xs"
        style={{ border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
        <span>{t(`Descartaste ${dismissedCount} sugerencia${dismissedCount === 1 ? '' : 's'} de datos.`, `You dismissed ${dismissedCount} data suggestion${dismissedCount === 1 ? '' : 's'}.`)}</span>
        <button onClick={restoreDismissed} className="underline shrink-0" style={{ color: 'var(--accent-blue)' }}>
          {t('Restaurar', 'Restore')}
        </button>
      </div>
    )
  }

  const actionLabel = (f) => {
    if (f.action?.kind === 'cashflow') return t('Capturar historia', 'Add history')
    if (f.action?.kind === 'review') return t('Revisar', 'Review')
    if (f.action?.kind === 'liquid-yield') return t('Ver el desglose', 'See the breakdown')
    return t('Completar', 'Complete')
  }

  const runAction = (f) => {
    const item = f.itemId ? items.find((it) => it.id === f.itemId) : null
    if (f.action?.kind === 'cashflow' && onOpenCashflow) {
      onOpenCashflow(f.action.prefill || (f.itemId ? { flowType: 'DEPOSIT', origin: 'external', linkedId: f.itemId, alreadyReflected: true } : {}))
    } else if (f.action?.kind === 'review' && onOpenReview) {
      onOpenReview()
    } else if (f.action?.kind === 'liquid-yield' && onOpenLiquidYield) {
      onOpenLiquidYield()
    } else if (item && onEditItem) {
      onEditItem(item)
    }
  }

  const scoreColor = globalScore >= 85 ? 'var(--accent-green)' : globalScore >= 60 ? 'var(--accent-orange)' : 'var(--alert-error-icon)'

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          {t('Chispu te sugiere', 'Chispu suggests')}
        </h3>
        <span className="text-xs px-2 py-1 rounded-full font-medium"
          style={{ color: scoreColor, backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }}
          title={t('El porcentaje pesa cada cuenta por su saldo, así que una cuenta chica con huecos casi no lo mueve. El conteo de al lado dice cuántos huecos hay, sin importar el tamaño de la cuenta.', 'The percentage weighs each account by its balance, so a small account with gaps barely moves it. The count next to it says how many gaps there are, regardless of account size.')}>
          {/* El porcentaje pondera por SALDO, así que una cuenta chica con
              varios huecos casi no lo baja: el chip llegaba a decir "99%
              completos" justo encima de una lista de siete pendientes, o sea la
              card se contradecía a sí misma en dos centímetros. El conteo va al
              lado porque es lo que la lista de abajo de verdad muestra; el
              porcentaje conserva su significado y deja de ser la única cifra. */}
          {t('Datos', 'Data')} {globalScore}% · {visible.length} {t(visible.length === 1 ? 'pendiente' : 'pendientes', visible.length === 1 ? 'gap' : 'gaps')}
        </span>
      </div>

      <div className="space-y-2">
        {shown.map((f) => (
          <div key={f.id} className="flex items-start gap-2 p-2.5 rounded-lg border" style={SEV_STYLE[f.severity]}>
            <span className="text-sm shrink-0 mt-0.5" aria-hidden="true">{SEV_ICON[f.severity]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {lang === 'es' ? f.textEs : f.textEn}
              </p>
              {/* Grounded in real data (a past transaction, the account's own
                  createdAt) — never invented. See lib/dataCompleteness.js. */}
              {f.suggestion && !applied.has(f.id) && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-blue)' }}>
                  💡 {lang === 'es' ? f.suggestion.textEs : f.suggestion.textEn}
                </p>
              )}
              {applied.has(f.id) && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>
                  ✓ {t('Aplicado', 'Applied')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {f.suggestion && onApplySuggestion && !applied.has(f.id) && (
                <button onClick={() => applySuggestion(f)}
                  className="text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap"
                  style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                  {t('Usar esto', 'Use this')}
                </button>
              )}
              {!applied.has(f.id) && (
                <button onClick={() => runAction(f)}
                  className="text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap"
                  style={{ color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.35)' }}>
                  {actionLabel(f)}
                </button>
              )}
              {/* dup-suspect only: a stronger answer than "dismiss this box" — it
                  stamps BOTH items (_dupConfirmedDistinct, dataCompleteness.js) so
                  the same pair stops being asked about everywhere this check runs,
                  not just here. A plain ✕ only ever hid THIS card's copy of it. */}
              {f.code === 'dup-suspect' && f.action?.itemIds?.length > 1 && onConfirmDistinct && !applied.has(f.id) && (
                <button onClick={() => onConfirmDistinct(f)}
                  className="text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--card-border)' }}>
                  {t('No son iguales', 'Not the same')}
                </button>
              )}
              <button onClick={() => dismiss(f.id)} aria-label={t('Descartar sugerencia', 'Dismiss suggestion')}
                className="text-xs w-6 h-6 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Arreglar hueco por hueco desde acá funciona, pero cuenta por cuenta es
          mucho más rápido: el repaso agrupa los hallazgos por activo y ordena por
          severidad (`onlyWithFindings`, AccountReviewModal), así que se contesta
          todo lo de una cuenta de una sola vez.
          Prop APARTE de `onOpenReview` a propósito: ese abre el repaso COMPLETO
          (todas las cuentas, incluidas las que no tienen ningún hueco) y es lo
          correcto para el hallazgo de tipo 'review' y para el botón general de
          Acciones. Acá la promesa es otra, "lo que falta", y una etiqueta tiene
          que llevar a donde dice. */}
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        {onCompleteAll && (
          <button onClick={() => onCompleteAll()}
            className="text-xs underline" style={{ color: 'var(--accent-blue)' }}>
            {t(`Completar cuenta por cuenta (${visible.length})`, `Complete account by account (${visible.length})`)}
          </button>
        )}
        {visible.length > 3 && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            {expanded ? t('Ver menos', 'Show less') : `${t('Ver todas', 'Show all')} (${visible.length})`}
          </button>
        )}
        {dismissedCount > 0 && (
          <button onClick={restoreDismissed}
            className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            {t(`Restaurar descartadas (${dismissedCount})`, `Restore dismissed (${dismissedCount})`)}
          </button>
        )}
      </div>
    </div>
  )
}
