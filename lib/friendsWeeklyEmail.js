// El correo semanal de tus grupos de Amigos. Módulo puro: recibe las tablas ya
// armadas (lib/friendsGroups.js) y devuelve { subject, html, text }.
//
// ⛔ QUÉ NO DICE, y por qué. No hay "subiste dos puestos" ni rachas: eso exige
// memoria por semana, que hoy no existe (no se guarda ninguna foto histórica
// de las posiciones). Inventar un movimiento comparando contra nada sería un
// dato con cara de dato. Cuando exista esa memoria, entra acá.
//
// Tampoco salen los "mayores movimientos" de cada persona: `change1d` mide la
// última SESIÓN, no la semana, así que ponerlos bajo un encabezado semanal
// afirmaría una ventana que esas cifras no cubren.
//
// Privacidad: este correo le muestra a UN miembro los nombres y porcentajes de
// los demás, que es exactamente lo que ya ve en la pantalla de Amigos. Ningún
// monto pasa por acá, y el alcance del grupo se respeta igual que en la
// pantalla (una fila sin datos para el alcance se dice, nunca se sustituye por
// el portafolio completo).

import { renderEmail } from '@/lib/emailLayout'
import { STALE_AFTER_DAYS } from '@/lib/friendsGroups'

// Dos decimales SIEMPRE y signo explícito: es lo que hace que la columna se lea
// como columna (la regla 3 de emailLayout), y el signo es lo que le da color.
export function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function weekLabel(now = new Date()) {
  const end = new Date(now.getTime())
  const start = new Date(end.getTime() - 6 * 86400000)
  const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${f(start)}-${f(end)}, ${end.getUTCFullYear()}`
}

function scopeLabel(scope) {
  return scope === 'ibkr' ? 'IBKR only' : 'Whole portfolio'
}

// La nota de cada fila contesta una sola pregunta por vez, y en este orden:
// (1) esta persona no tiene datos para el alcance del grupo, (2) su número es
// de hace más de una semana, (3) cómo le va en el mes. Los tres casos son
// excluyentes por construcción: sin datos no hay mes que mostrar.
function rowNote(r) {
  if (r.outOfScope) return 'no data for this scope'
  if (r.staleDays != null && r.staleDays >= STALE_AFTER_DAYS) return `${r.staleDays}d old`
  if (r.mtd == null) return ''
  return `month ${fmtPct(r.mtd)}`
}

function rowLabel(r) {
  const pos = r.rank != null ? `${r.rank}. ` : ''
  const you = r.isYou ? ' (you)' : ''
  return `${pos}${r.displayName}${you}`
}

// Dónde quedaste, dicho en una línea. Es lo que la gente abre el correo para
// saber, y una tabla sola obliga a buscarse en ella.
export function standingSentence({ rows, memberCount }) {
  const you = (rows || []).find((r) => r.isYou)
  const ranked = (rows || []).filter((r) => r.ytd != null)
  if (!you) return null
  if (you.ytd == null) {
    return you.outOfScope
      ? 'You have no numbers for this scope yet, so you are not in the standings.'
      : 'You have not published numbers yet, so you are not in the standings.'
  }
  if (ranked.length < 2) return 'You are the only one with published numbers so far.'
  const leader = ranked[0]
  if (leader.uid === you.uid) {
    const second = ranked.find((r) => r.uid !== you.uid)
    const gap = second && second.ytd != null ? Math.abs(you.ytd - second.ytd) : null
    return gap != null
      ? `You are 1st of ${ranked.length}, ${gap.toFixed(2)} points ahead of ${second.displayName}.`
      : `You are 1st of ${ranked.length}.`
  }
  const gap = Math.abs(leader.ytd - you.ytd)
  return `You are ${ordinal(you.rank)} of ${ranked.length}, ${gap.toFixed(2)} points behind ${leader.displayName}.`
}

function ordinal(n) {
  if (n == null) return '-'
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * @param {Array}  groups  [{ name, scope, memberCount, pendingCount, rows }]
 * @param {Date}   now
 * @param {string} [manageUrl]
 */
export function buildFriendsWeeklyEmail({ groups = [], now = new Date(), manageUrl = 'https://chispu.xyz/friends' } = {}) {
  const label = weekLabel(now)
  const sections = groups.map((g) => {
    const rows = (g.rows || []).map((r) => ({ label: rowLabel(r), value: fmtPct(r.ytd), note: rowNote(r) }))
    const paragraphs = []
    const sentence = standingSentence(g)
    if (sentence) paragraphs.push(sentence)
    if (g.pendingCount > 0) {
      paragraphs.push(`${g.pendingCount} ${g.pendingCount === 1 ? 'member has' : 'members have'} joined but not published yet.`)
    }
    return { heading: `${g.name} · ${scopeLabel(g.scope)}`, rows, paragraphs }
  })

  // La explicación de las columnas va UNA vez al final y no por grupo: repetirla
  // en cada sección la vuelve ruido en cuanto hay más de un grupo.
  sections.push({
    heading: 'How to read this',
    paragraphs: [
      'Ranked by return so far this year; the note on the right is the same person\'s month so far.',
      'Percentages only, never amounts: that is all anyone publishes to a group.',
    ],
    cta: { label: 'Open Friends', url: 'https://chispu.xyz/friends' },
  })

  const groupWord = groups.length === 1 ? 'group' : 'groups'
  const { html, text } = renderEmail({
    title: `Your ${groupWord} this week`,
    subtitle: `${label} · ${groups.length} ${groupWord}`,
    sections,
    manageUrl,
    reason: 'You are getting this because you turned on the weekly group standings in Chispudo.',
  })

  return { subject: `Chispudo Friends · ${label}`, html, text }
}
