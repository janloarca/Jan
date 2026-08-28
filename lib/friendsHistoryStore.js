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

// Cuántas fotos se leen hacia atrás. Cuatro alcanza para "viene liderando N
// semanas" sin traerse la historia entera cada domingo.
export const HISTORY_LOOKBACK = 4

/**
 * La foto de la semana para TODOS los grupos. Idempotente: dos corridas del
 * mismo domingo escriben el mismo doc (la llave es la semana, no el instante).
 */
export async function snapshotAllGroups({ db, now = new Date() } = {}) {
  const snap = await db.collection('friendGroups').limit(MAX_GROUPS_PER_RUN).get()
  const out = { groups: snap.size, written: 0, skipped: 0, failed: 0, weekKey: weekKeyFor(now) }
  if (snap.empty) return out

  for (const gd of snap.docs) {
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
