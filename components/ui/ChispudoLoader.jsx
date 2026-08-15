'use client'

// Chispudo's own loading indicator — the bolt, ringed by real progress (or a
// genuine indeterminate sweep), instead of a native browser spinner. Safari's
// own pull-to-refresh/tab-loading chrome is controlled by the browser and
// can't be (and isn't, here) touched from the page — this is a SEPARATE,
// in-page signal that lives entirely inside Chispudo's own UI, for moments
// the browser's own indicator doesn't cover: the app fetching its data,
// switching sections, refreshing prices.
//
// mode="fullscreen": a light, semi-transparent overlay for "we don't know
//   anything yet" moments (auth check, first paint). mode="inline" (default):
//   sized to `size`, sits wherever the caller puts it — a table, a card, a
//   toolbar — NEVER a fixed/full-viewport overlay, so a partial refresh only
//   blocks the one section it actually depends on, never the whole page.
//
// Same ring mechanics as ChispudoRefreshButton (SVG stroke-dashoffset for
// determinate progress, a short rotating arc for indeterminate) — one visual
// language for "Chispudo is working," whether it's the header button or a
// full-page splash. `progress` stays null until the caller has a REAL
// percentage; an indeterminate sweep is drawn instead of ever inventing one.
//
// The show-delay (150-250ms, `delay` prop) is the actual fix for "flickers
// on fast loads": nothing renders until the delay elapses, so a load that
// finishes before then never painted anything to begin with — no flash, no
// layout shift, because there was never a first frame with content. Success/
// error are terminal, informational moments (not "might still be instant"),
// so they always show right away.

import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert } from 'lucide-react'
import { BOLT_PATH, BOLT_VIEWBOX, boltStrokeWidth } from '@/lib/brandBolt'

const SIZES = { small: 28, medium: 48, large: 88 }
const R = 13.5
const C = 2 * Math.PI * R

export function ringColor(state) {
  if (state === 'error') return 'var(--text-negative)'
  if (state === 'success') return 'var(--accent-green)'
  return 'var(--accent-blue)'
}

export function defaultMessage(state, lang) {
  const t = (es, en) => (lang === 'es' ? es : en)
  switch (state) {
    case 'initial-loading': return t('Cargando Chispudo', 'Loading Chispudo')
    case 'section-loading': return t('Cargando datos', 'Loading data')
    case 'refreshing': return t('Actualizando datos', 'Updating data')
    case 'success': return t('Listo', 'Done')
    case 'error': return t('No se pudo cargar', 'Couldn’t load')
    default: return t('Cargando', 'Loading')
  }
}

export default function ChispudoLoader({
  mode = 'inline',
  size = 'medium',
  state = 'section-loading',
  // 0-100, or null/undefined while there is no reliable percentage yet.
  progress = null,
  message,
  errorMessage,
  onRetry,
  lang = 'es',
  // Inline mode stays icon-only by default (a table/card usually has no room
  // for a caption next to it) — set true for an inline use that DOES want
  // the visible text, e.g. a standalone "checking session" moment that isn't
  // full-screen but still wants its own caption.
  showLabel = false,
  // Minimum time a request has to be pending before anything renders at all
  // — the actual anti-flicker mechanism, see the file header.
  delay = 200,
  className = '',
}) {
  const diameter = typeof size === 'number' ? size : (SIZES[size] || SIZES.medium)
  const isWaiting = state === 'initial-loading' || state === 'section-loading' || state === 'refreshing'
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  const isDeterminate = isWaiting && pct != null
  const isIndeterminate = isWaiting && pct == null

  // Terminal states (success/error) always show immediately — they're not a
  // "might finish before you notice" moment, they're the answer. Waiting
  // states wait out `delay` first.
  const [visible, setVisible] = useState(state === 'success' || state === 'error')
  useEffect(() => {
    if (state === 'success' || state === 'error') { setVisible(true); return undefined }
    setVisible(false)
    const id = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(id)
  }, [state, delay])

  const label = message || defaultMessage(state, lang)
  const boltSize = Math.round(diameter * 0.42)
  const strokeW = diameter <= 32 ? 2.4 : diameter <= 56 ? 2 : 1.6

  if (!visible) {
    // Fullscreen has nothing to reserve — it's a fixed overlay outside
    // document flow either way, on or off. Inline reserves the SAME
    // diameter×diameter box now, invisible, so the fade-in at `delay`
    // never shifts whatever sits next to it — the alternative (popping in
    // at full size once the timer fires) is its own layout jump, just
    // delayed instead of avoided.
    return mode === 'fullscreen'
      ? null
      : <span aria-hidden="true" className={className} style={{ display: 'inline-block', width: diameter, height: diameter }} />
  }

  const ring = (
    <span className="chispu-loader-mark" style={{ position: 'relative', width: diameter, height: diameter, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {isWaiting && (
        <svg width={diameter} height={diameter} viewBox="0 0 32 32" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} style={{ stroke: 'var(--card-border)', opacity: 0.6 }} />
          {isIndeterminate ? (
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} strokeLinecap="round"
              className="chispu-loader-anim"
              style={{
                stroke: ringColor(state),
                strokeDasharray: `${C * 0.22} ${C * 0.78}`,
                transformOrigin: '16px 16px',
                animation: 'chispuLoaderSweep 1.1s linear infinite',
              }} />
          ) : (
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} strokeLinecap="round"
              transform="rotate(-90 16 16)"
              className="chispu-loader-anim"
              style={{
                stroke: ringColor(state),
                strokeDasharray: C,
                strokeDashoffset: C * (1 - Math.max(0.06, (pct ?? 0) / 100)),
                transition: 'stroke-dashoffset 320ms cubic-bezier(0.4, 0, 0.2, 1)',
              }} />
          )}
        </svg>
      )}
      {state === 'success' && (
        <svg width={diameter} height={diameter} viewBox="0 0 32 32" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} style={{ stroke: 'var(--accent-green)' }} />
        </svg>
      )}
      {state === 'success' ? (
        <Check size={boltSize} strokeWidth={2.5} className="chispu-loader-anim"
          style={{ color: 'var(--accent-green)', animation: 'chispuLoaderCheckIn 320ms cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
      ) : state === 'error' ? (
        <CircleAlert size={boltSize} style={{ color: 'var(--text-negative)' }} />
      ) : isDeterminate ? (
        <span className="tabular-nums font-bold" style={{ fontSize: Math.max(9, Math.round(diameter * 0.24)), color: 'var(--accent-blue)', lineHeight: 1 }}>
          {pct}%
        </span>
      ) : (
        <svg width={boltSize} height={boltSize} viewBox={BOLT_VIEWBOX} aria-hidden="true" className="chispu-loader-anim"
          style={{ animation: 'chispuLoaderPulse 1.4s ease-in-out infinite' }}>
          <path d={BOLT_PATH} fill="var(--accent-blue)" stroke="var(--accent-blue)"
            strokeWidth={boltStrokeWidth(boltSize)} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )

  const showText = mode === 'fullscreen' || errorMessage || state === 'error' || showLabel
  const body = (
    <div
      className={`chispu-loader ${className}`}
      role="status"
      aria-live="polite"
      aria-busy={isWaiting || undefined}
      style={mode === 'fullscreen'
        ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }
        : { display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      {ring}
      <span className="sr-only">{label}</span>
      {showText && (
        <span style={{ color: state === 'error' ? 'var(--text-negative)' : 'var(--text-secondary)', fontSize: mode === 'fullscreen' ? 14 : 12, textAlign: 'center' }}>
          {state === 'error' ? (errorMessage || label) : label}
        </span>
      )}
      {state === 'error' && onRetry && (
        <button type="button" onClick={onRetry}
          className="chispu-loader-retry"
          style={{
            marginTop: mode === 'fullscreen' ? 4 : 0,
            padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            color: '#ffffff', backgroundColor: 'var(--text-negative)', border: 'none', cursor: 'pointer',
          }}
        >
          {lang === 'es' ? 'Intentar de nuevo' : 'Try again'}
        </button>
      )}

      <style jsx>{`
        @keyframes chispuLoaderPulse {
          0%, 100% { opacity: 1;    transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.88); }
        }
        @keyframes chispuLoaderSweep {
          0%   { transform: rotate(-90deg); }
          100% { transform: rotate(270deg); }
        }
        @keyframes chispuLoaderCheckIn {
          0%   { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .chispu-loader-anim {
            animation: none !important;
            transition: opacity 120ms linear, stroke 120ms linear !important;
          }
        }
      `}</style>
    </div>
  )

  if (mode !== 'fullscreen') return body

  return (
    <div
      aria-hidden={false}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)',
        backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
      }}
    >
      {body}
    </div>
  )
}
