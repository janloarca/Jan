/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: () => {
    return `b${Date.now().toString(36)}`
  },
  env: {
    NEXT_BUILD_ID: `b${Date.now().toString(36)}`,
  },
  transpilePackages: ['undici'],
  // Next 14 todavía necesita el flag para cargar instrumentation.js, que es
  // donde arranca Sentry del lado del servidor y del edge.
  experimental: { instrumentationHook: true },
  // FASE FV. El helper de OAuth de Firebase (signInWithPopup/Redirect) vive en
  // <proyecto>.firebaseapp.com: un dominio CRUZADO cuyo storage Safari bloquea
  // (Intelligent Tracking Prevention), y el sign-in con Google muere en
  // auth/internal-error o vuelve del redirect sin sesión. El arreglo
  // documentado por Firebase es servir ese helper desde NUESTRO dominio:
  // authDomain pasa a ser el host de la app (lib/firebase.js) y estas rutas
  // hacen proxy de /__/auth y /__/firebase hacia firebaseapp.com, así el
  // iframe/popup es same-origin y Safari no tiene nada que bloquear.
  async rewrites() {
    // The helper host is whatever NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN names, which
    // is the authoritative value; `<projectId>.firebaseapp.com` only happens to
    // match it in the common case, and silently proxies to a host that does not
    // exist when it does not. Only trusted when it still IS the Firebase helper
    // domain: once authDomain is pointed at a custom domain, proxying to it
    // would send these routes back to ourselves in a loop.
    const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    const helperHost = (authDomain && /\.firebaseapp\.com$/i.test(authDomain))
      ? authDomain
      : (project ? `${project}.firebaseapp.com` : null)
    if (!helperHost) return []
    return [
      { source: '/__/auth/:path*', destination: `https://${helperHost}/__/auth/:path*` },
      // FASE GX: /__/firebase goes through our own route instead of straight to
      // Firebase. The helper reads its config from /__/firebase/init.json, which
      // Hosting serves -- and a project whose Hosting site was never provisioned
      // answers 404 for it while /__/auth keeps working, which is exactly what
      // the in-app diagnostic reported. That route proxies upstream first and
      // only synthesizes init.json when upstream has no answer.
      { source: '/__/firebase/:path*', destination: '/api/firebase-helper/:path*' },
    ]
  },
  webpack: (config, { webpack }) => {
    config.externals = [...(config.externals || []), { 'undici': 'commonjs undici' }]
    // Sentry envía TODO su código de trazas y de depuración aunque estén
    // apagados por configuración: apagarlos en runtime no los saca del bundle.
    // Estas banderas sí, y esta app se abre en teléfonos, así que cada kilobyte
    // del arranque cuenta. Medido: sin esto el bundle compartido sube ~71 kB.
    config.plugins.push(new webpack.DefinePlugin({
      __SENTRY_DEBUG__: false,
      __SENTRY_TRACING__: false,
      __RRWEB_EXCLUDE_IFRAME__: true,
      __RRWEB_EXCLUDE_SHADOW_DOM__: true,
      __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
    }))
    return config
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      // FASE HM. El no-store existía SOLO para /dashboard, y por eso no servía:
      // el usuario entra por la RAÍZ (chispu.xyz), que decide y redirige del
      // lado del cliente, así que el documento que el navegador cachea es el de
      // '/' (sin ninguna regla de caché) y ese HTML viejo referencia los chunks
      // del build viejo. El documento de /dashboard nunca se llega a pedir, así
      // que su header nunca aplica. Resultado real: un iPhone y un iPad
      // quedaron un día entero en el build viejo, a través de CUATRO deploys,
      // mostrando siempre la misma pantalla y haciendo parecer que ningún
      // arreglo hacía nada. Ahora TODA página de la app se sirve sin caché.
      //
      // Los assets con hash de contenido (/_next/static/*) NO entran acá a
      // propósito: sus nombres cambian en cada build, así que cachearlos para
      // siempre es correcto y es lo que hace que la app cargue rápido.
      ...['/', '/dashboard', '/finances', '/spreadsheet', '/friends', '/costs', '/login'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          { key: 'Surrogate-Control', value: 'no-store' },
        ],
      })),
      // FASE FV: el helper de OAuth proxied (rewrites de abajo) corre DENTRO de
      // un iframe de nuestra propia página de login. El X-Frame-Options: DENY
      // global lo rompería; esta regla va ANTES del catch-all y Next aplica la
      // ÚLTIMA que matchea por clave, así que el catch-all se anula aquí con
      // SAMEORIGIN declarándolo después. (Ver la regla específica al final.)
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Recomendado por soporte de Firebase. No lo teníamos puesto en
          // ningún lado (ni acá, ni en middleware, ni en vercel.json), así que
          // hoy vale lo que decida la plataforma. "same-origin" a secas rompe
          // la comunicación entre el popup de Google y la ventana que lo abrió;
          // declararlo explícito saca la variable de la ecuación en vez de
          // confiar en un default que no controlamos. "-allow-popups" es lo
          // estrictamente necesario: aísla de openers cruzados, pero deja que
          // los popups que ABRE esta página conserven su referencia.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js + theme bootstrap script need inline; eval used by some Next chunks.
              // Google hosts: AdSense footer unit (components/AdFooter.jsx).
              //
              // apis.google.com es OBLIGATORIO para Google sign-in y su ausencia
              // fue la causa del auth/internal-error que costó semanas (FASE HY).
              // El SDK de Firebase Auth carga https://apis.google.com/js/api.js
              // metiendo un <script> en el <head> (verificable en el bundle
              // servido); sin el host acá, el navegador lo BLOQUEA, el script
              // dispara un Event de error, y Firebase lo envuelve como
              // auth/internal-error sin más detalle. Por eso fallaba en todos los
              // dispositivos, en las dos arquitecturas de sign-in, sin respuesta
              // de servidor, y ningún ajuste de consola lo tocaba: la petición
              // nunca salía del navegador. Hay un test que lo fija.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.googletagservices.com https://adservice.google.com https://ep2.adtrafficquality.google",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https:",
              // Firebase Auth/Firestore/Storage + external price APIs (incl. wss for realtime)
              "connect-src 'self' https: wss:",
              // Firebase Auth popup/redirect iframes
              "frame-src 'self' https:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
      // FASE FV: override del catch-all para el helper de OAuth proxied, que
      // corre dentro de un iframe de nuestra página de login. Va AL FINAL a
      // propósito: para una misma clave, Next aplica la última regla que
      // matchea, así que estas dos pisan el DENY/frame-ancestors globales solo
      // en /__/auth. El contenido real lo sirve Google (rewrites de arriba).
      {
        source: '/__/auth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ]
  },
}

// Sentry envuelve la config para (a) inyectar su cliente en el bundle y (b)
// SUBIR LOS SOURCE MAPS al construir, que es lo que convierte un
// "Cannot access 'nL'" en "showToast, page.jsx:416".
//
// Todo esto es opcional por diseño: sin SENTRY_AUTH_TOKEN no se suben mapas y
// sin DSN el cliente ni se inicializa, así que un build sin configurar (o el de
// alguien que clone el repo) se comporta exactamente como antes.
//
// `widenClientFileUpload` incluye los chunks compartidos, que es justo donde
// vivía el error de esta mañana. `hideSourceMaps` evita que los mapas queden
// servidos públicamente: se suben a Sentry y no se exponen en el sitio, así que
// ganamos nombres legibles sin publicar el código fuente.
const { withSentryConfig } = require('@sentry/nextjs')

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  sourcemaps: {
    // Sin token no hay a dónde subirlos: generarlos igual solo alargaría el
    // build y dejaría archivos .map sin destino.
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // El túnel evita que los bloqueadores de anuncios se coman los reportes, que
  // es un porcentaje real de usuarios en móvil.
  tunnelRoute: '/monitoring',
})
