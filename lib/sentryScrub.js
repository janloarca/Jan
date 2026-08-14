// Qué NO puede salir de la app hacia Sentry.
//
// Esto es una app de dinero: los reportes de error van a un tercero, así que la
// pregunta no es "¿qué mandamos?" sino "¿qué estamos seguros de NO mandar?".
// Puro y con tests a propósito: es la última línea antes de que algo salga.
//
// Lo que sí viaja, y es todo lo que necesitamos para arreglar: el error con su
// nombre real, archivo y línea, el build, la pantalla, y el UID del usuario
// (que es el mismo identificador que ya usamos para encontrarlo en Firestore).
// Sin correo, sin nombre, sin montos, sin credenciales.

// Nombres de parámetro que jamás deben viajar con su valor. `t` es el Flex
// Token de IBKR: la URL del servicio de IBKR lo lleva en claro como ?t=...
const SECRET_PARAMS = /^(t|token|secret|password|passwd|pwd|auth|authorization|key|apikey|api_key|access_token|id_token|refresh_token|flextoken)$/i

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi
// Un JWT suelto (los tokens de Firebase viajan así) en cualquier texto.
const JWT_RE = /\beyJ[A-Za-z0-9._-]{20,}/g

export const REDACTED = '[redactado]'

// Limpia una URL conservando su forma (host y ruta sirven para diagnosticar;
// los valores secretos no).
export function scrubUrl(url) {
  if (typeof url !== 'string' || !url) return url
  const [base, query] = url.split('?')
  if (!query) return scrubText(base)
  const cleaned = query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    if (eq < 0) return pair
    const name = pair.slice(0, eq)
    return SECRET_PARAMS.test(name) ? `${name}=${REDACTED}` : pair
  }).join('&')
  return `${scrubText(base)}?${cleaned}`
}

// Limpia texto libre: mensajes de error, breadcrumbs, cualquier cadena.
export function scrubText(text) {
  if (typeof text !== 'string' || !text) return text
  return text
    .replace(BEARER_RE, (m) => `${m.split(/\s+/)[0]} ${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
}

// Recorre un objeto arbitrario aplicando la limpieza a toda cadena, con tope de
// profundidad para no colgarse con estructuras cíclicas o enormes.
function scrubDeep(value, depth = 0) {
  if (depth > 6) return value
  if (typeof value === 'string') return scrubText(value)
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_PARAMS.test(k)) { out[k] = REDACTED; continue }
      out[k] = (k === 'url' && typeof v === 'string') ? scrubUrl(v) : scrubDeep(v, depth + 1)
    }
    return out
  }
  return value
}

// El gancho que Sentry llama justo antes de enviar. Devolver null descarta el
// evento por completo.
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event

  // El usuario viaja SOLO como id. Sentry puede adjuntar ip y correo por su
  // cuenta; acá se recorta a lo mínimo que sirve para encontrarlo en Firestore.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined
  }

  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url)
    // Un cuerpo de petición puede llevar el token de IBKR o datos del
    // portafolio: no hay ningún caso donde lo necesitemos para diagnosticar.
    delete event.request.data
    delete event.request.cookies
    if (event.request.headers) delete event.request.headers
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubDeep(b))
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((v) => ({
      ...v,
      value: scrubText(v.value),
    }))
  }

  if (event.message) event.message = scrubText(event.message)
  if (event.extra) event.extra = scrubDeep(event.extra)

  return event
}
