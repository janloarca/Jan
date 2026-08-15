import { ImageResponse } from 'next/og'
import { BOLT_PATH, BOLT_VIEWBOX } from '@/lib/brandBolt'

export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Same bolt geometry as the in-app Logo (components/ui/Logo.jsx) — see
// app/icon.jsx for why solid blue + white bolt replaced the old emoji.
export default function AppleIcon() {
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
          borderRadius: '36px',
        }}
      >
        <svg width="104" height="104" viewBox={BOLT_VIEWBOX}>
          <path d={BOLT_PATH} fill="#ffffff" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
