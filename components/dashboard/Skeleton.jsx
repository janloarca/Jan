'use client'

function Pulse({ className }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="bg-[#1C1C1E] rounded-2xl border border-[#38383A] p-5 card-primary">
      <Pulse className="h-4 w-24 mb-4" />
      <Pulse className="h-8 w-40 mb-2" />
      <Pulse className="h-3 w-32" />
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="bg-[#1C1C1E] rounded-2xl border border-[#38383A] p-5 card-primary">
      <Pulse className="h-4 w-32 mb-4" />
      <Pulse className="h-48 w-full rounded-xl" />
    </div>
  )
}

