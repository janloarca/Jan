const windowMs = 60 * 1000
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

export function rateLimit(request, { maxRequests = 60 } = {}) {
  // Prefer x-real-ip (set by Vercel to the real connecting IP, not client-spoofable).
  // For x-forwarded-for, take the LAST segment: Vercel appends the real client IP,
  // so the leftmost entries can be spoofed by the client but the rightmost cannot.
  const forwarded = request.headers.get('x-forwarded-for')
  const forwardedIp = forwarded ? forwarded.split(',').map(s => s.trim()).filter(Boolean).pop() : null
  const ip = request.headers.get('x-real-ip')
    || forwardedIp
    || 'unknown'
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

  if (data.count > maxRequests) {
    return { limited: true, remaining: 0 }
  }

  return { limited: false, remaining: maxRequests - data.count }
}
