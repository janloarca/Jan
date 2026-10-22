import { getAdminDb } from '@/lib/firebase-admin'

// Constancia de sync de broker que SOLO el servidor puede escribir.
//
// `lastSync` dentro del vault (`users/{uid}/settings/{broker}`) lo puede
// reescribir el propio dueño con las reglas de Firestore (`users/{uid}/**` es
// escribible por él), así que no sirve como evidencia para la insignia de
// Amigos, que otras personas leen. Esta colección es top-level y las reglas la
// dejan en default-deny: solo el Admin SDK escribe y lee. La insignia sale de
// acá (lib/friendsVerified.js).
//
// Best-effort: un fallo jamás puede tumbar un sync que sí funcionó.
export const STAMP_COLLECTION = 'brokerSyncStamps'

export async function stampBrokerSync(uid, brokerId) {
  try {
    const db = getAdminDb()
    if (!db || !uid || !brokerId) return
    await db.collection(STAMP_COLLECTION).doc(uid)
      .set({ [brokerId]: new Date().toISOString() }, { merge: true })
  } catch (err) {
    console.error('[brokerSyncStamp] error:', err.message)
  }
}

// Lee los sellos y los devuelve en la forma que espera brokerVerification.
export async function readBrokerStamps(db, uid) {
  const snap = await db.collection(STAMP_COLLECTION).doc(uid).get()
  const data = snap.exists ? snap.data() : {}
  return Object.entries(data || {}).map(([id, lastSync]) => ({ id, data: { lastSync } }))
}
