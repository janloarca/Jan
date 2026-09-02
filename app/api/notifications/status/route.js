import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'
import { findSubscribers, CADENCE_FLAGS } from '@/app/api/cron/notifications/route'

export const dynamic = 'force-dynamic'

// FASE IG. El estado del envío AUTOMÁTICO de correos, sin mandar ninguno.
//
// Por qué existe: todo este diagnóstico nació colgado del botón de "enviar
// prueba" (FASES IF/IF2/IF3), o sea la única forma de saber si el cron corría y
// si te encontraba era mandarse un correo a uno mismo. Con las cadencias ya
// funcionando en producción, esos botones sobran y el diagnóstico no: es lo que
// convierte "no me llegó" en una respuesta concreta en vez de una ronda de
// preguntas. Así que se separa la pregunta del envío.
//
// Contesta exactamente dos cosas, que son las dos que hacían falta:
//   1. ¿El cron llegó a EJECUTARSE, y cuándo? (`system/notificationsCron`, la
//      constancia que deja cada corrida, incluidas las que no mandan nada).
//   2. ¿Te ENCUENTRA? Corriendo la MISMA búsqueda de suscriptores que usa el
//      cron, que es la única pieza que el camino de prueba no compartía con él
//      y por lo tanto la única que podía fallar sola.
//
// Solo mira las banderas que el usuario tiene ENCENDIDAS: una cadencia apagada
// no tiene nada que diagnosticar, y cada búsqueda puede costar una lectura por
// usuario cuando la consulta rápida cae al barrido (esta base ya tocó su cuota
// diaria una vez, ver FASE IE9). Nunca escribe nada.

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 20 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error
  const uid = authResult.uid
  if (!uid) return NextResponse.json({ error: 'Unauthorized', errorCode: 'BAD_REQUEST' }, { status: 401 })

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Admin not configured', errorCode: 'INTERNAL' }, { status: 503 })

  // La constancia de la última corrida. Es UNA lectura y responde la primera
  // pregunta de todas ("¿el cron corrió?"), así que se pide siempre, incluso
  // sin ninguna suscripción encendida.
  let lastRun = null
  try {
    const doc = await db.doc('system/notificationsCron').get()
    if (doc.exists) {
      const d = doc.data()
      // `result` dice cómo TERMINÓ la corrida y `cadences` CUÁL tocaba: son dos
      // preguntas distintas, y sin la segunda "corrió y no me llegó el mensual"
      // no se distingue de "corrió y el mensual no tocaba ese día".
      lastRun = {
        at: d.lastRunAt || null,
        result: d.lastResult || null,
        cadences: Array.isArray(d.cadences) ? d.cadences : null,
      }
    }
  } catch (e) {
    console.error('[notifications/status] heartbeat read failed:', e?.message)
  }

  let prefs = {}
  try {
    const prefsDoc = await db.doc(`users/${uid}/settings/preferences`).get()
    if (prefsDoc.exists) prefs = prefsDoc.data() || {}
  } catch (e) {
    console.error('[notifications/status] prefs read failed:', e?.message)
  }

  const lookups = []
  for (const [cadence, flag] of Object.entries(CADENCE_FLAGS)) {
    if (prefs[flag] !== true) continue
    try {
      const found = await findSubscribers(db, flag)
      lookups.push({
        cadence,
        flag,
        via: found.via,
        found: found.docs.length,
        includesYou: found.docs.some((d) => d.ref.parent.parent?.id === uid),
        ...(found.error ? { error: found.error } : {}),
      })
    } catch (e) {
      lookups.push({ cadence, flag, via: 'failed', error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ ok: true, lastRun, lookups })
}
