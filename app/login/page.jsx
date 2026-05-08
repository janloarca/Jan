'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function setSessionCookie(token) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `__session=${token}; path=/; max-age=3600; SameSite=Lax${secure}`
}

function isInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|WebView|wv\)/i.test(ua)
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [inAppBrowser, setInAppBrowser] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (isInAppBrowser()) setInAppBrowser(true)

    let unsub = () => {}
    async function check() {
      const { auth } = await import('@/lib/firebase')
      const { onAuthStateChanged } = await import('firebase/auth')
      if (!auth) return
      unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          const token = await u.getIdToken()
          setSessionCookie(token)
          router.push('/dashboard')
        }
      })
    }
    check()
    return () => unsub()
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { auth } = await import('@/lib/firebase')
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
      router.push('/dashboard')
    } catch (err) {
      const msg = err.code === 'auth/wrong-password' ? 'Contraseña incorrecta'
        : err.code === 'auth/user-not-found' ? 'No existe una cuenta con ese email'
        : err.code === 'auth/email-already-in-use' ? 'Ese email ya está registrado'
        : err.code === 'auth/weak-password' ? 'La contraseña debe tener al menos 6 caracteres'
        : err.code === 'auth/invalid-email' ? 'Email inválido'
        : err.code === 'auth/invalid-credential' ? 'Email o contraseña incorrectos'
        : err.code === 'auth/network-request-failed' ? 'Error de red. Verifica tu conexión.'
        : err.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera un momento.'
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
      const { auth } = await import('@/lib/firebase')
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      const provider = new GoogleAuthProvider()
      const cred = await signInWithPopup(auth, provider)
      const token = await cred.user.getIdToken()
      setSessionCookie(token)
      router.push('/dashboard')
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') return
      if (err.code === 'auth/popup-blocked') {
        setError('Popup bloqueado. Permite popups para este sitio.')
      } else {
        setError(err.message)
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email) { setError('Ingresa tu email primero'); return }
    setError('')
    setLoading(true)
    try {
      const { auth } = await import('@/lib/firebase')
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

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-blue-400 text-3xl">⚡</span>
            <h1 className="text-3xl font-bold text-blue-400">Chispudo</h1>
          </div>
          <p className="text-slate-500 text-sm">Tu control financiero personal</p>
        </div>

        <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white text-center mb-5">
            {isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </h2>

          {inAppBrowser && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-sm">
              Para mejor experiencia, abre en tu navegador:
              <a href={typeof window !== 'undefined' ? window.location.href : '#'}
                target="_blank" rel="noopener noreferrer"
                className="block mt-1 text-blue-400 underline font-medium">
                Abrir en Safari / Chrome
              </a>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
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
                className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-base"
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
                className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 text-base"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 transition-colors font-medium text-base"
            >
              {loading ? 'Cargando...' : (isSignUp ? 'Crear cuenta' : 'Iniciar sesión')}
            </button>
          </form>

          {!isSignUp && !showReset && (
            <button onClick={() => setShowReset(true)}
              className="w-full mt-2 text-xs text-slate-500 hover:text-blue-400 transition-colors text-center">
              ¿Olvidaste tu contraseña?
            </button>
          )}

          {showReset && (
            <div className="mt-3 p-3 bg-[#0f172a] rounded-lg border border-[#334155]/50">
              {resetSent ? (
                <p className="text-sm text-emerald-400 text-center">
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
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#334155]" /></div>
            <div className="relative flex justify-center">
              <span className="bg-[#1e293b] px-3 text-xs text-slate-500">o</span>
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
              className="text-blue-400 hover:text-blue-300 font-medium"
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
