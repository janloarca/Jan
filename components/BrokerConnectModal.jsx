'use client'

// Full-screen "Empezar" wizard for connecting a broker/exchange — replaces
// the old row of separate API / Pasos / CSV buttons with ONE entry point
// that walks through all three ways of bringing data in, one at a time,
// "Paso X de 3 → Continuar". None of the three steps is required and none is
// "the real way" with the others as a fallback: the framing throughout is
// additive (a file gives current positions, a screenshot can cover history a
// file format doesn't carry, an API keeps future syncs automatic), matching
// what the user asked for explicitly: "entre mas informacion mejor".
//
// IBKR runs through this SAME wizard (FASE EZ2) — IBKR_PSEUDO_BROKER in
// ConnectionsModal.jsx feeds it in, and the api step below special-cases
// `broker.id === 'ibkr'` to swap the generic `fields` inputs for its real
// Flex Token + Query ID shape. A successful IBKR connect continues straight
// into the "llevar al 100%" checklist (ConnectionsModal's handleIbkrSave,
// FASE FI) instead of stopping here — this wizard is only the first leg.

import { useState } from 'react'
import { FileSpreadsheet, Camera, KeyRound, ChevronLeft, Lock, CheckCircle2 } from 'lucide-react'
import { buildBrokerConnectSteps } from '@/lib/brokerConnectSteps'
import { connectorExplainer } from '@/lib/brokerRegistry'
import BrokerSteps from '@/components/ui/BrokerSteps'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const STEP_ICON = { file: FileSpreadsheet, screenshot: Camera, api: KeyRound }

export default function BrokerConnectModal({
  broker, howTo, lang = 'es', onClose, onCloseAll, onImport,
  brokerForm = {}, setBrokerForm, onSubmitApi, isSyncing = false, error,
  ibkrToken, setIbkrToken, ibkrQueryId, setIbkrQueryId,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const steps = buildBrokerConnectSteps(broker, howTo, lang)
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1
  const Icon = STEP_ICON[step.key]

  if (!broker || !step) return null

  const goNext = () => { if (!isLast) setStepIndex((i) => i + 1) }
  const goPrev = () => { if (stepIndex > 0) setStepIndex((i) => i - 1) }

  // Leaves the whole Connections flow, not just this wizard — same behavior
  // the old CSV button had: import is a different screen, not a sub-step of
  // this modal, so both this wizard AND ConnectionsModal underneath close.
  const openImporter = () => { (onCloseAll || onClose)(); setTimeout(() => onImport?.(broker.id), 50) }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4" onClick={onClose}
      role="dialog" aria-modal="true" aria-labelledby="broker-connect-title"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden sm:rounded-2xl"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--glass-border-color)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header: broker identity + close, then the step progress bar. */}
        <div className="px-5 pt-5 pb-3 border-b border-glass-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <h2 id="broker-connect-title" className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <span className="text-lg">{broker.icon}</span>
              {broker.name}
            </h2>
            <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
              className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>&times;</button>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            {steps.map((s, i) => (
              <div key={s.key} className="h-1 flex-1 rounded-full transition-colors"
                style={{ backgroundColor: i <= stepIndex ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }} />
            ))}
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            {t(`Paso ${stepIndex + 1} de ${steps.length}`, `Step ${stepIndex + 1} of ${steps.length}`)}
          </p>
        </div>

        {/* Framing line, once, not per-step: sets the "no step is required,
            more is better" expectation before any of the three specifics. */}
        {stepIndex === 0 && (
          <p className="text-xs px-5 pt-3" style={{ color: 'var(--text-muted)' }}>
            {t('Ningún paso es obligatorio ni excluye a los demás: mientras más completes, más preciso queda tu historial.',
               "No step is required and none rules out the others: the more you complete, the more accurate your history gets.")}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            {Icon && <Icon size={16} style={{ color: 'var(--accent-blue)' }} />}
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{step.title}</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{step.blurb}</p>

          {step.key === 'file' && (
            <div className="space-y-3">
              {step.instructionSteps ? (
                <BrokerSteps steps={step.instructionSteps} note={step.instructionNote} variant="csv" lang={lang} />
              ) : step.fallbackText ? (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{step.fallbackText}</p>
              ) : null}
              <button onClick={openImporter}
                className="w-full py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                style={{ color: 'var(--bg-card)', backgroundColor: 'var(--accent-green)' }}>
                {step.cta}
              </button>
            </div>
          )}

          {step.key === 'screenshot' && (
            <div className="space-y-3">
              <p className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--text-muted)' }}>
                {t('Dentro del importador, busca "¿Solo tienes una captura...?": copia el prompt, pégalo con tu foto en tu IA favorita, y sube aquí lo que te devuelva.',
                   'Inside the importer, look for "Only have a screenshot...?": copy the prompt, paste it with your photo into your favorite AI, and upload here what it gives back.')}
              </p>
              <button onClick={openImporter}
                className="w-full py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-purple)' }}>
                {step.cta}
              </button>
            </div>
          )}

          {step.key === 'api' && !step.available && (
            <div className="px-3 py-2.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
              {t('No disponible para este broker: usa el archivo o la captura de los pasos anteriores.',
                 "Not available for this broker: use the file or screenshot from the earlier steps.")}
            </div>
          )}

          {step.key === 'api' && step.available && (
            <div className="space-y-3">
              <p className="text-xs px-2.5 py-1.5 rounded-lg flex items-start gap-1.5" style={{ backgroundColor: 'rgba(37,99,235,0.06)', color: 'var(--accent-blue)' }}>
                <Lock size={12} className="shrink-0 mt-0.5" />
                {connectorExplainer(broker, t)}
              </p>
              {step.instructionSteps && (
                <BrokerSteps steps={step.instructionSteps} note={step.instructionNote} variant="api" lang={lang} />
              )}
              {error && <p className="text-xs" style={{ color: 'var(--text-negative)' }}>{error}</p>}
              {/* IBKR's own credential shape (Flex Token + Query ID) is not a
                  registry `fields` array — it's the one broker onboarded
                  outside lib/brokerRegistry.js (see IBKR_PSEUDO_BROKER in
                  ConnectionsModal.jsx), so it gets its own two inputs here
                  instead of the generic fields.map below. */}
              {broker.id === 'ibkr' ? (
                <>
                  <div>
                    <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>Flex Token</label>
                    <input type="password" value={ibkrToken || ''} onChange={(e) => setIbkrToken?.(e.target.value)}
                      placeholder="••••••••••••••••"
                      className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs focus:outline-none focus:border-blue-500/50"
                      style={{ color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>Query ID</label>
                    <input type="text" value={ibkrQueryId || ''} onChange={(e) => setIbkrQueryId?.(e.target.value)}
                      placeholder="123456"
                      className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs focus:outline-none focus:border-blue-500/50"
                      style={{ color: 'var(--text-primary)' }} />
                  </div>
                </>
              ) : step.authType !== 'oauth' && step.fields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                  <input type={f.type || 'text'} value={brokerForm[f.key] || ''}
                    onChange={(e) => setBrokerForm?.((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs focus:outline-none focus:border-blue-500/50"
                    style={{ color: 'var(--text-primary)' }} />
                </div>
              ))}
              <button onClick={onSubmitApi}
                disabled={isSyncing || (broker.id === 'ibkr' ? (!ibkrToken || !ibkrQueryId) : (step.authType !== 'oauth' && step.fields.some((f) => !brokerForm[f.key])))}
                className="w-full py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                {isSyncing ? '...' : step.cta}
              </button>
            </div>
          )}
        </div>

        {/* Footer nav — Continuar/Listo never block on having done anything
            in the current step, on purpose (see the framing line above). */}
        <div className="px-5 py-3.5 border-t border-glass-border flex items-center gap-2 shrink-0">
          <button onClick={goPrev} disabled={stepIndex === 0}
            aria-label={t('Anterior', 'Previous')}
            className="px-3 py-2 rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{ borderColor: 'var(--glass-border-color)', color: 'var(--text-secondary)' }}>
            <ChevronLeft size={16} />
          </button>
          {isLast ? (
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
              style={{ color: 'var(--bg-card)', backgroundColor: 'var(--accent-green)' }}>
              <CheckCircle2 size={15} /> {t('Listo', 'Done')}
            </button>
          ) : (
            <button onClick={goNext}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
              {t('Continuar', 'Continue')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
