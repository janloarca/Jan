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
// both paths: <mailbox>+<token>@yourdomain. The local part is irrelevant to
// matching on purpose, which is what lets the ingest mailbox be one that
// already exists (today the same one that sends the reminder emails).

import crypto from 'crypto'

export const MAX_TOKENS = 5
export const TOKEN_RE = /^[a-f0-9]{32}$/

// Chained collection()/doc() form, matching every other Admin SDK call in this
// repo (see app/api/share/route.js) — not the equivalent single-string
// db.doc('a/b/c/d') form, so this can never be the one call in the codebase
// that's syntactically different from the rest.
function ingestRef(db, uid) {
  return db.collection('users').doc(uid).collection('settings').doc('ingest')
}

// OJO: esta es la lectura CRUDA, y es la correcta para todo caller que después
// vuelva a ESCRIBIR la lista de tokens (learn/forget). Usar la versión con
// historial de uso ahí persistiría lastUsedAt/lastResult dentro del doc del
// usuario como una segunda copia que se queda vieja al instante.
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

// Cómo TERMINÓ el último intento de este token.
//
// `lastUsedAt` por sí solo dice que el atajo llegó, no si sirvió. Y esa es
// justamente la pregunta que no se puede contestar desde afuera: un gasto que no
// aparece puede ser que la automatización nunca disparó, que disparó y el
// servidor lo rechazó, o que disparó y era duplicado. Las tres se ven idénticas.
//
// Best-effort SIEMPRE: esto es telemetría de diagnóstico, y un fallo acá jamás
// puede tumbar el registro de un gasto real.
// El transporte por el que llegó. Lista cerrada: es una llave de documento.
const TRANSPORTS = ['shortcut', 'email', 'android']

export async function stampIngestResult(db, token, result, source = null) {
  if (!TOKEN_RE.test(String(token || ''))) return
  const at = new Date().toISOString()
  const clean = String(result || '').slice(0, 40) || null
  const via = TRANSPORTS.includes(source) ? source : null
  try {
    await db.collection('ingestTokens').doc(token).set({
      lastResult: clean,
      lastResultAt: at,
      lastSource: via,
      // Y ADEMÁS por transporte, que es lo que de verdad hacía falta.
      //
      // Con un solo par de campos, el atajo (que dispara con cada compra) pisa
      // el rastro del correo el mismo día, así que "el camino de correo nunca
      // ha entregado nada" y "entregó y después el atajo lo tapó" se ven
      // idénticos. Y esa es justo la pregunta que hay que poder contestar
      // cuando alguien acaba de configurar el reenvío.
      //
      // Firestore fusiona un mapa anidado campo a campo, así que esto solo
      // toca la rama de SU transporte y deja las otras intactas.
      ...(via ? { usage: { [via]: { at, result: clean } } } : {}),
    }, { merge: true })
  } catch {
    // Ignorado a propósito.
  }
}

// Los tokens del usuario CON su historial de uso.
//
// El uso vive en los docs de nivel superior (`ingestTokens/{token}`) y la lista
// que ve el usuario vive en su propio doc, así que hasta ahora el dato se
// escribía y nadie lo leía: el comentario de arriba decía "diagnosable desde la
// lista de Settings" y la lista nunca lo mostró.
//
// Los tokens están topeados en MAX_TOKENS (5), así que son 5 lecturas como
// máximo. getAll() SIN argumentos lanza, de ahí la guarda.
export async function listIngestTokensWithUsage(db, uid) {
  const { tokens, rules } = await readIngestDoc(db, uid)
  if (!tokens.length) return { tokens, rules }
  try {
    const refs = tokens.map((t) => db.collection('ingestTokens').doc(t.token))
    const snaps = await db.getAll(...refs)
    const usage = new Map()
    for (const snap of snaps) {
      if (snap.exists) usage.set(snap.id, snap.data())
    }
    return {
      tokens: tokens.map((t) => {
        const u = usage.get(t.token) || {}
        return {
          ...t,
          lastUsedAt: u.lastUsedAt || null,
          lastResult: u.lastResult || null,
          lastResultAt: u.lastResultAt || null,
          lastSource: u.lastSource || null,
          // Por transporte: sin esto no se puede contestar "¿el correo ha
          // entregado alguna vez?" en un token que el atajo usa a diario.
          usage: u.usage && typeof u.usage === 'object' ? u.usage : null,
        }
      }),
      rules,
    }
  } catch {
    // Sin el historial la lista sigue sirviendo: se degrada a lo de siempre.
    return { tokens, rules }
  }
}

// Category rules the user taught us, read on every ingest.
export async function readUserRules(db, uid) {
  const { rules } = await readIngestDoc(db, uid)
  return rules
}

// La moneda base del usuario. La necesita el camino de correo para decidir qué
// significa un '$' suelto en una alerta: en México, Colombia, Chile, Argentina y
// Uruguay ese símbolo es el peso local, y leerlo como dólar multiplica el cobro
// por el tipo de cambio. La respuesta no está en la alerta, está en quién la
// recibe.
//
// Best-effort: si el documento no se puede leer, el caller cae a su propio
// valor por omisión en vez de fallar el ingreso de un gasto real.
export async function readUserBaseCurrency(db, uid) {
  try {
    const snap = await db.doc(`users/${uid}/settings/preferences`).get()
    const code = snap.exists ? snap.data()?.baseCurrency : null
    return typeof code === 'string' && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null
  } catch {
    return null
  }
}
