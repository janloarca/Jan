// Last-known-good cache for price data, mirroring the fx:last-good pattern in
// app/api/exchange-rates: KV-backed when configured (shared across serverless
// instances, 7-day expiry), with an in-memory Map fallback so dev and KV-less
// deploys still get per-instance staleness protection. Best-effort by design —
// a cache failure must never fail the request.
//
// Usage in a price route:
//   after a successful upstream fetch:  saveLastGood(`px:${symbol}`, data)
//   on total upstream failure:          const stale = await getLastGood(`px:${symbol}`)
// Stale payloads come back as { data, asOf } so callers can mark `stale: true`.

const memory = new Map()
const MAX_MEMORY_ENTRIES = 500
const EXPIRY_MS = 7 * 86400 * 1000

const kvConfigured = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

export async function saveLastGood(key, data) {
  const entry = { data, asOf: new Date().toISOString() }
  // In-memory always (covers warm instances even without KV)
  memory.set(key, entry)
  if (memory.size > MAX_MEMORY_ENTRIES) {
    const first = memory.keys().next().value
    memory.delete(first)
  }
  if (!kvConfigured()) return
  try {
    const { kv } = await import('@vercel/kv')
    // Fire-and-forget semantics at the call sites; awaited here for error capture.
    await kv.set(`lastgood:${key}`, entry, { ex: 7 * 86400 })
  } catch (e) {
    console.error('[priceCache] KV write failed:', e.message)
  }
}

export async function getLastGood(key) {
  const mem = memory.get(key)
  if (mem && Date.now() - new Date(mem.asOf).getTime() < EXPIRY_MS) return mem
  if (!kvConfigured()) return null
  try {
    const { kv } = await import('@vercel/kv')
    const entry = await kv.get(`lastgood:${key}`)
    return entry || null
  } catch (e) {
    console.error('[priceCache] KV read failed:', e.message)
    return null
  }
}

// Test hook: clears the in-memory layer.
export function _clearMemory() {
  memory.clear()
}
