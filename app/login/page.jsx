'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let unsub = () => {}
    async function check() {
      const { auth } = await import('@/lib/firebase')
      const { onAuthStateChanged } = await import('firebase/auth')
      if (!auth) return
      unsub = onAuthStateChanged(auth, (u) => { if (u) router.push('/dashboard') })
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
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      router.push('/dashboard')
    } catch (err) {
      const msg = err.code === 'auth/wrong-password' ? 'Contraseña incorrecta'
        : err.code === 'auth/user-not-found' ? 'No existe una cuenta con ese email'
        : err.code === 'auth/email-already-in-use' ? 'Ese email ya está registrado'
        : err.code === 'auth/weak-password' ? 'La contraseña debe tener al menos 6 caracteres'
        : err.code === 'auth/invalid-email' ? 'Email inválido'
        : err.code === 'auth/invalid-credential' ? 'Email o contraseña incorrectos'
        : err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0b1120]">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-emerald-400 text-3xl">⚡</span>
            <h1 className="text-3xl font-bold text-emerald-400">Chispudo</h1>
          </div>
          <p className="text-slate-500 text-sm">Tu panel de patrimonio privado</p>
        </div>

        <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white text-center mb-5">
            {isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </h2>

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
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-sm"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors font-medium text-sm"
            >
              {loading ? 'Cargando...' : (isSignUp ? 'Crear cuenta' : 'Iniciar sesión')}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {isSignUp ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError('') }}
              className="text-emerald-400 hover:text-emerald-300 font-medium"
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
