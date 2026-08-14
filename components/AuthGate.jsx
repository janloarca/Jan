'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import ChispudoLoader from '@/components/ui/ChispudoLoader'

// Misma cookie que setea la página de login. La renovamos en cada cambio de ID
// token para que el check de __session del middleware no expire (el JWT dura 1h)
// mientras la sesión de Firebase sigue viva (Firebase refresca su propio token).
function setSessionCookie(token) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `__session=${token}; path=/; max-age=604800; SameSite=Lax${secure}`
}

// Caché en memoria a nivel de módulo: una vez verificada la sesión en esta carga
// de la app, cambiar de sección no vuelve a mostrar el spinner "Verificando
// sesión...". El listener se monta igual en cada navegación: si la sesión muere,
// redirige a /login exactamente como antes.
let _sessionAlive = false

// Best-effort: si Sentry no está configurado (sin DSN) esto no hace nada, y un
// fallo acá jamás puede impedir que alguien entre a la app.
function tagSentryUser(uid) {
  // Puente que expone sentry.client.config.js. Se llama así, y no importando
  // el SDK, porque un import acá (AuthGate envuelve TODAS las pantallas) le
  // sumaba 36 kB al arranque de la app entera. Si Sentry no está configurado la
  // función no existe y esto no hace nada.
  try { window.__chispuSentryUser?.(uid) } catch {}
}

export default function AuthGate({ children }) {
  const [status, setStatus] = useState(_sessionAlive ? 'authed' : 'checking') // 'checking' | 'authed'
  const router = useRouter()
  const pathname = usePathname()
  const [lang] = useState(() => (typeof window !== 'undefined' && localStorage.getItem('chispudo-lang') === 'en' ? 'en' : 'es'))

  useEffect(() => {
    // Sin config de Firebase (dev local sin env vars) no bloqueamos la pantalla.
    if (!auth) { _sessionAlive = true; setStatus('authed'); return }

    let cancelled = false
    let unsub

    import('firebase/auth')
      .then(({ onIdTokenChanged }) => {
        if (cancelled) return
        // onIdTokenChanged (no onAuthStateChanged): también dispara cuando Firebase
        // refresca el token, así renovamos __session en cada refresh.
        unsub = onIdTokenChanged(auth, async (u) => {
          if (u) {
            try {
              setSessionCookie(await u.getIdToken())
            } catch {}
            // Etiqueta el UID en los reportes de error, y NADA más: sin correo,
            // sin nombre. Es el mismo identificador con el que ya se busca a
            // alguien en Firestore, así que un error reportado se puede seguir
            // hasta su cuenta sin tener que preguntarle a nadie. lib/sentryScrub
            // recorta cualquier otro campo de usuario antes de enviar.
            tagSentryUser(u.uid)
            _sessionAlive = true
            setStatus('authed')
          } else {
            tagSentryUser(null)
            _sessionAlive = false
            router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
          }
        })
      })
      .catch((err) => {
        // Si el SDK no carga (red caída, bloqueador agresivo) no dejamos al usuario
        // atrapado en un spinner infinito; RootErrorBoundary cubre el resto.
        console.error('AuthGate: no se pudo cargar firebase/auth', err)
        setStatus('authed')
      })

    return () => { cancelled = true; unsub?.() }
  }, [pathname, router])

  if (status !== 'authed') {
    // Chispudo's own splash, not a raw spinner — a warm-cache session
    // resolves near-instantly, so the default show-delay is what keeps this
    // from flashing on screen at all for most returning users.
    return <ChispudoLoader mode="fullscreen" state="initial-loading" lang={lang} />
  }

  return children
}
