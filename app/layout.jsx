import './globals.css'
import RootErrorBoundary from '@/components/RootErrorBoundary'
import { ADSENSE_CLIENT } from '@/lib/adsense'

export const metadata = {
  title: 'Chispudo: Portfolio Tracker for Latin America',
  description: 'Track stocks, crypto, bonds, real estate, DeFi, SAFE notes and more. Built for LatAm. Free forever.',
  keywords: ['portfolio tracker', 'investment', 'LatAm', 'Guatemala', 'Mexico', 'Colombia', 'stocks', 'crypto', 'bonds', 'DeFi'],
  openGraph: {
    title: 'Chispudo: Track Your Entire Portfolio',
    description: 'Stocks, crypto, bonds, real estate, DeFi yield, SAFE notes: all in one place. Built for Latin America.',
    url: 'https://chispu.xyz',
    siteName: 'Chispudo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chispudo: Portfolio Tracker for Latin America',
    description: 'Track every asset type. Built for LatAm. Free forever.',
  },
  metadataBase: new URL('https://chispu.xyz'),
  // manifest: '/manifest.json',  // disabled — SW causes stale cache issues
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Chispudo',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0A0A12' },
    { media: '(prefers-color-scheme: light)', color: '#F8F9FB' },
  ],
}

export default function RootLayout({ children }) {
  const buildId = process.env.NEXT_BUILD_ID || '__dev__'
  const themeScript = `
    (function() {
      try {
        var saved = localStorage.getItem('chispudo-theme');
        // Default matches the dashboard's default ('dark') — a different default here
        // made /finances and /spreadsheet load light while the dashboard loaded dark.
        var theme = 'dark';
        if (saved === 'light') {
          theme = 'light';
        } else if (saved === 'system') {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
        var tc = theme === 'light' ? '#F8F9FB' : '#0A0A12';
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        metas.forEach(function(m) { m.setAttribute('content', tc); });
      } catch(e) {}
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(r) { r.unregister(); });
        });
        caches.keys().then(function(keys) {
          keys.forEach(function(k) { caches.delete(k); });
        });
      }
      setTimeout(function() {
        var PAGE_BUILD = '${buildId}';
        fetch('/api/version').then(function(r) { return r.json(); }).then(function(d) {
          if (d.buildId && d.buildId !== '__dev__' && PAGE_BUILD !== '__dev__' && d.buildId !== PAGE_BUILD) {
            var key = 'chispudo-reloaded-' + d.buildId;
            if (!sessionStorage.getItem(key)) {
              sessionStorage.setItem(key, '1');
              location.reload();
            }
          }
        }).catch(function() {});
      }, 3000);
    })();
  `

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* AdSense loader + site-verification snippet. Site-wide so Google's crawler
            can verify on public pages (the dashboard is behind auth). With Auto Ads
            off, no ad renders anywhere except our manual unit (AdBanner). */}
        {ADSENSE_CLIENT && (
          <script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`} crossOrigin="anonymous" />
        )}
      </head>
      <body className="font-sans"><RootErrorBoundary>{children}</RootErrorBoundary></body>
    </html>
  )
}
