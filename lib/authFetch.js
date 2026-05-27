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

  const res = await fetch(url, { ...options, headers })

  if (res.status === 401 && auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken(true)
      headers['Authorization'] = `Bearer ${token}`
      return fetch(url, { ...options, headers })
    } catch {
      return res
    }
  }

  return res
}
