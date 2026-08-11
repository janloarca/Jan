// Cliente KV compartido (Upstash Redis por REST), sin el SDK `@vercel/kv`.
//
// Por qué existe:
//
//  1. NOMBRES DE VARIABLES. La integración de Vercel expone las credenciales
//     como KV_REST_API_URL/KV_REST_API_TOKEN, pero una base creada del lado de
//     Upstash (o conectada por el Marketplace) puede exponerlas SOLO como
//     UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Los tres consumidores
//     (priceCache, exchange-rates, rateLimit) chequeaban únicamente el primer
//     par, así que con el segundo juego el caché quedaba apagado EN SILENCIO y
//     se comportaba igual que sin base: exactamente la clase de degradación
//     muda que el invariante 5 de "Serie histórica del patrimonio" prohíbe.
//
//  2. `@vercel/kv` está DEPRECADO (avisa en cada `npm install`). La API REST de
//     Upstash es un POST con el comando como array JSON, así que el SDK no
//     aporta nada que valga una dependencia deprecada.
//
// Todo es best-effort por diseño: un fallo del caché nunca puede hacer fallar
// la petición que lo usa. Los errores se loguean y se devuelve null.

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

export function kvConfigured() {
  return !!creds()
}

// 'upstash' | 'none'. Se reporta en las respuestas de las rutas que lo usan
// para que "¿el caché está activo?" se pueda VER, no deducir.
export function kvBackend() {
  return creds() ? 'upstash' : 'none'
}

// Un comando Redis por REST: POST <url> con el comando como array JSON.
// Devuelve `result` crudo, o null ante cualquier problema.
async function command(args, { timeoutMs = 3000 } = {}) {
  const c = creds()
  if (!c) return null
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[kv] ${args[0]} respondió ${res.status}`)
      return null
    }
    const json = await res.json()
    return json?.result ?? null
  } catch (e) {
    console.error(`[kv] ${args[0]} falló:`, e?.message || e)
    return null
  }
}

// Valores JSON: se guardan serializados y se devuelven ya parseados, que es el
// contrato que tenían los callers con el SDK (kv.get/kv.set con objetos).
export async function kvGetJSON(key) {
  const raw = await command(['GET', key])
  if (raw == null) return null
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function kvSetJSON(key, value, ttlSeconds) {
  const args = ['SET', key, JSON.stringify(value)]
  if (ttlSeconds > 0) args.push('EX', String(Math.floor(ttlSeconds)))
  await command(args)
}

// Contador atómico para el rate limit: INCR es atómico entre instancias
// serverless, que es justo por lo que ese caso no puede usar memoria local.
export async function kvIncr(key) {
  const v = await command(['INCR', key])
  return typeof v === 'number' ? v : null
}

export async function kvExpire(key, seconds) {
  await command(['EXPIRE', key, String(Math.floor(seconds))])
}
