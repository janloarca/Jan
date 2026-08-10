// FASE GX. `/__/firebase/init.json` is the config the OAuth helper page reads
// to configure itself. It is served by Firebase HOSTING, not by Auth, so a
// project whose Hosting site was never provisioned answers 404 for it while
// `/__/auth/handler` keeps working -- which is exactly the split the in-app
// diagnostic reported from the failing device:
//
//     ✖ Proxy /__/firebase: respondió 404
//     ✔ Página de OAuth: alcanzable (HTTP 200)
//
// Proxying faithfully means faithfully returning that 404, and the helper then
// has no config to start from. We do not need Google to tell us our own public
// Firebase config, though: it is the same config the app itself is built with.
// So the proxy asks upstream first and only fills in when upstream has no
// answer. Google's copy always wins when it exists; this can only turn a 404
// into a usable response, never change a working one.
//
// Every field here is public by design (it ships in the client bundle already).

export const INIT_JSON_PATH = 'init.json'

export function buildFirebaseInitJson(env = {}, { authDomain = null } = {}) {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  // Without these two the helper cannot do anything, and emitting a half
  // config would swap a clear 404 for a confusing failure further in.
  if (!apiKey || !projectId) return null

  return {
    apiKey,
    projectId,
    // The helper runs on whichever host served it. Under the same-origin setup
    // that is our own domain, so it is reported as such when the caller knows
    // it; otherwise fall back to the configured Firebase domain.
    authDomain: authDomain || env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
  }
}

// The Firebase helper host to proxy to. Same rule as next.config.js: the
// authDomain is authoritative, but only while it still IS the Firebase domain
// -- once pointed at a custom domain, proxying to it would loop back here.
export function resolveHelperHost(env = {}) {
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  if (authDomain && /\.firebaseapp\.com$/i.test(authDomain)) return authDomain
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  return projectId ? `${projectId}.firebaseapp.com` : null
}
