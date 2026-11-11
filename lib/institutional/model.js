// Modo institucional, Fase 1. Reglas PURAS (sin Firestore, sin crypto, sin
// React): las usan el servidor (lib/institutional/store.js), las pantallas y
// los tests. Una sola definición de alcances, roles, estados de invitación y
// de lo que el cliente puede ver de la actividad de su asesor.
//
// ⛔ Nada de este módulo toca patrimonio, YTD, snapshots ni backfill: el modo
// institucional LEE lo que el cliente ya tiene archivado y nunca recalcula.

export const SCOPES = ['patrimonio', 'hoja', 'dividendos', 'metas', 'flujo']
// Flujo son datos de gasto personal: va apagado salvo que el cliente lo marque.
export const DEFAULT_SCOPES = ['patrimonio', 'hoja', 'dividendos', 'metas']
export const ROLES = ['admin', 'advisor', 'assistant']
export const CONSENT_VERSION = '2026-11-v1'
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const VIEW_SCREENS = ['panel', 'hoja', 'dividendos', 'metas', 'flujo']
export const VIEW_DEBOUNCE_MS = 10 * 60 * 1000
export const NO_CONTACT_DAYS = 90
export const MAX_BODY = 4000
export const ACTIVITY_LIMIT = 50

// Qué alcance abre cada pantalla de la vista de lectura.
export const SCREEN_SCOPE = { panel: 'patrimonio', hoja: 'hoja', dividendos: 'dividendos', metas: 'metas', flujo: 'flujo' }

export const SCOPE_LABELS = {
  patrimonio: { es: 'Patrimonio (panel, activos y su valor)', en: 'Net worth (panel, assets and their value)' },
  hoja: { es: 'Hoja (historial mes a mes)', en: 'Sheet (month by month history)' },
  dividendos: { es: 'Dividendos e ingresos pasivos', en: 'Dividends and passive income' },
  metas: { es: 'Metas', en: 'Goals' },
  flujo: { es: 'Flujo (ingresos y gastos personales)', en: 'Cash flow (personal income and expenses)' },
}

export function linkIdFor(orgId, clientUid) {
  return `${orgId}_${clientUid}`
}

export function sanitizeScopes(input) {
  const set = new Set(Array.isArray(input) ? input : [])
  return SCOPES.filter((s) => set.has(s))
}

export function isValidRole(role) {
  return ROLES.includes(role)
}

// Un asistente ve el book y nada más: ni datos del cliente ni mensajes.
export function canSeeClients(role) {
  return role === 'admin' || role === 'advisor'
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email))
}

export function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org'
}

// Estado de una invitación en un instante. Lo decide el DOCUMENTO, no el
// token: un token ya usado o vencido se rechaza con su razón, y jamás activa
// un vínculo.
export function inviteState(invite, nowMs) {
  if (!invite) return 'not-found'
  if (invite.status === 'accepted') return 'used'
  if (invite.status === 'revoked') return 'revoked'
  if (invite.status === 'expired') return 'expired'
  const exp = Date.parse(invite.expiresAt || '')
  if (!Number.isFinite(exp) || nowMs > exp) return 'expired'
  return 'ok'
}

// Espejo por ASESOR que leen las reglas (`users/{clientUid}/advisorAccess/
// {advisorUid}`). Una regla no puede descubrir a qué organización pertenece
// quien pide, así que el servidor deriva, de los grants ACTIVOS del cliente,
// qué alcances tiene cada persona. Un asesor presente en dos firmas vinculadas
// al mismo cliente recibe la UNIÓN de lo que el cliente concedió a cada una.
export function accessFromGrants(grants) {
  const out = new Map()
  for (const g of grants || []) {
    if (!g || g.status !== 'active') continue
    const scopes = sanitizeScopes(g.scopes)
    for (const uid of g.advisorUids || []) {
      if (!uid) continue
      const cur = out.get(uid) || { status: 'active', scopes: [], orgIds: [] }
      cur.scopes = sanitizeScopes([...cur.scopes, ...scopes])
      if (g.orgId && !cur.orgIds.includes(g.orgId)) cur.orgIds.push(g.orgId)
      out.set(uid, cur)
    }
  }
  return out
}

// Una vista se registra una vez por pantalla cada 10 minutos.
export function shouldLogView(lastViewIso, nowMs) {
  const last = Date.parse(lastViewIso || '')
  return !Number.isFinite(last) || nowMs - last >= VIEW_DEBOUNCE_MS
}

export function daysSince(iso, nowMs) {
  const ts = Date.parse(iso || '')
  if (!Number.isFinite(ts)) return null
  return Math.max(0, Math.floor((nowMs - ts) / 86400000))
}

// Id de auditoría que ORDENA SOLO: el nombre del documento crece al revés del
// tiempo, así que una consulta por igualdad (que Firestore devuelve ordenada
// por nombre) trae lo más reciente primero sin índice compuesto.
export function auditDocId(nowMs, rand) {
  const inv = String(9999999999999 - Math.floor(nowMs)).padStart(13, '0')
  return `${inv}_${rand}`
}

// Lo que el cliente ve en "Actividad de tu asesor": vistas y mensajes del lado
// de la firma (más notas compartidas y exportaciones). Nunca una nota interna.
export function isClientVisibleActivity(ev) {
  if (!ev || ev.actorRole === 'client') return false
  const a = ev.action || ''
  if (a.startsWith('view.') || a === 'message.send' || a === 'message.edit' || a === 'export.messages') return true
  return a === 'note.create' && ev.meta?.visibility === 'shared'
}

// Fila del book. Los montos son los que el panel del cliente archivó
// (`advisorSummary/latest`): se muestran tal cual, nunca se recalculan.
export function bookRow(link, summary, nowMs) {
  const s = summary || null
  // Contacto = último mensaje o nota compartida del asesor. Sin ninguno, el
  // reloj corre desde que el cliente aceptó.
  const contactIso = link.lastAdvisorContactAt || link.acceptedAt || null
  return {
    linkId: link.id,
    clientUid: link.clientUid,
    name: link.clientName || link.invitedEmail || link.clientEmail || '',
    email: link.clientEmail || link.invitedEmail || '',
    advisorUid: link.advisorUid || null,
    status: link.status,
    scopes: sanitizeScopes(link.scopes),
    netWorth: s && Number.isFinite(s.netWorth) ? s.netWorth : null,
    investable: s && Number.isFinite(s.investable) ? s.investable : null,
    ytdPct: s && Number.isFinite(s.ytdPct) ? s.ytdPct : null,
    currency: s?.baseCurrency || null,
    netWorthUSD: s && Number.isFinite(s.netWorthUSD) ? s.netWorthUSD : null,
    investableUSD: s && Number.isFinite(s.investableUSD) ? s.investableUSD : null,
    snapshotAt: s?.at || null,
    daysNoContact: daysSince(contactIso, nowMs),
    hasContact: !!link.lastAdvisorContactAt,
    unread: Math.max(0, Number(link.unreadForOrg) || 0),
  }
}

export function bookTotals(rows) {
  const active = (rows || []).filter((r) => r.status === 'active')
  const sum = (k) => active.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0)
  return {
    activeClients: active.length,
    declaredUSD: sum('netWorthUSD'),
    investableUSD: sum('investableUSD'),
    withoutSnapshot: active.filter((r) => r.netWorthUSD == null).length,
    noContact90: active.filter((r) => r.daysNoContact != null && r.daysNoContact > NO_CONTACT_DAYS).length,
  }
}

// Más días sin contacto primero; quien nunca tuvo fecha va al final.
export function sortByNoContact(rows) {
  return [...(rows || [])].sort((a, b) => (b.daysNoContact ?? -1) - (a.daysNoContact ?? -1))
}

function csvCell(v) {
  let s = v == null ? '' : String(v)
  // Una celda que empieza con = + - @ la ejecuta Excel como fórmula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function messagesCsv(messages) {
  const rows = [['date', 'author', 'role', 'kind', 'body', 'edited_at', 'previous_versions']]
  for (const m of messages || []) {
    rows.push([
      m.createdAt || '', m.authorName || m.authorUid || '', m.authorRole || '',
      m.kind === 'note' ? 'shared_note' : 'message', m.body || '', m.editedAt || '',
      (m.previousBodies || []).map((p) => `[${p.at || ''}] ${p.body || ''}`).join(' | '),
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}
