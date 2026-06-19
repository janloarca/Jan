'use client'

function Pulse({ className }) {
  return <div className={`animate-pulse rounded ${className}`} style={{ backgroundColor: 'var(--bg-card-hover)', opacity: 0.5 }} />
}

export function SkeletonCard() {
  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary" style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <Pulse className="h-4 w-24 mb-4" />
      <Pulse className="h-8 w-40 mb-2" />
      <Pulse className="h-3 w-32" />
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary" style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <Pulse className="h-4 w-32 mb-4" />
      <Pulse className="h-48 w-full rounded-xl" />
    </div>
  )
}
