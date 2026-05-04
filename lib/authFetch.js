import { auth } from './firebase'

export async function authFetch(url, options = {}) {
  const headers = { ...options.headers }

  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken()
      headers['Authorization'] = `Bearer ${token}`
    } catch {}
  }

  return fetch(url, { ...options, headers })
}
