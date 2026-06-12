const ALGO = 'AES-GCM'
const SALT_PREFIX = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CRYPTO_SALT
  ? process.env.NEXT_PUBLIC_CRYPTO_SALT
  : 'chispudo-default-v2'

async function deriveKeyFrom(material) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('chispudo-ibkr-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function deriveKey(uid) {
  return deriveKeyFrom(`${uid}:${SALT_PREFIX}`)
}

// Tokens stored before the salt prefix was added used the uid alone
function deriveLegacyKey(uid) {
  return deriveKeyFrom(uid)
}

export async function encryptToken(plaintext, uid) {
  if (!plaintext || !uid) throw new Error('encryptToken requires plaintext and uid')
  const key = await deriveKey(uid)
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
  try {
    const key = await deriveKey(uid)
    const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext)
    return new TextDecoder().decode(decrypted)
  } catch {
    try {
      const legacyKey = await deriveLegacyKey(uid)
      const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, legacyKey, ciphertext)
      return new TextDecoder().decode(decrypted)
    } catch {
      return stored
    }
  }
}
