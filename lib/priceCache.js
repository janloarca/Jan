import { kvConfigured, kvGetJSON, kvSetJSON, kvBackend } from './kvClient'

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

// FASE HS: credenciales y transporte en lib/kvClient.js (acepta los DOS juegos
// de nombres de variables y no usa el SDK deprecado).

export async function saveLastGood(key, data) {
  const entry = { data, asOf: new Date().toISOString() }
  // In-memory always (covers warm instances even without KV)
  memory.set(key, entry)
  if (memory.size > MAX_MEMORY_ENTRIES) {
    const first = memory.keys().next().value
    memory.delete(first)
  }
  if (!kvConfigured()) return
  await kvSetJSON(`lastgood:${key}`, entry, 7 * 86400)
}

export async function getLastGood(key) {
  const mem = memory.get(key)
  if (mem && Date.now() - new Date(mem.asOf).getTime() < EXPIRY_MS) return mem
  if (!kvConfigured()) return null
  return (await kvGetJSON(`lastgood:${key}`)) || null
}

// Test hook: clears the in-memory layer.
export function _clearMemory() {
  memory.clear()
}

// Re-export para que las rutas puedan REPORTAR si el caché está activo.
export { kvBackend }
