const windowMs = 60 * 1000
const windowSec = 60

// In-memory fallback store (used when Vercel KV / Upstash is not configured, e.g.
// local dev). On serverless this is per-instance and resets on cold start, which is
// exactly why the shared KV path below is preferred in production.
const store = new Map()
const MAX_STORE_SIZE = 10000

setInterval(() => {
  const now = Date.now()
  for (const [key, data] of store) {
    if (now - data.windowStart > windowMs * 2) {
      store.delete(key)
    }
  }
}, 60 * 1000)

function clientIp(request) {
  // Prefer x-real-ip (set by Vercel to the real connecting IP, not client-spoofable).
  // For x-forwarded-for, take the LAST segment: Vercel appends the real client IP,
  // so the leftmost entries can be spoofed by the client but the rightmost cannot.
  const forwarded = request.headers.get('x-forwarded-for')
  const forwardedIp = forwarded ? forwarded.split(',').map(s => s.trim()).filter(Boolean).pop() : null
  return request.headers.get('x-real-ip') || forwardedIp || 'unknown'
}

function limitInMemory(ip, maxRequests) {
  const now = Date.now()
  if (store.size > MAX_STORE_SIZE) {
    const oldest = store.keys().next().value
    store.delete(oldest)
  }
  let data = store.get(ip)
  if (!data || now - data.windowStart > windowMs) {
    data = { windowStart: now, count: 0 }
  }
  store.delete(ip)
  store.set(ip, data)
  data.count++
  if (data.count > maxRequests) return { limited: true, remaining: 0 }
  return { limited: false, remaining: maxRequests - data.count }
}

const kvConfigured = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

// Shared, atomic fixed-window counter backed by Vercel KV (Upstash Redis). The key
// embeds the current window bucket so it expires on its own; INCR is atomic across
// serverless instances, so cold starts / instance rotation can't reset the count.
async function limitKV(ip, maxRequests) {
  const { kv } = await import('@vercel/kv')
  const bucket = Math.floor(Date.now() / windowMs)
  const key = `rl:${ip}:${bucket}`
  const count = await kv.incr(key)
  if (count === 1) await kv.expire(key, windowSec)
  if (count > maxRequests) return { limited: true, remaining: 0 }
  return { limited: false, remaining: maxRequests - count }
}

// One-time confirmation per cold start so "is KV actually being used?" is
// answerable from the Vercel runtime logs.
let kvAnnounced = false

export async function rateLimit(request, { maxRequests = 60 } = {}) {
  const ip = clientIp(request)
  if (kvConfigured()) {
    try {
      const result = await limitKV(ip, maxRequests)
      if (!kvAnnounced) {
        kvAnnounced = true
        console.log('[rateLimit] Vercel KV activo — rate limiting compartido entre instancias')
      }
      return result
    } catch (err) {
      // KV unavailable → don't break the route; fall back to per-instance limiting.
      console.error('[rateLimit] KV error, falling back to in-memory:', err?.message)
    }
  }
  return limitInMemory(ip, maxRequests)
}
