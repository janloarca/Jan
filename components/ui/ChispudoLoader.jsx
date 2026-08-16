'use client'

// Chispudo's own loading indicator — the bolt, ringed by real progress (or a
// genuine indeterminate sweep), instead of a native browser spinner. Safari's
// own pull-to-refresh/tab-loading chrome is controlled by the browser and
// can't be (and isn't, here) touched from the page — this is a SEPARATE,
// in-page signal that lives entirely inside Chispudo's own UI, for moments
// the browser's own indicator doesn't cover: the app fetching its data,
// switching sections, refreshing prices.
//
// mode="fullscreen": the app's SPLASH. An opaque, full-viewport surface with
//   a big bolt, a caption, and staged status copy — the first thing anyone
//   sees, so it's the brand moment, not a spinner in a corner.
//   mode="inline" (default): sized to `size`, sits wherever the caller puts
//   it — a table, a card, a toolbar — NEVER a fixed/full-viewport overlay, so
//   a partial refresh only blocks the one section it actually depends on.
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
//
// The splash paints an OPAQUE --bg-primary (it used to be 78% + backdrop
// blur). Two reasons: on first paint there is nothing behind it to show
// through, so the transparency only risked compositing toward the browser's
// own white; and blurring a flat, uniform backdrop is a no-op VISUAL that
// still costs a compositing layer, the same reasoning that took the blur off
// `.card`. Opaque is also what makes the exit fade read as the splash lifting
// off the dashboard instead of two translucent layers crossing.
//
// It is deliberately THEME-AWARE rather than hardcoded bright: dark is this
// app's default theme, so a fixed off-white would flash white at every
// dark-theme user on every cold open. In light theme --bg-primary is already
// #F8F9FB, i.e. the soft off-white this splash is supposed to be.

import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, WifiOff } from 'lucide-react'
import { BOLT_PATH, BOLT_VIEWBOX, boltStrokeWidth } from '@/lib/brandBolt'

const SIZES = { small: 28, medium: 48, large: 88 }
const R = 13.5
const C = 2 * Math.PI * R

// Dither for the splash's background tint. A very light wash over a light
// background BANDS, and not marginally: 7% of --accent-blue over #F8F9FB moves
// the red channel by only ~15 levels, spread over ~380px, so there is a visible
// step every ~25px and the "subtle glow" renders as concentric rings (measured,
// not guessed — it showed up in the first screenshot of this splash).
// Strengthening the tint would narrow the bands but stops being subtle;
// shrinking the radius makes it a halo instead of a wash. Noise is the fix that
// keeps the tint exactly as light as intended: ~1 level of grain per pixel is
// enough to break the steps and is itself invisible.
// Inline data URI so it costs no request, and `img-src 'self' data:` in the
// CSP already allows it.
const DITHER = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E\")"

// The splash gives the bolt ~1.5x the share of the ring that an inline
// loader does. An inline one sits in a table row or a toolbar, where the mark
// is a status glyph and the ring is the message; on the splash the mark IS
// the message, so it gets the room.
const BOLT_RATIO = { fullscreen: 0.62, inline: 0.42 }

// Staged copy for a load that outlives a glance. Nothing before ~1.2s: a
// caption that starts changing immediately reads as thrash, not progress.
// The three lines and the slow warning share ONE slot, so the cadence is set
// so that all three land BEFORE the warning takes over (1.2s / 2.5s / 3.8s,
// warning at 5s) — otherwise the last line is written but never seen.
export const STEP_FIRST_MS = 1200
export const STEP_EVERY_MS = 1300
// Past this, "still loading" stops being reassuring and needs to say so.
export const SLOW_AFTER_MS = 5000
// Long enough to read as a fade, short enough that nobody waits on it.
export const EXIT_MS = 240

export function ringColor(state) {
  if (state === 'error') return 'var(--text-negative)'
  if (state === 'success') return 'var(--accent-green)'
  return 'var(--accent-blue)'
}

export function defaultMessage(state, lang) {
  const t = (es, en) => (lang === 'es' ? es : en)
  switch (state) {
    // Names what is being loaded, not the product: by the time this is on
    // screen the reader already knows which app they opened.
    case 'initial-loading': return t('Cargando tu portafolio', 'Loading your portfolio')
    case 'section-loading': return t('Cargando datos', 'Loading data')
    case 'refreshing': return t('Actualizando datos', 'Updating data')
    case 'success': return t('Listo', 'Done')
    case 'error': return t('No se pudo cargar', 'Couldn’t load')
    default: return t('Cargando', 'Loading')
  }
}

// The order is the real order of the work: prices come from the network,
// then the portfolio is assembled from them.
export function loadingSteps(lang) {
  const t = (es, en) => (lang === 'es' ? es : en)
  return [
    t('Trayendo precios en vivo…', 'Fetching live prices…'),
    t('Cargando tus activos…', 'Loading your assets…'),
    t('Casi listo…', 'Almost ready…'),
  ]
}

// Which staged line to show at `elapsed`. Returns -1 before the first one.
// CLAMPS at the last step and never wraps: cycling back to "fetching prices"
// after "almost ready" would walk the perceived progress backwards, which is
// worse than holding on the last honest line.
export function stepIndexAt(elapsedMs, count) {
  if (count <= 0 || elapsedMs < STEP_FIRST_MS) return -1
  const i = Math.floor((elapsedMs - STEP_FIRST_MS) / STEP_EVERY_MS)
  return Math.min(i, count - 1)
}

export function slowMessage(lang) {
  return lang === 'es'
    ? 'Está tardando más de lo normal.'
    : 'Taking a bit longer than usual.'
}

// Offline REPLACES the spinner rather than sitting under it: a ring that
// keeps sweeping says "working on it" about work that cannot happen.
export function offlineMessage(lang) {
  return lang === 'es'
    ? { title: 'Sin conexión a internet', hint: 'Revisa tu conexión y volvé a intentar.' }
    : { title: 'No internet connection', hint: 'Check your connection and try again.' }
}

export default function ChispudoLoader({
  mode = 'inline',
  // The splash defaults to `large`: it is the one place with room for it.
  size,
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
  // Set by the caller once the wait is over, to play the exit fade before
  // unmounting. The caller owns this because only it knows when whatever the
  // splash was covering is actually ready to be seen.
  exiting = false,
  // Fires the first time this actually paints. Lets a caller skip the exit
  // fade for a load that resolved inside `delay` and therefore never showed:
  // fading out something that was never on screen is just a delay.
  onVisible,
  className = '',
}) {
  const isFullscreen = mode === 'fullscreen'
  const resolvedSize = size ?? (isFullscreen ? 'large' : 'medium')
  const diameter = typeof resolvedSize === 'number' ? resolvedSize : (SIZES[resolvedSize] || SIZES.medium)
  const isWaiting = state === 'initial-loading' || state === 'section-loading' || state === 'refreshing'
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  const isDeterminate = isWaiting && pct != null
  const isIndeterminate = isWaiting && pct == null

  // Terminal states (success/error) always show immediately — they're not a
  // "might finish before you notice" moment, they're the answer. Waiting
  // states wait out `delay` first. `exiting` forces it on: the caller is
  // asking for a fade-out, which needs something on screen to fade.
  const [shown, setShown] = useState(state === 'success' || state === 'error')
  useEffect(() => {
    if (state === 'success' || state === 'error') { setShown(true); return undefined }
    setShown(false)
    const id = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(id)
  }, [state, delay])
  const visible = shown || exiting

  // Ref, not a dep: `onVisible` is a fresh closure on every parent render, so
  // putting it in the array would re-fire this on renders that changed nothing.
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible
  useEffect(() => { if (visible) onVisibleRef.current?.() }, [visible])

  // Staged copy + the slow warning. Four timers set once, instead of an
  // interval re-rendering the splash a few times a second to compute the same
  // two values. Timed from MOUNT (when the wait really started), not from
  // first paint, so the copy describes the wait rather than the animation.
  const [stepIdx, setStepIdx] = useState(-1)
  const [slow, setSlow] = useState(false)
  const wantsStagedCopy = isFullscreen && isWaiting && !exiting
  useEffect(() => {
    if (!wantsStagedCopy) { setStepIdx(-1); setSlow(false); return undefined }
    const timers = loadingSteps(lang).map((_, i) =>
      setTimeout(() => setStepIdx(i), STEP_FIRST_MS + i * STEP_EVERY_MS))
    timers.push(setTimeout(() => setSlow(true), SLOW_AFTER_MS))
    return () => timers.forEach(clearTimeout)
  }, [wantsStagedCopy, lang])

  // Initial state is false so the server render and the first client render
  // agree; the effect corrects it immediately after mount.
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (!isFullscreen) return undefined
    const sync = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [isFullscreen])

  const label = message || defaultMessage(state, lang)
  const boltSize = Math.round(diameter * (isFullscreen ? BOLT_RATIO.fullscreen : BOLT_RATIO.inline))
  const strokeW = diameter <= 32 ? 2.4 : diameter <= 56 ? 2.2 : 2

  if (!visible) {
    // Fullscreen has nothing to reserve — it's a fixed overlay outside
    // document flow either way, on or off. Inline reserves the SAME
    // diameter×diameter box now, invisible, so the fade-in at `delay`
    // never shifts whatever sits next to it — the alternative (popping in
    // at full size once the timer fires) is its own layout jump, just
    // delayed instead of avoided.
    return isFullscreen
      ? null
      : <span aria-hidden="true" className={className} style={{ display: 'inline-block', width: diameter, height: diameter }} />
  }

  const showOffline = isFullscreen && offline && isWaiting

  const ring = (
    <span className="chispu-loader-mark" style={{ position: 'relative', width: diameter, height: diameter, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {isWaiting && (
        <svg width={diameter} height={diameter} viewBox="0 0 32 32" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} style={{ stroke: 'var(--card-border)', opacity: 0.75 }} />
          {isIndeterminate ? (
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth={strokeW} strokeLinecap="round"
              className="chispu-loader-anim"
              style={{
                stroke: ringColor(state),
                strokeDasharray: `${C * 0.22} ${C * 0.78}`,
                transformOrigin: '16px 16px',
                animation: 'chispuLoaderSweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
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
          style={{
            animation: 'chispuLoaderPulse 1.3s ease-in-out infinite',
            // Only on the splash: at inline sizes a glow this size relative to
            // the mark just muddies its edges.
            filter: isFullscreen
              ? `drop-shadow(0 0 ${Math.round(boltSize * 0.3)}px color-mix(in srgb, var(--accent-blue) 42%, transparent))`
              : undefined,
          }}>
          <path d={BOLT_PATH} fill="var(--accent-blue)" stroke="var(--accent-blue)"
            strokeWidth={boltStrokeWidth(boltSize)} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )

  const showText = isFullscreen || errorMessage || state === 'error' || showLabel
  const stagedLine = stepIdx >= 0 ? loadingSteps(lang)[stepIdx] : null
  const offlineCopy = offlineMessage(lang)
  // Offline and slow both hand back control instead of leaving someone
  // watching a ring forever. A reload is the honest default when the caller
  // gave no retry of its own: whatever this splash was waiting on starts over.
  const retry = onRetry || (isFullscreen ? () => window.location.reload() : null)
  const showRetry = (state === 'error' && onRetry) || (isFullscreen && (showOffline || slow) && retry)

  const body = (
    <div
      className={`chispu-loader ${className}`}
      role="status"
      aria-live="polite"
      aria-busy={(isWaiting && !showOffline) || undefined}
      style={isFullscreen
        ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24, maxWidth: 340, textAlign: 'center' }
        : { display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      {showOffline ? (
        <WifiOff size={Math.round(diameter * 0.5)} strokeWidth={1.75} style={{ color: 'var(--text-muted)' }} />
      ) : ring}

      <span className="sr-only">{showOffline ? offlineCopy.title : label}</span>

      {showText && (
        <span style={{
          color: state === 'error' ? 'var(--text-negative)' : 'var(--text-primary)',
          fontSize: isFullscreen ? 16 : 12,
          fontWeight: isFullscreen ? 600 : 400,
          letterSpacing: isFullscreen ? '-0.01em' : undefined,
          textAlign: 'center',
        }}>
          {showOffline ? offlineCopy.title : state === 'error' ? (errorMessage || label) : label}
        </span>
      )}

      {/* Secondary line. One slot, so the staged copy and the slow warning
          replace each other instead of stacking into a wall of status. */}
      {isFullscreen && (showOffline || slow || stagedLine) && (
        <span
          key={showOffline ? 'offline' : slow ? 'slow' : stepIdx}
          className="chispu-loader-sub"
          style={{ marginTop: -6, fontSize: 13, lineHeight: 1.45, color: 'var(--text-muted)' }}
        >
          {showOffline ? offlineCopy.hint : slow ? slowMessage(lang) : stagedLine}
        </span>
      )}

      {showRetry && (
        <button type="button" onClick={retry}
          className="chispu-loader-retry"
          style={{
            marginTop: isFullscreen ? 2 : 0,
            padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            ...(state === 'error'
              ? { color: '#ffffff', backgroundColor: 'var(--text-negative)', border: 'none' }
              // Slow/offline are not failures yet, so this is a quiet way out,
              // not an alarm competing with the mark for attention.
              : { color: 'var(--text-secondary)', backgroundColor: 'transparent', border: 'var(--glass-border)' }),
          }}
        >
          {state === 'error'
            ? (lang === 'es' ? 'Intentar de nuevo' : 'Try again')
            : (lang === 'es' ? 'Recargar' : 'Reload')}
        </button>
      )}

      <style jsx>{`
        /* A breath, not a throb: the old one shrank to 0.88 and dropped to
           0.55 opacity, which on a bright background read as the mark
           flickering out. Scaling slightly UP keeps it feeling alive without
           ever looking like it is disappearing. */
        @keyframes chispuLoaderPulse {
          0%, 100% { transform: scale(1);    opacity: 0.94; }
          50%      { transform: scale(1.04); opacity: 1; }
        }
        @keyframes chispuLoaderSweep {
          0%   { transform: rotate(-90deg); }
          100% { transform: rotate(270deg); }
        }
        @keyframes chispuLoaderCheckIn {
          0%   { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes chispuLoaderSubIn {
          0%   { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .chispu-loader-sub {
          animation: chispuLoaderSubIn 260ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .chispu-loader-anim,
          .chispu-loader-sub {
            animation: none !important;
            transition: opacity 120ms linear, stroke 120ms linear !important;
          }
        }
      `}</style>
    </div>
  )

  if (!isFullscreen) return body

  return (
    <div
      aria-hidden={false}
      className={exiting ? 'chispu-splash-out' : 'chispu-splash'}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Opaque, and tinted from the centre so a full-bleed surface doesn't
        // read as a dead flat field. backgroundImage over backgroundColor:
        // the shorthand would drop the fallback colour under the gradient.
        backgroundColor: 'var(--bg-primary)',
        // Grain on top, tint under it. See DITHER above for why the grain is
        // not decoration.
        backgroundImage: `${DITHER}, radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--accent-blue) 7%, transparent) 0%, transparent 62%)`,
        backgroundRepeat: 'repeat, no-repeat',
      }}
    >
      {body}
      <style jsx>{`
        @keyframes chispuSplashIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes chispuSplashOut { from { opacity: 1; } to { opacity: 0; } }
        .chispu-splash     { animation: chispuSplashIn 180ms ease-out both; }
        .chispu-splash-out { animation: chispuSplashOut ${EXIT_MS}ms ease-in both; pointer-events: none; }
        @media (prefers-reduced-motion: reduce) {
          .chispu-splash     { animation: none; }
          .chispu-splash-out { animation: chispuSplashOut ${EXIT_MS}ms linear both; }
        }
      `}</style>
    </div>
  )
}
