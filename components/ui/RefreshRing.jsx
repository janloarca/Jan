'use client'

// The refresh control, as a Chispu-branded progress ring instead of a spinning
// arrow. The bolt is the logo mark; the ring around it fills as the load
// finishes.
//
// The fraction is REAL: it counts how many of the dashboard's independent load
// stages have finished (your data, exchange rates, market prices). It is never a
// timer pretending to be progress — a made-up bar that crawls to 90% and waits
// is the same class of lie as a made-up number in a chart, and this app has
// spent enough time undoing those. With nothing loading the ring is idle and the
// control is just the refresh icon.

import { RefreshCw, Zap } from 'lucide-react'

const R = 13
const C = 2 * Math.PI * R

export default function RefreshRing({
  stagesDone = 0, stagesTotal = 0, onClick, disabled, label, title, size = 34,
}) {
  const active = stagesTotal > 0 && stagesDone < stagesTotal
  const pct = stagesTotal > 0 ? Math.max(0, Math.min(1, stagesDone / stagesTotal)) : 0

  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={title}
      aria-busy={active || undefined}
      className="relative shrink-0 rounded-full border flex items-center justify-center transition-colors disabled:cursor-default hover:bg-theme-elevated"
      style={{ width: size, height: size, borderColor: 'var(--card-border)', color: 'var(--accent-blue)' }}>
      {active ? (
        <>
          <svg width={size} height={size} viewBox="0 0 32 32" className="absolute inset-0" aria-hidden="true">
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2.5"
              style={{ stroke: 'var(--card-border)' }} />
            {/* Starts at 12 o'clock and fills clockwise. A floor of 8% keeps the
                very first stage visible instead of showing an empty ring. */}
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
              transform="rotate(-90 16 16)"
              style={{
                stroke: 'var(--accent-blue)',
                strokeDasharray: C,
                strokeDashoffset: C * (1 - Math.max(0.08, pct)),
                transition: 'stroke-dashoffset 400ms ease-out',
              }} />
          </svg>
          <Zap size={13} className="relative animate-pulse" style={{ fill: 'currentColor' }} />
        </>
      ) : (
        <RefreshCw size={14} />
      )}
    </button>
  )
}
