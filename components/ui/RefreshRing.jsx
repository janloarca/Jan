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
//
// Two feedback moments, both cosmetic (neither one drives real state):
//  - IGNITE, on click itself. `active` only flips true once the parent's load
//    stages actually start ticking, which can lag the tap by a beat — long
//    enough that a press felt like it did nothing. `justClicked` fires the
//    instant the button is pressed: a quick blue ripple + bolt kick, gone by
//    the time the real ring (if it shows at all) takes over.
//  - CELEBRATE, on the active → done transition. The old plain green flash
//    confirmed "something happened" but read as a UI blip, not a finish. This
//    is a small spark burst (a handful of little chispas flying off the bolt)
//    plus a brief warm-to-green glow — a fraction of a second, CSS only, gone
//    well before it could get in the way of using the ring again.

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Zap } from 'lucide-react'

const R = 13.5
const C = 2 * Math.PI * R
// Spark burst directions (degrees) and stagger — six chispas, not symmetric
// enough to read as a mechanical pattern.
const SPARKS = [
  { angle: -100, delay: 0 }, { angle: -35, delay: 40 }, { angle: 15, delay: 90 },
  { angle: 75, delay: 30 }, { angle: 145, delay: 70 }, { angle: -160, delay: 110 },
]

export default function RefreshRing({
  stagesDone = 0, stagesTotal = 0, onClick, disabled, label, title, size = 34,
}) {
  const active = stagesTotal > 0 && stagesDone < stagesTotal
  const pct = stagesTotal > 0 ? Math.max(0, Math.min(1, stagesDone / stagesTotal)) : 0

  const [celebrate, setCelebrate] = useState(false)
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active) {
      setCelebrate(true)
      const id = setTimeout(() => setCelebrate(false), 900)
      return () => clearTimeout(id)
    }
    wasActive.current = active
  }, [active])

  const [ignite, setIgnite] = useState(false)
  const igniteTimer = useRef(null)
  const handleClick = (e) => {
    setIgnite(true)
    clearTimeout(igniteTimer.current)
    igniteTimer.current = setTimeout(() => setIgnite(false), 380)
    onClick?.(e)
  }
  useEffect(() => () => clearTimeout(igniteTimer.current), [])

  return (
    <button onClick={handleClick} disabled={disabled} aria-label={label} title={title}
      aria-busy={active || undefined}
      className="relative shrink-0 rounded-full border flex items-center justify-center transition-colors disabled:cursor-default hover:bg-theme-elevated overflow-visible"
      style={{
        width: size, height: size, color: 'var(--accent-blue)',
        borderColor: celebrate ? 'var(--accent-green)' : 'var(--card-border)',
        transition: 'border-color 250ms ease-out',
      }}>
      {ignite && (
        <span aria-hidden="true" className="absolute inset-0 rounded-full"
          style={{ border: '2px solid var(--accent-blue)', animation: 'chispuIgnite 380ms ease-out forwards' }} />
      )}
      {celebrate && (
        <>
          <span aria-hidden="true" className="absolute inset-0 rounded-full"
            style={{ backgroundColor: 'var(--accent-green)', animation: 'chispuFlash 700ms ease-out forwards' }} />
          {SPARKS.map((s, i) => (
            <span key={i} aria-hidden="true" className="absolute rounded-full"
              style={{
                width: 3, height: 3, top: '50%', left: '50%',
                '--a': `${s.angle}deg`,
                backgroundColor: i % 2 === 0 ? 'var(--accent-orange)' : 'var(--accent-green)',
                animation: `chispuSpark 550ms ease-out ${s.delay}ms forwards`,
              }} />
          ))}
        </>
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
        <RefreshCw size={14} className="relative"
          style={{
            color: celebrate ? 'var(--accent-green)' : undefined,
            animation: ignite ? 'chispuKick 380ms ease-out' : undefined,
          }} />
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
      `}</style>
    </button>
  )
}
