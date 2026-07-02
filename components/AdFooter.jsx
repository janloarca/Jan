'use client'

import { useEffect } from 'react'
import { ADSENSE_CLIENT } from '@/lib/adsense'

// Google AdSense footer — the single ad slot on the dashboard, at the very end of
// the page so it never disturbs the main view. The adsbygoogle.js loader is
// injected globally by app/layout.jsx (needed there for site verification); this
// component only renders the manual unit. It stays hidden until the ad unit
// exists: set NEXT_PUBLIC_ADSENSE_SLOT_FOOTER after AdSense approves the site.
// No dismiss button (AdSense policy) and Auto Ads must stay OFF in the console.
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_FOOTER

export default function AdFooter({ lang = 'es' }) {
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
    <footer className="mt-8 pt-4 border-t" style={{ borderColor: 'var(--card-border)' }}>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        {lang === 'es' ? 'Publicidad' : 'Ad'}
      </p>
      {/* minHeight reserves the space up front so the ad doesn't shift the layout */}
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: 90 }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </footer>
  )
}
