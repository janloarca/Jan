/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: () => {
    return `b${Date.now().toString(36)}`
  },
  env: {
    NEXT_BUILD_ID: `b${Date.now().toString(36)}`,
  },
  transpilePackages: ['undici'],
  // FASE FV. El helper de OAuth de Firebase (signInWithPopup/Redirect) vive en
  // <proyecto>.firebaseapp.com: un dominio CRUZADO cuyo storage Safari bloquea
  // (Intelligent Tracking Prevention), y el sign-in con Google muere en
  // auth/internal-error o vuelve del redirect sin sesión. El arreglo
  // documentado por Firebase es servir ese helper desde NUESTRO dominio:
  // authDomain pasa a ser el host de la app (lib/firebase.js) y estas rutas
  // hacen proxy de /__/auth y /__/firebase hacia firebaseapp.com, así el
  // iframe/popup es same-origin y Safari no tiene nada que bloquear.
  async rewrites() {
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!project) return []
    return [
      { source: '/__/auth/:path*', destination: `https://${project}.firebaseapp.com/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `https://${project}.firebaseapp.com/__/firebase/:path*` },
    ]
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), { 'undici': 'commonjs undici' }]
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
      {
        source: '/dashboard',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          { key: 'Surrogate-Control', value: 'no-store' },
        ],
      },
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
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js + theme bootstrap script need inline; eval used by some Next chunks.
              // Google hosts: AdSense footer unit (components/AdFooter.jsx).
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.googletagservices.com https://adservice.google.com https://ep2.adtrafficquality.google",
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

module.exports = nextConfig
