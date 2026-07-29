'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'

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
  const [status, setStatus] = useState(_sessionAlive ? 'authed' : 'checking') // 'checking' | 'authed'
  const router = useRouter()
  const pathname = usePathname()

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
            _sessionAlive = true
            setStatus('authed')
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
        setStatus('authed')
      })

    return () => { cancelled = true; unsub?.() }
  }, [pathname, router])

  if (status !== 'authed') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-theme-base" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--text-secondary)', borderTopColor: 'transparent' }} />
          Verificando sesión...
        </div>
      </div>
    )
  }

  return children
}
