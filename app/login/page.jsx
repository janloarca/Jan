'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'

function setSessionCookie(token) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `__session=${token}; path=/; max-age=604800; SameSite=Lax${secure}`
}

function isInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|WebView|wv\)/i.test(ua)
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [inAppBrowser, setInAppBrowser] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const searchParams = useSearchParams()
  const router = useRouter()
  const firebaseAuthRef = useRef(null)

  const redirectTo = searchParams.get('redirect') || '/dashboard'

  useEffect(() => {
    if (isInAppBrowser()) setInAppBrowser(true)

    if (!auth) { setCheckingAuth(false); return }

    let unsub
    import('firebase/auth').then(({ onAuthStateChanged }) => {
      firebaseAuthRef.current = true
      unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          try {
            const token = await u.getIdToken(true)
            setSessionCookie(token)
            router.replace(redirectTo)
          } catch {
            setCheckingAuth(false)
          }
        } else {
          setCheckingAuth(false)
        }
      })
    })

    const timeout = setTimeout(() => setCheckingAuth(false), 3000)
    return () => { clearTimeout(timeout); unsub?.() }
  }, [redirectTo, router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      let cred
      if (isSignUp) {
        cred = await createUserWithEmailAndPassword(auth, email, password)
      } else {
        cred = await signInWithEmailAndPassword(auth, email, password)
      }
      const token = await cred.user.getIdToken()
      setSessionCookie(token)
      router.replace(redirectTo)
    } catch (err) {
      const msg = err.code === 'auth/wrong-password' ? 'Contraseña incorrecta'
        : err.code === 'auth/user-not-found' ? 'No existe una cuenta con ese email'
        : err.code === 'auth/email-already-in-use' ? 'Ese email ya está registrado'
        : err.code === 'auth/weak-password' ? 'La contraseña debe tener al menos 6 caracteres'
        : err.code === 'auth/invalid-email' ? 'Email inválido'
        : err.code === 'auth/invalid-credential' ? 'Email o contraseña incorrectos'
        : err.code === 'auth/network-request-failed' ? 'Error de red. Verifica tu conexión.'
        : err.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera un momento.'
        : err.code === 'auth/internal-error' ? 'Error interno. Intenta de nuevo.'
        : err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setGoogleLoading(true)
    try {
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      const provider = new GoogleAuthProvider()
      if (isInAppBrowser()) {
        await signInWithRedirect(auth, provider)
        return
      }
      const cred = await signInWithPopup(auth, provider)
      const token = await cred.user.getIdToken()
      setSessionCookie(token)
      router.replace(redirectTo)
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return
      if (err.code === 'auth/popup-blocked') {
        try {
          const { GoogleAuthProvider, signInWithRedirect } = await import('firebase/auth')
          if (auth) await signInWithRedirect(auth, new GoogleAuthProvider())
          return
        } catch {}
      }
      const msg = err.code === 'auth/network-request-failed' ? 'Error de red. Verifica tu conexión.'
        : err.code === 'auth/internal-error' ? 'Error interno. Intenta de nuevo.'
        : 'Error al conectar con Google. Intenta de nuevo.'
      setError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email) { setError('Ingresa tu email primero'); return }
    setError('')
    setLoading(true)
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch (err) {
      const msg = err.code === 'auth/user-not-found' ? 'No existe una cuenta con ese email'
        : err.code === 'auth/invalid-email' ? 'Email inválido'
        : err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#000000]">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          Verificando sesión...
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#000000]">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-3xl" style={{ color: '#60a5fa' }}>⚡</span>
            <h1 className="text-3xl font-bold" style={{ color: '#60a5fa' }}>Chispudo</h1>
          </div>
          <p className="text-slate-500 text-sm">Tu control financiero personal</p>
        </div>

        <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white text-center mb-5">
            {isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </h2>

          {inAppBrowser && (
            <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
              Para mejor experiencia, abre en tu navegador:
              <a href={typeof window !== 'undefined' ? window.location.href : '#'}
                target="_blank" rel="noopener noreferrer"
                className="block mt-1 underline font-medium" style={{ color: '#60a5fa' }}>
                Abrir en Safari / Chrome
              </a>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--text-negative)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#000000] border border-[#38383A] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-base"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Password</label>
              <input
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#000000] border border-[#38383A] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-base"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg disabled:opacity-50 transition-colors font-medium text-base"
              style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
            >
              {loading ? 'Cargando...' : (isSignUp ? 'Crear cuenta' : 'Iniciar sesión')}
            </button>
          </form>

          {!isSignUp && !showReset && (
            <button onClick={() => setShowReset(true)}
              className="w-full mt-2 text-xs transition-colors text-center" style={{ color: '#64748b' }}>
              ¿Olvidaste tu contraseña?
            </button>
          )}

          {showReset && (
            <div className="mt-3 p-3 bg-[#000000] rounded-lg border border-[#38383A]/50">
              {resetSent ? (
                <p className="text-sm text-center" style={{ color: 'var(--accent-green)' }}>
                  Revisa tu email para restablecer tu contraseña.
                </p>
              ) : (
                <>
                  <p className="text-xs text-slate-400 mb-2">Ingresa tu email arriba y presiona:</p>
                  <button onClick={handleResetPassword} disabled={loading}
                    className="w-full py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-600 active:bg-slate-800 disabled:opacity-50 transition-colors">
                    {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#38383A]" /></div>
            <div className="relative flex justify-center">
              <span className="bg-[#1C1C1E] px-3 text-xs text-slate-500">o</span>
            </div>
          </div>

          <button onClick={handleGoogle} disabled={googleLoading}
            className="w-full py-3 bg-white text-gray-800 rounded-lg hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50 transition-colors font-medium text-base flex items-center justify-center gap-3 border border-gray-300">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {googleLoading ? 'Conectando...' : 'Continuar con Google'}
          </button>

          <p className="mt-5 text-center text-sm text-slate-500">
            {isSignUp ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setShowReset(false); setResetSent(false) }}
              className="font-medium" style={{ color: '#60a5fa' }}
            >
              {isSignUp ? 'Inicia sesión' : 'Regístrate'}
            </button>
          </p>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6">
          Powered by Chispudo
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#000000]">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
