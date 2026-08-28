// El armado del correo semanal de grupos para UN usuario, compartido por el
// cron dominical y el botón de "enviar prueba" de Ajustes.
//
// Existe por la misma razón que weeklyBriefBuilder: si el botón de prueba
// armara su propia versión, probaría algo distinto de lo que el domingo se
// manda de verdad, que es la peor clase de prueba.
//
// ⛔ NO carga el portafolio. A diferencia de los otros tres correos, este no
// llama a `loadUserPortfolioContext`: sus cifras son porcentajes que cada
// persona YA publicó a su grupo, así que no hay que cotizar precios, ni
// reconstruir anclas, ni generar un PDF. Es lo que hace que una cadencia más
// sea barata: dos consultas por grupo y ninguna llamada a la red.

import { groupStandings, rankedCount } from '@/lib/friendsGroups'
import { buildFriendsWeeklyEmail } from '@/lib/friendsWeeklyEmail'
import { withMovement, leaderStreak } from '@/lib/friendsHistory'
import { readRecentHistory } from '@/lib/friendsHistoryStore'

// Los mismos topes que la ruta de Amigos: un usuario no puede estar en más
// grupos ni un grupo tener más miembros, así que el trabajo está acotado por
// construcción.
const MAX_GROUPS = 20
const MAX_MEMBERS = 30

// Un grupo donde solo UNA persona tiene número no es una comparación, y mandar
// una "tabla de posiciones" de una fila es ruido semanal. Se omite ese grupo;
// si todos los grupos están así, no sale correo.
const MIN_RANKED = 2

/**
 * Devuelve { subject, html, text } listo para sendMail, o null cuando no hay
 * nada que comparar (sin grupos, o ninguno con al menos dos personas
 * publicando).
 */
export async function buildFriendsWeeklyForUser({ db, uid, prefs = {}, now = new Date() } = {}) {
  // Apagar Amigos tiene que apagar también su correo: sin esto, quien desactivó
  // el módulo (y por lo tanto ya no aparece en ningún grupo) seguiría recibiendo
  // los domingos una tabla de gente con la que ya no se compara.
  if (prefs.friendsEnabled === false) return null

  const snap = await db.collection('friendGroups').where('memberUids', 'array-contains', uid).get()
  if (snap.empty) return null

  const groups = []
  for (const gd of snap.docs.slice(0, MAX_GROUPS)) {
    const g = { id: gd.id, ...gd.data() }
    const memberUids = Array.isArray(g.memberUids) ? g.memberUids.slice(0, MAX_MEMBERS) : []
    // ⚠️ getAll() SIN argumentos lanza (validateMinNumberOfArguments), así que
    // un grupo sin miembros tiene que cortocircuitar. Una sola lectura por
    // grupo en vez de N sueltas: esta app ya tocó el techo de cuota de
    // Firestore en producción (FASE IE9).
    const profs = memberUids.length === 0
      ? []
      : await db.getAll(...memberUids.map((m) => db.collection('friendProfiles').doc(m)))
    const standings = groupStandings({
      group: { ...g, memberUids },
      viewerUid: uid,
      nowTs: now.getTime(),
      profiles: profs.filter((p) => p.exists).map((p) => ({ uid: p.id, profile: p.data() })),
    })
    if (rankedCount(standings.rows) < MIN_RANKED) continue

    // La memoria de las semanas anteriores (FASE LS). Best-effort: sin ella el
    // correo sale igual, solo que sin movimiento ni racha, que es exactamente
    // como salía antes de que la memoria existiera. Perder el correo entero por
    // una lectura de historia sería peor que mandarlo sin ese adorno.
    let history = []
    try {
      history = await readRecentHistory({ db, groupId: g.id, now })
    } catch (e) {
      console.error('[friendsWeekly] history read failed for', g.id, e?.message)
    }
    const rows = withMovement({ rows: standings.rows, previous: history[0] || null })
    groups.push({ name: g.name || 'Group', ...standings, rows, streak: leaderStreak(history) })
  }

  if (groups.length === 0) return null
  groups.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return buildFriendsWeeklyEmail({ groups, now })
}
