// Ingest tokens: the credential the iPhone Shortcut and the forwarded-email
// address both carry. Server-only (Admin SDK).
//
// Why not a Firebase ID token? Neither transport can run a Firebase login: the
// Shortcuts app can only attach a static header, and an email carries nothing at
// all. So we mint an opaque long-lived token per device, exactly like the
// read-only share links do, and resolve it server-side.
//
// Storage mirrors app/api/share/route.js:
//   ingestTokens/{token}          → { uid, label, createdAt, ... }  (top-level,
//                                    unreachable from the browser: firestore.rules
//                                    is default-deny outside users/{uid}/**)
//   users/{uid}/settings/ingest   → { tokens: [...], rules: [...] } (what the
//                                    Settings UI lists)
//
// The token doubles as the email plus-address label, so ONE credential covers
// both paths: gastos+<token>@yourdomain.

import crypto from 'crypto'

export const MAX_TOKENS = 5
export const TOKEN_RE = /^[a-f0-9]{32}$/

function ingestRef(db, uid) {
  return db.doc(`users/${uid}/settings/ingest`)
}

export async function readIngestDoc(db, uid) {
  const snap = await ingestRef(db, uid).get()
  const data = snap.exists ? snap.data() : {}
  return {
    tokens: Array.isArray(data.tokens) ? data.tokens : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
  }
}

export async function createIngestToken(db, uid, label) {
  const { tokens, rules } = await readIngestDoc(db, uid)
  if (tokens.length >= MAX_TOKENS) {
    return { error: `Max ${MAX_TOKENS} tokens` }
  }
  const token = crypto.randomBytes(16).toString('hex')
  const entry = {
    token,
    label: String(label || '').slice(0, 40).trim() || 'iPhone',
    createdAt: new Date().toISOString(),
  }
  await db.collection('ingestTokens').doc(token).set({ uid, ...entry })
  await ingestRef(db, uid).set({ tokens: [...tokens, entry], rules, uid, updatedAt: entry.createdAt }, { merge: true })
  return { entry }
}

export async function revokeIngestToken(db, uid, token) {
  if (!TOKEN_RE.test(String(token || ''))) return { error: 'Invalid token' }
  const { tokens, rules } = await readIngestDoc(db, uid)
  if (!tokens.some((t) => t.token === token)) return { error: 'Unknown token' }
  await db.collection('ingestTokens').doc(token).delete()
  await ingestRef(db, uid).set(
    { tokens: tokens.filter((t) => t.token !== token), rules, uid, updatedAt: new Date().toISOString() },
    { merge: true }
  )
  return { ok: true }
}

// token → { uid, label } or null. Also stamps usage so a token that stopped
// working is diagnosable from the Settings list.
export async function resolveIngestToken(db, token, { touch = true } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) return null
  const snap = await db.collection('ingestTokens').doc(token).get()
  if (!snap.exists) return null
  const data = snap.data()
  if (!data?.uid) return null
  if (touch) {
    snap.ref.set({ lastUsedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
  }
  return { uid: data.uid, label: data.label || null }
}

// Category rules the user taught us, read on every ingest.
export async function readUserRules(db, uid) {
  const { rules } = await readIngestDoc(db, uid)
  return rules
}
