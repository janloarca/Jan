'use client'

// "Llevar tu broker al 100%" — the ordered checklist a broker connection leads
// into. Right now this is IBKR's real three-step story (lib/brokerCompletion.js);
// every other broker falls back to its single door. None of it is required:
// every step here is something the app can already do without it, this just
// makes the difference in data quality visible and gives a next click. Renders
// via StepJourney, the same connected-timeline visual the "how do I get this"
// instructions (BrokerSteps) use — one journey language across the whole
// connect-a-broker experience instead of two unrelated-looking checklists
// (FASE DT).

import { useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { KeyRound, FileSpreadsheet, CalendarRange, Percent, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getBrokerCompletionSteps } from '@/lib/brokerCompletion'
import { getBrokerHowTo } from '@/lib/brokerHowTo'
import StepJourney from '@/components/ui/StepJourney'
import BrokerProgressPanel from './BrokerProgressPanel'
import { formatCurrency, formatDate } from './utils'

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
  // FASE IH: el avance de lib/ibkrJourney.js (solo IBKR). Cuando llega, esta
  // pantalla dibuja el MISMO panel de % y requisitos tocables que la lista de
  // conexiones, en vez de una segunda forma de contar lo mismo. Sin él (todo
  // broker que no sea IBKR) se queda con el StepJourney de siempre.
  progress = null, onOpenStep = null,
  onConnect, onImportHistory, onQuarterlyHistory, onCalibrate,
  inferredFlowCount = 0, onReviewInferredFlows,
  // FASE GK: lib/ibkrReconciliation.js report (null until the PortfolioAnalyst
  // summary has been transcribed). Rendered as the closing scoreboard: PA's
  // lifetime primitives vs ours, delta visible per row.
  reconciliation = null,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()

  const howTo = getBrokerHowTo(brokerId)
  const steps = useMemo(() => getBrokerCompletionSteps(brokerId, howTo), [brokerId, howTo])

  // 'history' (Flex-XML-per-year) no longer exists as a step — see FASE DR in
  // lib/brokerCompletion.js. 'import' stays: it's the generic non-IBKR
  // broker's single csv door, unrelated to that removed step.
  const ACTIONS = { connect: onConnect, quarterly: onQuarterlyHistory, returns: onCalibrate, import: onImportHistory }

  const usePanel = !!(progress && progress.steps?.length && onOpenStep)
  const doneCount = steps.filter((s) => s.done(completionState)).length
  // OJO: `allDone` es el checklist de lib/brokerCompletion.js, el MISMO que
  // hasCompleteBrokerData usa para gatear la inferencia de flujos. No se
  // reemplaza por el % del panel (que cuenta un requisito más): el botón de
  // abajo tiene que aparecer exactamente cuando los candidatos existen.
  const allDone = steps.length > 0 && doneCount === steps.length

  // "active" (the journey's "you are here" highlight) is the FIRST step that's
  // neither done nor skippable — everything after it stays a plain upcoming
  // "todo" until its turn comes, exactly like a real journey/tracker.
  const firstOpenIdx = steps.findIndex((s) => !s.done(completionState) && !(s.skippable && s.skippable(completionState)))

  const journeySteps = steps.map((step, i) => {
    const isDone = step.done(completionState)
    const isSkippable = !isDone && step.skippable && step.skippable(completionState)
    const action = ACTIONS[step.id]
    return {
      key: step.id,
      title: step.title,
      desc: step.desc,
      icon: KIND_ICON[step.kind],
      status: isDone ? 'done' : isSkippable ? 'skippable' : (i === firstOpenIdx ? 'active' : 'todo'),
      action: action ? { label: t('Hacer', 'Do it'), onClick: () => { onClose(); action() } } : null,
    }
  })

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
            {!usePanel && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {allDone
                  ? t('Completo. Tu historial y tus retornos son lo más reales que se puede.', 'Complete. Your history and returns are as real as it gets.')
                  : t(`${doneCount}/${steps.length} listos. Ninguno es obligatorio, pero cada uno reduce huecos.`, `${doneCount}/${steps.length} done. None are required, but each one closes gaps.`)}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto">
          {usePanel
            ? <BrokerProgressPanel progress={progress} brokerName={brokerName} lang={lang} compact
                onOpenStep={(n) => { onClose(); setTimeout(() => onOpenStep(n), 50) }} />
            : <StepJourney steps={journeySteps} lang={lang} accent="var(--accent-blue)" />}

          {/* FASE GK: the reconciliation scoreboard. PA's screenshot asserts
              three lifetime primitives; our file asserts the same three. When
              every row closes, the account is verifiably at 100%; when one
              does not, its delta says exactly which primitive is missing. */}
          {brokerId === 'ibkr' && reconciliation && (
            <div className="mt-4 rounded-xl p-3.5" style={{ border: '1px solid var(--card-border)' }}>
              <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>
                {t('Conciliación con PortfolioAnalyst', 'Reconciliation with PortfolioAnalyst')}
              </p>
              <p className="text-[10px] mb-2.5" style={{ color: 'var(--text-muted)' }}>
                {t(`A la fecha de tu captura (${formatDate(reconciliation.asOfDate)}).`, `As of your screenshot's date (${formatDate(reconciliation.asOfDate)}).`)}
              </p>
              {[
                { key: 'nav', label: t('Valor de la cuenta (NAV)', 'Account value (NAV)'), row: reconciliation.nav },
                { key: 'netFlows', label: t('Depósitos netos de por vida', 'Lifetime net deposits'), row: reconciliation.netFlows },
                { key: 'pl', label: t('Ganancia de por vida', 'Lifetime gain'), row: reconciliation.pl },
              ].map(({ key, label, row }) => (
                <div key={key} className="flex items-center gap-2 py-1.5 text-xs" style={{ borderTop: '1px solid var(--card-border)' }}>
                  {row.ok
                    ? <CheckCircle2 size={13} className="shrink-0" style={{ color: 'var(--accent-green)' }} />
                    : <AlertTriangle size={13} className="shrink-0" style={{ color: 'var(--alert-warn-icon)' }} />}
                  <span className="flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="font-mono text-right shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {row.oursUSD != null ? formatCurrency(row.oursUSD, 'USD') : t('sin dato', 'no data')}
                  </span>
                  <span className="font-mono text-[10px] text-right shrink-0 w-20" style={{ color: row.ok ? 'var(--text-muted)' : 'var(--alert-warn-icon)' }}>
                    {row.deltaUSD != null && !row.ok
                      ? `${row.deltaUSD >= 0 ? '+' : ''}${formatCurrency(row.deltaUSD, 'USD')}`
                      : `PA ${formatCurrency(row.paUSD, 'USD')}`}
                  </span>
                </div>
              ))}
              {reconciliation.periodPct != null && (
                <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {t(`Referencia: PA reporta ${reconciliation.periodPct >= 0 ? '+' : ''}${reconciliation.periodPct.toFixed(2)}% desde el inicio (TWR del broker). Estas tres filas son la evidencia cruda de la que ese % se deriva: si cierran, la historia cierra.`,
                     `Reference: PA reports ${reconciliation.periodPct >= 0 ? '+' : ''}${reconciliation.periodPct.toFixed(2)}% since inception (the broker's TWR). These three rows are the raw evidence that % derives from: if they close, the story closes.`)}
                </p>
              )}
            </div>
          )}
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
