import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAdminDb } from '@/lib/firebase-admin'
import { buildMarketBrief } from '@/lib/marketBrief'
import { buildWeeklyBriefForUser, makeMailer, AUTO_HEADERS } from '@/lib/weeklyBriefBuilder'
import { makeBriefFetcher } from '@/lib/briefFetcher'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// FASE HZ. UN despachador diario para TODAS las notificaciones periódicas
// (semanal hoy; mensual y anual entran aquí sin infraestructura nueva).
//
// Por qué un despachador y no un cron por cadencia: el plan Hobby de Vercel
// permite 2 cron jobs y los dispara una vez al día. Con el recordatorio de
// fin de mes ya ocupando uno, tres crons más simplemente no caben. Así que
// esta ruta corre todos los días y decide adentro qué toca: domingo = semanal.
// Y la decisión vive en código testeable en vez de en una expresión cron.
//
// Gating (convención del repo: no-op silencioso sin configurar):
//   CRON_SECRET, SMTP_HOST / SMTP_USER / SMTP_PASS
//
// Suscripciones: users/{uid}/settings/preferences con notifyWeekly = true.
// Cada cadencia es independiente: elegir una no condiciona a las otras.

// Qué cadencias corresponden a una fecha dada. Exportada y pura para poder
// probarla: es la única lógica del cron que decide si alguien recibe correo.
export function dueCadences(date) {
  const out = []
  if (date.getUTCDay() === 0) out.push('weekly')
  return out
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized', errorCode: 'BAD_REQUEST' }, { status: 401 })
  }

  const mailer = makeMailer(nodemailer)
  if (!mailer) return NextResponse.json({ ok: true, skipped: 'SMTP not configured' })
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Admin not configured', errorCode: 'INTERNAL' }, { status: 503 })

  const now = new Date()
  const cadences = dueCadences(now)
  if (cadences.length === 0) {
    return NextResponse.json({ ok: true, skipped: `nothing due on ${now.toISOString().slice(0, 10)}` })
  }

  const snap = await db.collectionGroup('settings').where('notifyWeekly', '==', true).get()
  if (snap.empty) return NextResponse.json({ ok: true, cadences, optedIn: 0, sent: 0 })

  // El brief de mercado es el MISMO para todos: se arma una sola vez por
  // corrida en vez de una por usuario (mismos datos, N veces el costo).
  let market = null
  try {
    market = await buildMarketBrief({ fetchSeries: makeBriefFetcher() })
  } catch (e) {
    console.error('[cron/notifications] market brief failed:', e.message)
  }

  const weekKey = now.toISOString().slice(0, 10)
  let sent = 0, skipped = 0, failed = 0

  for (const doc of snap.docs) {
    try {
      if (doc.id !== 'preferences') { skipped++; continue }
      const prefs = doc.data()
      const uid = doc.ref.parent.parent?.id
      const email = (prefs.notifyEmail || prefs.financeReminderEmail || '').trim()
      if (!uid || !email.includes('@')) { skipped++; continue }
      // Un solo correo por semana aunque el cron corra dos veces.
      if (prefs._lastWeeklyBrief === weekKey) { skipped++; continue }

      const mail = await buildWeeklyBriefForUser({ db, uid, prefs, market, now })
      if (!mail) { skipped++; continue }

      await mailer.transport.sendMail({
        from: mailer.from, to: email,
        subject: mail.subject, html: mail.html, text: mail.text,
        attachments: mail.attachments,
        ...(mailer.replyTo ? { replyTo: mailer.replyTo } : {}),
        headers: AUTO_HEADERS,
      })
      await doc.ref.set({ _lastWeeklyBrief: weekKey }, { merge: true })
      sent++
    } catch (e) {
      console.error('[cron/notifications] user failed:', e.message)
      failed++
    }
  }

  mailer.transport.close()
  return NextResponse.json({ ok: true, cadences, optedIn: snap.size, sent, skipped, failed, marketComplete: !!market?.complete })
}
