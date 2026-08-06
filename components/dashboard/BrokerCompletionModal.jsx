'use client'

// "Llevar tu broker al 100%" — the ordered checklist a broker connection leads
// into. Right now this is IBKR's real four-step story (lib/brokerCompletion.js);
// every other broker falls back to its single door. None of it is required:
// every step here is something the app can already do without it, this just
// makes the difference in data quality visible and gives a next click.

import { useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { CheckCircle2, Circle, ChevronRight, KeyRound, FileSpreadsheet, CalendarRange, Percent, Sparkles } from 'lucide-react'
import { getBrokerCompletionSteps } from '@/lib/brokerCompletion'
import { getBrokerHowTo } from '@/lib/brokerHowTo'

const KIND_ICON = { api: KeyRound, csv: FileSpreadsheet, quarterly: CalendarRange, calibrate: Percent }

// `completionState` is the SAME object useDashboardData.js's
// brokerCompletionState computes and hasCompleteBrokerData gates the inferred-
// flows feature on — passed down rather than recomputed here, so the
// checklist and the inference gate can never quietly disagree about what
// "done" means for this account.
export default function BrokerCompletionModal({
  brokerId = 'ibkr', brokerName = 'Interactive Brokers',
  onClose, lang = 'es',
  completionState = {},
  onConnect, onImportHistory, onQuarterlyHistory, onCalibrate,
  inferredFlowCount = 0, onReviewInferredFlows,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()

  const howTo = getBrokerHowTo(brokerId)
  const steps = useMemo(() => getBrokerCompletionSteps(brokerId, howTo), [brokerId, howTo])

  const ACTIONS = { connect: onConnect, history: onImportHistory, quarterly: onQuarterlyHistory, returns: onCalibrate, import: onImportHistory }

  const doneCount = steps.filter((s) => s.done(completionState)).length
  const allDone = steps.length > 0 && doneCount === steps.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t(`Llevar ${brokerName} al 100%`, `Get ${brokerName} to 100%`)}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {allDone
                ? t('Completo. Tu historial y tus retornos son lo más reales que se puede.', 'Complete. Your history and returns are as real as it gets.')
                : t(`${doneCount}/${steps.length} listos. Ninguno es obligatorio, pero cada uno reduce huecos.`, `${doneCount}/${steps.length} done. None are required, but each one closes gaps.`)}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        <div className="px-5 pb-5 space-y-2">
          {steps.map((step, i) => {
            const isDone = step.done(completionState)
            const isSkippable = !isDone && step.skippable && step.skippable(completionState)
            const Icon = KIND_ICON[step.kind] || Circle
            const action = ACTIONS[step.id]
            return (
              <div key={step.id} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ border: '1px solid var(--card-border)', opacity: isSkippable ? 0.6 : 1 }}>
                <span className="shrink-0 mt-0.5">
                  {isDone
                    ? <CheckCircle2 size={18} style={{ color: 'var(--accent-green)' }} />
                    : <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{i + 1}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Icon size={13} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-body font-medium" style={{ color: isDone ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none' }}>
                      {lang === 'es' ? step.title.es : step.title.en}
                    </span>
                  </span>
                  {step.desc && !isDone && (
                    <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {lang === 'es' ? step.desc.es : step.desc.en}
                    </span>
                  )}
                  {isSkippable && (
                    <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {t('No hace falta: el archivo ya cubre todo tu historial.', 'Not needed: the file already covers your whole history.')}
                    </span>
                  )}
                </span>
                {!isDone && !isSkippable && action && (
                  <button type="button" onClick={() => { onClose(); action() }}
                    className="shrink-0 flex items-center gap-1 self-center text-micro font-medium px-2 py-1 rounded-lg transition-colors hover:bg-theme-elevated"
                    style={{ color: 'var(--accent-blue)' }}>
                    {t('Hacer', 'Do it')} <ChevronRight size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Only ever reachable once every step above is done — an account
            still missing one has nothing here (see hasCompleteBrokerData in
            useDashboardData.js, the single gate both this button's visibility
            and the candidates themselves are computed from). */}
        {allDone && onReviewInferredFlows && (
          <div className="px-5 pb-5">
            <button type="button" onClick={() => { onClose(); onReviewInferredFlows() }}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors hover:bg-theme-elevated"
              style={{ border: '1px solid var(--card-border)' }}>
              <Sparkles size={16} className="shrink-0" style={{ color: 'var(--accent-blue)' }} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t('Buscar depósitos o retiros que faltan', 'Look for missing deposits or withdrawals')}
                </span>
                <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {inferredFlowCount > 0
                    ? t(`Encontró ${inferredFlowCount} para revisar.`, `Found ${inferredFlowCount} to review.`)
                    : t('Con todo esto ya completo, Chispu puede detectarlos solo.', 'With all of this complete, Chispu can detect them on its own.')}
                </span>
              </span>
              {inferredFlowCount > 0 && (
                <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                  {inferredFlowCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
