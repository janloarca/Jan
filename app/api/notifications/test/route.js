import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin'
import { buildMarketBrief, MARKET_WINDOWS } from '@/lib/marketBrief'
import { buildWeeklyBriefForUser, makeMailer, AUTO_HEADERS } from '@/lib/weeklyBriefBuilder'
import { buildMonthlyBriefForUser, buildAnnualBriefForUser } from '@/lib/periodBriefBuilder'
import { makeBriefFetcher } from '@/lib/briefFetcher'
import { findSubscribers } from '@/app/api/cron/notifications/route'

// Qué se prueba por cadencia: el MISMO builder y la MISMA ventana de mercado
// (MARKET_WINDOWS, compartida con el cron) que usa la corrida real. Una lista
// cerrada: el body no puede pedir nada que el cron no mande.
const TESTABLE = {
  weekly: { build: buildWeeklyBriefForUser, marketOpts: MARKET_WINDOWS.weekly },
  monthly: { build: buildMonthlyBriefForUser, marketOpts: MARKET_WINDOWS.monthly },
  annual: { build: buildAnnualBriefForUser, marketOpts: MARKET_WINDOWS.annual },
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// FASE HZ2. "Enviarme una prueba" desde Ajustes.
//
// Existe porque el correo semanal solo sale los domingos, y esperar tres días
// para descubrir que el SMTP no autentica es exactamente el ciclo de
// diagnóstico lento que este repo ya pagó caro varias veces (la lección del
// botón "Reparar ahora" de FASE HP). El armado es el MISMO de la corrida real
// (lib/weeklyBriefBuilder), así que esto prueba lo que de verdad se manda.
//
// Solo al PROPIO usuario firmado: no toma destinatario del cuerpo, así que
// esta ruta no puede usarse para mandarle correo a nadie más.

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 5 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error
  const uid = authResult.uid
  if (!uid) return NextResponse.json({ error: 'Unauthorized', errorCode: 'BAD_REQUEST' }, { status: 401 })

  // El destinatario sale de Firebase Auth, la fuente autoritativa, NUNCA del
  // cuerpo del request: así esta ruta no puede usarse para mandarle correo a
  // nadie más que a quien está firmado.
  const adminAuth = getAdminAuth()
  let email = ''
  try {
    const rec = await adminAuth?.getUser(uid)
    email = (rec?.email || '').trim()
  } catch (e) {
    console.error('[notifications/test] getUser failed:', e.message)
  }
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'No email on this account', errorCode: 'BAD_REQUEST' }, { status: 400 })
  }

  const mailer = makeMailer(nodemailer)
  if (!mailer) {
    return NextResponse.json({ error: 'Email is not configured on the server', errorCode: 'NOT_CONFIGURED' }, { status: 503 })
  }
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Admin not configured', errorCode: 'INTERNAL' }, { status: 503 })

  // Cadencia a probar (semanal si no se pide otra). Validada contra la lista
  // cerrada: un valor desconocido es 400, nunca un fallback silencioso.
  const body = await request.json().catch(() => ({}))
  const cadence = body?.cadence || 'weekly'
  const cfg = TESTABLE[cadence]
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown cadence', errorCode: 'BAD_REQUEST' }, { status: 400 })
  }

  try {
    const prefsDoc = await db.doc(`users/${uid}/settings/preferences`).get()
    const prefs = prefsDoc.exists ? prefsDoc.data() : {}

    let market = null
    try {
      market = await buildMarketBrief({ fetchSeries: makeBriefFetcher(cfg.marketOpts.fetcher), ...cfg.marketOpts.brief })
    } catch (e) {
      console.error('[notifications/test] market brief failed:', e.message)
    }

    const mail = await cfg.build({ db, uid, prefs, market })
    if (!mail) {
      return NextResponse.json({ error: 'Add some holdings first', errorCode: 'NO_DATA' }, { status: 400 })
    }

    await mailer.transport.sendMail({
      from: mailer.from, to: email,
      subject: `[Test] ${mail.subject}`,
      html: mail.html, text: mail.text, attachments: mail.attachments,
      ...(mailer.replyTo ? { replyTo: mailer.replyTo } : {}),
      headers: AUTO_HEADERS,
    })
    mailer.transport.close()

    // FASE IF. El botón de prueba probaba TODO menos la única pieza que el
    // envío automático no comparte con él: cómo el cron encuentra a los
    // suscriptores (una consulta de grupo de colecciones que exige un índice
    // y que nunca había corrido en producción). Ahora la ejercita también y
    // reporta el resultado, así "la prueba llega pero el automático no" deja
    // de ser un misterio que solo los logs de la plataforma pueden resolver.
    let cronLookup = null
    try {
      const flag = cadence === 'weekly' ? 'notifyWeekly' : cadence === 'monthly' ? 'notifyMonthly' : 'notifyAnnual'
      const found = await findSubscribers(db, flag)
      cronLookup = {
        flag,
        found: found.docs.length,
        via: found.via,
        includesYou: found.docs.some((d) => d.ref.parent.parent?.id === uid),
        ...(found.error ? { error: found.error } : {}),
      }
    } catch (e) {
      cronLookup = { error: e?.message || String(e) }
    }

    return NextResponse.json({ ok: true, sentTo: email, attached: mail.attachments.length > 0, cronLookup })
  } catch (err) {
    // El mensaje del servidor SMTP viaja de vuelta a propósito: si Zoho
    // rechaza la autenticación, saberlo aquí ahorra una ronda de logs.
    console.error('[notifications/test] failed:', err.message)
    return NextResponse.json({ error: err.message || 'Send failed', errorCode: 'SEND_FAILED' }, { status: 502 })
  }
}
