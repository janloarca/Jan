'use client'

// Chispudo's own refresh control: a circular progress ring instead of a
// generic browser-style spinner button. The ring is a real, own-brand
// instrument, not a decoration — see below for exactly what drives it.
//
// The fraction is REAL: `progress` should be null until there's a reliable
// percentage to show (e.g. Header passes stagesDone/stagesTotal from three
// independent load stages — your data, exchange rates, market prices — never
// a timer pretending to be progress). A made-up bar that crawls to 90% and
// waits is the same class of lie as a made-up number in a chart, and this
// app has spent enough time undoing those. With `progress == null` and
// `loading` true, the ring shows a genuinely INDETERMINATE sweep instead of
// inventing a percentage — it only switches to a determinate fill once the
// caller hands it a real number.
//
// Four states, each with its own color band and center glyph:
//   idle    — brand blue outline, refresh icon.
//   loading — progress color band below, percentage text in the center once
//             determinate (a pulsing bolt while still indeterminate).
//   success — ring pinned at 100% intense green, a checkmark, ~1s, then back
//             to idle. Never a silent snap — always announced.
//   error   — intense red, ring stops animating, a retry-affordance icon;
//             clicking tries again (never a dead end).
//
// Two extra feedback moments, both purely cosmetic (neither drives state):
//  - IGNITE, on click itself. `loading` flipping true can lag the tap by a
//    beat (the parent's own load-stage bookkeeping needs a render to catch
//    up) — long enough that a press felt like it did nothing without this. A
//    quick blue ripple + bolt kick, gone before the real ring (if it shows
//    at all) takes over. It also DOUBLES as the "ignore clicks for a beat"
//    guard: see clickLockRef below.
//  - CELEBRATE, the loading → success transition. A small spark burst (a
//    handful of little chispas flying off the bolt) plus a warm-to-green
//    glow under the checkmark — a fraction of a second, CSS only.

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Zap, Check, CircleAlert } from 'lucide-react'

const R = 13.5
const C = 2 * Math.PI * R
// Mínimo táctil de iOS. El control puede verse más chico (en el header mide 36
// para compartir la banda con el resto de la fila) sin bajar de esto al tocar.
const TOUCH_TARGET = 44
// Spark burst directions (degrees) and stagger — six chispas, not symmetric
// enough to read as a mechanical pattern.
const SPARKS = [
  { angle: -100, delay: 0 }, { angle: -35, delay: 40 }, { angle: 15, delay: 90 },
  { angle: 75, delay: 30 }, { angle: 145, delay: 70 }, { angle: -160, delay: 110 },
]

// Percentage → color band, per the spec: soft coral barely started, amber
// making progress, a lighter green nearly there, intense green only at a
// true 100. Same hue at different intensity for the 0-24%/error pair (soft
// vs full opacity) and the 75-99%/100% pair — INTENSITY is the distinguishing
// signal the spec itself asks for, so it's the actual mechanism here, not
// just a description of it, and it stays theme-correct for free (opacity
// over an already-per-theme token, never a hand-picked hex that only
// happens to work in one theme).
export function progressColor(pct, hasError) {
  if (hasError) return { color: 'var(--text-negative)', opacity: 1 }
  if (pct == null) return { color: 'var(--accent-blue)', opacity: 1 }
  if (pct >= 100) return { color: 'var(--accent-green)', opacity: 1 }
  if (pct >= 75) return { color: 'var(--accent-green)', opacity: 0.72 }
  if (pct >= 25) return { color: 'var(--accent-orange)', opacity: 1 }
  return { color: 'var(--text-negative)', opacity: 0.62 }
}

export function statusText(uiState, pct, lang) {
  const t = (es, en) => (lang === 'es' ? es : en)
  switch (uiState) {
    case 'error': return t('Error al actualizar', 'Update failed')
    case 'success': return t('Actualización completada', 'Update completed')
    case 'loading':
      return pct != null
        ? t(`Actualizando datos, ${pct}%`, `Updating data, ${pct}%`)
        : t('Actualizando datos', 'Updating data')
    default: return t('Actualizar datos', 'Refresh data')
  }
}

export default function ChispudoRefreshButton({
  onClick,
  loading = false,
  // 0-100, or null/undefined while there is no reliable percentage yet.
  progress = null,
  error = false,
  disabled = false,
  size = 44,
  lang = 'es',
  className = '',
}) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  const isDeterminate = loading && pct != null && !error
  const isIndeterminate = loading && pct == null && !error

  // Success holds for ~1s after `loading` goes false with no error — long
  // enough to read as a real completion, short enough to never block a next
  // click for real.
  const [success, setSuccess] = useState(false)
  const wasLoading = useRef(false)
  useEffect(() => {
    if (wasLoading.current && !loading && !error) {
      setSuccess(true)
      const id = setTimeout(() => setSuccess(false), 1000)
      return () => clearTimeout(id)
    }
    wasLoading.current = loading
  }, [loading, error])
  // An error arriving mid-celebration (rare, but the parent's flags are its
  // own source of truth) cancels the celebration rather than fighting it.
  useEffect(() => { if (error) setSuccess(false) }, [error])

  const uiState = error ? 'error' : success ? 'success' : loading ? 'loading' : 'idle'
  const label = statusText(uiState, pct, lang)

  // Ignite ripple on click. Also the "don't let a double-tap fire twice"
  // guard: `loading` itself can't be trusted to flip true on the SAME tick
  // as the click (it comes back down through the parent's own state), so a
  // fast double-tap could slip a second call through before that arrives.
  // The lock only needs to outlive that one render round-trip.
  const [ignite, setIgnite] = useState(false)
  const igniteTimer = useRef(null)
  const clickLockRef = useRef(false)
  const handleClick = (e) => {
    if (disabled || loading || clickLockRef.current) return
    clickLockRef.current = true
    setTimeout(() => { clickLockRef.current = false }, 500)
    setIgnite(true)
    clearTimeout(igniteTimer.current)
    igniteTimer.current = setTimeout(() => setIgnite(false), 380)
    onClick?.(e)
  }
  useEffect(() => () => clearTimeout(igniteTimer.current), [])

  const isDisabled = disabled || loading
  const visual = progressColor(pct, error)
  const ringOpacity = uiState === 'success' ? 1 : visual.opacity
  const ringColor = uiState === 'success' ? 'var(--accent-green)' : visual.color
  const ringPct = uiState === 'success' ? 100 : pct

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={label}
      aria-busy={loading || undefined}
      title={label}
      className={`chispu-refresh-btn relative shrink-0 rounded-full border flex items-center justify-center transition-colors disabled:cursor-default hover:bg-theme-elevated overflow-visible ${className}`}
      style={{
        // La caja mide EXACTAMENTE `size`. Antes tenía un piso fijo de 44px
        // por área táctil, lo que rompía dos cosas a la vez: con un size menor
        // la caja seguía en 44 y no compartía la altura de los controles
        // vecinos (todos h-9 = 36px en el header, así que el anillo sobresalía
        // arriba y abajo de la fila), y el SVG, dibujado a `size` y anclado con
        // inset-0, quedaba pegado arriba-izquierda dentro de esa caja de 44:
        // el anillo descentrado. El área táctil de 44px se conserva abajo, con
        // un span invisible que se extiende fuera de la caja sin ocupar layout.
        width: size, height: size, minWidth: size, minHeight: size,
        color: 'var(--accent-blue)',
        borderColor: uiState === 'error' ? 'var(--text-negative)' : uiState === 'success' ? 'var(--accent-green)' : 'var(--card-border)',
        transition: 'border-color 250ms ease-out',
      }}
    >
      {/* Screen-reader announcement channel — aria-label alone isn't
          reliably announced on a control the user isn't actively focused on
          (e.g. it finishes after they've tabbed away), aria-live is. */}
      <span aria-live="polite" className="sr-only">{label}</span>

      {/* Área táctil de 44px (mínimo de iOS) sin agrandar la caja visible: un
          hijo del propio botón, así que un toque en él dispara el botón igual.
          Se dimensiona en 44 exactos y se centra, en vez de expandirse con
          `inset`: los offsets de un absoluto se miden contra la caja de PADDING
          (sin el borde de 1px), así que un inset de -4 daba 42, no 44. */}
      {size < TOUCH_TARGET && (
        <span aria-hidden="true" className="absolute left-1/2 top-1/2"
          style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, transform: 'translate(-50%, -50%)' }} />
      )}

      {ignite && (
        <span aria-hidden="true" className="absolute inset-0 rounded-full chispu-anim"
          style={{ border: '2px solid var(--accent-blue)', animation: 'chispuIgnite 380ms ease-out forwards' }} />
      )}
      {uiState === 'success' && (
        <>
          <span aria-hidden="true" className="absolute inset-0 rounded-full chispu-anim"
            style={{ backgroundColor: 'var(--accent-green)', animation: 'chispuFlash 700ms ease-out forwards' }} />
          {SPARKS.map((s, i) => (
            <span key={i} aria-hidden="true" className="absolute rounded-full chispu-anim"
              style={{
                width: 3, height: 3, top: '50%', left: '50%',
                '--a': `${s.angle}deg`,
                backgroundColor: i % 2 === 0 ? 'var(--accent-orange)' : 'var(--accent-green)',
                animation: `chispuSpark 550ms ease-out ${s.delay}ms forwards`,
              }} />
          ))}
        </>
      )}

      {/* w-full/h-full en vez de width={size}: con inset-0 y un width fijo, el
          navegador ignora el offset derecho y el SVG queda anclado a la
          izquierda si la caja llega a medir distinto de `size`. Estirándolo a
          la caja, el anillo queda centrado pase lo que pase. */}
      {(loading || uiState === 'success') && (
        <svg viewBox="0 0 32 32" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2"
            style={{ stroke: 'var(--card-border)', opacity: 0.7 }} />
          {isIndeterminate ? (
            // No reliable percentage yet: a short arc that sweeps around the
            // ring instead of a fake number climbing toward one.
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2" strokeLinecap="round"
              className="chispu-anim"
              style={{
                stroke: ringColor,
                strokeDasharray: `${C * 0.22} ${C * 0.78}`,
                transformOrigin: '16px 16px',
                animation: 'chispuSweep 1.1s linear infinite',
              }} />
          ) : (
            // Starts at 12 o'clock and fills clockwise. A floor of 8% keeps
            // the very first stage visible instead of an empty ring.
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2" strokeLinecap="round"
              transform="rotate(-90 16 16)"
              className="chispu-anim"
              style={{
                stroke: ringColor,
                opacity: ringOpacity,
                strokeDasharray: C,
                strokeDashoffset: C * (1 - Math.max(0.08, (ringPct ?? 0) / 100)),
                transition: 'stroke-dashoffset 320ms cubic-bezier(0.4, 0, 0.2, 1), stroke 250ms ease-out',
              }} />
          )}
        </svg>
      )}

      <span className="relative flex items-center justify-center w-full h-full">
        {uiState === 'error' ? (
          <CircleAlert size={16} style={{ color: 'var(--text-negative)' }} />
        ) : uiState === 'success' ? (
          <Check size={16} strokeWidth={2.5} className="chispu-anim"
            style={{ color: 'var(--accent-green)', animation: 'chispuCheckIn 320ms cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
        ) : isDeterminate ? (
          <span className="tabular-nums font-bold" style={{ fontSize: size <= 36 ? 10 : 11, color: 'var(--accent-blue)', lineHeight: 1 }}>
            {pct}%
          </span>
        ) : loading ? (
          <Zap size={12} strokeWidth={2.25} className="chispu-anim"
            style={{ fill: 'currentColor', animation: 'chispuPulse 1.4s ease-in-out infinite' }} />
        ) : (
          <RefreshCw size={14} className="chispu-anim"
            style={{ animation: ignite ? 'chispuKick 380ms ease-out' : undefined }} />
        )}
      </span>

      <style jsx>{`
        @keyframes chispuPulse {
          0%, 100% { opacity: 1;    transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.88); }
        }
        @keyframes chispuFlash {
          0%   { opacity: 0.55; transform: scale(0.4); }
          60%  { opacity: 0.22; transform: scale(1); }
          100% { opacity: 0;    transform: scale(1); }
        }
        @keyframes chispuIgnite {
          0%   { opacity: 0.9; transform: scale(0.7); }
          100% { opacity: 0;   transform: scale(1.35); }
        }
        @keyframes chispuKick {
          0%   { transform: rotate(0deg)   scale(1); }
          35%  { transform: rotate(-18deg) scale(1.15); }
          100% { transform: rotate(0deg)   scale(1); }
        }
        @keyframes chispuSpark {
          0%   { opacity: 1;   transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translateY(0)   scale(1); }
          100% { opacity: 0;   transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translateY(-16px) scale(0.4); }
        }
        @keyframes chispuSweep {
          0%   { transform: rotate(-90deg); }
          100% { transform: rotate(270deg); }
        }
        @keyframes chispuCheckIn {
          0%   { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        /* Every animation and non-essential transition in this button goes
           through .chispu-anim (or is a keyframe listed above) so this one
           rule can turn all of it off. styled-jsx scopes plain class
           selectors to just this component's own elements automatically, so
           this can't leak onto unrelated chispu-anim usage elsewhere. The
           inline animation/transition values above are important-beaten
           here, not fought around. */
        @media (prefers-reduced-motion: reduce) {
          .chispu-anim {
            animation: none !important;
            transition: opacity 120ms linear, stroke 120ms linear !important;
          }
          button {
            transition: none !important;
          }
        }
      `}</style>
    </button>
  )
}
