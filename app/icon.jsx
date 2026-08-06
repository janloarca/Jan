import { ImageResponse } from 'next/og'
import { BOLT_PATH, BOLT_VIEWBOX } from '@/lib/brandBolt'

export const runtime = 'edge'
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// Same bolt geometry as the in-app Logo (components/ui/Logo.jsx) — solid
// blue tile + white bolt reads crisply even shrunk to a 16px browser tab,
// which the old plain "⚡" emoji glyph never reliably did (emoji render in
// their own fixed color regardless of any CSS `color` set on them, so the
// old favicon was never actually on-brand blue to begin with).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2563EB',
          borderRadius: '100px',
        }}
      >
        <svg width="300" height="300" viewBox={BOLT_VIEWBOX}>
          <path d={BOLT_PATH} fill="#ffffff" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
