const CACHE_NAME = 'chispudo-v4'
const STATIC_ASSETS = ['/', '/dashboard', '/login']

const API_CACHE_TTL = {
  '/api/exchange-rates': 60 * 60 * 1000,
  '/api/prices': 5 * 60 * 1000,
  '/api/prices/benchmark': 5 * 60 * 1000,
  '/api/prices/chart': 5 * 60 * 1000,
  '/api/prices/dividends': 60 * 60 * 1000,
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

function getApiTTL(url) {
  for (const [path, ttl] of Object.entries(API_CACHE_TTL)) {
    if (url.includes(path)) return ttl
  }
  return 0
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  if (request.url.includes('/api/')) {
    const ttl = getApiTTL(request.url)
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)

        if (cached && ttl > 0) {
          const cachedTime = cached.headers.get('X-SW-Cached')
          if (cachedTime && Date.now() - Number(cachedTime) < ttl) {
            return cached
          }
        }

        try {
          const res = await fetch(request)
          if (res.ok) {
            const headers = new Headers(res.headers)
            headers.set('X-SW-Cached', String(Date.now()))
            const body = await res.clone().arrayBuffer()
            const cachedResponse = new Response(body, {
              status: res.status,
              statusText: res.statusText,
              headers,
            })
            cache.put(request, cachedResponse)
          }
          return res
        } catch {
          return cached || new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      })
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((res) => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        return res
      }).catch(() => cached)
      return cached || fetched
    })
  )
})
