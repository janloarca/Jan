'use client'

// Exported (was private to this file) so app/dashboard/loading.jsx and
// page.jsx's ModalSkeleton() can build their own shapes out of the same atom
// instead of hand-rolling hardcoded-hex placeholders that don't move or
// color the same way as every other loading moment in the app.
export function Shimmer({ className }) {
  return <div className={`rounded shimmer ${className}`} style={{ backgroundColor: 'var(--bg-card-hover)', opacity: 0.5 }} />
}

export function SkeletonCard() {
  return (
    <div className="card-glass rounded-2xl p-5">
      <Shimmer className="h-4 w-24 mb-4" />
      <Shimmer className="h-8 w-40 mb-2" />
      <Shimmer className="h-3 w-32" />
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="card-glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <Shimmer className="h-4 w-32" />
        <div className="flex gap-2">
          <Shimmer className="h-6 w-12 rounded-full" />
          <Shimmer className="h-6 w-12 rounded-full" />
          <Shimmer className="h-6 w-12 rounded-full" />
        </div>
      </div>
      <Shimmer className="h-48 w-full rounded-xl" />
    </div>
  )
}

export function SkeletonTable() {
  return (
    <div className="card-glass rounded-2xl p-5">
      <Shimmer className="h-4 w-40 mb-4" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 mb-3">
          <Shimmer className="h-8 w-8 rounded-full" />
          <Shimmer className="h-4 flex-1" />
          <Shimmer className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
