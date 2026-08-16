'use client'

// The "this button is working" state, for buttons. Goes INSIDE an existing
// <button>, wrapping its label — deliberately not a <Button> component,
// because this repo has no shared button (verified: 22 busy buttons across 17
// files, each with its own className), so a label wrapper is the only change
// that fits all of them without a styling refactor.
//
// It replaces two things that were both wrong in their own way:
//
//  1. `{saving ? '...' : 'Guardar configuración'}` (22 sites). No motion at
//     all, and the button SHRINKS to three dots and snaps back when the save
//     finishes. Here the label keeps its box at `opacity: 0` and the ring is
//     centered on top of it, so the width never changes.
//
//  2. `border-2 border-white border-t-transparent` (the sync modals). That
//     only works on a button whose text is white; on any other button the
//     spinner is invisible. Here the ring is `currentColor`, which is what
//     makes ONE primitive correct on a filled button (white text) and on a
//     ghost button (accent or muted text) without a single branch.
//
// Sized in `em`, not px, so it scales with whatever font-size the button
// already has: the small "Sync" chip and a full-width primary button both just
// work.
//
// The ring geometry comes from `lib/brandRing.js`, shared with
// ChispudoRefreshButton and ChispudoLoader, so all three are visibly the same
// mechanism rather than three lookalikes.

import { RING_VIEWBOX, RING_CX, RING_CY, RING_R, sweepDash } from '@/lib/brandRing'

// Only used when a caller does not pass its own accessible text.
function busyText(lang) {
  return lang === 'en' ? 'Working…' : 'Procesando…'
}

export function BusyRing({ size = '1em', strokeWidth = 3, className = '', style }) {
  return (
    <svg
      viewBox={RING_VIEWBOX}
      width={size}
      height={size}
      aria-hidden="true"
      className={`busy-ring ${className}`}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth={strokeWidth}
        stroke="currentColor" opacity={0.25} />
      <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth={strokeWidth}
        stroke="currentColor" strokeLinecap="round"
        className="busy-ring-arc"
        style={{
          strokeDasharray: sweepDash(),
          transformOrigin: '16px 16px',
          // `chispuSweep` is defined ONCE, globally, in globals.css. It has to
          // be global rather than a <style jsx> block: the animation is set
          // from an inline style here, and an inline style cannot see a
          // component-scoped keyframe name.
          animation: 'chispuSweep 1.1s linear infinite',
        }} />
    </svg>
  )
}

export default function BusyLabel({
  busy = false,
  children,
  // Text to show NEXT TO the ring while busy, for the few buttons where the
  // changed wording is itself informative ("Connecting to IBKR..."). Without
  // it the original label stays put, invisible, holding the width.
  busyLabel,
  lang = 'es',
  // Announced to screen readers while busy. Defaults to `busyLabel` when the
  // caller gave one, since that is already the sentence a human would read.
  srText,
  size = '1em',
  className = '',
}) {
  if (!busy) return <>{children}</>

  const announced = srText || busyLabel || busyText(lang)

  // With a busyLabel the button is ALLOWED to resize: that variant exists
  // precisely to say something the original label doesn't, so holding the old
  // width would clip it.
  if (busyLabel) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`} aria-busy="true">
        <BusyRing size={size} />
        <span>{busyLabel}</span>
      </span>
    )
  }

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      aria-busy="true"
    >
      {/* aria-hidden as well as invisible: the label is only here to hold the
          button's width, and reading out "Save" while it is saving would
          describe the wrong state. */}
      <span aria-hidden="true" style={{ opacity: 0 }}>{children}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        <BusyRing size={size} />
      </span>
      <span className="sr-only">{announced}</span>
    </span>
  )
}
