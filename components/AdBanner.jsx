'use client'

import { useEffect } from 'react'
import { ADSENSE_CLIENT, ADSENSE_SLOT_FOOTER } from '@/lib/adsense'

// Google AdSense banner — the single ad slot on the dashboard. Placed right below
// the hero (NetWorth + growth chart), the first natural seam: visible without
// scrolling but never interrupting the content the user came for. Styled as one
// more card so it follows the page rhythm instead of looking bolted on.
// The adsbygoogle.js loader is injected globally by app/layout.jsx (needed there
// for site verification); this component only renders the manual unit. It stays
// hidden until the ad unit exists: set NEXT_PUBLIC_ADSENSE_SLOT_FOOTER after
// AdSense approves the site. No dismiss button (AdSense policy) and Auto Ads must
// stay OFF in the console.
const SLOT = ADSENSE_SLOT_FOOTER

export default function AdBanner({ lang = 'es' }) {
  const enabled = !!(ADSENSE_CLIENT && SLOT)

  useEffect(() => {
    if (!enabled) return
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch (e) {
      // Loader not ready yet — must never break the dashboard.
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div className="card-glass rounded-2xl px-4 pt-2 pb-3">
      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {lang === 'es' ? 'Publicidad' : 'Ad'}
      </p>
      {/* Slim horizontal unit; minHeight reserves the space up front so the ad
          doesn't shift the layout below when it loads */}
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: 90, maxHeight: 120, overflow: 'hidden' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </div>
  )
}
