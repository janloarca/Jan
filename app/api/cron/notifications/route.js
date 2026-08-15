import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAdminDb } from '@/lib/firebase-admin'
import { buildMarketBrief, MARKET_WINDOWS } from '@/lib/marketBrief'
import { buildWeeklyBriefForUser, makeMailer, AUTO_HEADERS } from '@/lib/weeklyBriefBuilder'
import { buildMonthlyBriefForUser, buildAnnualBriefForUser, monthRefFor } from '@/lib/periodBriefBuilder'
import { makeBriefFetcher } from '@/lib/briefFetcher'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// FASE HZ. UN despachador diario para TODAS las notificaciones periódicas
// (semanal y, desde FASE IE, mensual; anual entra aquí sin infraestructura
// nueva).
//
// Por qué un despachador y no un cron por cadencia: el plan Hobby de Vercel
// permite 2 cron jobs y los dispara una vez al día. Con el recordatorio de
// fin de mes ya ocupando uno, tres crons más simplemente no caben. Así que
// esta ruta corre todos los días y decide adentro qué toca: domingo = semanal,
// día 1 = mensual. Y la decisión vive en código testeable en vez de en una
// expresión cron.
//
// Gating (convención del repo: no-op silencioso sin configurar):
//   CRON_SECRET, SMTP_HOST / SMTP_USER / SMTP_PASS
//
// Suscripciones: users/{uid}/settings/preferences con notifyWeekly /
// notifyMonthly = true. Cada cadencia es independiente: elegir una no
// condiciona a las otras, y un domingo que cae en día 1 manda AMBOS correos
// (contenidos distintos, decisión del usuario).

// Qué cadencias corresponden a una fecha dada. Exportada y pura para poder
// probarla: es la única lógica del cron que decide si alguien recibe correo.
export function dueCadences(date) {
  const out = []
  if (date.getUTCDay() === 0) out.push('weekly')
  if (date.getUTCDate() === 1) out.push('monthly')
  // El 1 de enero salen AMBOS: el mensual cubre diciembre y el anual el año
  // entero. Son contenidos distintos, y las cadencias son independientes por
  // decisión del usuario (elegir una no condiciona a las otras).
  if (date.getUTCDate() === 1 && date.getUTCMonth() === 0) out.push('annual')
  return out
}

// Todo lo que difiere entre cadencias, en UN solo lugar: la bandera de
// suscripción, el campo de dedup y su clave, la ventana del brief de mercado
// y el builder. Agregar la anual es agregar una entrada aquí.
const CADENCES = {
  weekly: {
    flag: 'notifyWeekly',
    dedupField: '_lastWeeklyBrief',
    dedupKey: (now) => now.toISOString().slice(0, 10),
    marketOpts: MARKET_WINDOWS.weekly,
    build: buildWeeklyBriefForUser,
  },
  monthly: {
    flag: 'notifyMonthly',
    // La clave es el MES CUBIERTO (el de ayer), no la fecha del envío: un
    // reintento del cron el mismo día 1 no puede mandar el mes dos veces.
    dedupField: '_lastMonthlyBrief',
    dedupKey: (now) => {
      const ref = monthRefFor(now)
      return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`
    },
    marketOpts: MARKET_WINDOWS.monthly,
    build: buildMonthlyBriefForUser,
  },
  annual: {
    flag: 'notifyAnnual',
    // La clave es el AÑO CUBIERTO (el de ayer), por la misma razón que el
    // mensual usa el mes: un reintento del cron no repite el año.
    dedupField: '_lastAnnualBrief',
    dedupKey: (now) => String(monthRefFor(now).getUTCFullYear()),
    marketOpts: MARKET_WINDOWS.annual,
    build: buildAnnualBriefForUser,
  },
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

  const report = {}
  for (const cadence of cadences) {
    const cfg = CADENCES[cadence]
    if (!cfg) continue
    let sent = 0, skipped = 0, failed = 0, optedIn = 0
    try {
      const snap = await db.collectionGroup('settings').where(cfg.flag, '==', true).get()
      optedIn = snap.size
      if (!snap.empty) {
        // El brief de mercado es el MISMO para todos los usuarios de la
        // cadencia: se arma una sola vez por corrida, con SU ventana.
        let market = null
        try {
          market = await buildMarketBrief({ fetchSeries: makeBriefFetcher(cfg.marketOpts.fetcher), ...cfg.marketOpts.brief })
        } catch (e) {
          console.error(`[cron/notifications] ${cadence} market brief failed:`, e.message)
        }

        const dedupKey = cfg.dedupKey(now)
        for (const doc of snap.docs) {
          try {
            if (doc.id !== 'preferences') { skipped++; continue }
            const prefs = doc.data()
            const uid = doc.ref.parent.parent?.id
            const email = (prefs.notifyEmail || prefs.financeReminderEmail || '').trim()
            if (!uid || !email.includes('@')) { skipped++; continue }
            if (prefs[cfg.dedupField] === dedupKey) { skipped++; continue }

            const mail = await cfg.build({ db, uid, prefs, market, now })
            if (!mail) { skipped++; continue }

            await mailer.transport.sendMail({
              from: mailer.from, to: email,
              subject: mail.subject, html: mail.html, text: mail.text,
              attachments: mail.attachments,
              ...(mailer.replyTo ? { replyTo: mailer.replyTo } : {}),
              headers: AUTO_HEADERS,
            })
            await doc.ref.set({ [cfg.dedupField]: dedupKey }, { merge: true })
            sent++
          } catch (e) {
            console.error(`[cron/notifications] ${cadence} user failed:`, e.message)
            failed++
          }
        }
      }
    } catch (e) {
      console.error(`[cron/notifications] ${cadence} cadence failed:`, e.message)
    }
    report[cadence] = { optedIn, sent, skipped, failed }
  }

  mailer.transport.close()
  return NextResponse.json({ ok: true, cadences, report })
}
