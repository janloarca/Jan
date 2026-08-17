import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import crypto from 'crypto'

// Social layer: friend groups + a YTD-return leaderboard. Like shareTokens, the
// data lives in TOP-LEVEL collections that firestore.rules leaves default-deny,
// so the browser can never read another user's row — every access goes through
// this Admin-SDK route behind verifyAuth. The cardinal privacy rule: only
// percentages and symbols are ever stored/returned — NEVER money amounts.
//
// friendProfiles/{uid}: { uid, displayName, avatar, globalOptIn, pseudonym,
//   stats: { all: {ytd, day, movers[], updatedAt}, ibkr?: {...} }, updatedAt }
// friendGroups/{groupId}: { id, name, ownerUid, inviteCode, scope:'all'|'ibkr',
//   memberUids: string[], createdAt }

const MAX_GROUPS_PER_USER = 20
const MAX_MEMBERS = 30
const MAX_MOVERS = 5
const GLOBAL_SCAN_CAP = 500
const GLOBAL_TOP = 20
// Umbral de la insignia "sincronizado". Tiene que coincidir con el que calcula
// el cliente (app/friends/page.jsx), que es de donde sale syncedPct.
const VERIFIED_MIN_SYNCED = 0.6

// Human-friendly invite codes: no 0/O/1/I/L to avoid transcription errors.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function genCode(len = 7) {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return s
}

const PSEUDO_ADJ = ['Audaz', 'Sereno', 'Veloz', 'Astuto', 'Noble', 'Intrépido', 'Sabio', 'Ágil', 'Valiente', 'Tranquilo']
const PSEUDO_NOUN = ['Quetzal', 'Jaguar', 'Colibrí', 'Tucán', 'Puma', 'Cóndor', 'Ocelote', 'Guacamayo', 'Venado', 'Búho']
function genPseudonym() {
  const a = PSEUDO_ADJ[crypto.randomBytes(1)[0] % PSEUDO_ADJ.length]
  const n = PSEUDO_NOUN[crypto.randomBytes(1)[0] % PSEUDO_NOUN.length]
  const num = crypto.randomBytes(1)[0] % 100
  return `${n} ${a} ${num}`
}

function clampPct(v) {
  const n = Number(v)
  if (!isFinite(n)) return null
  return Math.max(-200, Math.min(200, n))
}

// Server-side re-validation of the stats the client publishes — the client is
// untrusted, so we clamp every number and strip anything amount-shaped.
function sanitizeStatBlock(raw) {
  if (!raw || typeof raw !== 'object') return null
  const movers = Array.isArray(raw.movers)
    ? raw.movers.slice(0, MAX_MOVERS).map((m) => ({
        symbol: String(m?.symbol || '?').slice(0, 12),
        name: String(m?.name || '').slice(0, 40),
        changePct: clampPct(m?.changePct),
        impactPct: isFinite(Number(m?.impactPct)) ? Number(m.impactPct) : 0,
      })).filter((m) => m.changePct != null)
    : []
  return { ytd: clampPct(raw.ytd), mtd: clampPct(raw.mtd), day: clampPct(raw.day), movers, updatedAt: new Date().toISOString() }
}

function statsForScope(profile, scope) {
  const stats = profile?.stats || {}
  return (scope === 'ibkr' && stats.ibkr) ? stats.ibkr : (stats.all || null)
}

async function readGroup(db, groupId) {
  const doc = await db.collection('friendGroups').doc(groupId).get()
  return doc.exists ? { ...doc.data(), id: doc.id } : null
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 40 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { action } = body || {}

  try {
    const profileRef = db.collection('friendProfiles').doc(uid)

    // ---- sync: publish my public stats + display meta ------------------------
    if (action === 'sync') {
      const all = sanitizeStatBlock(body.stats?.all)
      if (!all) return NextResponse.json({ error: 'Missing stats' }, { status: 400 })
      const ibkr = sanitizeStatBlock(body.stats?.ibkr)
      const syncedPct = Math.max(0, Math.min(1, Number(body.syncedPct) || 0))
      const update = {
        uid,
        displayName: String(body.displayName || '').slice(0, 40) || 'Anónimo',
        avatar: String(body.avatar || '').slice(0, 8),
        stats: ibkr ? { all, ibkr } : { all },
        // Soft trust signal: portfolio is mostly broker-synced (not hand-typed).
        // DERIVED from syncedPct, not read from body.verified. For an honest
        // client the result is identical (it computes the same `pct >= 0.6`),
        // but there is no longer a second, independent input to believe: a
        // client could previously claim verified:true while reporting a
        // syncedPct that contradicts it. This does NOT close the hole —
        // syncedPct is still self-reported, so the badge can be self-awarded.
        // Verifying it for real is a separate feature.
        verified: syncedPct >= VERIFIED_MIN_SYNCED,
        syncedPct,
        updatedAt: new Date().toISOString(),
      }
      await profileRef.set(update, { merge: true })
      return NextResponse.json({ ok: true })
    }

    // ---- list: my groups + each group's leaderboard --------------------------
    if (action === 'list') {
      const snap = await db.collection('friendGroups').where('memberUids', 'array-contains', uid).get()
      const groups = []
      for (const gd of snap.docs) {
        const g = { id: gd.id, ...gd.data() }
        const memberUids = Array.isArray(g.memberUids) ? g.memberUids.slice(0, MAX_MEMBERS) : []
        // getAll en vez de N .get() sueltos: con 20 grupos de 30 miembros esto
        // pasaba de 600 lecturas por llamada, y desde que la pantalla tiene
        // jalar-para-refrescar se puede pedir muchas veces seguidas. Esta app ya
        // tocó el techo de cuota de Firestore en producción (FASE IE9).
        // ⚠️ getAll() SIN argumentos lanza (validateMinNumberOfArguments), así
        // que un grupo sin miembros tiene que cortocircuitar.
        const profs = memberUids.length === 0
          ? []
          : await db.getAll(...memberUids.map((m) => db.collection('friendProfiles').doc(m)))
        const rows = profs.filter((p) => p.exists).map((p) => {
          const prof = p.data()
          const st = statsForScope(prof, g.scope) || {}
          return {
            uid: p.id,
            isYou: p.id === uid,
            displayName: prof.displayName || 'Anónimo',
            avatar: prof.avatar || '',
            verified: !!prof.verified,
            ytd: st.ytd ?? null,
            mtd: st.mtd ?? null,
            day: st.day ?? null,
            movers: Array.isArray(st.movers) ? st.movers : [],
            updatedAt: st.updatedAt || prof.updatedAt || null,
          }
        }).sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
        groups.push({
          id: g.id, name: g.name, scope: g.scope || 'all',
          inviteCode: g.inviteCode, isOwner: g.ownerUid === uid,
          memberCount: memberUids.length, rows,
        })
      }
      groups.sort((a, b) => a.name.localeCompare(b.name))
      return NextResponse.json({ groups })
    }

    // ---- create-group --------------------------------------------------------
    if (action === 'create-group') {
      const name = String(body.name || '').slice(0, 40).trim()
      if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
      const scope = body.scope === 'ibkr' ? 'ibkr' : 'all'
      const owned = await db.collection('friendGroups').where('ownerUid', '==', uid).get()
      if (owned.size >= MAX_GROUPS_PER_USER) {
        return NextResponse.json({ error: `Max ${MAX_GROUPS_PER_USER} groups` }, { status: 400 })
      }
      const groupId = crypto.randomBytes(12).toString('hex')
      const inviteCode = genCode()
      const group = { id: groupId, name, ownerUid: uid, inviteCode, scope, memberUids: [uid], createdAt: new Date().toISOString() }
      await db.collection('friendGroups').doc(groupId).set(group)
      return NextResponse.json({ group: { id: groupId, name, scope, inviteCode, isOwner: true, memberCount: 1, rows: [] } })
    }

    // ---- join: enforce the member cap atomically -----------------------------
    if (action === 'join') {
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 })
      const snap = await db.collection('friendGroups').where('inviteCode', '==', code).limit(1).get()
      if (snap.empty) return NextResponse.json({ error: 'Invalid code' }, { status: 404 })
      const groupRef = snap.docs[0].ref
      const result = await db.runTransaction(async (tx) => {
        const doc = await tx.get(groupRef)
        const g = doc.data()
        const members = Array.isArray(g.memberUids) ? g.memberUids : []
        if (members.includes(uid)) return { already: true, id: doc.id }
        if (members.length >= MAX_MEMBERS) return { full: true }
        tx.update(groupRef, { memberUids: [...members, uid] })
        return { id: doc.id }
      })
      if (result.full) return NextResponse.json({ error: 'Group is full' }, { status: 400 })
      return NextResponse.json({ ok: true, groupId: result.id })
    }

    // ---- leave: owner leaving transfers ownership, or deletes if last --------
    if (action === 'leave' || action === 'kick') {
      const groupId = String(body.groupId || '')
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group' }, { status: 404 })
      const target = action === 'kick' ? String(body.uid || '') : uid
      if (action === 'kick' && group.ownerUid !== uid) {
        return NextResponse.json({ error: 'Only the owner can remove members' }, { status: 403 })
      }
      const members = (group.memberUids || []).filter((m) => m !== target)
      const groupRef = db.collection('friendGroups').doc(groupId)
      if (members.length === 0) {
        await groupRef.delete()
      } else {
        const patch = { memberUids: members }
        if (group.ownerUid === target) patch.ownerUid = members[0] // transfer to oldest remaining
        await groupRef.update(patch)
      }
      return NextResponse.json({ ok: true })
    }

    // ---- rename / delete-group (owner only) ----------------------------------
    if (action === 'rename') {
      const groupId = String(body.groupId || '')
      const name = String(body.name || '').slice(0, 40).trim()
      if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group' }, { status: 404 })
      if (group.ownerUid !== uid) return NextResponse.json({ error: 'Only the owner can rename' }, { status: 403 })
      await db.collection('friendGroups').doc(groupId).update({ name })
      return NextResponse.json({ ok: true })
    }
    if (action === 'delete-group') {
      const groupId = String(body.groupId || '')
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group' }, { status: 404 })
      if (group.ownerUid !== uid) return NextResponse.json({ error: 'Only the owner can delete' }, { status: 403 })
      await db.collection('friendGroups').doc(groupId).delete()
      return NextResponse.json({ ok: true })
    }

    // ---- global anonymous leaderboard ---------------------------------------
    if (action === 'global-optin') {
      const on = !!body.on
      const patch = { globalOptIn: on }
      if (on) {
        const cur = await profileRef.get()
        if (!cur.exists) return NextResponse.json({ error: 'Sync your profile first' }, { status: 400 })
        if (!cur.data().pseudonym) patch.pseudonym = String(body.pseudonym || '').slice(0, 30) || genPseudonym()
      }
      await profileRef.set(patch, { merge: true })
      return NextResponse.json({ ok: true, pseudonym: patch.pseudonym })
    }
    if (action === 'global') {
      // Anonymity: return ONLY pseudonym + ytd — never uid, movers, or symbols.
      const snap = await db.collection('friendProfiles').where('globalOptIn', '==', true).limit(GLOBAL_SCAN_CAP).get()
      const all = snap.docs.map((d) => {
        const p = d.data()
        return { uid: d.id, pseudonym: p.pseudonym || 'Anónimo', verified: !!p.verified, ytd: statsForScope(p, 'all')?.ytd ?? null }
      }).filter((r) => r.ytd != null).sort((a, b) => b.ytd - a.ytd)
      const yourRank = all.findIndex((r) => r.uid === uid)
      const top = all.slice(0, GLOBAL_TOP).map((r, i) => ({ rank: i + 1, pseudonym: r.pseudonym, verified: r.verified, ytd: r.ytd, isYou: r.uid === uid }))
      // `optedIn` sale del PROPIO documento, no se deduce del ranking. El
      // cliente lo deducía de `yourRank != null`, y `yourRank` se calcula sobre
      // una lista ya filtrada por `ytd != null`: alguien que SÍ está apuntado
      // pero todavía no tiene YTD quedaba fuera, y el botón le decía
      // "Participar" cuando ya participaba. Es un booleano sobre uno mismo, así
      // que no abre ninguna ventana a los datos de nadie más.
      const mine = await profileRef.get()
      return NextResponse.json({
        top,
        yourRank: yourRank >= 0 ? yourRank + 1 : null,
        total: all.length,
        optedIn: mine.exists ? !!mine.data().globalOptIn : false,
      })
    }

    // ---- disable: purge my public presence -----------------------------------
    if (action === 'disable') {
      const snap = await db.collection('friendGroups').where('memberUids', 'array-contains', uid).get()
      await Promise.all(snap.docs.map(async (gd) => {
        const g = gd.data()
        const members = (g.memberUids || []).filter((m) => m !== uid)
        if (members.length === 0) return gd.ref.delete()
        const patch = { memberUids: members }
        if (g.ownerUid === uid) patch.ownerUid = members[0]
        return gd.ref.update(patch)
      }))
      await profileRef.delete().catch(() => {})
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    console.error('[api/friends] error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
