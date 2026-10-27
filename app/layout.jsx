import './globals.css'
import RootErrorBoundary from '@/components/RootErrorBoundary'
import UpdateAvailablePill from '@/components/ui/UpdateAvailablePill'
import { ADSENSE_CLIENT } from '@/lib/adsense'

export const metadata = {
  title: 'Chispudo: Portfolio Tracker for Latin America',
  description: 'Track stocks, crypto, bonds, real estate, DeFi, SAFE notes and more. Built for Latin America.',
  keywords: ['portfolio tracker', 'investment', 'LatAm', 'Guatemala', 'Mexico', 'Colombia', 'stocks', 'crypto', 'bonds', 'DeFi'],
  openGraph: {
    title: 'Chispu: Your real net worth, in one place',
    description: 'Track stocks, crypto, real estate, debt, private companies and startup rounds in any currency.',
    url: 'https://chispu.xyz',
    siteName: 'Chispu',
    type: 'website',
    images: [
      {
        url: 'https://chispu.xyz/og.png',
        width: 1200,
        height: 630,
        alt: 'Chispu: your real net worth, not just stocks',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chispu: Your real net worth, in one place',
    description: 'Track stocks, crypto, real estate, debt, private companies and startup rounds in any currency.',
    images: ['https://chispu.xyz/og.png'],
  },
  metadataBase: new URL('https://chispu.xyz'),
  // El manifest SE ACTIVA otra vez: lo que causaba el cache viejo era el
  // service worker, y ese se desregistra en cada carga (script de abajo), asi
  // que el manifest solo aporta nombre, icono, color y display standalone.
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Chispudo',
  },
  // Chrome deprecó apple-mobile-web-app-capable; Next sigue emitiendo ese, asi
  // que se agrega el nombre estandar junto a el (iOS conserva el suyo).
  other: { 'mobile-web-app-capable': 'yes' },
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
      // El build que ESTÁ CORRIENDO, alcanzable desde cualquier pantalla.
      // Sin esto, "hice el cambio y sigue igual" no se puede distinguir de
      // "el teléfono sigue pegado al bundle viejo", que en este repo ya costó
      // un día entero y cuatro deploys (FASES HK/HM).
      try { window.__CHISPU_BUILD = '${buildId}'; } catch(e) {}
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
        // Fondo del documento ANTES de que pinte nada: sin esto, al abrir la
        // app desde el icono hay un destello blanco mientras carga el CSS, y el
        // rebote elastico de iOS enseña el fondo del navegador.
        document.documentElement.style.backgroundColor = tc;
        // Barra de estado de la app instalada. 'black-translucent' dibuja el
        // reloj en BLANCO siempre, ilegible sobre el header claro: en tema
        // claro se usa 'default' (texto oscuro, el contenido arranca debajo).
        var sb = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
        if (!sb) {
          sb = document.createElement('meta');
          sb.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
          document.head.appendChild(sb);
        }
        sb.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
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
              // FASE HK. location.reload() a secas puede servir el MISMO HTML
              // cacheado en iOS Safari: la pagina "recargada" sigue siendo el
              // build viejo, el guard de sessionStorage (anti-loop, correcto)
              // impide reintentar, y la pestana queda pegada al bundle viejo
              // por dias, a traves de multiples deploys. Navegar con un query
              // param nuevo cambia la clave de cache del HTML y fuerza al
              // navegador a pedir el documento fresco de verdad.
              try {
                var u = new URL(location.href);
                u.searchParams.set('_cb', d.buildId.slice(0, 12));
                location.replace(u.toString());
              } catch (e) { location.reload(); }
            }
          } else if (d.buildId && d.buildId === PAGE_BUILD) {
            // Build al dia: limpiar el param de cache-bust si quedo en la URL,
            // para que no se comparta ni se guarde en marcadores.
            try {
              if (location.search.indexOf('_cb=') !== -1) {
                var clean = new URL(location.href);
                clean.searchParams.delete('_cb');
                history.replaceState(null, '', clean.toString());
              }
            } catch (e) {}
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
        {/* JetBrains Mono NECESITA el 700: la app usa `font-mono font-bold` en
            23 sitios, incluido el número grande de patrimonio, y sin ese peso
            cargado el navegador lo SINTETIZA (engorda los trazos por su
            cuenta), que es lo que hace ver el número emborronado.
            El 800 de Inter se quita en el mismo cambio para que el costo sea
            neutro: `font-extrabold` tiene CERO usos, `text-display` (que lo
            especifica) tiene CERO usos, y su único consumidor era Logo.jsx,
            que pasa a 900, ya cargado. Mismo número de archivos de fuente. */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* AdSense loader + site-verification snippet. Site-wide so Google's crawler
            can verify on public pages (the dashboard is behind auth). With Auto Ads
            off, no ad renders anywhere except our manual unit (AdBanner). */}
        {ADSENSE_CLIENT && (
          <script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`} crossOrigin="anonymous" />
        )}
      </head>
      <body className="font-sans">
        <RootErrorBoundary>{children}</RootErrorBoundary>
        {/* FASE HM: red de seguridad VISIBLE para cuando la recarga automática
            de arriba no prospera (iOS Safari sirviendo el documento cacheado). */}
        <UpdateAvailablePill buildId={buildId} />
      </body>
    </html>
  )
}
