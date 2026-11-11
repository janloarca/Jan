// Modo institucional, Fase 1: TODA escritura de organizaciones, vínculos,
// grants, mensajes, notas y auditoría pasa por aquí (Admin SDK, detrás de
// verifyAuth). Las reglas de Firestore niegan esas escrituras al navegador.
//
// Mapa de colecciones (el PR lo documenta):
//   organizations/{orgId}                       firma
//   organizations/{orgId}/memberships/{uid}     admin | advisor | assistant
//   organizations/{orgId}/notes/{noteId}        notas internas o compartidas
//   clientLinks/{orgId}_{clientUid}             vínculo firma <-> cliente
//   clientLinks/inv_{hash}                      invitación de cliente pendiente
//   inviteTokens/{sha256(token)}                estado del token de un solo uso
//   users/{clientUid}/grants/{orgId}            lo que el cliente concedió a esa firma
//   users/{clientUid}/advisorAccess/{advisorUid}  espejo por asesor que leen las reglas
//   users/{uid}/orgMemberships/{orgId}          espejo de membresías (enciende la UI)
//   threads/{linkId}/messages/{msgId}           hilo; sin delete
//   auditLog/{eventId}                          append-only
//
// Las funciones reciben `ctx` con sus dependencias inyectadas (db, reloj,
// generador de tokens, envío de correo) para poder probarlas sin red.
import {
  SCOPES, DEFAULT_SCOPES, CONSENT_VERSION, INVITE_TTL_MS, VIEW_SCREENS, SCREEN_SCOPE, MAX_BODY, ACTIVITY_LIMIT,
  linkIdFor, sanitizeScopes, isValidRole, canSeeClients, normalizeEmail, isValidEmail, slugify,
  inviteState, accessFromGrants, shouldLogView, auditDocId, isClientVisibleActivity,
  bookRow, bookTotals, sortByNoContact, messagesCsv,
} from './model'
import { memberInviteEmail, clientInviteEmail, newMessageEmail } from './emails'

export class OrgError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))]
const iso = (ctx) => new Date(ctx.now()).toISOString()

function auditRef(ctx) {
  return ctx.db.doc(`auditLog/${auditDocId(ctx.now(), ctx.rand())}`)
}

function auditEvent(ctx, ev) {
  const clean = { at: iso(ctx), actorUid: ctx.uid, ...ev }
  Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k])
  return clean
}

async function sendMail(ctx, to, mail) {
  if (!to || !ctx.sendEmail) return false
  try { return (await ctx.sendEmail(to, mail)) !== false } catch (e) { console.error('[org] email failed:', e?.message); return false }
}

async function membershipOf(db, orgId, uid) {
  if (!orgId || !uid) return null
  const snap = await db.doc(`organizations/${orgId}/memberships/${uid}`).get()
  const m = snap.exists ? snap.data() : null
  return m && m.status === 'active' ? m : null
}

async function requireMember(ctx, orgId, roles) {
  if (typeof orgId !== 'string' || !orgId) throw new OrgError('BAD_ORG')
  const m = await membershipOf(ctx.db, orgId, ctx.uid)
  if (!m || (roles && !roles.includes(m.role))) throw new OrgError('FORBIDDEN', 403)
  return m
}

async function activeAdminUids(reader, db, orgId) {
  const q = db.collection(`organizations/${orgId}/memberships`).where('role', '==', 'admin')
  const snap = reader ? await reader.get(q) : await q.get()
  return snap.docs.filter((d) => d.data().status === 'active').map((d) => d.id)
}

// Reescribe el espejo por asesor a partir de los grants del cliente tal como
// QUEDAN después de la operación. Va dentro de la misma transacción que el
// vínculo y el grant: revocar no puede dejar un espejo vivo.
function syncAccess(tx, ctx, clientUid, grantsAfter, affectedUids) {
  const map = accessFromGrants(grantsAfter)
  for (const uid of uniq([...affectedUids, ...map.keys()])) {
    const ref = ctx.db.doc(`users/${clientUid}/advisorAccess/${uid}`)
    const a = map.get(uid)
    if (a) tx.set(ref, { status: 'active', scopes: a.scopes, orgIds: a.orgIds, updatedAt: iso(ctx) })
    else tx.delete(ref)
  }
}

async function grantsOf(tx, ctx, clientUid) {
  const snap = await tx.get(ctx.db.collection(`users/${clientUid}/grants`))
  return snap.docs.map((d) => ({ ...d.data(), orgId: d.id }))
}

// ── Organización y equipo ──────────────────────────────────────────────────

export async function createOrg(ctx, { name, locale } = {}) {
  const clean = String(name || '').trim().slice(0, 80)
  if (clean.length < 2) throw new OrgError('BAD_NAME')
  const orgId = `${slugify(clean)}-${ctx.rand().slice(0, 6)}`
  const now = iso(ctx)
  const batch = ctx.db.batch()
  batch.set(ctx.db.doc(`organizations/${orgId}`), {
    name: clean, slug: slugify(clean), createdAt: now, createdBy: ctx.uid,
    locale: locale === 'en' ? 'en' : 'es', status: 'active',
  })
  batch.set(ctx.db.doc(`organizations/${orgId}/memberships/${ctx.uid}`), {
    role: 'admin', status: 'active', invitedBy: ctx.uid, invitedEmail: ctx.email || '',
    email: ctx.email || '', name: ctx.name || '', createdAt: now, updatedAt: now,
  })
  batch.set(ctx.db.doc(`users/${ctx.uid}/orgMemberships/${orgId}`), { orgId, orgName: clean, role: 'admin', status: 'active', updatedAt: now })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: 'admin', orgId, action: 'org.create', meta: { name: clean } }))
  await batch.commit()
  return { orgId, name: clean }
}

export async function getOrg(ctx, { orgId } = {}) {
  const me = await requireMember(ctx, orgId)
  const [orgSnap, memSnap] = await Promise.all([
    ctx.db.doc(`organizations/${orgId}`).get(),
    ctx.db.collection(`organizations/${orgId}/memberships`).get(),
  ])
  if (!orgSnap.exists) throw new OrgError('NOT_FOUND', 404)
  const nowMs = ctx.now()
  const members = memSnap.docs.map((d) => {
    const m = d.data()
    const expired = m.status === 'invited' && Date.parse(m.inviteExpiresAt || '') < nowMs
    return { id: d.id, role: m.role, status: expired ? 'expired' : m.status, email: m.email || m.invitedEmail || '', name: m.name || '' }
  }).filter((m) => m.status !== 'removed')
  return { org: { id: orgId, ...orgSnap.data() }, role: me.role, members }
}

export async function inviteMember(ctx, { orgId, email, role } = {}) {
  await requireMember(ctx, orgId, ['admin'])
  const to = normalizeEmail(email)
  if (!isValidEmail(to)) throw new OrgError('BAD_EMAIL')
  if (!isValidRole(role)) throw new OrgError('BAD_ROLE')
  const orgSnap = await ctx.db.doc(`organizations/${orgId}`).get()
  const orgName = orgSnap.data()?.name || ''
  const token = ctx.token()
  const hash = ctx.hash(token)
  const now = iso(ctx)
  const expiresAt = new Date(ctx.now() + INVITE_TTL_MS).toISOString()
  const batch = ctx.db.batch()
  batch.set(ctx.db.doc(`inviteTokens/${hash}`), {
    kind: 'member', orgId, orgName, email: to, role, status: 'invited', expiresAt, createdAt: now, createdBy: ctx.uid,
  })
  batch.set(ctx.db.doc(`organizations/${orgId}/memberships/inv_${hash.slice(0, 20)}`), {
    role, status: 'invited', invitedBy: ctx.uid, invitedEmail: to, inviteTokenHash: hash, inviteExpiresAt: expiresAt, createdAt: now, updatedAt: now,
  })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: 'admin', orgId, action: 'member.invite', target: to, meta: { role } }))
  await batch.commit()
  const emailSent = await sendMail(ctx, to, memberInviteEmail({ orgName, inviterName: ctx.name, role, token }))
  return { ok: true, emailSent }
}

export async function removeMember(ctx, { orgId, memberId } = {}) {
  await requireMember(ctx, orgId, ['admin'])
  if (typeof memberId !== 'string' || !memberId) throw new OrgError('BAD_MEMBER')
  const ref = ctx.db.doc(`organizations/${orgId}/memberships/${memberId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new OrgError('NOT_FOUND', 404)
  const m = snap.data()
  const now = iso(ctx)
  if (m.status === 'invited') {
    const batch = ctx.db.batch()
    batch.delete(ref)
    if (m.inviteTokenHash) batch.set(ctx.db.doc(`inviteTokens/${m.inviteTokenHash}`), { status: 'revoked', updatedAt: now }, { merge: true })
    batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: 'admin', orgId, action: 'member.remove', target: m.invitedEmail || memberId, meta: { pending: true } }))
    await batch.commit()
    return { ok: true }
  }
  if (memberId === ctx.uid) {
    const admins = await activeAdminUids(null, ctx.db, orgId)
    if (admins.filter((u) => u !== ctx.uid).length === 0) throw new OrgError('LAST_ADMIN')
  }
  const batch = ctx.db.batch()
  batch.set(ref, { status: 'removed', updatedAt: now }, { merge: true })
  batch.set(ctx.db.doc(`users/${memberId}/orgMemberships/${orgId}`), { status: 'removed', updatedAt: now }, { merge: true })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: 'admin', orgId, action: 'member.remove', target: memberId, meta: { role: m.role } }))
  await batch.commit()
  // Sus clientes pasan a quien lo quitó, y su acceso a los datos se corta.
  await resyncOrgGrants(ctx, orgId, { reassignFrom: memberId, reassignTo: ctx.uid })
  return { ok: true }
}

// Vuelve a derivar quién puede leer a cada cliente activo de la firma. Corre
// cuando cambia el equipo (entra un admin, sale alguien).
export async function resyncOrgGrants(ctx, orgId, { reassignFrom = null, reassignTo = null } = {}) {
  const links = await ctx.db.collection('clientLinks').where('orgId', '==', orgId).get()
  for (const d of links.docs) {
    if (d.data().status !== 'active') continue
    await ctx.db.runTransaction(async (tx) => {
      const linkSnap = await tx.get(d.ref)
      const link = linkSnap.data()
      if (!link || link.status !== 'active') return
      const admins = await activeAdminUids(tx, ctx.db, orgId)
      const grants = await grantsOf(tx, ctx, link.clientUid)
      const advisorUid = reassignFrom && link.advisorUid === reassignFrom ? reassignTo : link.advisorUid
      const advisorUids = uniq([advisorUid, ...admins]).filter((u) => u !== reassignFrom)
      const before = link.advisorUids || []
      const after = grants.map((g) => (g.orgId === orgId ? { ...g, advisorUids } : g))
      tx.set(d.ref, { advisorUid, advisorUids, updatedAt: iso(ctx) }, { merge: true })
      tx.set(ctx.db.doc(`users/${link.clientUid}/grants/${orgId}`), { advisorUids, updatedAt: iso(ctx) }, { merge: true })
      syncAccess(tx, ctx, link.clientUid, after, uniq([...before, ...advisorUids]))
    })
  }
}

// ── Invitaciones ───────────────────────────────────────────────────────────

export async function inviteClient(ctx, { orgId, email } = {}) {
  const me = await requireMember(ctx, orgId, ['admin', 'advisor'])
  const to = normalizeEmail(email)
  if (!isValidEmail(to)) throw new OrgError('BAD_EMAIL')
  const orgSnap = await ctx.db.doc(`organizations/${orgId}`).get()
  const org = orgSnap.data() || {}
  if (org.status !== 'active') throw new OrgError('ORG_SUSPENDED', 403)
  const token = ctx.token()
  const hash = ctx.hash(token)
  const now = iso(ctx)
  const expiresAt = new Date(ctx.now() + INVITE_TTL_MS).toISOString()
  const advisorName = me.name || ctx.name || ''
  const batch = ctx.db.batch()
  batch.set(ctx.db.doc(`inviteTokens/${hash}`), {
    kind: 'client', orgId, orgName: org.name || '', advisorUid: ctx.uid, advisorName, email: to,
    status: 'invited', expiresAt, createdAt: now, createdBy: ctx.uid,
  })
  batch.set(ctx.db.doc(`clientLinks/inv_${hash.slice(0, 20)}`), {
    orgId, advisorUid: ctx.uid, invitedEmail: to, status: 'invited', scopes: DEFAULT_SCOPES,
    inviteTokenHash: hash, inviteExpiresAt: expiresAt, createdAt: now,
  })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: me.role, orgId, action: 'link.invite', target: to }))
  await batch.commit()
  const emailSent = await sendMail(ctx, to, clientInviteEmail({ orgName: org.name || '', advisorName, token }))
  return { ok: true, emailSent }
}

export async function cancelClientInvite(ctx, { orgId, inviteId } = {}) {
  const me = await requireMember(ctx, orgId, ['admin', 'advisor'])
  if (typeof inviteId !== 'string' || !inviteId.startsWith('inv_')) throw new OrgError('BAD_INVITE')
  const ref = ctx.db.doc(`clientLinks/${inviteId}`)
  const snap = await ref.get()
  const inv = snap.exists ? snap.data() : null
  if (!inv || inv.orgId !== orgId || inv.status !== 'invited') throw new OrgError('NOT_FOUND', 404)
  const batch = ctx.db.batch()
  batch.delete(ref)
  if (inv.inviteTokenHash) batch.set(ctx.db.doc(`inviteTokens/${inv.inviteTokenHash}`), { status: 'revoked', updatedAt: iso(ctx) }, { merge: true })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: me.role, orgId, action: 'link.revoke', target: inv.invitedEmail || inviteId, meta: { pending: true } }))
  await batch.commit()
  return { ok: true }
}

// Lo que la pantalla de consentimiento necesita saber del token. No activa nada.
export async function getInvite(ctx, { token } = {}) {
  if (typeof token !== 'string' || token.length < 20) return { state: 'not-found' }
  const snap = await ctx.db.doc(`inviteTokens/${ctx.hash(token)}`).get()
  if (!snap.exists) return { state: 'not-found' }
  const inv = snap.data()
  return {
    state: inviteState(inv, ctx.now()), kind: inv.kind, orgName: inv.orgName || '', advisorName: inv.advisorName || '',
    role: inv.role || null, email: inv.email || '', expiresAt: inv.expiresAt,
    scopes: SCOPES, defaultScopes: DEFAULT_SCOPES, consentVersion: CONSENT_VERSION,
    emailMatches: inv.kind === 'member' ? normalizeEmail(ctx.email) === inv.email : true,
  }
}

const INVITE_ERRORS = { 'not-found': 'INVITE_NOT_FOUND', used: 'TOKEN_USED', expired: 'INVITE_EXPIRED', revoked: 'INVITE_REVOKED' }

export async function acceptInvite(ctx, { token, scopes, consentVersion } = {}) {
  if (typeof token !== 'string' || token.length < 20) throw new OrgError('INVITE_NOT_FOUND', 404)
  const hash = ctx.hash(token)
  const tokenRef = ctx.db.doc(`inviteTokens/${hash}`)
  const stubId = `inv_${hash.slice(0, 20)}`
  const result = await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(tokenRef)
    const inv = snap.exists ? snap.data() : null
    const state = inviteState(inv, ctx.now())
    if (state !== 'ok') {
      // Un token vencido se marca UNA vez (y se audita) y nunca activa nada.
      if (state === 'expired' && inv.status === 'invited') {
        tx.set(tokenRef, { status: 'expired', updatedAt: iso(ctx) }, { merge: true })
        if (inv.kind === 'client') {
          tx.set(ctx.db.doc(`clientLinks/${stubId}`), { status: 'expired' }, { merge: true })
          tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: 'client', orgId: inv.orgId, action: 'link.expire', target: inv.email }))
        }
      }
      return { error: INVITE_ERRORS[state] }
    }
    const now = iso(ctx)
    const orgSnap = await tx.get(ctx.db.doc(`organizations/${inv.orgId}`))
    const org = orgSnap.exists ? orgSnap.data() : null
    if (!org || org.status !== 'active') return { error: 'ORG_SUSPENDED' }

    if (inv.kind === 'member') {
      // Entrar a una firma da acceso a datos de terceros: solo la persona
      // dueña del correo invitado puede aceptar.
      if (normalizeEmail(ctx.email) !== inv.email) return { error: 'EMAIL_MISMATCH', status: 403 }
      tx.set(ctx.db.doc(`organizations/${inv.orgId}/memberships/${ctx.uid}`), {
        role: inv.role, status: 'active', invitedBy: inv.createdBy, invitedEmail: inv.email,
        email: inv.email, name: ctx.name || '', createdAt: now, updatedAt: now,
      })
      tx.delete(ctx.db.doc(`organizations/${inv.orgId}/memberships/${stubId}`))
      tx.set(ctx.db.doc(`users/${ctx.uid}/orgMemberships/${inv.orgId}`), { orgId: inv.orgId, orgName: org.name || '', role: inv.role, status: 'active', updatedAt: now })
      tx.set(tokenRef, { status: 'accepted', acceptedAt: now, acceptedBy: ctx.uid }, { merge: true })
      tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: inv.role, orgId: inv.orgId, action: 'member.accept', meta: { role: inv.role } }))
      return { kind: 'member', orgId: inv.orgId, role: inv.role }
    }

    // Cliente: vincula SU cuenta existente. No se copia ni se migra nada: lo
    // único que nace es el permiso de lectura.
    if (consentVersion !== CONSENT_VERSION) return { error: 'CONSENT_REQUIRED' }
    const granted = sanitizeScopes(scopes)
    if (granted.length === 0) return { error: 'NO_SCOPES' }
    const clientUid = ctx.uid
    if (clientUid === inv.advisorUid) return { error: 'SELF_LINK' }
    const admins = await activeAdminUids(tx, ctx.db, inv.orgId)
    const advSnap = await tx.get(ctx.db.doc(`organizations/${inv.orgId}/memberships/${inv.advisorUid}`))
    const adv = advSnap.exists && advSnap.data().status === 'active' ? advSnap.data() : null
    const advisorUid = adv ? inv.advisorUid : admins[0]
    if (!advisorUid) return { error: 'ORG_SUSPENDED' }
    const advisorUids = uniq([advisorUid, ...admins]).filter((u) => u !== clientUid)
    const linkId = linkIdFor(inv.orgId, clientUid)
    const linkRef = ctx.db.doc(`clientLinks/${linkId}`)
    const [prevLink, profSnap, grants] = await Promise.all([
      tx.get(linkRef), tx.get(ctx.db.doc(`users/${clientUid}/settings/profile`)), grantsOf(tx, ctx, clientUid),
    ])
    const prev = prevLink.exists ? prevLink.data() : null
    const clientName = (profSnap.exists && profSnap.data().name) || ctx.name || ''
    tx.set(linkRef, {
      orgId: inv.orgId, orgName: org.name || '', clientUid, advisorUid, advisorUids,
      advisorName: adv?.name || inv.advisorName || '', advisorEmail: adv?.email || '',
      clientName, clientEmail: ctx.email || '', invitedEmail: inv.email,
      status: 'active', scopes: granted, consentVersion: CONSENT_VERSION,
      inviteTokenHash: hash, inviteExpiresAt: inv.expiresAt,
      createdAt: prev?.createdAt || now, acceptedAt: now, revokedAt: null, revokedBy: null,
      unreadForOrg: prev?.unreadForOrg || 0, unreadForClient: prev?.unreadForClient || 0,
      lastAdvisorContactAt: prev?.lastAdvisorContactAt || null, updatedAt: now,
    })
    const grant = { orgId: inv.orgId, orgName: org.name || '', status: 'active', scopes: granted, advisorUids, updatedAt: now }
    tx.set(ctx.db.doc(`users/${clientUid}/grants/${inv.orgId}`), grant)
    const prevGrant = grants.find((g) => g.orgId === inv.orgId)
    syncAccess(tx, ctx, clientUid, [...grants.filter((g) => g.orgId !== inv.orgId), grant], uniq([...(prevGrant?.advisorUids || []), ...advisorUids]))
    tx.delete(ctx.db.doc(`clientLinks/${stubId}`))
    tx.set(tokenRef, { status: 'accepted', acceptedAt: now, acceptedBy: clientUid }, { merge: true })
    tx.set(auditRef(ctx), auditEvent(ctx, {
      actorRole: 'client', orgId: inv.orgId, clientUid, linkId, action: 'link.accept',
      meta: { scopes: granted, consentVersion: CONSENT_VERSION, invitedEmail: inv.email },
    }))
    return { kind: 'client', orgId: inv.orgId, linkId, scopes: granted }
  })
  if (result.error) throw new OrgError(result.error, result.status || 400)
  if (result.kind === 'member' && result.role === 'admin') await resyncOrgGrants(ctx, result.orgId)
  return result
}

// ── Revocar ────────────────────────────────────────────────────────────────

// Vínculo, grant y espejo de acceso cambian en UNA transacción, junto con su
// evento de auditoría: la siguiente lectura del asesor ya falla.
export async function revokeLink(ctx, { orgId, clientUid } = {}) {
  if (typeof orgId !== 'string' || !orgId) throw new OrgError('BAD_ORG')
  const byClient = !clientUid || clientUid === ctx.uid
  const target = byClient ? ctx.uid : clientUid
  let role = 'client'
  if (!byClient) role = (await requireMember(ctx, orgId, ['admin', 'advisor'])).role
  const linkId = linkIdFor(orgId, target)
  const linkRef = ctx.db.doc(`clientLinks/${linkId}`)
  const out = await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(linkRef)
    const link = snap.exists ? snap.data() : null
    if (!link || link.clientUid !== target) return { error: 'NOT_FOUND', status: 404 }
    if (role === 'advisor' && link.advisorUid !== ctx.uid) return { error: 'FORBIDDEN', status: 403 }
    if (link.status === 'revoked') return { ok: true, already: true }
    if (link.status !== 'active') return { error: 'NOT_FOUND', status: 404 }
    const now = iso(ctx)
    const grants = await grantsOf(tx, ctx, target)
    const after = grants.map((g) => (g.orgId === orgId ? { ...g, status: 'revoked', advisorUids: [] } : g))
    tx.set(linkRef, { status: 'revoked', revokedAt: now, revokedBy: role, updatedAt: now }, { merge: true })
    tx.set(ctx.db.doc(`users/${target}/grants/${orgId}`), { status: 'revoked', advisorUids: [], updatedAt: now }, { merge: true })
    syncAccess(tx, ctx, target, after, link.advisorUids || [])
    tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: role, orgId, clientUid: target, linkId, action: 'link.revoke', meta: { revokedBy: role } }))
    return { ok: true }
  })
  if (out.error) throw new OrgError(out.error, out.status)
  return out
}

// ── Book y transparencia ───────────────────────────────────────────────────

export async function getBook(ctx, { orgId } = {}) {
  const me = await requireMember(ctx, orgId)
  const [orgSnap, linkSnap] = await Promise.all([
    ctx.db.doc(`organizations/${orgId}`).get(),
    ctx.db.collection('clientLinks').where('orgId', '==', orgId).get(),
  ])
  const nowMs = ctx.now()
  let links = linkSnap.docs.map((d) => ({ ...d.data(), id: d.id }))
  // Un asesor ve SU cartera; el admin y el asistente ven la de la firma.
  if (me.role === 'advisor') links = links.filter((l) => l.advisorUid === ctx.uid)
  const active = links.filter((l) => l.status === 'active')
  // El último snapshot que el panel del cliente archivó: una lectura por
  // cliente, sin recalcular nada.
  const refs = active.map((l) => ctx.db.doc(`users/${l.clientUid}/advisorSummary/latest`))
  const sums = refs.length ? await ctx.db.getAll(...refs) : []
  const rows = active.map((l, i) => bookRow(l, sums[i]?.exists ? sums[i].data() : null, nowMs))
  const pending = links.filter((l) => l.status === 'invited' || l.status === 'expired').map((l) => ({
    id: l.id, email: l.invitedEmail || '', expiresAt: l.inviteExpiresAt || null,
    expired: l.status === 'expired' || Date.parse(l.inviteExpiresAt || '') < nowMs,
  }))
  const revoked = links.filter((l) => l.status === 'revoked').map((l) => ({
    linkId: l.id, clientUid: l.clientUid, name: l.clientName || l.clientEmail || '', revokedAt: l.revokedAt || null, revokedBy: l.revokedBy || null,
  }))
  return {
    org: { id: orgId, name: orgSnap.data()?.name || '' }, role: me.role,
    rows: sortByNoContact(rows), totals: bookTotals(rows), pending, revoked,
  }
}

async function loadLinkForStaff(ctx, orgId, clientUid) {
  const me = await requireMember(ctx, orgId, ['admin', 'advisor'])
  const snap = await ctx.db.doc(`clientLinks/${linkIdFor(orgId, clientUid)}`).get()
  const link = snap.exists ? snap.data() : null
  if (!link) throw new OrgError('NOT_FOUND', 404)
  if (me.role !== 'admin' && !(link.advisorUids || []).includes(ctx.uid)) throw new OrgError('FORBIDDEN', 403)
  return { me, link, ref: snap.ref, linkId: snap.id }
}

// Ficha del cliente para la vista de lectura (nombre, alcances, estado).
export async function getClient(ctx, { orgId, clientUid } = {}) {
  const { me, link, linkId } = await loadLinkForStaff(ctx, orgId, clientUid)
  return {
    linkId, role: me.role, status: link.status, scopes: link.status === 'active' ? sanitizeScopes(link.scopes) : [],
    name: link.clientName || link.clientEmail || '', email: link.clientEmail || '', orgName: link.orgName || '',
    unread: link.unreadForOrg || 0,
  }
}

export async function logView(ctx, { orgId, clientUid, screen } = {}) {
  if (!VIEW_SCREENS.includes(screen)) throw new OrgError('BAD_SCREEN')
  const { me, link, ref, linkId } = await loadLinkForStaff(ctx, orgId, clientUid)
  if (link.status !== 'active') throw new OrgError('LINK_NOT_ACTIVE', 403)
  if (!sanitizeScopes(link.scopes).includes(SCREEN_SCOPE[screen])) throw new OrgError('FORBIDDEN_SCOPE', 403)
  const key = `${ctx.uid}_${screen}`
  if (!shouldLogView(link.lastViews?.[key], ctx.now())) return { logged: false }
  const batch = ctx.db.batch()
  batch.set(ref, { lastViews: { [key]: iso(ctx) } }, { merge: true })
  batch.set(auditRef(ctx), auditEvent(ctx, { actorRole: me.role, orgId, clientUid, linkId, action: `view.${screen}`, target: screen }))
  await batch.commit()
  return { logged: true }
}

export async function listClientLinks(ctx) {
  const snap = await ctx.db.collection('clientLinks').where('clientUid', '==', ctx.uid).get()
  const links = snap.docs.map((d) => {
    const l = d.data()
    return {
      linkId: d.id, orgId: l.orgId, orgName: l.orgName || '', advisorName: l.advisorName || '', status: l.status,
      scopes: sanitizeScopes(l.scopes), acceptedAt: l.acceptedAt || null, revokedAt: l.revokedAt || null,
      unread: l.unreadForClient || 0,
    }
  }).filter((l) => l.status === 'active' || l.status === 'revoked')
  return { links }
}

// "Actividad de tu asesor": las últimas vistas y mensajes, del auditLog.
export async function clientActivity(ctx, { orgId } = {}) {
  if (typeof orgId !== 'string' || !orgId) throw new OrgError('BAD_ORG')
  const linkId = linkIdFor(orgId, ctx.uid)
  const snap = await ctx.db.collection('auditLog').where('linkId', '==', linkId).limit(300).get()
  const events = snap.docs.map((d) => d.data())
    .filter((e) => e.clientUid === ctx.uid && isClientVisibleActivity(e))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, ACTIVITY_LIMIT)
    .map((e) => ({ at: e.at, action: e.action, target: e.target || null }))
  return { events }
}

// ── Mensajes y notas ───────────────────────────────────────────────────────

async function threadActor(ctx, linkId) {
  if (typeof linkId !== 'string' || !linkId || linkId.startsWith('inv_')) throw new OrgError('BAD_LINK')
  const ref = ctx.db.doc(`clientLinks/${linkId}`)
  const snap = await ref.get()
  const link = snap.exists ? snap.data() : null
  if (!link) throw new OrgError('NOT_FOUND', 404)
  if (link.clientUid === ctx.uid) return { link, ref, role: 'client', name: link.clientName || ctx.name || '' }
  const m = await membershipOf(ctx.db, link.orgId, ctx.uid)
  // Un asistente no participa del hilo.
  if (!m || !canSeeClients(m.role)) throw new OrgError('FORBIDDEN', 403)
  if (m.role !== 'admin' && !(link.advisorUids || []).includes(ctx.uid)) throw new OrgError('FORBIDDEN', 403)
  return { link, ref, role: 'advisor', memberRole: m.role, name: m.name || ctx.name || '' }
}

function cleanBody(body) {
  const s = String(body || '').replace(/\r\n/g, '\n').trim()
  if (!s) throw new OrgError('EMPTY_BODY')
  if (s.length > MAX_BODY) throw new OrgError('BODY_TOO_LONG')
  return s
}

async function notifyOtherSide(ctx, link, fromRole, fromName) {
  const toAdvisor = fromRole === 'client'
  const to = toAdvisor ? link.advisorEmail : link.clientEmail
  return sendMail(ctx, to, newMessageEmail({ fromName, toAdvisor, clientUid: link.clientUid }))
}

function messageWrites(tx, ctx, { linkId, link, ref, role, name, body, kind }) {
  const now = iso(ctx)
  const msgRef = ctx.db.collection(`threads/${linkId}/messages`).doc()
  tx.set(msgRef, {
    authorUid: ctx.uid, authorRole: role, authorName: name, body, createdAt: now,
    readBy: { [ctx.uid]: now }, ...(kind ? { kind } : {}),
  })
  tx.set(ref, role === 'client'
    ? { unreadForOrg: (link.unreadForOrg || 0) + 1, lastClientMessageAt: now, updatedAt: now }
    : { unreadForClient: (link.unreadForClient || 0) + 1, lastAdvisorContactAt: now, updatedAt: now }, { merge: true })
  return msgRef.id
}

export async function sendMessage(ctx, { linkId, body } = {}) {
  const text = cleanBody(body)
  const actor = await threadActor(ctx, linkId)
  const out = await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(actor.ref)
    const link = snap.data()
    // Vínculo revocado: el hilo queda como registro, en solo lectura.
    if (!link || link.status !== 'active') return { error: 'LINK_NOT_ACTIVE', status: 403 }
    const msgId = messageWrites(tx, ctx, { linkId, link, ref: actor.ref, role: actor.role, name: actor.name, body: text })
    tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: actor.role, orgId: link.orgId, clientUid: link.clientUid, linkId, action: 'message.send', target: msgId }))
    return { ok: true, msgId, link }
  })
  if (out.error) throw new OrgError(out.error, out.status)
  const emailSent = await notifyOtherSide(ctx, out.link, actor.role, actor.name)
  return { ok: true, msgId: out.msgId, emailSent }
}

export async function editMessage(ctx, { linkId, msgId, body } = {}) {
  const text = cleanBody(body)
  const actor = await threadActor(ctx, linkId)
  if (typeof msgId !== 'string' || !msgId) throw new OrgError('BAD_MESSAGE')
  const msgRef = ctx.db.doc(`threads/${linkId}/messages/${msgId}`)
  const out = await ctx.db.runTransaction(async (tx) => {
    const [linkSnap, msgSnap] = await Promise.all([tx.get(actor.ref), tx.get(msgRef)])
    const link = linkSnap.data()
    const msg = msgSnap.exists ? msgSnap.data() : null
    if (!link || link.status !== 'active') return { error: 'LINK_NOT_ACTIVE', status: 403 }
    if (!msg) return { error: 'NOT_FOUND', status: 404 }
    if (msg.authorUid !== ctx.uid || msg.kind === 'note') return { error: 'FORBIDDEN', status: 403 }
    if (msg.body === text) return { ok: true }
    const now = iso(ctx)
    // Nada se pierde: la versión anterior queda en el propio mensaje.
    tx.set(msgRef, { body: text, editedAt: now, previousBodies: [...(msg.previousBodies || []), { body: msg.body, at: msg.editedAt || msg.createdAt }] }, { merge: true })
    tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: actor.role, orgId: link.orgId, clientUid: link.clientUid, linkId, action: 'message.edit', target: msgId }))
    return { ok: true }
  })
  if (out.error) throw new OrgError(out.error, out.status)
  return { ok: true }
}

export async function markThreadRead(ctx, { linkId } = {}) {
  const actor = await threadActor(ctx, linkId)
  const snap = await ctx.db.collection(`threads/${linkId}/messages`).get()
  const now = iso(ctx)
  const batch = ctx.db.batch()
  let n = 0
  for (const d of snap.docs) {
    const m = d.data()
    if (m.authorUid === ctx.uid || m.readBy?.[ctx.uid]) continue
    batch.set(d.ref, { readBy: { [ctx.uid]: now } }, { merge: true })
    if (++n >= 400) break
  }
  batch.set(actor.ref, actor.role === 'client' ? { unreadForClient: 0 } : { unreadForOrg: 0 }, { merge: true })
  await batch.commit()
  return { ok: true, marked: n }
}

// El hilo, en orden. Lo leen las dos partes; un asistente no.
export async function listMessages(ctx, { linkId } = {}) {
  const actor = await threadActor(ctx, linkId)
  const snap = await ctx.db.collection(`threads/${linkId}/messages`).get()
  const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const l = actor.link
  return {
    messages, role: actor.role, status: l.status, orgName: l.orgName || '', advisorName: l.advisorName || '',
    clientName: l.clientName || '', clientUid: l.clientUid, advisorUids: l.advisorUids || [],
  }
}

export async function exportMessages(ctx, { linkId } = {}) {
  const actor = await threadActor(ctx, linkId)
  const snap = await ctx.db.collection(`threads/${linkId}/messages`).get()
  const messages = snap.docs.map((d) => d.data()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  await auditRef(ctx).set(auditEvent(ctx, {
    actorRole: actor.role, orgId: actor.link.orgId, clientUid: actor.link.clientUid, linkId, action: 'export.messages', meta: { count: messages.length },
  }))
  return { csv: messagesCsv(messages), count: messages.length }
}

export async function createNote(ctx, { orgId, clientUid, body, visibility } = {}) {
  const text = cleanBody(body)
  const vis = visibility === 'shared' ? 'shared' : 'internal'
  const { me, ref, linkId } = await loadLinkForStaff(ctx, orgId, clientUid)
  const noteRef = ctx.db.collection(`organizations/${orgId}/notes`).doc()
  const name = me.name || ctx.name || ''
  const out = await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const link = snap.data()
    // Una nota compartida es comunicación con el cliente: exige vínculo vivo.
    if (vis === 'shared' && (!link || link.status !== 'active')) return { error: 'LINK_NOT_ACTIVE', status: 403 }
    tx.set(noteRef, { clientUid, authorUid: ctx.uid, authorName: name, body: text, visibility: vis, createdAt: iso(ctx) })
    if (vis === 'shared') messageWrites(tx, ctx, { linkId, link, ref, role: 'advisor', name, body: text, kind: 'note' })
    tx.set(auditRef(ctx), auditEvent(ctx, { actorRole: me.role, orgId, clientUid, linkId, action: 'note.create', target: noteRef.id, meta: { visibility: vis } }))
    return { ok: true, link }
  })
  if (out.error) throw new OrgError(out.error, out.status)
  const emailSent = vis === 'shared' ? await notifyOtherSide(ctx, out.link, 'advisor', name) : false
  return { ok: true, noteId: noteRef.id, emailSent }
}

export async function listNotes(ctx, { orgId, clientUid } = {}) {
  await loadLinkForStaff(ctx, orgId, clientUid)
  const snap = await ctx.db.collection(`organizations/${orgId}/notes`).where('clientUid', '==', clientUid).get()
  const notes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { notes }
}

export const ACTIONS = {
  'org.create': createOrg, 'org.get': getOrg, 'member.invite': inviteMember, 'member.remove': removeMember,
  'link.invite': inviteClient, 'link.cancelInvite': cancelClientInvite, 'link.revoke': revokeLink,
  'invite.get': getInvite, 'invite.accept': acceptInvite,
  book: getBook, 'client.get': getClient, 'view.log': logView,
  'client.links': listClientLinks, 'client.activity': clientActivity,
  'message.list': listMessages, 'message.send': sendMessage, 'message.edit': editMessage, 'message.read': markThreadRead, 'message.export': exportMessages,
  'note.create': createNote, 'note.list': listNotes,
}
