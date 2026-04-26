export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Header skeleton */}
      <header className="border-b border-[#334155] h-14 bg-[#0f172a]/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-500/20 animate-pulse" />
            <div className="w-20 h-4 rounded bg-[#334155] animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#334155] animate-pulse" />
            <div className="w-8 h-8 rounded-lg bg-[#334155] animate-pulse" />
            <div className="w-16 h-8 rounded-lg bg-blue-600/30 animate-pulse" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Status bar */}
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-blue-400/30 animate-pulse" />
          <div className="w-24 h-3 rounded bg-[#334155] animate-pulse" />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Net Worth skeleton */}
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-20 h-3 rounded bg-[#334155] animate-pulse" />
                <div className="w-16 h-4 rounded-full bg-blue-500/10 animate-pulse" />
              </div>
              <div className="w-48 h-8 rounded bg-[#334155] animate-pulse mb-2" />
              <div className="w-24 h-3 rounded bg-[#334155] animate-pulse" />
            </div>

            {/* Top Movers skeleton */}
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
              <div className="w-28 h-3 rounded bg-[#334155] animate-pulse mb-4" />
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded bg-[#334155] animate-pulse" />
                    <div className="w-12 h-3 rounded bg-[#334155] animate-pulse" />
                    <div className="flex-1 h-1.5 rounded-full bg-[#334155] animate-pulse" />
                    <div className="w-14 h-3 rounded bg-[#334155] animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            {/* Goals skeleton */}
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
              <div className="w-32 h-3 rounded bg-[#334155] animate-pulse mb-4" />
              <div className="space-y-3">
                <div className="w-full h-3 rounded-full bg-[#334155] animate-pulse" />
                <div className="w-full h-3 rounded-full bg-[#334155] animate-pulse" />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-3 space-y-4">
            {/* Chart skeleton */}
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="w-28 h-3 rounded bg-[#334155] animate-pulse mb-2" />
                  <div className="w-20 h-6 rounded bg-[#334155] animate-pulse" />
                </div>
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-8 h-6 rounded bg-[#334155] animate-pulse" />
                  ))}
                </div>
              </div>
              <div className="h-[200px] rounded bg-[#0f172a] animate-pulse" />
            </div>

            {/* Allocation skeleton */}
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
              <div className="w-28 h-3 rounded bg-[#334155] animate-pulse mb-4" />
              <div className="flex items-center gap-6">
                <div className="w-[160px] h-[160px] rounded-full bg-[#334155] animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#334155] animate-pulse" />
                      <div className="w-16 h-3 rounded bg-[#334155] animate-pulse" />
                      <div className="ml-auto w-12 h-3 rounded bg-[#334155] animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance skeleton */}
        <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
          <div className="w-24 h-3 rounded bg-[#334155] animate-pulse mb-4" />
          <div className="grid grid-cols-5 gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-3 bg-[#0f172a] rounded-lg border border-[#334155]/50">
                <div className="w-8 h-2 rounded bg-[#334155] animate-pulse mx-auto mb-2" />
                <div className="w-16 h-5 rounded bg-[#334155] animate-pulse mx-auto" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
