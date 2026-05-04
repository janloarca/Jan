const windowMs = 60 * 1000
const store = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, data] of store) {
    if (now - data.windowStart > windowMs * 2) {
      store.delete(key)
    }
  }
}, 60 * 1000)

export function rateLimit(request, { maxRequests = 60 } = {}) {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown'
  const now = Date.now()

  let data = store.get(ip)
  if (!data || now - data.windowStart > windowMs) {
    data = { windowStart: now, count: 0 }
    store.set(ip, data)
  }

  data.count++

  if (data.count > maxRequests) {
    return { limited: true, remaining: 0 }
  }

  return { limited: false, remaining: maxRequests - data.count }
}
