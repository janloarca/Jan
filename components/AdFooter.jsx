'use client'

import { useEffect } from 'react'
import Script from 'next/script'

// Google AdSense footer — the single ad slot on the dashboard, at the very end of
// the page so it never disturbs the main view. Feature-flagged by env vars: with
// NEXT_PUBLIC_ADSENSE_CLIENT / NEXT_PUBLIC_ADSENSE_SLOT_FOOTER unset this renders
// nothing, so the code ships inert until the AdSense account is approved.
// No dismiss button: AdSense policy discourages encouraging users to hide/interact
// with ads. Auto Ads must stay OFF in the AdSense console (only this manual unit).
const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_FOOTER

export default function AdFooter({ lang = 'es' }) {
  const enabled = !!(CLIENT && SLOT)

  useEffect(() => {
    if (!enabled) return
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch (e) {
      // adsbygoogle not ready yet (script still loading) — the push on script load
      // handles it; a hard failure here must never break the dashboard.
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <footer className="mt-8 pt-4 border-t" style={{ borderColor: 'var(--card-border)' }}>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        {lang === 'es' ? 'Publicidad' : 'Ad'}
      </p>
      <Script
        id="adsbygoogle-js"
        strategy="lazyOnload"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`}
        crossOrigin="anonymous"
      />
      {/* minHeight reserves the space up front so the ad doesn't shift the layout */}
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: 90 }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </footer>
  )
}
