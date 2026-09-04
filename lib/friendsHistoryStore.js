// Leer y escribir la memoria semanal de los grupos (lib/friendsHistory.js).
//
// La ESCRITURA corre una vez por semana desde el cron y recorre TODOS los
// grupos, no solo los de quienes reciben el correo: si la foto dependiera de la
// suscripción, la historia quedaría con huecos justo para quien la active más
// adelante, y un hueco de semanas no se puede rellenar después.

import { groupStandings, rankedCount } from '@/lib/friendsGroups'
import { buildSnapshot, weekKeyFor } from '@/lib/friendsHistory'

// Topes: los mismos de la ruta de Amigos para miembros, y uno propio para la
// cantidad de grupos que una corrida puede fotografiar. Si algún día se corta,
// el reporte lo dice en vez de truncar en silencio.
const MAX_MEMBERS = 30
export const MAX_GROUPS_PER_RUN = 500

// Cuánto puede consumir la foto antes de soltar el resto. Menos que el barrido
// del buzón (25s) porque esto corre ANTES de todos los correos del día.
export const SNAPSHOT_BUDGET_MS = 20000

// Cuántas fotos se leen hacia atrás. Cuatro alcanza para "viene liderando N
// semanas" sin traerse la historia entera cada domingo.
export const HISTORY_LOOKBACK = 4

/**
 * La foto de la semana para TODOS los grupos. Idempotente: dos corridas del
 * mismo domingo escriben el mismo doc (la llave es la semana, no el instante).
 */
export async function snapshotAllGroups({ db, now = new Date(), budgetMs = SNAPSHOT_BUDGET_MS } = {}) {
  const snap = await db.collection('friendGroups').limit(MAX_GROUPS_PER_RUN).get()
  const out = {
    groups: snap.size, written: 0, skipped: 0, failed: 0, weekKey: weekKeyFor(now),
    // El comentario de arriba prometía "si algún día se corta, el reporte lo
    // dice en vez de truncar en silencio" y no había ningún campo que lo
    // dijera: se infería de `groups === 500`. El tope NO es diferido (no hay
    // cursor), así que los grupos que quedan fuera no se fotografían nunca.
    truncated: snap.size >= MAX_GROUPS_PER_RUN,
    ranOut: false,
  }
  if (snap.empty) return out

  // ⛔ Presupuesto de tiempo. El bucle es SERIAL (una lectura de perfiles y una
  // escritura por grupo), así que con muchos grupos se come la función entera y
  // se lleva por delante lo que viene DESPUÉS: las cadencias de correo, y entre
  // ellas la anual, que es la única sin repesca hasta el año siguiente. Ceder
  // acá cuesta la foto de los grupos que no alcanzó (recuperable la semana que
  // viene, y el corte queda dicho); no ceder cuesta un correo que no vuelve.
  const deadline = Date.now() + Math.max(1000, Number(budgetMs) || 0)

  for (const gd of snap.docs) {
    if (Date.now() > deadline) { out.ranOut = true; break }
    try {
      const g = { id: gd.id, ...gd.data() }
      const memberUids = Array.isArray(g.memberUids) ? g.memberUids.slice(0, MAX_MEMBERS) : []
      // getAll() SIN argumentos lanza, así que un grupo sin miembros corta acá.
      if (memberUids.length === 0) { out.skipped++; continue }
      const profs = await db.getAll(...memberUids.map((m) => db.collection('friendProfiles').doc(m)))
      const standings = groupStandings({
        group: { ...g, memberUids },
        nowTs: now.getTime(),
        profiles: profs.filter((p) => p.exists).map((p) => ({ uid: p.id, profile: p.data() })),
      })
      // Una foto con una sola persona con número no sirve para nada: no hay
      // posiciones que comparar la semana que viene.
      if (rankedCount(standings.rows) < 2) { out.skipped++; continue }
      const doc = buildSnapshot({ group: g, standings, now })
      await db.collection('friendGroups').doc(gd.id).collection('history').doc(doc.weekKey).set(doc)
      out.written++
    } catch (e) {
      console.error('[friendsHistory] group failed:', gd.id, e?.message)
      out.failed++
    }
  }
  return out
}

/**
 * Las fotos más recientes de un grupo, de la más nueva a la más vieja.
 *
 * ⛔ Excluye la semana EN CURSO a propósito. El correo compara contra "la
 * semana pasada", y la foto de esta semana la escribe el mismo cron: sin este
 * corte, el orden de las dos pasadas decidiría si el movimiento sale real o
 * sale cero. Con el corte, el resultado no depende del orden.
 */
export async function readRecentHistory({ db, groupId, now = new Date(), limit = HISTORY_LOOKBACK } = {}) {
  const thisWeek = weekKeyFor(now)
  const snap = await db.collection('friendGroups').doc(groupId).collection('history')
    .orderBy('weekKey', 'desc').limit(limit + 1).get()
  return snap.docs.map((d) => d.data()).filter((d) => d && d.weekKey < thisWeek).slice(0, limit)
}

// Cuántas fotos toca una purga. Alto a propósito: apagar Amigos es una acción
// rara y es una promesa de privacidad, así que se paga el barrido completo en
// vez de dejar filas atrás. Si un grupo tuviera más historia que esto, la purga
// lo REPORTA en vez de dar por limpio lo que no limpió.
export const MAX_HISTORY_PURGE = 260

/**
 * Saca las filas de UN usuario de toda la historia de un grupo.
 *
 * ⛔ Existe porque apagar Amigos promete "se borra tu perfil público al
 * instante" y borraba `friendProfiles/{uid}` sin tocar esta subcolección, donde
 * quedaban su uid, su nombre y sus porcentajes semana por semana, para siempre
 * y visibles para el resto del grupo. La memoria semanal (FASE LS) abrió ese
 * hueco: antes no había dónde sobrevivir.
 *
 * Se REESCRIBE la foto sin esa fila en vez de borrar el doc entero: la historia
 * de las OTRAS personas es suya y no se destruye al irse alguien.
 */
export async function purgeUserFromGroupHistory({ db, groupId, uid } = {}) {
  const snap = await db.collection('friendGroups').doc(groupId).collection('history')
    .limit(MAX_HISTORY_PURGE).get()
  const out = { scanned: snap.size, cleaned: 0, truncated: snap.size >= MAX_HISTORY_PURGE }
  for (const d of snap.docs) {
    const data = d.data() || {}
    const rows = Array.isArray(data.rows) ? data.rows : []
    const kept = rows.filter((r) => r && r.uid !== uid)
    if (kept.length === rows.length) continue
    // Una foto que se queda sin nadie ya no describe ninguna comparación.
    if (kept.length === 0) await d.ref.delete()
    else await d.ref.update({ rows: kept })
    out.cleaned++
  }
  return out
}

/**
 * Borra la historia de un grupo. Firestore NO borra subcolecciones al borrar su
 * documento padre, así que sin esto un grupo eliminado dejaba sus fotos vivas,
 * huérfanas e inalcanzables desde cualquier pantalla: datos de personas reales
 * que nadie puede ver ni borrar.
 */
export async function deleteGroupHistory({ db, groupId } = {}) {
  const snap = await db.collection('friendGroups').doc(groupId).collection('history')
    .limit(MAX_HISTORY_PURGE).get()
  for (const d of snap.docs) await d.ref.delete()
  return { deleted: snap.size, truncated: snap.size >= MAX_HISTORY_PURGE }
}
