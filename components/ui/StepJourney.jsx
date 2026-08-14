'use client'

// Shared "journey" visual: a connected vertical timeline of steps, used for
// BOTH kinds of step sequences the app has — pure instructions (lib/brokerHowTo.js,
// "how do I get this file/key") and stateful completion checklists
// (lib/brokerCompletion.js, "get this broker to 100%"). Same visual language
// everywhere a broker asks the user to do a sequence of things, instead of the
// old flat numbered `<ol>` that didn't read as a journey at all (FASE DT).
//
// Per-step shape (all optional except title):
//   { key, title, desc, detail, status: 'done'|'active'|'todo'|'skippable',
//     icon: LucideIcon, action: { label, onClick } }
// `status` is optional — when every step omits it, the first step is treated
// as 'active' and the rest as 'todo' (the pure-instructions case, which has no
// real completion state to track).

import { useState } from 'react'
import { CheckCircle2, Info, Circle } from 'lucide-react'

function resolveText(v, lang) {
  if (v == null) return null
  if (typeof v === 'string') return v
  return lang === 'es' ? v.es : v.en
}

// lib/brokerHowTo.js's own step shape puts the instruction text straight on
// the step (`{ es, en, detail }`), not nested under `.title` — this resolves
// EITHER shape so those steps (passed through completely unmapped by every
// caller: FileImportModal, ConnectionsModal, BrokerConnectModal) render their
// text instead of silently falling back to an empty circle with a number and
// nothing next to it.
function resolveTitle(step, lang) {
  if (step.title != null) return resolveText(step.title, lang)
  if (step.es != null || step.en != null) return resolveText({ es: step.es, en: step.en }, lang)
  return null
}

export default function StepJourney({
  steps, note, variant = 'csv', lang = 'es', title = null, accent: accentProp = null, headerIcon: HeaderIcon = null,
  // FASE IH2: la lista entera se puede plegar detrás de su propio encabezado.
  // Existe porque en los pasos del viaje de IBKR las instrucciones empujaban
  // el campo que hay que llenar fuera de la pantalla: lo primero que se ve
  // tiene que ser lo que hay que HACER, con el "cómo consigo esto" a un toque.
  // Sin `collapsible` el comportamiento es idéntico al de siempre.
  collapsible = false, defaultOpen = false,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openStep, setOpenStep] = useState(null)
  const [listOpen, setListOpen] = useState(defaultOpen)
  if (!steps || steps.length === 0) return null

  const accent = accentProp || (variant === 'api' ? 'var(--accent-blue)' : 'var(--accent-green)')

  // No caller supplied real status → this is the pure-instructions case: the
  // first step reads as "you're here", the rest as upcoming. Gives the flat
  // how-to list the same "journey" feel without inventing a false done state.
  const hasRealStatus = steps.some((s) => s.status)
  const resolved = steps.map((s, i) => ({
    ...s,
    status: s.status || (hasRealStatus ? 'todo' : (i === 0 ? 'active' : 'todo')),
  }))

  const firstActiveIdx = resolved.findIndex((s) => s.status === 'active')
  const doneCount = resolved.filter((s) => s.status === 'done').length

  const collapsed = collapsible && !listOpen

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${accent}33`, backgroundColor: collapsed ? 'transparent' : `${accent}0a` }}>
      {title && collapsible && (
        <button type="button" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}
          className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-theme-elevated">
          {HeaderIcon && <HeaderIcon size={14} className="shrink-0" style={{ color: accent }} />}
          <span className="text-xs font-semibold flex-1 min-w-0" style={{ color: accent }}>{title}</span>
          <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>
            {hasRealStatus ? `${doneCount}/${resolved.length}` : t(`${resolved.length} pasos`, `${resolved.length} steps`)}
          </span>
          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{listOpen ? '▴' : '▾'}</span>
        </button>
      )}
      {title && !collapsible && (
        <div className="flex items-center gap-2 px-4 pt-4 pb-1">
          {HeaderIcon && <HeaderIcon size={14} style={{ color: accent }} />}
          <span className="text-xs font-semibold" style={{ color: accent }}>{title}</span>
          {hasRealStatus && (
            <span className="text-[10px] font-medium ml-auto" style={{ color: 'var(--text-muted)' }}>
              {doneCount}/{resolved.length}
            </span>
          )}
        </div>
      )}
      {collapsed ? null : (
      <>
      <ol className="px-4 py-4">
        {resolved.map((step, i) => {
          const isLast = i === resolved.length - 1
          const isOpen = openStep === i
          const isDone = step.status === 'done'
          const isActive = step.status === 'active'
          const isSkippable = step.status === 'skippable'
          const lineColor = isDone ? accent : 'var(--card-border)'
          const desc = resolveText(step.desc, lang)
          const detail = resolveText(step.detail, lang)
          const stepTitle = resolveTitle(step, lang)
          const StepIcon = step.icon

          return (
            <li key={step.key ?? i} className="relative flex gap-3" style={{ paddingBottom: isLast ? 0 : '0.9rem' }}>
              {/* connector line to the next step */}
              {!isLast && (
                <span
                  className="absolute left-[13px] top-[28px] w-[2px] rounded-full transition-colors"
                  style={{ bottom: 4, backgroundColor: lineColor }}
                />
              )}
              {/* circle indicator */}
              <span
                className="shrink-0 z-10 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                style={isDone
                  ? { backgroundColor: accent, color: 'var(--bg-card)' }
                  : isActive
                    ? { backgroundColor: 'var(--bg-card)', color: accent, border: `2px solid ${accent}`, boxShadow: `0 0 0 3px ${accent}22` }
                    : isSkippable
                      ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', opacity: 0.6 }
                      : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              >
                {isDone ? <CheckCircle2 size={15} /> : (StepIcon ? <StepIcon size={13} /> : i + 1)}
              </span>

              {/* body */}
              <div className="flex-1 min-w-0 rounded-lg transition-colors"
                style={isActive ? { backgroundColor: `${accent}12`, border: `1px solid ${accent}33`, padding: '0.55rem 0.7rem', marginTop: '-2px' } : { padding: '0.15rem 0' }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed font-medium"
                      style={{ color: isDone ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: isDone && !desc ? 'line-through' : 'none' }}>
                      {stepTitle}
                    </p>
                    {desc && !isDone && (
                      <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                    )}
                    {isSkippable && (
                      <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t('No hace falta: ya está cubierto.', 'Not needed: already covered.')}
                      </p>
                    )}
                  </div>
                  {/* FASE GM parte 2: botón "i" explícito en vez de una flechita
                      ambigua — el usuario pidió "botones de info con más
                      especificaciones" para que quede claro que ahí vive el
                      detalle, no una acción de expandir genérica. */}
                  {detail && (
                    <button type="button" onClick={() => setOpenStep(isOpen ? null : i)} aria-expanded={isOpen}
                      aria-label={t('Más detalle de este paso', 'More detail for this step')}
                      className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                      style={isOpen
                        ? { backgroundColor: accent, color: 'var(--bg-card)' }
                        : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      <Info size={12} />
                    </button>
                  )}
                </div>
                {detail && isOpen && (
                  <p className="text-[11px] leading-relaxed mt-1 pt-1" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--card-border)' }}>
                    {detail}
                  </p>
                )}
                {step.action && !isDone && !isSkippable && (
                  <button type="button" onClick={step.action.onClick}
                    className="mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-opacity hover:opacity-85"
                    style={{ backgroundColor: accent, color: 'var(--bg-card)' }}>
                    {resolveText(step.action.label, lang)}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {note && (
        <div className="flex items-start gap-2 mx-4 mb-4 px-2.5 py-2 rounded-lg text-[11px] leading-relaxed"
          style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--text-muted)' }}>
          <Circle size={10} className="shrink-0 mt-0.5" fill="currentColor" style={{ color: 'var(--alert-info-icon)' }} />
          <span>{resolveText(note, lang)}</span>
        </div>
      )}
      </>
      )}
    </div>
  )
}
