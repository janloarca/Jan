import { kvConfigured, kvIncr, kvExpire } from './kvClient'
const windowMs = 60 * 1000
const windowSec = 60

// In-memory fallback store (used when Vercel KV / Upstash is not configured, e.g.
// local dev). On serverless this is per-instance and resets on cold start, which is
// exactly why the shared KV path below is preferred in production.
const store = new Map()
const MAX_STORE_SIZE = 10000

const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [key, data] of store) {
    if (now - data.windowStart > windowMs * 2) {
      store.delete(key)
    }
  }
}, 60 * 1000)
// En Node el interval mantendría vivo el proceso (p.ej. un test que importa
// este módulo directo); unref lo suelta. En bundle de navegador setInterval
// devuelve un número sin unref y el optional call lo salta.
sweeper.unref?.()

function clientIp(request) {
  // Prefer x-real-ip (set by Vercel to the real connecting IP, not client-spoofable).
  // For x-forwarded-for, take the LAST segment: Vercel appends the real client IP,
  // so the leftmost entries can be spoofed by the client but the rightmost cannot.
  const forwarded = request.headers.get('x-forwarded-for')
  const forwardedIp = forwarded ? forwarded.split(',').map(s => s.trim()).filter(Boolean).pop() : null
  return request.headers.get('x-real-ip') || forwardedIp || 'unknown'
}

function limitInMemory(key, maxRequests) {
  const now = Date.now()
  if (store.size > MAX_STORE_SIZE) {
    const oldest = store.keys().next().value
    store.delete(oldest)
  }
  let data = store.get(key)
  if (!data || now - data.windowStart > windowMs) {
    data = { windowStart: now, count: 0 }
  }
  store.delete(key)
  store.set(key, data)
  data.count++
  if (data.count > maxRequests) return { limited: true, remaining: 0 }
  return { limited: false, remaining: maxRequests - data.count }
}

// FASE HS: ver lib/kvClient.js (dos juegos de nombres, sin SDK deprecado).

// Shared, atomic fixed-window counter backed by Vercel KV (Upstash Redis). The key
// embeds the current window bucket so it expires on its own; INCR is atomic across
// serverless instances, so cold starts / instance rotation can't reset the count.
async function limitKV(scopedIp, maxRequests) {
  const bucket = Math.floor(Date.now() / windowMs)
  const key = `rl:${scopedIp}:${bucket}`
  const count = await kvIncr(key)
  // Sin respuesta del contador compartido no se puede afirmar nada atómico:
  // se cae al contador en memoria del caller (el catch de rateLimit).
  if (count == null) throw new Error('KV incr sin respuesta')
  if (count === 1) await kvExpire(key, windowSec)
  if (count > maxRequests) return { limited: true, remaining: 0 }
  return { limited: false, remaining: maxRequests - count }
}

// One-time confirmation per cold start so "is KV actually being used?" is
// answerable from the Vercel runtime logs.
let kvAnnounced = false

// FASE IE2. El contador es POR RUTA + IP, nunca por IP a secas. Antes las ~30
// rutas que llaman rateLimit compartían UN contador por IP y cada una aplicaba
// SU tope al tráfico de todas las demás: con el dashboard abierto (precios +
// tasas + benchmark + historial superan 5 req/min sin esfuerzo), cualquier
// ruta con tope bajo quedaba en 429 permanente sin que el usuario la tocara
// (el botón "Enviarme una prueba", tope 5, reporte real con captura). El tope
// que cada ruta declara solo puede significar "de ESTA ruta".
function scopeFor(request) {
  try {
    return new URL(request.url).pathname
  } catch {
    return 'global'
  }
}

export async function rateLimit(request, { maxRequests = 60 } = {}) {
  const ip = `${scopeFor(request)}:${clientIp(request)}`
  if (kvConfigured()) {
    try {
      const result = await limitKV(ip, maxRequests)
      if (!kvAnnounced) {
        kvAnnounced = true
        console.log('[rateLimit] Vercel KV activo: rate limiting compartido entre instancias')
      }
      return result
    } catch (err) {
      // KV unavailable → don't break the route; fall back to per-instance limiting.
      console.error('[rateLimit] KV error, falling back to in-memory:', err?.message)
    }
  }
  return limitInMemory(ip, maxRequests)
}
