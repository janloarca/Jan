const ALGO = 'AES-GCM'
const SALT_PREFIX = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CRYPTO_SALT
  ? process.env.NEXT_PUBLIC_CRYPTO_SALT
  : 'chispudo-default-v2'

const PBKDF2_ITERATIONS = 600000
const PBKDF2_LEGACY_ITERATIONS = 100000

async function deriveKeyWith(material, iterations) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('chispudo-ibkr-v1'), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function deriveKey(uid) {
  return deriveKeyWith(`${uid}:${SALT_PREFIX}`, PBKDF2_ITERATIONS)
}

// Server-only master key: mixes a secret that never reaches the client
// (process.env.CRYPTO_MASTER_KEY, NOT NEXT_PUBLIC_*) into the key material, so the
// stored ciphertext can't be decrypted from the uid + public salt alone (i.e. by a
// DB breach). Returns null on the client / when unset → falls back to deriveKey,
// keeping behavior identical to before this change.
function masterSecret() {
  return (typeof process !== 'undefined' && process.env?.CRYPTO_MASTER_KEY) || null
}

function deriveMasterKey(uid) {
  return deriveKeyWith(`${uid}:${SALT_PREFIX}:${masterSecret()}`, PBKDF2_ITERATIONS)
}

function deriveLegacyKey(uid) {
  return deriveKeyWith(`${uid}:${SALT_PREFIX}`, PBKDF2_LEGACY_ITERATIONS)
}

function deriveV1Key(uid) {
  return deriveKeyWith(uid, PBKDF2_LEGACY_ITERATIONS)
}

export async function encryptToken(plaintext, uid) {
  if (!plaintext || !uid) throw new Error('encryptToken requires plaintext and uid')
  // Prefer the server-only master key when available; otherwise behave exactly as
  // before (deriveKey). Decryption tries the master key too, so this is forward- and
  // backward-compatible.
  const key = masterSecret() ? await deriveMasterKey(uid) : await deriveKey(uid)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, enc.encode(plaintext))
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return 'enc:' + btoa(String.fromCharCode(...combined))
}

export async function decryptToken(stored, uid) {
  if (!stored || !uid || !stored.startsWith('enc:')) return stored
  let raw
  try {
    raw = Uint8Array.from(atob(stored.slice(4)), c => c.charCodeAt(0))
  } catch {
    return stored
  }
  const iv = raw.slice(0, 12)
  const ciphertext = raw.slice(12)
  // Try the master key first (server, when configured), then the legacy public-salt
  // keys so tokens saved before the master key still decrypt (no lockout).
  const keyFns = masterSecret()
    ? [deriveMasterKey, deriveKey, deriveLegacyKey, deriveV1Key]
    : [deriveKey, deriveLegacyKey, deriveV1Key]
  for (const fn of keyFns) {
    try {
      const key = await fn(uid)
      const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext)
      return new TextDecoder().decode(decrypted)
    } catch {}
  }
  throw new Error('Failed to decrypt token: credentials may need to be re-saved')
}
