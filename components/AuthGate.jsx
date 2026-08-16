'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import ChispudoLoader, { EXIT_MS } from '@/components/ui/ChispudoLoader'

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

export default function AuthGate({ children }) {
  // 'checking' -> ('exiting' ->) 'ready'. The middle phase exists so the
  // splash can fade out OVER the app instead of being cut away: it renders
  // children AND the splash at once, so nothing pops. Going straight from
  // 'checking' to 'exiting' in a single setState matters — an intermediate
  // 'ready' frame would flash the dashboard and then re-cover it.
  const [phase, setPhase] = useState(_sessionAlive ? 'ready' : 'checking')
  const router = useRouter()
  const pathname = usePathname()
  const [lang] = useState(() => (typeof window !== 'undefined' && localStorage.getItem('chispudo-lang') === 'en' ? 'en' : 'es'))

  // Only fade out something that was actually on screen. A warm-cache session
  // resolves inside the loader's show-delay, so it never painted, and fading
  // nothing out is just a 240ms delay before the app appears.
  const paintedRef = useRef(false)
  const settle = () => setPhase(paintedRef.current ? 'exiting' : 'ready')

  useEffect(() => {
    if (phase !== 'exiting') return undefined
    const id = setTimeout(() => setPhase('ready'), EXIT_MS)
    return () => clearTimeout(id)
  }, [phase])

  useEffect(() => {
    // Sin config de Firebase (dev local sin env vars) no bloqueamos la pantalla.
    if (!auth) { _sessionAlive = true; settle(); return }

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
            _sessionAlive = true
            settle()
          } else {
            _sessionAlive = false
            router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
          }
        })
      })
      .catch((err) => {
        // Si el SDK no carga (red caída, bloqueador agresivo) no dejamos al usuario
        // atrapado en un spinner infinito; RootErrorBoundary cubre el resto.
        console.error('AuthGate: no se pudo cargar firebase/auth', err)
        settle()
      })

    return () => { cancelled = true; unsub?.() }
  }, [pathname, router])

  if (phase === 'checking') {
    // Chispudo's own splash, not a raw spinner — a warm-cache session
    // resolves near-instantly, so the default show-delay is what keeps this
    // from flashing on screen at all for most returning users.
    return (
      <ChispudoLoader mode="fullscreen" state="initial-loading" lang={lang}
        onVisible={() => { paintedRef.current = true }} />
    )
  }

  return (
    <>
      {children}
      {/* delay={0}: the wait is over, so the anti-flicker delay would only
          postpone the fade. It sits above children (fixed, z-60) and lets
          clicks through while it goes. */}
      {phase === 'exiting' && (
        <ChispudoLoader mode="fullscreen" state="initial-loading" lang={lang} exiting delay={0} />
      )}
    </>
  )
}
