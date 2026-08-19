import { Shimmer } from '@/components/dashboard/Skeleton'

// This is the ONLY route in the app using Next.js' file-based loading.jsx
// convention — spreadsheet/finances/costs/friends all gate inline in their
// own page component and already render Skeleton.jsx's Shimmer-based
// SkeletonCard/SkeletonChart/SkeletonTable. This file used to hand-roll its
// own placeholder blocks on hardcoded dark-mode hex (`bg-[#38383A]`, plus a
// couple of `bg-blue-*/opacity` utilities Tailwind never redirects through
// the theme tokens either), so it rendered dark-charcoal blocks on a light
// background in light theme — the one loading moment in the whole app that
// didn't match. It's also the very first thing any user sees on a cold load
// of the main page, so it's worth getting right. Rebuilt on the same Shimmer
// atom every other skeleton in the app already uses: same color token
// (var(--bg-card-hover)), same diagonal-sweep motion instead of a plain
// opacity pulse. The layout below still mirrors the real dashboard grid on
// purpose (net worth card, movers, goals, chart, allocation, performance) so
// nothing jumps when the real content lands — only the atom changed, not the
// shape.
//
// FASE JU: eso último era falso a medias. El átomo se migró, pero el
// ENVOLTORIO no: los seis usaban `rounded-xl` (12px) sin sombra contra los 16px
// + sombra de `.card`, y el contenedor iba en `py-6 space-y-6 gap-6` contra el
// `py-4 sm:py-6 space-y-4 sm:space-y-6 gap-4 sm:gap-6` que la página real usa
// desde FASE JB. O sea en CADA carga en frío de la pantalla principal las cards
// cambiaban de radio, les aparecía la sombra y todo se recorría unos píxeles.
// Ahora usan `.card` y el mismo ritmo.
//
// Lo que NO se hace, a propósito: cambiar estas formas por los `SkeletonCard` /
// `SkeletonChart` / `SkeletonTable` genéricos de Skeleton.jsx. Esos tienen una
// forma FIJA que no corresponde a ninguna card real del tablero, así que
// usarlos haría saltar MÁS cosas, no menos. Las de acá están talladas a mano
// contra la grilla de verdad, que es justo el punto del archivo.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-theme-base">
      {/* Header skeleton */}
      <header className="border-b border-glass-border h-14 bg-theme-base/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {/* Logo mark: intentionally blue-tinted, and bg-blue-500/20 already
                redirects through var(--accent-blue) via color-mix in both
                themes (app/globals.css) — left as-is, not a Shimmer. */}
            <div className="w-6 h-6 rounded bg-blue-500/20 animate-pulse" />
            <Shimmer className="w-20 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <Shimmer className="w-8 h-8 rounded-lg" />
            <Shimmer className="w-8 h-8 rounded-lg" />
            <Shimmer className="w-16 h-8 rounded-lg" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Status bar */}
        <div className="flex items-center gap-3">
          <Shimmer className="w-2 h-2 rounded-full" />
          <Shimmer className="w-24 h-3" />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 flex flex-col gap-4 sm:gap-6 min-w-0">
            {/* Net Worth skeleton */}
            <div className="card p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <Shimmer className="w-20 h-3" />
                {/* Same as the logo mark above: already theme-correct
                    (var(--accent-blue) via color-mix in both themes). */}
                <div className="w-16 h-4 rounded-full bg-blue-500/10 animate-pulse" />
              </div>
              <Shimmer className="w-48 h-8 mb-2" />
              <Shimmer className="w-24 h-3" />
            </div>

            {/* Top Movers skeleton */}
            <div className="card p-4 sm:p-5">
              <Shimmer className="w-28 h-3 mb-4" />
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Shimmer className="w-3 h-3" />
                    <Shimmer className="w-12 h-3" />
                    <Shimmer className="flex-1 h-1.5 rounded-full" />
                    <Shimmer className="w-14 h-3" />
                  </div>
                ))}
              </div>
            </div>

            {/* Goals skeleton */}
            <div className="card p-4 sm:p-5">
              <Shimmer className="w-32 h-3 mb-4" />
              <div className="space-y-3">
                <Shimmer className="w-full h-3 rounded-full" />
                <Shimmer className="w-full h-3 rounded-full" />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-3 flex flex-col gap-4 sm:gap-6 min-w-0">
            {/* Chart skeleton */}
            <div className="card p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Shimmer className="w-28 h-3 mb-2" />
                  <Shimmer className="w-20 h-6" />
                </div>
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Shimmer key={i} className="w-8 h-6" />
                  ))}
                </div>
              </div>
              <Shimmer className="h-[200px]" />
            </div>

            {/* Allocation skeleton */}
            <div className="card p-4 sm:p-5">
              <Shimmer className="w-28 h-3 mb-4" />
              <div className="flex items-center gap-6">
                <Shimmer className="w-[160px] h-[160px] rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="w-2.5 h-2.5 rounded-full" />
                      <Shimmer className="w-16 h-3" />
                      <Shimmer className="ml-auto w-12 h-3" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance skeleton */}
        <div className="card p-4 sm:p-5">
          <Shimmer className="w-24 h-3 mb-4" />
          <div className="grid grid-cols-5 gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-3 bg-theme-base rounded-lg border border-glass-border/50">
                <Shimmer className="w-8 h-2 mx-auto mb-2" />
                <Shimmer className="w-16 h-5 mx-auto" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
