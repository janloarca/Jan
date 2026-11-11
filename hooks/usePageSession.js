'use client'

// Sesión e idioma para las pantallas del modo institucional. Sin sesión manda
// a /login conservando a dónde volver (una invitación abierta sin sesión no
// puede perderse en el camino).
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function usePageSession(returnTo) {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
    } catch { /* sin storage */ }
  }, [])
  const toggleLang = useCallback(() => {
    setLang((cur) => {
      const next = cur === 'en' ? 'es' : 'en'
      try { localStorage.setItem('chispudo-lang', next) } catch { /* sin storage */ }
      return next
    })
  }, [])

  useEffect(() => {
    let unsubscribe = () => {}
    const loginHref = `/login?redirect=${encodeURIComponent(returnTo || '/dashboard')}`
    ;(async () => {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push(loginHref); return }
      unsubscribe = onIdTokenChanged(auth, (current) => {
        if (!current) router.push(loginHref)
        else setUser(current)
        setAuthLoading(false)
      })
    })()
    return () => unsubscribe()
  }, [router, returnTo])

  return { user, authLoading, lang, toggleLang }
}
