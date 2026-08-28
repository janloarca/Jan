'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { auth, app } from '@/lib/firebase'
import Logo from '@/components/ui/Logo'
import ChispudoLoader from '@/components/ui/ChispudoLoader'
import { BusyRing } from '@/components/ui/BusyLabel'

// Google sign-in, ENCENDIDO otra vez (FASE HY2): funciona, verificado en
// producción por el usuario.
//
// Estuvo oculto tras esta bandera (FASE HW) mientras se buscaba la causa del
// auth/internal-error que lo mató durante semanas. La causa resultó ser
// NUESTRA: `apis.google.com` faltaba en la `script-src` de la CSP
// (next.config.js), así que el navegador bloqueaba el script que el SDK de
// Firebase Auth necesita, y Firebase envolvía ese evento de error de carga
// como un internal-error genérico. Ver FASE HY, y el guardián
// `lib/__tests__/cspGoogleAuth.test.js` que impide que vuelva a pasar.
//
// La bandera se queda: si algún día hay que apagarlo de urgencia, es una línea
// en vez de un revert. `/login?google=1` sigue funcionando y ahora es
// redundante (el botón ya se muestra siempre), lo que es correcto: forzar algo
// que ya está encendido no hace daño.
const GOOGLE_SIGNIN_ENABLED = true

// Marca de que ESTA pestaña mandó al usuario a Google por redirect. Sin ella,
// las dos piernas del flujo son indistinguibles cuando fallan: el popup y la
// vuelta producen el mismo auth/internal-error genérico, y ni el código ni el
// mensaje dicen cuál de las dos murió. Saber eso descarta la mitad de las
// causas posibles de una sola vez.
const REDIRECT_MARK = 'chispu-google-redirect'
function markRedirectStarted() {
  try { sessionStorage.setItem(REDIRECT_MARK, String(Date.now())) } catch {}
}
function takeRedirectMark() {
  try {
    const v = sessionStorage.getItem(REDIRECT_MARK)
    if (v) sessionStorage.removeItem(REDIRECT_MARK)
    return !!v
  } catch { return false }
}

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

  // Only allow same-origin internal paths to prevent open-redirect (e.g. ?redirect=//evil.com)
  const rawRedirect = searchParams.get('redirect') || '/dashboard'
  const redirectTo = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') && !rawRedirect.includes('\\') ? rawRedirect : '/dashboard'

  // Ver el comentario de GOOGLE_SIGNIN_ENABLED arriba. Se lee del mismo
  // searchParams que ya usa `redirect`, así que no hay riesgo de desajuste
  // entre lo que renderiza el servidor y lo que renderiza el navegador.
  const showGoogle = GOOGLE_SIGNIN_ENABLED || searchParams.get('google') === '1'

  useEffect(() => {
    if (isInAppBrowser()) setInAppBrowser(true)

    if (!auth) { setCheckingAuth(false); return }

    let unsub
    import('firebase/auth').then((mod) => {
      // Guardar el MÓDULO, no un booleano: handleGoogle lo necesita ya cargado
      // para llamar signInWithPopup sin un `await import(...)` de por medio.
      // Safari (sobre todo iOS) invalida el gesto del usuario si hay una espera
      // de red entre el tap y window.open, y bloquea el popup.
      firebaseAuthRef.current = mod
      const { onAuthStateChanged, getRedirectResult } = mod
      // Completar (o reportar) un sign-in por redirect que vuelve de Google:
      // sin esto, un error del flujo de redirect (el fallback cuando el popup
      // se bloquea) moría en silencio y el usuario solo veía la pantalla de
      // login otra vez, sin pista de qué pasó.
      const cameBackFromGoogle = takeRedirectMark()
      getRedirectResult(auth).then((res) => {
        // Volvimos de Google SIN credencial y SIN error. No es un rechazo: es
        // que el resultado se perdió entre la ida y la vuelta, lo que apunta al
        // estado del round-trip y no a un permiso mal puesto. Sin este caso, un
        // viaje que no produce nada se ve idéntico a no haber intentado.
        if (!res && cameBackFromGoogle) {
          setError('You came back from Google but the session never arrived. Please try again.')
          setCheckingAuth(false)
        }
      }).catch((err) => {
        if (!err || !err.code) return
        // El detalle embebido importa MÁS en esta rama que en el popup. Este es
        // el tramo de VUELTA: Google ya autenticó y el helper está canjeando la
        // credencial contra Identity Toolkit, así que un rechazo de aquí SÍ es
        // una respuesta de servidor y suele traer su razón adentro.
        console.error('[google-redirect]', err.code, err.message)
        setError('We could not finish signing you in with Google. Please try again.')
        setCheckingAuth(false)
      })
      unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          try {
            const token = await u.getIdToken()
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
      setCheckingAuth(true)
      setTimeout(() => { window.location.href = redirectTo }, 1500)
    } catch (err) {
      const msg = err.code === 'auth/wrong-password' ? 'Wrong password'
        : err.code === 'auth/user-not-found' ? 'There is no account with that email'
        : err.code === 'auth/email-already-in-use' ? 'That email is already registered'
        : err.code === 'auth/weak-password' ? 'Your password needs at least 6 characters'
        : err.code === 'auth/invalid-email' ? 'Invalid email'
        : err.code === 'auth/invalid-credential' ? 'Wrong email or password'
        : err.code === 'auth/network-request-failed' ? 'Network error. Check your connection.'
        : err.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a moment.'
        : err.code === 'auth/internal-error' ? 'Something went wrong. Please try again.'
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
      // El módulo ya viene precargado desde el mount: usarlo directo mantiene
      // el gesto del usuario intacto entre el tap y window.open (Safari
      // bloquea el popup si hay una importación de red en medio). El await
      // dinámico queda solo como fallback si el mount aún no terminó.
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = firebaseAuthRef.current || await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      const provider = new GoogleAuthProvider()
      if (isInAppBrowser()) {
        markRedirectStarted()
        await signInWithRedirect(auth, provider)
        return
      }
      const cred = await signInWithPopup(auth, provider)
      const token = await cred.user.getIdToken()
      setSessionCookie(token)
      setCheckingAuth(true)
      setTimeout(() => { window.location.href = redirectTo }, 1500)
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return
      // auth/internal-error joins popup-blocked as a reason to fall back to the
      // redirect flow. The failing device reports it with NO embedded server
      // payload (the message is the bare "Firebase: Error (auth/internal-error)"),
      // and that distinction is the useful one: a request the server rejected
      // comes back carrying its reason, so a bare one means the popup never got
      // that far. What dies before then is the popup/iframe handshake the SDK
      // needs to talk to the helper, which Safari restricts hardest. The
      // redirect flow does not use that handshake at all: it navigates the top
      // window and comes back through getRedirectResult (handled on mount).
      // Only reached when the popup path has ALREADY failed, so at worst it
      // replaces a dead end with an attempt.
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/internal-error') {
        try {
          const { GoogleAuthProvider, signInWithRedirect } = firebaseAuthRef.current || await import('firebase/auth')
          if (auth) { markRedirectStarted(); await signInWithRedirect(auth, new GoogleAuthProvider()); return }
        } catch (redirectErr) {
          // Falls through to the banner below, which now describes the redirect
          // failure rather than the popup one that is no longer the real story.
          console.error('[google-signin] redirect fallback', redirectErr?.code, redirectErr?.message)
        }
      }
      // El código del error viaja en el mensaje a propósito: "Error interno"
      // a secas hacía imposible diagnosticar a distancia qué falló de verdad
      // (auth/internal-error, unauthorized-domain, etc.). auth/internal-error
      // PUEDE traer embebido el mensaje real del servidor en err.message (un
      // JSON con la razón); se muestra recortado porque es el único canal de
      // diagnóstico en un teléfono. Cuando NO lo trae (el caso observado: el
      // mensaje es el genérico a secas) eso mismo es el dato: el servidor
      // nunca contestó, así que el fallo está antes, en el handshake del
      // popup, y por eso arriba se reintenta por redirect.
      console.error('[google-signin]', err.code, err.message)
      // Mensaje HUMANO. El código y el detalle técnico van a la consola de
      // arriba, no a la cara del usuario: la causa del auth/internal-error que
      // costó semanas ya está encontrada y arreglada (era nuestra CSP, FASE HY),
      // con un test que la fija, así que mostrar códigos crudos en la pantalla
      // de login solo asusta a quien se topa con un bache de red.
      setError(err.code === 'auth/network-request-failed'
        ? 'Network error. Check your connection.'
        : 'We could not connect to Google. Please try again.')
      // Etiquetada como IDA: si el fallback por redirect hubiera arrancado, esta
      // pestaña ya se habría ido a Google y este banner no existiría.
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email) { setError('Enter your email first'); return }
    setError('')
    setLoading(true)
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth')
      if (!auth) throw new Error('Firebase not initialized')
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch (err) {
      const msg = err.code === 'auth/user-not-found' ? 'There is no account with that email'
        : err.code === 'auth/invalid-email' ? 'Invalid email'
        : err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-theme-base" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(37,99,235,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.06) 0%, transparent 50%), var(--bg-primary)' }}>
        <ChispudoLoader mode="inline" size="medium" state="initial-loading" message="Checking your session..." showLabel />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-theme-base" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(37,99,235,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.06) 0%, transparent 50%), var(--bg-primary)' }}>
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex mb-2">
            <Logo size={32} as="h1" />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your whole portfolio, in one place</p>
        </div>

        {/* Era `rounded-xl` (12px) contra los 16px de toda card de la app, más un
            `backdropFilter` que `.card` quitó a propósito: el fondo de atrás es
            un degradado radial, o sea baja frecuencia, y desenfocar un degradado
            suave no cambia un píxel, solo cuesta una capa de composición. La
            sombra sí se conserva más profunda (`--shadow-elevated`): esta card
            flota sobre la pantalla en vez de vivir en una grilla, mismo criterio
            que `.card-hero`. */}
        <div className="card p-6" style={{ boxShadow: 'var(--shadow-elevated)' }}>
          <h2 className="text-h2 text-center mb-5" style={{ color: 'var(--text-primary)' }}>
            {isSignUp ? 'Create account' : 'Log in'}
          </h2>

          {inAppBrowser && (
            /* `#fbbf24` medía 1.67:1 sobre la card blanca. Los tres tokens de
               aviso ya existen y su valor OSCURO es exactamente el que estaba
               escrito acá a mano, así que en tema oscuro no cambia nada. */
            <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)', color: 'var(--alert-warn-icon)' }}>
              For the best experience, open this in your browser:
              <a href={typeof window !== 'undefined' ? window.location.href : '#'}
                target="_blank" rel="noopener noreferrer"
                className="block mt-1 underline font-medium" style={{ color: 'var(--accent-blue)' }}>
                Open in Safari / Chrome
              </a>
            </div>
          )}

          {error && (
            <div role="alert" aria-live="assertive" className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)', color: 'var(--alert-error-icon)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Email</label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-white placeholder-slate-600 focus:outline-none text-base"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: 'var(--glass-border)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-white placeholder-slate-600 focus:outline-none text-base"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: 'var(--glass-border)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)' }}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 rounded-lg disabled:opacity-50 transition-colors font-medium text-base"
            >
              {loading ? 'Loading...' : (isSignUp ? 'Create account' : 'Log in')}
            </button>
          </form>

          {!isSignUp && !showReset && (
            <button onClick={() => setShowReset(true)}
              className="w-full mt-2 text-xs transition-colors text-center" style={{ color: 'var(--text-secondary)' }}>
              Forgot your password?
            </button>
          )}

          {showReset && (
            <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: 'var(--glass-border)' }}>
              {resetSent ? (
                <p className="text-sm text-center" style={{ color: 'var(--accent-green)' }}>
                  Check your email to reset your password.
                </p>
              ) : (
                <>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Enter your email above and press:</p>
                  <button onClick={handleResetPassword} disabled={loading}
                    className="w-full py-2 text-sm text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: 'var(--glass-border)' }}>
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </>
              )}
            </div>
          )}

          {showGoogle && (<>
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-glass-border" /></div>
            <div className="relative flex justify-center">
              <span className="bg-theme-card px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>or</span>
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
            {googleLoading ? 'Connecting...' : 'Continue with Google'}
          </button>
          </>)}

          <p className="mt-5 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setShowReset(false); setResetSent(false) }}
              className="font-medium" style={{ color: 'var(--accent-blue)' }}
            >
              {isSignUp ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </div>

        {/* El enlace con círculo "i" que vivía acá (FASE FC) se quitó: apuntaba
            a /terms, exactamente igual que la línea de abajo, así que eran dos
            accesos al mismo documento a tres centímetros uno del otro. La línea
            de abajo se queda porque además de enlazar dice para qué sirve
            ("al continuar aceptas..."), que es lo que un aviso legal tiene que
            hacer, y porque también cubre la Política de Privacidad. */}
        <p className="text-center text-xs mt-5" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          By continuing you accept the <a href="/terms" className="underline" style={{ color: 'var(--accent-blue)' }}>Terms</a> and the <a href="/privacy" className="underline" style={{ color: 'var(--accent-blue)' }}>Privacy Policy</a>
        </p>
        <p className="text-center text-xs mt-2" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          Powered by Chispudo
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-theme-base" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(37,99,235,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.06) 0%, transparent 50%), var(--bg-primary)' }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <BusyRing size="16px" />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
