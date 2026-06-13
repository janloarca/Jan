import crypto from 'crypto'

export function generateOAuthState(broker) {
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = `${broker}:${nonce}`
  return { state, nonce }
}

export function makeStateCookie(nonce) {
  return `oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
}

export function validateOAuthState(stateParam, cookieNonce) {
  if (!stateParam || !cookieNonce) return null
  const [broker, nonce] = stateParam.split(':')
  if (!broker || !nonce) return null
  if (nonce !== cookieNonce) return null
  return broker
}
