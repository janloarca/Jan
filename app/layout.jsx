import './globals.css'

export const metadata = {
  title: 'Chispudo — Portfolio Tracker for Latin America',
  description: 'Track stocks, crypto, bonds, real estate, DeFi, SAFE notes and more. Built for LatAm. Free forever.',
  keywords: ['portfolio tracker', 'investment', 'LatAm', 'Guatemala', 'Mexico', 'Colombia', 'stocks', 'crypto', 'bonds', 'DeFi'],
  openGraph: {
    title: 'Chispudo — Track Your Entire Portfolio',
    description: 'Stocks, crypto, bonds, real estate, DeFi yield, SAFE notes — all in one place. Built for Latin America.',
    url: 'https://chispu.xyz',
    siteName: 'Chispudo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chispudo — Portfolio Tracker for Latin America',
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
  themeColor: '#000000',
}

export default function RootLayout({ children }) {
  const themeScript = `
    (function() {
      try {
        var saved = localStorage.getItem('chispudo-theme');
        if (saved === 'light') {
          document.documentElement.setAttribute('data-theme', 'light');
        } else if (saved === 'system') {
          var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      } catch(e) {}
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(r) { r.unregister(); });
        });
        caches.keys().then(function(keys) {
          keys.forEach(function(k) { caches.delete(k); });
        });
      }
    })();
  `

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
