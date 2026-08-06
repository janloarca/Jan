// The Chispudo bolt: one path, reused everywhere the mark appears (header,
// favicon/PWA icons, loading screens, onboarding, print). A framework-agnostic
// constant on purpose — `components/ui/Logo.jsx` (React, client-side) and
// `app/icon.jsx`/`app/apple-icon.jsx` (edge runtime, Satori/ImageResponse, no
// React hooks) both need the exact same geometry, and the two environments
// can't share a component, only data.
//
// Simpler than the old lucide Zap glyph on purpose (fewer vertices — just the
// two notches a lightning bolt needs to read as one), in a 24x24 viewBox.
// Rounding comes from pairing this fill with a matching round-joined stroke
// (see ROUNDED_STROKE below) rather than redrawing every vertex with arcs —
// same silhouette, softened corners, no extra path complexity.
export const BOLT_PATH = 'M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z'
export const BOLT_VIEWBOX = '0 0 24 24'

// Stroke width is in the 24x24 viewBox's own units, so it scales down WITH
// the icon as size shrinks — a value that reads as "gently rounded" at 40px
// turns sub-pixel and vanishes at 14px. Two tiers keeps the rounding visible
// at favicon/button sizes without over-softening it at larger ones.
export function boltStrokeWidth(size) {
  return size <= 24 ? 1.6 : 1.1
}
