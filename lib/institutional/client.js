// Cliente del modo institucional: una sola puerta (/api/org) y los textos de
// sus errores. Nada de aquí escribe en Firestore: todo va por el servidor.
import { authFetch, safeJson } from '@/lib/authFetch'

export async function orgApi(action, payload = {}) {
  const res = await authFetch('/api/org', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
  })
  let data = null
  try { data = await safeJson(res) } catch { /* respuesta sin JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP_${res.status}`)
    err.code = data?.error || `HTTP_${res.status}`
    throw err
  }
  return data || {}
}

const ERRORS = {
  FORBIDDEN: ['No tienes permiso para hacer esto.', 'You do not have permission to do this.'],
  FORBIDDEN_SCOPE: ['El cliente no compartió esta sección.', 'The client did not share this section.'],
  TOKEN_USED: ['Esta invitación ya se usó.', 'This invitation was already used.'],
  INVITE_EXPIRED: ['Esta invitación venció. Pide una nueva.', 'This invitation expired. Ask for a new one.'],
  INVITE_NOT_FOUND: ['No encontramos esta invitación.', 'We could not find this invitation.'],
  INVITE_REVOKED: ['Esta invitación fue cancelada.', 'This invitation was cancelled.'],
  EMAIL_MISMATCH: ['Esta invitación es para otro correo. Entra con la cuenta invitada.', 'This invitation is for another email. Sign in with the invited account.'],
  CONSENT_REQUIRED: ['Falta aceptar el consentimiento.', 'Consent is required.'],
  NO_SCOPES: ['Marca al menos una sección para compartir.', 'Select at least one section to share.'],
  SELF_LINK: ['No puedes vincularte como cliente de ti mismo.', 'You cannot link yourself as your own client.'],
  ORG_SUSPENDED: ['Esta firma no está activa.', 'This firm is not active.'],
  LINK_NOT_ACTIVE: ['El vínculo ya no está activo.', 'The link is no longer active.'],
  LAST_ADMIN: ['La firma necesita al menos un administrador.', 'The firm needs at least one administrator.'],
  BAD_EMAIL: ['Revisa el correo.', 'Check the email address.'],
  BAD_NAME: ['Escribe el nombre de la firma.', 'Enter the firm name.'],
  EMPTY_BODY: ['Escribe un mensaje.', 'Write a message.'],
  BODY_TOO_LONG: ['El mensaje es demasiado largo.', 'The message is too long.'],
  RATE_LIMITED: ['Demasiados intentos. Espera un momento.', 'Too many attempts. Wait a moment.'],
}

export function orgErrorText(err, lang = 'es') {
  const pair = ERRORS[err?.code || err?.message]
  if (pair) return lang === 'es' ? pair[0] : pair[1]
  return lang === 'es' ? 'No se pudo completar. Intenta de nuevo.' : 'Could not complete. Try again.'
}
