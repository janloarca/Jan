// El correo semanal de tus grupos de Amigos. Módulo puro: recibe las tablas ya
// armadas (lib/friendsGroups.js) y devuelve { subject, html, text }.
//
// FASE LS. El movimiento y la racha SÍ salen ahora, porque desde esa fase
// existe la memoria por semana (lib/friendsHistory.js) contra la cual
// compararse. Siguen siendo opcionales: sin foto previa el correo no afirma
// nada, que es como salía antes.
//
// ⛔ QUÉ SIGUE SIN DECIR: los "mayores movimientos" de cada persona. `change1d` mide la
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

// El movimiento va pegado al NOMBRE y no a la nota, porque la nota ya está
// ocupada por el mes y las dos cosas pueden aplicar a la vez. Solo se dibuja
// cuando de verdad hubo movimiento: un "0" al lado de cada fila que no se movió
// es ruido, y peor, se lee como si el cero fuera un dato de esta semana.
function rowLabel(r) {
  const pos = r.rank != null ? `${r.rank}. ` : ''
  const you = r.isYou ? ' (you)' : ''
  const d = r.rankDelta
  const move = d ? (d > 0 ? ` ▲${d}` : ` ▼${Math.abs(d)}`) : ''
  return `${pos}${r.displayName}${you}${move}`
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

// Tu movimiento desde la semana pasada, dicho aparte de la posición: son dos
// hechos distintos (dónde estás, y qué cambió) y juntarlos en una sola oración
// la vuelve ilegible. Null cuando no hay contra qué comparar o no te moviste:
// "no te moviste" no es noticia y ocuparía la misma línea que sí lo es.
//
// El conteo es de PERSONAS que pasaste, no de puestos crudos: `withMovement`
// lo calcula sobre quienes estaban en las dos semanas, así que alguien que se
// fue del grupo no te regala un ascenso.
export function movementSentence(rows) {
  const you = (rows || []).find((r) => r.isYou)
  if (!you || !you.rankDelta) return null
  const n = Math.abs(you.rankDelta)
  const who = n === 1 ? 'one person' : `${n} people`
  // Se NOMBRA la semana comparada en vez de decir "la semana pasada": si el
  // cron se saltó un domingo, la foto previa es de hace dos semanas y "la
  // semana pasada" sería falso. Con la fecha, la frase es cierta pase lo que
  // pase. En el mismo formato que el resto del correo, no el ISO crudo.
  return you.rankDelta > 0
    ? `You passed ${who} since the week of ${humanWeek(you.previousWeek)}.`
    : `${n === 1 ? 'One person' : `${n} people`} passed you since the week of ${humanWeek(you.previousWeek)}.`
}

function humanWeek(key) {
  const ts = Date.parse(`${key}T00:00:00Z`)
  if (!Number.isFinite(ts)) return String(key ?? '')
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
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
    const moved = movementSentence(g.rows)
    if (moved) paragraphs.push(moved)
    if (g.streak) {
      paragraphs.push(`${g.streak.displayName} has led for ${g.streak.weeks} weeks running.`)
    }
    if (g.pendingCount > 0) {
      paragraphs.push(`${g.pendingCount} ${g.pendingCount === 1 ? 'member has' : 'members have'} joined but not published yet.`)
    }
    return { heading: `${g.name} · ${scopeLabel(g.scope)}`, rows, paragraphs }
  })

  // La explicación de las columnas va UNA vez al final y no por grupo: repetirla
  // en cada sección la vuelve ruido en cuanto hay más de un grupo.
  const anyMovement = groups.some((g) => (g.rows || []).some((r) => r.rankDelta))
  sections.push({
    heading: 'How to read this',
    paragraphs: [
      'Ranked by return so far this year; the note on the right is the same person\'s month so far.',
      // La leyenda de las flechas solo aparece cuando hay flechas: explicar un
      // símbolo que no está en pantalla es ruido, y en la primera semana (sin
      // memoria todavía) no habría ninguno.
      ...(anyMovement
        ? ['The arrow counts people you passed, or who passed you, among those who were also here last week.']
        : []),
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
