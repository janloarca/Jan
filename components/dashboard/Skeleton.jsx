'use client'

function Pulse({ className }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <Pulse className="h-4 w-24 mb-4" />
      <Pulse className="h-8 w-40 mb-2" />
      <Pulse className="h-3 w-32" />
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <Pulse className="h-4 w-32 mb-4" />
      <Pulse className="h-48 w-full rounded-xl" />
    </div>
  )
}

export function SkeletonTable() {
  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <Pulse className="h-4 w-40 mb-4" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-[#334155]/30 last:border-0">
          <Pulse className="h-8 w-8 rounded-full" />
          <Pulse className="h-4 w-24" />
          <div className="flex-1" />
          <Pulse className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}
