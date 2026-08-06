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

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Zap } from 'lucide-react'

const R = 13.5
const C = 2 * Math.PI * R

export default function RefreshRing({
  stagesDone = 0, stagesTotal = 0, onClick, disabled, label, title, size = 34,
}) {
  const active = stagesTotal > 0 && stagesDone < stagesTotal
  const pct = stagesTotal > 0 ? Math.max(0, Math.min(1, stagesDone / stagesTotal)) : 0

  // A short flash on the transition active → done, in the button's own space:
  // the confirmation that the refresh landed. Without it the ring just vanishes
  // and nothing tells you anything actually happened.
  const [flash, setFlash] = useState(false)
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active) {
      setFlash(true)
      const id = setTimeout(() => setFlash(false), 700)
      return () => clearTimeout(id)
    }
    wasActive.current = active
  }, [active])

  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={title}
      aria-busy={active || undefined}
      className="relative shrink-0 rounded-full border flex items-center justify-center transition-colors disabled:cursor-default hover:bg-theme-elevated overflow-hidden"
      style={{
        width: size, height: size, color: 'var(--accent-blue)',
        borderColor: flash ? 'var(--accent-green)' : 'var(--card-border)',
        transition: 'border-color 250ms ease-out',
      }}>
      {flash && (
        <span aria-hidden="true" className="absolute inset-0 rounded-full"
          style={{ backgroundColor: 'var(--accent-green)', animation: 'chispuFlash 700ms ease-out forwards' }} />
      )}
      {active ? (
        <>
          <svg width={size} height={size} viewBox="0 0 32 32" className="absolute inset-0" aria-hidden="true">
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2"
              style={{ stroke: 'var(--card-border)', opacity: 0.7 }} />
            {/* Starts at 12 o'clock and fills clockwise. A floor of 8% keeps the
                very first stage visible instead of showing an empty ring. */}
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2" strokeLinecap="round"
              transform="rotate(-90 16 16)"
              style={{
                stroke: 'var(--accent-blue)',
                strokeDasharray: C,
                strokeDashoffset: C * (1 - Math.max(0.1, pct)),
                transition: 'stroke-dashoffset 450ms cubic-bezier(0.4, 0, 0.2, 1)',
              }} />
          </svg>
          <Zap size={12} className="relative" strokeWidth={2.25}
            style={{ fill: 'currentColor', animation: 'chispuPulse 1.4s ease-in-out infinite' }} />
        </>
      ) : (
        <RefreshCw size={14} className="relative" style={flash ? { color: 'var(--accent-green)' } : undefined} />
      )}
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
      `}</style>
    </button>
  )
}
