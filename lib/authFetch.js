import { auth } from './firebase'

export async function safeJson(res) {
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    throw new Error(`Expected JSON but got ${ct || 'unknown content-type'}`)
  }
  return res.json()
}

export async function authFetch(url, options = {}) {
  const headers = { ...options.headers }

  // Al cargar, Firebase restaura la sesión de forma asíncrona: hasta entonces
  // `currentUser` es null y la petición saldría SIN token (401 en /api/prices
  // y /api/prices/dividends del tablero, que pide antes que la Hoja). Se espera
  // a que el estado de auth esté listo; sin sesión real sigue sin token.
  if (auth && !auth.currentUser && typeof auth.authStateReady === 'function') {
    try { await auth.authStateReady() } catch { /* sin sesión: sigue sin token */ }
  }

  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken()
      headers['Authorization'] = `Bearer ${token}`
    } catch (err) {
      try {
        const token = await auth.currentUser.getIdToken(true)
        headers['Authorization'] = `Bearer ${token}`
      } catch (retryErr) {
        console.error('[authFetch] Token refresh failed:', retryErr.message)
      }
    }
  }

  const fetchOpts = { ...options, headers }
  if (!fetchOpts.signal) {
    fetchOpts.signal = AbortSignal.timeout(30000)
  }

  const res = await fetch(url, fetchOpts)

  if (res.status === 401 && auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken(true)
      headers['Authorization'] = `Bearer ${token}`
      return fetch(url, fetchOpts)
    } catch {
      return res
    }
  }

  return res
}
