import { auth } from './firebase'

export async function authFetch(url, options = {}) {
  const headers = { ...options.headers }

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
